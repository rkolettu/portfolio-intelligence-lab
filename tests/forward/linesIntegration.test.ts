// Task 11 integration / regression tests: the three line definitions are built on the
// REAL forward chain (risk model -> CAPM prior -> BL inputs -> BL posterior ->
// tangency -> expected returns) and must reuse, never recompute, what Tasks 2, 3, 4,
// 7 and 10 certified. Unit-level behaviour of lines.ts lives in lines.test.ts; this
// file only checks cross-task consistency, lineage and the module boundary.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildCapmPrior, capmRequiredReturn, expectedMarketReturn } from "@/lib/forward/capm";
import { buildForwardExpectedReturns } from "@/lib/forward/expectedReturns";
import {
  buildMarketCmlProxy,
  buildModelCal,
  buildSecurityMarketLine,
  capitalLineReturnAt,
  securityMarketLineReturnAt,
} from "@/lib/forward/lines";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { buildTangencyPortfolio } from "@/lib/forward/tangency";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import type {
  CapmPrior,
  ForwardExpectedReturnsResult,
  ForwardRiskFree,
  ForwardRiskModel,
  MarketProxy,
  TangencyPortfolio,
} from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

// Spy on the canonical CAPM function while keeping its real behaviour, so a test can
// prove the SML is evaluated THROUGH it rather than by a second Rf + β·MRP.
vi.mock("@/lib/forward/capm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forward/capm")>();
  return { ...actual, capmRequiredReturn: vi.fn(actual.capmRequiredReturn) };
});

const EPS = Number.EPSILON;
const OBSERVATION_DATE = "2024-06-03";

const forwardRiskFree = (
  annualYield = 0.0513,
  fetchedAt = "2024-06-04T15:00:00Z",
  cacheAgeSeconds = 0,
): ForwardRiskFree => ({
  series: "DGS1",
  maturity: "1Y",
  observationDate: OBSERVATION_DATE,
  annualYield,
  provenance: {
    provider: "fixture",
    fetchedAt,
    lastSuccessfulRefresh: fetchedAt,
    cacheAgeSeconds,
    observationDate: OBSERVATION_DATE,
    fallbackUsed: false,
    warnings: [],
  },
});

function ok<T extends { available: boolean }>(out: T): Extract<T, { available: true }> {
  if (!out.available) throw new Error(`expected an available outcome: ${JSON.stringify(out)}`);
  return out as Extract<T, { available: true }>;
}

const modelCache = new Map<string, ForwardRiskModel>();
function riskModelFor(universe: string[], proxy: MarketProxy): ForwardRiskModel {
  const key = `${proxy}|${universe.join(",")}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const built = buildForwardRiskModel({
    universe,
    marketProxy: proxy,
    riskWindow: "3Y",
    requestedStartDate: FORWARD_START_3Y,
    endDate: FORWARD_END,
    prices: ["AAA", "BBB", "CCC", "DDD", "VTI", "SPY"].map((t) => fixtureSeries(t)),
    sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
  });
  const model = ok(built).model;
  modelCache.set(key, model);
  return model;
}

type Scenario = {
  name: string;
  universe: string[];
  proxy: MarketProxy;
  mrp: number;
  views: Record<string, unknown>;
  riskFree?: ForwardRiskFree;
};
const manual = (manualReturn: number, confidence: number) => ({ source: "manual", manualReturn, confidence });

/** The real forward chain through Task 10, then the three lines on top of it. */
function chain(s: Scenario) {
  const model = riskModelFor(s.universe, s.proxy);
  const prior = ok(
    buildCapmPrior({ riskModel: model, riskFree: s.riskFree ?? forwardRiskFree(), marketRiskPremium: s.mrp }),
  ).prior;
  const inputs = ok(buildBlackLittermanInputs({ riskModel: model, views: s.views })).inputs;
  const posterior = ok(buildBlackLittermanPosterior({ capmPrior: prior, riskModel: model, inputs })).posterior;
  const tangencyOutcome = buildTangencyPortfolio({ riskModel: model, capmPrior: prior, posterior });
  const expectedFor = (weights: { ticker: string; weight: number }[]) =>
    ok(buildForwardExpectedReturns({ riskModel: model, capmPrior: prior, inputs, posterior, weights })).result;
  // A deterministic mixed portfolio: equal risky weights plus 10% CASH.
  const mixed = [
    ...model.tickers.map((ticker) => ({ ticker, weight: 0.9 / model.tickers.length })),
    { ticker: "CASH", weight: 0.1 },
  ];
  return {
    model,
    prior,
    inputs,
    posterior,
    tangencyOutcome,
    expectedFor,
    expected: expectedFor(mixed),
    cal: buildModelCal(tangencyOutcome),
    cml: buildMarketCmlProxy({ riskModel: model, capmPrior: prior }),
    sml: buildSecurityMarketLine({ capmPrior: prior }),
  };
}

const AVAILABLE_SCENARIOS: Scenario[] = [
  {
    name: "prior-only BL, VTI proxy, MRP 5%",
    universe: ["AAA", "BBB", "CCC", "DDD"],
    proxy: "VTI",
    mrp: 0.05,
    views: {},
  },
  {
    name: "posterior with two manual views, MRP 6%",
    universe: ["AAA", "BBB", "CCC", "DDD"],
    proxy: "VTI",
    mrp: 0.06,
    views: { AAA: manual(0.18, 0.6), CCC: manual(0.02, 0.4) },
  },
  {
    name: "the proxy VTI is itself held (beta exactly 1), MRP 4.5%",
    universe: ["AAA", "BBB", "VTI"],
    proxy: "VTI",
    mrp: 0.045,
    views: { BBB: manual(0.12, 0.5) },
  },
  {
    name: "SPY proxy, another Rf, MRP 7%",
    universe: ["DDD", "CCC", "BBB", "AAA"],
    proxy: "SPY",
    mrp: 0.07,
    views: { DDD: manual(0.1, 0.3) },
    riskFree: forwardRiskFree(0.0391),
  },
];

/** The anchor allowance the methodology defines: 4·ε·(|intercept| + |slope·x| + |y|). */
const allowance = (intercept: number, slope: number, x: number, y: number) =>
  FORWARD_METHODOLOGY.lines.anchorAllowanceUlps * EPS * (Math.abs(intercept) + Math.abs(slope * x) + Math.abs(y));

/** The chain plus the three available lines; built in beforeAll so one failing
 * scenario fails its own tests instead of the whole file's collection. */
function prepare(scenario: Scenario) {
  const c = chain(scenario);
  const t: TangencyPortfolio = ok(c.tangencyOutcome).tangency;
  return {
    c,
    t,
    cal: ok(c.cal).line,
    cml: ok(c.cml).line,
    sml: ok(c.sml).line,
    rf: c.prior.riskFreeRate,
    mrp: c.prior.marketRiskPremium,
  };
}

describe.each(AVAILABLE_SCENARIOS)("lines on the real forward chain: $name", (scenario) => {
  let ctx!: ReturnType<typeof prepare>;
  beforeAll(() => {
    ctx = prepare(scenario);
  });

  it("Task 2: all three lines reuse the one forward Rf and its observation date", () => {
    const { c, t, cal, cml, sml, rf } = ctx;
    expect(rf).toBe(scenario.riskFree?.annualYield ?? 0.0513);
    expect(t.riskFreeRate).toBe(rf);
    expect(cal.intercept).toBe(rf);
    expect(cml.intercept).toBe(rf);
    expect(sml.intercept).toBe(rf);
    for (const line of [cal, cml, sml]) {
      expect(line.riskFreeRate).toBe(rf);
      expect(line.riskFreeObservationDate).toBe(c.prior.riskFreeObservationDate);
      expect(line.riskFreeObservationDate).toBe(OBSERVATION_DATE);
      expect(line.riskFreeObservationDate).toBe(t.riskFreeObservationDate);
    }
    // CASH sits at the intercept of every line: β = 0 on the SML, σ = 0 on the capital lines.
    expect(securityMarketLineReturnAt(sml, 0)).toBe(c.prior.cash.expectedReturn);
    expect(capitalLineReturnAt(cal, 0)).toBe(c.prior.cash.expectedReturn);
    expect(capitalLineReturnAt(cml, 0)).toBe(c.prior.cash.expectedReturn);
  });

  it("Task 3: the CML uses the risk model's σ_m and the SML reproduces every Forward Model Beta prior exactly", () => {
    const { c, cml, sml, rf, mrp } = ctx;
    expect(cml.marketProxyVolatility).toBe(c.model.marketVolatility);
    expect(cml.solidThroughVolatility).toBe(c.model.marketVolatility);
    expect(cml.slope).toBe(mrp / c.model.marketVolatility);
    expect(c.prior.rows.map((r) => r.ticker)).toEqual(c.model.tickers);
    c.model.tickers.forEach((ticker, i) => {
      // Same function, same inputs: bit-identical, not merely close.
      expect(securityMarketLineReturnAt(sml, c.model.modelBeta[i]), ticker).toBe(c.prior.rows[i].capmPrior);
      expect(securityMarketLineReturnAt(sml, c.prior.rows[i].forwardModelBeta), ticker).toBe(
        c.prior.rows[i].capmPrior,
      );
      expect(capmRequiredReturn(rf, c.model.modelBeta[i], mrp), ticker).toBe(c.prior.rows[i].capmPrior);
    });
  });

  it("Task 4: E[R_m] is the one canonical Rf + MRP; the CML ends there and the SML passes through it at β = 1", () => {
    const { c, cml, sml, rf, mrp } = ctx;
    expect(cml.expectedMarketReturn).toBe(c.prior.expectedMarketReturn);
    expect(cml.expectedMarketReturn).toBe(expectedMarketReturn(rf, mrp));
    expect(cml.marketRiskPremium).toBe(mrp);
    expect(sml.marketRiskPremium).toBe(mrp);
    expect(sml.slope).toBe(mrp);
    expect(securityMarketLineReturnAt(sml, 1)).toBe(c.prior.expectedMarketReturn);
    expect(securityMarketLineReturnAt(sml, 1)).toBe(expectedMarketReturn(rf, mrp));
    // The CML's anchor identity: it reaches E[R_m] at σ_m, within the rounding allowance.
    const atMarket = capitalLineReturnAt(cml, c.model.marketVolatility);
    const allowed = allowance(cml.intercept, cml.slope, c.model.marketVolatility, cml.expectedMarketReturn);
    expect(Math.abs(atMarket - cml.expectedMarketReturn)).toBeLessThanOrEqual(allowed);
    expect(Math.abs(cml.anchorAllowance - allowed)).toBeLessThanOrEqual(allowed * 1e-9);
    expect(cml.anchorResidual).toBeLessThanOrEqual(cml.anchorAllowance);
    expect(cml.anchorAllowance).toBeGreaterThan(0);
    expect(cml.anchorAllowance).toBeLessThan(1e-12);
    // A held proxy has β = 1 exactly and therefore sits exactly on the market return.
    if (c.model.proxyInUniverse) {
      const k = c.model.tickers.indexOf(scenario.proxy);
      expect(c.prior.rows[k].capmPrior).toBe(c.prior.expectedMarketReturn);
      expect(securityMarketLineReturnAt(sml, c.model.modelBeta[k])).toBe(c.prior.expectedMarketReturn);
    }
  });

  it("Task 7: Expected Return Gap = BL return − SML return at the security's own Forward Model Beta", () => {
    const { c, cml, sml } = ctx;
    const result: ForwardExpectedReturnsResult = c.expected;
    expect(result.rows.map((r) => r.ticker)).toEqual(c.model.tickers);
    for (const row of result.rows) {
      const onSml = securityMarketLineReturnAt(sml, row.forwardModelBeta);
      expect(onSml, row.ticker).toBe(row.capmPrior);
      expect(row.blackLittermanExpectedReturn - onSml, row.ticker).toBe(row.expectedReturnGap);
    }
    // CASH: β = 0, on the SML intercept, gap 0.
    expect(result.cash).not.toBeNull();
    expect(securityMarketLineReturnAt(sml, 0)).toBe(result.cash!.capmPrior);
    expect(result.cash!.blackLittermanExpectedReturn - securityMarketLineReturnAt(sml, 0)).toBe(
      result.cash!.expectedReturnGap,
    );
    // The portfolio's CAPM required return is the SML at the portfolio's own beta.
    const p = result.portfolio;
    expect(p.capmRequiredReturn).toBe(securityMarketLineReturnAt(sml, p.forwardModelBeta));
    expect(p.expectedReturn - securityMarketLineReturnAt(sml, p.forwardModelBeta)).toBe(p.expectedReturnGap);
    // The Task 7 result and the lines share one Rf, MRP, E[R_m] and lineage.
    expect(result.riskFreeRate).toBe(sml.intercept);
    expect(result.marketRiskPremium).toBe(sml.marketRiskPremium);
    expect(result.expectedMarketReturn).toBe(cml.expectedMarketReturn);
    expect(result.riskFreeObservationDate).toBe(sml.riskFreeObservationDate);
  });

  it("Task 10: the CAL is the certified tangency's Rf and Forward Model Sharpe, anchored at (σ_t, μ_t)", () => {
    const { t, cal } = ctx;
    expect(cal.kind).toBe("model_cal");
    expect(cal.slope).toBe(t.forwardModelSharpe);
    expect(cal.intercept).toBe(t.riskFreeRate);
    expect(cal.tangencyHash).toBe(t.tangencyHash);
    expect(cal.solidThroughVolatility).toBe(t.volatility);
    expect(cal.tangencyVolatility).toBe(t.volatility);
    expect(cal.tangencyExpectedReturn).toBe(t.expectedReturn);
    const atTangency = capitalLineReturnAt(cal, t.volatility);
    const allowed = allowance(cal.intercept, cal.slope, t.volatility, t.expectedReturn);
    expect(Math.abs(atTangency - t.expectedReturn)).toBeLessThanOrEqual(cal.anchorAllowance);
    expect(Math.abs(cal.anchorAllowance - allowed)).toBeLessThanOrEqual(allowed * 1e-9);
    expect(cal.anchorResidual).toBeLessThanOrEqual(cal.anchorAllowance);
    expect(Math.abs(cal.anchorResidual - Math.abs(atTangency - t.expectedReturn))).toBeLessThanOrEqual(
      cal.anchorAllowance,
    );
    expect(cal.anchorAllowance).toBeGreaterThan(0);
    expect(cal.anchorAllowance).toBeLessThan(1e-12);
  });

  it("the dashed leverage extension keeps the same Sharpe: 2σ_t earns Rf + 2(μ_t − Rf)", () => {
    const { c, t, cal, cml, rf, mrp } = ctx;
    expect(capitalLineReturnAt(cal, 2 * t.volatility)).toBeCloseTo(rf + 2 * (t.expectedReturn - rf), 12);
    expect((capitalLineReturnAt(cal, 3 * t.volatility) - rf) / (3 * t.volatility)).toBeCloseTo(
      t.forwardModelSharpe,
      12,
    );
    expect(capitalLineReturnAt(cml, 2 * c.model.marketVolatility)).toBeCloseTo(
      rf + 2 * mrp,
      12,
    );
  });

  it("Task 7 + 10 + 11: the tangency portfolio lies on the Model CAL, every other long-only portfolio on or below it", () => {
    const { c, t, cal } = ctx;
    const atTangencyWeights = c.expectedFor(t.tickers.map((ticker, i) => ({ ticker, weight: t.weights[i] })));
    const pt = atTangencyWeights.portfolio;
    expect(pt.expectedReturn).toBeCloseTo(t.expectedReturn, 9);
    expect(pt.modelVolatility).toBeCloseTo(t.volatility, 9);
    expect(Math.abs(capitalLineReturnAt(cal, pt.modelVolatility) - pt.expectedReturn)).toBeLessThan(1e-9);
    // Equal-weight with CASH, and each single security: on or below the CAL.
    const others = [
      c.expected.portfolio,
      ...c.model.tickers.map((ticker) => c.expectedFor([{ ticker, weight: 1 }]).portfolio),
      c.expectedFor([
        { ticker: c.model.tickers[0], weight: 0.5 },
        { ticker: "CASH", weight: 0.5 },
      ]).portfolio,
    ];
    for (const p of others) {
      expect(p.expectedReturn).toBeLessThanOrEqual(capitalLineReturnAt(cal, p.modelVolatility) + 1e-9);
    }
  });

  it("lineage: every line shares the chain's risk model hash, proxy, risk window and methodology version", () => {
    const { c, t, cal, cml, sml } = ctx;
    for (const line of [cal, cml, sml]) {
      expect(line.riskModelHash).toBe(c.model.hash);
      expect(line.riskModelHash).toBe(c.prior.riskModelHash);
      expect(line.marketProxy).toBe(scenario.proxy);
      expect(line.marketProxy).toBe(c.model.marketProxy);
      expect(line.marketProxy).toBe(c.prior.marketProxy);
      expect(line.riskWindow).toBe("3Y");
      expect(line.riskWindow).toBe(c.prior.riskWindow);
      expect(line.riskWindow).toBe(t.riskWindow);
      expect(line.methodologyVersion).toBe(FORWARD_METHODOLOGY.version);
      expect(line.methodologyVersion).toBe(c.prior.methodologyVersion);
      expect(line.lineHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(cal.riskModelHash).toBe(t.riskModelHash);
    expect(new Set([cal.lineHash, cml.lineHash, sml.lineHash]).size).toBe(3);
  });

  it("definitions only: no chart domain, colour, dash style or sampled points; labels never call the CAL a CML", () => {
    const { cal, cml, sml } = ctx;
    for (const line of [cal, cml, sml]) {
      expect(Object.keys(line).filter((k) => /colou?r|dash|stroke|domain|points|axis/i.test(k))).toEqual([]);
    }
    expect(JSON.stringify(cal)).not.toMatch(/cml/i);
    expect([cal.kind, cml.kind, sml.kind]).toEqual(["model_cal", "market_cml_proxy", "security_market_line"]);
    expect(sml.direction).toBe("upward");
  });

  it("the builders are pure: same certified inputs give identical lines and never mutate them", () => {
    const { c } = ctx;
    const before = structuredClone({ t: c.tangencyOutcome, prior: c.prior });
    const again = {
      cal: buildModelCal(c.tangencyOutcome),
      cml: buildMarketCmlProxy({ riskModel: c.model, capmPrior: c.prior }),
      sml: buildSecurityMarketLine({ capmPrior: c.prior }),
    };
    expect(again).toEqual({ cal: c.cal, cml: c.cml, sml: c.sml });
    expect(structuredClone({ t: c.tangencyOutcome, prior: c.prior })).toEqual(before);
  });
});

describe("lineage sensitivity on the real chain", () => {
  const base: Scenario = AVAILABLE_SCENARIOS[1];
  const lines = (s: Scenario) => {
    const c = chain(s);
    return { cal: ok(c.cal).line, cml: ok(c.cml).line, sml: ok(c.sml).line };
  };
  let b!: ReturnType<typeof lines>;
  beforeAll(() => {
    b = lines(base);
  });

  it("the same economics (universe order, provenance, view key order) give identical lines and hashes", () => {
    const other = lines({
      ...base,
      universe: ["DDD", "CCC", "BBB", "AAA"],
      views: { CCC: { confidence: 0.4, manualReturn: 0.02, source: "manual" }, AAA: manual(0.18, 0.6) },
      riskFree: forwardRiskFree(0.0513, "2024-06-04T20:00:00Z", 7200),
    });
    expect(other).toEqual(b);
  });

  it("views move only the CAL: the CML and SML depend on Rf, MRP and the risk model alone", () => {
    const moved = lines({ ...base, views: { AAA: manual(0.25, 0.9) } });
    expect(moved.cal.lineHash).not.toBe(b.cal.lineHash);
    expect(moved.cal.slope).not.toBe(b.cal.slope);
    expect(moved.cal.tangencyHash).not.toBe(b.cal.tangencyHash);
    expect(moved.cml).toEqual(b.cml);
    expect(moved.sml).toEqual(b.sml);
  });

  it("the MRP moves all three lines (and the CML/SML slopes follow it exactly)", () => {
    const moved = lines({ ...base, mrp: 0.08 });
    for (const k of ["cal", "cml", "sml"] as const) expect(moved[k].lineHash).not.toBe(b[k].lineHash);
    expect(moved.sml.slope).toBe(0.08);
    expect(moved.cml.expectedMarketReturn).toBe(expectedMarketReturn(0.0513, 0.08));
  });

  it("Rf moves all three intercepts and hashes", () => {
    const moved = lines({ ...base, riskFree: forwardRiskFree(0.0413) });
    for (const k of ["cal", "cml", "sml"] as const) {
      expect(moved[k].intercept).toBe(0.0413);
      expect(moved[k].lineHash).not.toBe(b[k].lineHash);
    }
  });

  it("the market proxy moves the risk-model lineage and the CML/SML hashes", () => {
    const moved = lines({ ...base, proxy: "SPY" });
    for (const k of ["cal", "cml", "sml"] as const) {
      expect(moved[k].marketProxy).toBe("SPY");
      expect(moved[k].riskModelHash).not.toBe(b[k].riskModelHash);
      expect(moved[k].lineHash).not.toBe(b[k].lineHash);
    }
  });
});

describe("lines on the real chain when the economics say a line does not exist", () => {
  const universe = ["AAA", "BBB", "CCC", "DDD"];
  const lift = { CCC: manual(0.2, 0.5) };

  it("negative MRP with a view above Rf: the CAL exists, the CML does not, the SML slopes downward", () => {
    const c = chain({ name: "", universe, proxy: "VTI", mrp: -0.05, views: lift });
    const cal = ok(c.cal).line;
    expect(cal.slope).toBeGreaterThan(0);
    expect(cal.slope).toBe(ok(c.tangencyOutcome).tangency.forwardModelSharpe);
    expect(c.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: -0.05,
    });
    const sml = ok(c.sml).line;
    expect(sml.direction).toBe("downward");
    expect(sml.slope).toBe(-0.05);
    // A negative-MRP SML is still the canonical formula, not a clamped or flipped line.
    c.model.tickers.forEach((_, i) =>
      expect(securityMarketLineReturnAt(sml, c.model.modelBeta[i])).toBe(c.prior.rows[i].capmPrior),
    );
    expect(securityMarketLineReturnAt(sml, 1)).toBe(c.prior.expectedMarketReturn);
  });

  it("MRP = 0 with a view above Rf: CAL exists, CML unavailable, SML flat at Rf for every beta", () => {
    const c = chain({ name: "", universe, proxy: "VTI", mrp: 0, views: lift });
    expect(ok(c.cal).line.slope).toBeGreaterThan(0);
    expect(c.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: 0,
    });
    const sml = ok(c.sml).line;
    expect(sml.direction).toBe("flat");
    for (const beta of [-1, 0, 0.5, 1, 2.5]) expect(securityMarketLineReturnAt(sml, beta)).toBe(sml.intercept);
  });

  it("no tangency (MRP = 0, no views): the CAL carries the tangency's own unavailability through; the SML still exists", () => {
    const c = chain({ name: "", universe, proxy: "VTI", mrp: 0, views: {} });
    const t = c.tangencyOutcome;
    expect(t).toMatchObject({ available: false, code: "no_positive_excess_return" });
    if (t.available) throw new Error("unreachable");
    expect(c.cal).toEqual({ available: false, code: t.code, reason: t.reason, cause: t.cause });
    expect(c.cml.available).toBe(false);
    expect(ok(c.sml).line.direction).toBe("flat");
  });

  it("negative MRP and no view above Rf: no tangency, so no CAL and no CML, but a downward SML", () => {
    const c = chain({ name: "", universe, proxy: "VTI", mrp: -0.05, views: {} });
    expect(c.tangencyOutcome).toMatchObject({ available: false, code: "no_positive_excess_return" });
    expect(c.cal.available).toBe(false);
    expect(c.cml.available).toBe(false);
    expect(ok(c.sml).line.direction).toBe("downward");
  });

  it("the CML threshold is the tangency's 1e-12 positive-excess tolerance: MRP = 1e-12 unavailable, 2e-12 available", () => {
    const tolerance = FORWARD_METHODOLOGY.tangency.positiveExcessReturnTolerance;
    expect(tolerance).toBe(1e-12);
    const model = riskModelFor(universe, "VTI");
    const priorAt = (mrp: number) =>
      ok(buildCapmPrior({ riskModel: model, riskFree: forwardRiskFree(), marketRiskPremium: mrp })).prior;
    expect(buildMarketCmlProxy({ riskModel: model, capmPrior: priorAt(tolerance) })).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
    });
    const above = ok(buildMarketCmlProxy({ riskModel: model, capmPrior: priorAt(2 * tolerance) })).line;
    expect(above.slope).toBe((2 * tolerance) / model.marketVolatility);
    expect(above.expectedMarketReturn).toBe(0.0513 + 2 * tolerance);
    // The SML exists at every MRP in the valid range, including the boundaries.
    for (const mrp of [-0.1, 0, tolerance, 0.2]) {
      expect(ok(buildSecurityMarketLine({ capmPrior: priorAt(mrp) })).line.slope).toBe(mrp);
    }
  });

  it("inconsistent or non-finite inputs are rejected, never silently drawn", () => {
    const c = chain(AVAILABLE_SCENARIOS[0]);
    const withPrior = (patch: Partial<CapmPrior>): CapmPrior => ({ ...c.prior, ...patch });
    const rejected = (out: { available: boolean; code?: string }) =>
      expect(out).toMatchObject({ available: false, code: "invalid_inputs" });
    rejected(buildSecurityMarketLine({ capmPrior: withPrior({ riskFreeRate: Number.NaN }) }));
    rejected(buildSecurityMarketLine({ capmPrior: withPrior({ marketRiskPremium: Number.POSITIVE_INFINITY }) }));
    rejected(
      buildMarketCmlProxy({
        riskModel: { hash: c.model.hash, marketProxy: c.model.marketProxy, marketVolatility: 0 },
        capmPrior: c.prior,
      }),
    );
    rejected(
      buildMarketCmlProxy({
        riskModel: { hash: c.model.hash, marketProxy: c.model.marketProxy, marketVolatility: Number.NaN },
        capmPrior: c.prior,
      }),
    );
    // The prior and the risk model must describe the same model (hash and proxy).
    rejected(
      buildMarketCmlProxy({
        riskModel: { hash: "another-risk-model", marketProxy: c.model.marketProxy, marketVolatility: c.model.marketVolatility },
        capmPrior: c.prior,
      }),
    );
    rejected(
      buildMarketCmlProxy({
        riskModel: { hash: c.model.hash, marketProxy: "SPY", marketVolatility: c.model.marketVolatility },
        capmPrior: c.prior,
      }),
    );
  });
});

describe("one implementation per formula", () => {
  it("the SML is evaluated through the canonical capmRequiredReturn(Rf, β, MRP)", () => {
    const c = chain(AVAILABLE_SCENARIOS[1]);
    const sml = ok(c.sml).line;
    const spy = vi.mocked(capmRequiredReturn);
    for (const beta of [-0.4, 0, 0.2, 1, 1.37]) {
      spy.mockClear();
      const value = securityMarketLineReturnAt(sml, beta);
      expect(spy, `β = ${beta}`).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(c.prior.riskFreeRate, beta, c.prior.marketRiskPremium);
      expect(value).toBe(spy.mock.results[0].value);
    }
  });

  it("capital lines are intercept + slope·σ and nothing else (no floor, clamp or rescale)", () => {
    const line = { intercept: 0.0513, slope: 0.4 };
    expect(capitalLineReturnAt(line, 0)).toBe(0.0513);
    expect(capitalLineReturnAt(line, 0.25)).toBe(0.0513 + 0.4 * 0.25);
    expect(capitalLineReturnAt(line, 5)).toBe(0.0513 + 0.4 * 5);
    expect(capitalLineReturnAt({ intercept: 0.0513, slope: -0.4 }, 5)).toBe(0.0513 - 0.4 * 5);
  });
});

describe("module boundary", () => {
  const file = "lib/forward/lines.ts";
  const raw = readFileSync(file, "utf8");
  // Comments may legitimately mention the historical engine or Street data ("never ...").
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const imports = [...code.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);

  it("imports only the line types, the CAPM function, methodology config and SHA-256 (errors optional)", () => {
    const allowed = [
      "./capm",
      "@/config/methodology",
      "@/lib/types/forward",
      "@/lib/utils/errors",
      "@/lib/utils/sha256",
    ];
    const required = ["./capm", "@/config/methodology", "@/lib/types/forward", "@/lib/utils/sha256"];
    const distinct = [...new Set(imports)].sort();
    expect(distinct.filter((i) => !allowed.includes(i))).toEqual([]);
    expect(distinct.filter((i) => required.includes(i))).toEqual(required.slice().sort());
  });

  it("has no side-effect, dynamic or CommonJS imports", () => {
    expect(code).not.toMatch(/^\s*import\s+["']/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bexport\s+\*\s+from/);
  });

  it("touches no historical engine, server, provider, Node or UI module", () => {
    expect(imports.filter((i) => /analytics|backtest|server|data|components|app\/|providers?|^node:|^fs|^path|react|next/.test(i))).toEqual([]);
    expect(code).not.toMatch(/server-only|use client|node:/);
    // Browser-safe and deterministic: no clock, randomness, process or network access.
    expect(code).not.toMatch(/Math\.random|Date\.now|new Date\b|process\.|fetch\s*\(|window\.|document\./);
  });

  it("uses no historical CAGR/alpha or Street data and no second CAPM or capital-line formula", () => {
    expect(code).not.toMatch(/cagr|alpha|street|historical|jensen/i);
    // The canonical function is imported and called; the formula is not re-derived here.
    expect(code).toMatch(/\bcapmRequiredReturn\s*\(/);
    expect(code).not.toMatch(/\bbeta\s*\*\s*\w*(mrp|marketRiskPremium|slope)|\w*(mrp|marketRiskPremium|slope)\w*\s*\*\s*beta/i);
  });

  it("the other forward modules do not import the line engine (it stays a leaf above Task 4/10)", () => {
    for (const other of ["capm", "riskModel", "riskFree", "expectedReturns", "tangency", "frontier", "blackLitterman", "views"]) {
      const text = readFileSync(`lib/forward/${other}.ts`, "utf8");
      expect(text, other).not.toMatch(/from "(\.\/lines|@\/lib\/forward\/lines)"/);
    }
  });
});
