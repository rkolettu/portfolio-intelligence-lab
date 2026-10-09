// Independent (specification-derived) tests for the V2 line engine, Task 11: the Model
// Capital Allocation Line, the Market CML Proxy and the Security Market Line.
// Expected values are computed here from the formulas in the specification, never
// from the implementation:
//   Model CAL        E[R](σ) = Rf + Sharpe_t·σ, anchored at (0, Rf) and (σ_t, μ_t)
//   Market CML Proxy E[R](σ) = Rf + (MRP/σ_m)·σ, anchored at (0, Rf) and (σ_m, Rf + MRP);
//                    unavailable whenever MRP ≤ 1e-12
//   SML              E[R](β) = capmRequiredReturn(Rf, β, MRP); defined for every finite MRP
//   anchor identities hold within 4·ε·(|Rf| + |slope·x| + |y|)
import { describe, expect, it, vi } from "vitest";
import {
  buildMarketCmlProxy,
  buildModelCal,
  buildSecurityMarketLine,
  capitalLineReturnAt,
  securityMarketLineReturnAt,
} from "@/lib/forward/lines";
import { buildTangencyPortfolio } from "@/lib/forward/tangency";
import { buildCapmPrior, capmRequiredReturn, expectedMarketReturn } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions, forwardRiskWindowDates } from "@/lib/forward/sample";
import { solveLinear } from "@/lib/analytics/construction/common";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  CapmPrior,
  ForwardRiskFree,
  ForwardRiskModel,
  MarketCmlProxy,
  MarketCmlProxyOutcome,
  MarketProxy,
  ModelCal,
  ModelCalOutcome,
  RiskWindow,
  SecurityMarketLine,
  SecurityMarketLineOutcome,
  TangencyOutcome,
} from "@/lib/types/forward";
import { FORWARD_NOW, fixtureSeries } from "../fixtures/forward";

// The SML must be evaluated ONLY through the canonical capmRequiredReturn: wrap it in a
// call-through spy (behaviour unchanged) so that can be observed.
vi.mock("@/lib/forward/capm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forward/capm")>();
  return { ...actual, capmRequiredReturn: vi.fn(actual.capmRequiredReturn) };
});

// ---------------------------------------------------------------------------------
// Helpers: arithmetic, floating-point neighbours, synthetic inputs
// ---------------------------------------------------------------------------------

const EPS = Number.EPSILON;
const TOLERANCE = 1e-12;
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const quadratic = (S: readonly (readonly number[])[], w: readonly number[]) =>
  w.reduce((s, wi, i) => s + wi * dot(S[i], w), 0);

/** The next double above a positive finite x, by incrementing its bit pattern. */
function nextUp(x: number): number {
  const f = new Float64Array([x]);
  new BigUint64Array(f.buffer)[0] += 1n;
  return f[0];
}
/** The next double below a positive finite x. */
function nextDown(x: number): number {
  const f = new Float64Array([x]);
  new BigUint64Array(f.buffer)[0] -= 1n;
  return f[0];
}
const NEXT_ABOVE_TOLERANCE = nextUp(1e-12);

/** The specified anchor rounding allowance: 4·ε·(|Rf| + |slope·x| + |y|). */
const allowance = (rf: number, slope: number, x: number, y: number) =>
  4 * EPS * (Math.abs(rf) + Math.abs(slope * x) + Math.abs(y));

const reverseKeys = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).reverse()) as T;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** A consistent synthetic CAPM prior in the shape buildCapmPrior produces. */
function prior(rf: number, mrp: number, o: Partial<CapmPrior> = {}): CapmPrior {
  return {
    methodologyVersion: FORWARD_METHODOLOGY.version,
    riskModelHash: "rm-hash-1",
    marketProxy: "VTI",
    riskWindow: "3Y",
    riskFreeRate: rf,
    riskFreeObservationDate: "2024-06-03",
    riskFreeSource: "fixture-provider",
    marketRiskPremium: mrp,
    expectedMarketReturn: expectedMarketReturn(rf, mrp),
    rows: [
      { ticker: "AAA", forwardModelBeta: 0.8, capmPrior: capmRequiredReturn(rf, 0.8, mrp) },
      { ticker: "BBB", forwardModelBeta: 1.3, capmPrior: capmRequiredReturn(rf, 1.3, mrp) },
    ],
    cash: { ticker: "CASH", forwardModelBeta: 0, expectedReturn: rf },
    ...o,
  };
}
type MarketModel = Pick<ForwardRiskModel, "hash" | "marketProxy" | "marketVolatility">;
const marketModel = (sigmaM: number, o: Partial<MarketModel> = {}): MarketModel => ({
  hash: "rm-hash-1",
  marketProxy: "VTI",
  marketVolatility: sigmaM,
  ...o,
});

const calOf = (o: ModelCalOutcome): ModelCal => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.line;
};
const cmlOf = (o: MarketCmlProxyOutcome): MarketCmlProxy => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.line;
};
const smlOf = (o: SecurityMarketLineOutcome): SecurityMarketLine => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.line;
};
const cml = (rf: number, mrp: number, sigmaM = 0.15) =>
  buildMarketCmlProxy({ riskModel: marketModel(sigmaM), capmPrior: prior(rf, mrp) });

// ---------------------------------------------------------------------------------
// Synthetic tangencies (the Task 10 call pattern) and a seeded factor-style Σ
// ---------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A positive-definite Σ (two common factors plus idiosyncratic variance) and μ. */
function seededModel(n: number, seed: number) {
  const rand = mulberry32(seed);
  const load = Array.from({ length: n }, () => [rand() * 0.5 - 0.1, rand() * 0.4 - 0.1]);
  const idio = Array.from({ length: n }, () => 0.01 + rand() * 0.05);
  const sigma = load.map((a, i) =>
    load.map((b, j) => (a[0] * b[0] + a[1] * b[1]) * 0.06 + (i === j ? idio[i] : 0)),
  );
  const mu = Array.from({ length: n }, () => 0.01 + rand() * 0.15);
  return { sigma, mu };
}
const SIGMA3 = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];

function syntheticTangency(
  sigma: number[][],
  mu: number[],
  o: {
    rf?: number;
    hash?: string;
    tickers?: string[];
    proxy?: MarketProxy;
    window?: RiskWindow;
    date?: string;
    priorHash?: string;
    solve?: (A: number[][], b: number[]) => number[] | null;
  } = {},
): TangencyOutcome {
  const tickers = o.tickers ?? mu.map((_, i) => `T${i}`);
  const rf = o.rf ?? 0.04;
  const hash = o.hash ?? "synthetic-risk-model";
  const proxy = o.proxy ?? "VTI";
  const window = o.window ?? "3Y";
  return buildTangencyPortfolio({
    riskModel: { tickers, covariance: sigma, hash },
    capmPrior: {
      riskModelHash: o.priorHash ?? hash,
      riskFreeRate: rf,
      riskFreeObservationDate: o.date ?? "2024-06-03",
      marketProxy: proxy,
      riskWindow: window,
    },
    posterior: {
      riskModelHash: hash,
      universeTickers: tickers,
      blackLittermanExpectedReturn: mu,
      marketProxy: proxy,
      riskWindow: window,
      cash: { ticker: "CASH", forwardModelBeta: 0, expectedReturn: rf },
    },
    solve: o.solve,
  });
}
const availableTangency = (out: TangencyOutcome) => {
  if (!out.available) throw new Error(`${out.code}: ${out.reason}`);
  return out.tangency;
};

// ---------------------------------------------------------------------------------
// The real forward chain: risk model → CAPM prior → Black–Litterman → tangency → lines
// ---------------------------------------------------------------------------------

const RISK_FREE: ForwardRiskFree = {
  series: "DGS1",
  maturity: "1Y",
  observationDate: "2024-06-03",
  annualYield: 0.0513,
  provenance: {
    provider: "fixture",
    fetchedAt: "2024-06-04T15:00:00Z",
    lastSuccessfulRefresh: "2024-06-04T15:00:00Z",
    cacheAgeSeconds: 0,
    observationDate: "2024-06-03",
    fallbackUsed: false,
    warnings: [],
  },
};
const PRICES = ["AAA", "BBB", "CCC", "DDD", "VTI", "SPY", "VT"].map((t) => fixtureSeries(t));
const modelCache = new Map<string, ForwardRiskModel>();
function riskModelFor(universe: readonly string[], window: RiskWindow, proxy: MarketProxy) {
  const key = `${window}|${proxy}|${universe.join(",")}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const d = forwardRiskWindowDates(window, FORWARD_NOW);
  const r = buildForwardRiskModel({
    universe,
    marketProxy: proxy,
    riskWindow: window,
    requestedStartDate: d.requestedStartDate,
    endDate: d.endDate,
    prices: PRICES,
    sessions: forwardRiskSessions(d.requestedStartDate, d.endDate),
  });
  if (!r.available) throw new Error(r.reason);
  modelCache.set(key, r.model);
  return r.model;
}
const manual = (manualReturn: number, confidence: number) => ({ source: "manual", manualReturn, confidence });

function chain(
  o: {
    universe?: readonly string[];
    window?: RiskWindow;
    proxy?: MarketProxy;
    mrp?: number;
    views?: Record<string, unknown>;
    riskFree?: ForwardRiskFree;
  } = {},
) {
  const model = riskModelFor(o.universe ?? ["AAA", "BBB", "CCC", "DDD"], o.window ?? "3Y", o.proxy ?? "VTI");
  const capm = buildCapmPrior({
    riskModel: model,
    riskFree: o.riskFree ?? RISK_FREE,
    marketRiskPremium: o.mrp ?? 0.05,
  });
  if (!capm.available) throw new Error(capm.reason);
  const inputs = buildBlackLittermanInputs({ riskModel: model, views: o.views ?? {} });
  if (!inputs.available) throw new Error(inputs.reason);
  const posterior = buildBlackLittermanPosterior({
    capmPrior: capm.prior,
    riskModel: model,
    inputs: inputs.inputs,
  });
  if (!posterior.available) throw new Error(posterior.reason);
  const tangency = buildTangencyPortfolio({
    riskModel: model,
    capmPrior: capm.prior,
    posterior: posterior.posterior,
  });
  return {
    model,
    prior: capm.prior,
    tangency,
    cal: buildModelCal(tangency),
    cml: buildMarketCmlProxy({ riskModel: model, capmPrior: capm.prior }),
    sml: buildSecurityMarketLine({ capmPrior: capm.prior }),
  };
}

// ---------------------------------------------------------------------------------
// Specification grid
// ---------------------------------------------------------------------------------

const RFS = [-0.01, 0, 0.0513, 0.1];
const MRPS = [-0.1, -1e-6, 0, 5e-13, 1e-12, NEXT_ABOVE_TOLERANCE, 2e-12, 0.05, 0.2];
const SIGMAS = [1e-4, 0.15, 3];
const BETAS = [-1, 0, 0.5, 1, 1.5, 3];

describe("floating-point helpers used by the grid", () => {
  it("nextUp/nextDown step exactly one double, and the grid contains the boundary neighbours", () => {
    expect(nextUp(1)).toBe(1 + EPS);
    expect(nextDown(1)).toBe(1 - EPS / 2);
    expect(NEXT_ABOVE_TOLERANCE).toBeGreaterThan(1e-12);
    expect(nextDown(NEXT_ABOVE_TOLERANCE)).toBe(1e-12);
    expect(FORWARD_METHODOLOGY.tangency.positiveExcessReturnTolerance).toBe(TOLERANCE);
    expect(FORWARD_METHODOLOGY.lines.anchorAllowanceUlps).toBe(4);
  });
});

describe("Market CML Proxy: availability and anchors across Rf × MRP × σ_m", () => {
  for (const rf of RFS) {
    it(`Rf = ${rf}: exists exactly when MRP > 1e-12 and passes through (0, Rf) and (σ_m, Rf + MRP)`, () => {
      for (const mrp of MRPS)
        for (const sigmaM of SIGMAS) {
          const label = `Rf=${rf} MRP=${mrp} σ_m=${sigmaM}`;
          const out = cml(rf, mrp, sigmaM);
          expect(out.available, label).toBe(mrp > TOLERANCE);
          if (!out.available) {
            expect(out, label).toMatchObject({
              code: "market_proxy_has_no_positive_expected_excess_return",
              marketRiskPremium: mrp,
            });
            expect(out, label).not.toHaveProperty("line");
            continue;
          }
          const line = out.line;
          const slope = mrp / sigmaM;
          const expectedReturnM = rf + mrp;
          expect(line.kind, label).toBe("market_cml_proxy");
          expect(line.intercept, label).toBe(rf);
          expect(line.slope, label).toBe(slope);
          expect(line.slope, label).toBeGreaterThan(0);
          expect(line.marketRiskPremium, label).toBe(mrp);
          expect(line.marketProxyVolatility, label).toBe(sigmaM);
          expect(line.solidThroughVolatility, label).toBe(sigmaM);
          expect(line.expectedMarketReturn, label).toBe(expectedMarketReturn(rf, mrp));
          // Both anchors, within the specified allowance.
          const tolerance = allowance(rf, slope, sigmaM, expectedReturnM);
          expect(capitalLineReturnAt(line, 0), label).toBe(rf);
          expect(Math.abs(capitalLineReturnAt(line, 0) - rf), label).toBeLessThanOrEqual(tolerance);
          expect(
            Math.abs(capitalLineReturnAt(line, line.solidThroughVolatility) - expectedReturnM),
            label,
          ).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(line.anchorAllowance - tolerance), label).toBeLessThanOrEqual(1e-12 * tolerance);
          expect(line.anchorResidual, label).toBe(Math.abs(rf + slope * sigmaM - expectedReturnM));
          expect(line.anchorResidual, label).toBeLessThanOrEqual(line.anchorAllowance);
          expect(line.lineHash, label).toMatch(/^[0-9a-f]{64}$/);
        }
    });
  }

  it("the threshold is strict and exact in doubles: ≤ 1e-12 unavailable, the next double above exists", () => {
    for (const mrp of [nextDown(1e-12), 1e-12, 5e-13, 1e-15, 0, -0, -1e-12, -0.05])
      expect(cml(0.0513, mrp), `MRP=${mrp}`).toMatchObject({
        available: false,
        code: "market_proxy_has_no_positive_expected_excess_return",
      });
    for (const mrp of [NEXT_ABOVE_TOLERANCE, 1.5e-12, 2e-12, 1e-9, 0.02])
      expect(cml(0.0513, mrp).available, `MRP=${mrp}`).toBe(true);
  });

  it("carries the chain's lineage from the CAPM prior and the risk model", () => {
    const p = prior(0.0513, 0.05, {
      riskModelHash: "rm-hash-xyz",
      marketProxy: "SPY",
      riskWindow: "5Y",
      riskFreeObservationDate: "2024-05-31",
    });
    const line = cmlOf(buildMarketCmlProxy({ riskModel: marketModel(0.17, { hash: "rm-hash-xyz", marketProxy: "SPY" }), capmPrior: p }));
    expect(line).toMatchObject({
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: "rm-hash-xyz",
      marketProxy: "SPY",
      riskWindow: "5Y",
      riskFreeRate: 0.0513,
      riskFreeObservationDate: "2024-05-31",
    });
  });

  it("rejects inconsistent or invalid inputs with invalid_inputs (no line is manufactured)", () => {
    const good = { riskModel: marketModel(0.15), capmPrior: prior(0.0513, 0.05) };
    expect(buildMarketCmlProxy(good).available).toBe(true);
    const bad: [string, Parameters<typeof buildMarketCmlProxy>[0]][] = [
      ["risk-model hash mismatch", { ...good, riskModel: marketModel(0.15, { hash: "other" }) }],
      ["market proxy mismatch", { ...good, riskModel: marketModel(0.15, { marketProxy: "SPY" }) }],
      ["σ_m = 0", { ...good, riskModel: marketModel(0) }],
      ["σ_m negative", { ...good, riskModel: marketModel(-0.15) }],
      ["σ_m NaN", { ...good, riskModel: marketModel(Number.NaN) }],
      ["σ_m +Infinity", { ...good, riskModel: marketModel(Infinity) }],
      ["σ_m −Infinity", { ...good, riskModel: marketModel(-Infinity) }],
      ["E[R_m] above Rf + MRP", { ...good, capmPrior: prior(0.0513, 0.05, { expectedMarketReturn: 0.1014 }) }],
      ["E[R_m] below Rf + MRP", { ...good, capmPrior: prior(0.0513, 0.05, { expectedMarketReturn: 0.1 }) }],
      ["E[R_m] = Rf", { ...good, capmPrior: prior(0.0513, 0.05, { expectedMarketReturn: 0.0513 }) }],
      ["Rf NaN", { ...good, capmPrior: { ...prior(0.0513, 0.05), riskFreeRate: Number.NaN } }],
      ["Rf +Infinity", { ...good, capmPrior: { ...prior(0.0513, 0.05), riskFreeRate: Infinity } }],
    ];
    for (const [label, input] of bad) {
      const out = buildMarketCmlProxy(input);
      expect(out, label).toMatchObject({ available: false, code: "invalid_inputs" });
      expect(out, label).not.toHaveProperty("line");
    }
    for (const mrp of [Number.NaN, Infinity])
      expect(
        buildMarketCmlProxy({ ...good, capmPrior: { ...prior(0.0513, 0.05), marketRiskPremium: mrp, expectedMarketReturn: mrp } }).available,
        `MRP=${mrp}`,
      ).toBe(false);
  });
});

describe("Market CML Proxy: proportionality and extreme (but valid) volatilities", () => {
  it("slope ∝ MRP exactly and ∝ 1/σ_m to rounding, whatever the Rf", () => {
    for (const rf of RFS)
      for (const sigmaM of SIGMAS) {
        const base = cmlOf(cml(rf, 0.04, sigmaM));
        // Doubling MRP doubles MRP/σ_m exactly in binary floating point.
        expect(cmlOf(cml(rf, 0.08, sigmaM)).slope, `Rf=${rf} σ=${sigmaM}`).toBe(2 * base.slope);
        for (const k of [2, 10, 0.1]) {
          const scaled = cmlOf(cml(rf, 0.04, sigmaM * k));
          expect(Math.abs(scaled.slope * k - base.slope) / base.slope, `Rf=${rf} σ=${sigmaM} k=${k}`).toBeLessThanOrEqual(
            1e-15,
          );
          expect(scaled.solidThroughVolatility).toBe(sigmaM * k);
        }
      }
  });

  it("any positive finite σ_m is valid: the anchors still hold at 1e-150 … 1e150", () => {
    for (const rf of [0, 0.0513])
      for (const sigmaM of [1e-150, 1e-30, 1e30, 1e150]) {
        const label = `Rf=${rf} σ_m=${sigmaM}`;
        const line = cmlOf(cml(rf, 0.05, sigmaM));
        expect(Number.isFinite(line.slope), label).toBe(true);
        expect(line.slope, label).toBe(0.05 / sigmaM);
        expect(
          Math.abs(capitalLineReturnAt(line, sigmaM) - (rf + 0.05)),
          label,
        ).toBeLessThanOrEqual(allowance(rf, line.slope, sigmaM, rf + 0.05));
      }
  });

  it("is anchored at the same point as the SML's β = 1 on a real chain", () => {
    const c = chain({ mrp: 0.07 });
    const market = cmlOf(c.cml);
    const sml = smlOf(c.sml);
    expect(Math.abs(capitalLineReturnAt(market, c.model.marketVolatility) - securityMarketLineReturnAt(sml, 1))).toBeLessThanOrEqual(
      market.anchorAllowance,
    );
    expect(securityMarketLineReturnAt(sml, 1)).toBe(market.expectedMarketReturn);
    expect(securityMarketLineReturnAt(sml, 0)).toBe(capitalLineReturnAt(market, 0));
    // One chain: the three lines share one lineage.
    const cal = calOf(c.cal);
    for (const key of ["methodologyVersion", "riskModelHash", "marketProxy", "riskWindow", "riskFreeRate", "riskFreeObservationDate"] as const) {
      expect(market[key], key).toBe(cal[key]);
      expect(sml[key], key).toBe(cal[key]);
    }
    expect(cal.riskModelHash).toBe(c.model.hash);
  });
});

describe("Security Market Line: always defined for finite Rf and MRP", () => {
  it("across Rf × MRP: intercept Rf, slope MRP, direction by the sign of MRP, never unavailable", () => {
    for (const rf of RFS)
      for (const mrp of MRPS) {
        const label = `Rf=${rf} MRP=${mrp}`;
        const out = buildSecurityMarketLine({ capmPrior: prior(rf, mrp) });
        expect(out.available, label).toBe(true);
        const line = smlOf(out);
        expect(line.kind, label).toBe("security_market_line");
        expect(line.intercept, label).toBe(rf);
        expect(line.slope, label).toBe(mrp);
        expect(line.marketRiskPremium, label).toBe(mrp);
        expect(line.riskFreeRate, label).toBe(rf);
        expect(line.direction, label).toBe(mrp > 0 ? "upward" : mrp < 0 ? "downward" : "flat");
        expect(line.lineHash, label).toMatch(/^[0-9a-f]{64}$/);

        // Evaluated through capmRequiredReturn, exactly.
        for (const beta of BETAS)
          expect(securityMarketLineReturnAt(line, beta), `${label} β=${beta}`).toBe(
            capmRequiredReturn(rf, beta, mrp),
          );
        expect(securityMarketLineReturnAt(line, 1), label).toBe(expectedMarketReturn(rf, mrp));
        expect(securityMarketLineReturnAt(line, 1), label).toBe(rf + mrp);
        expect(securityMarketLineReturnAt(line, 0), label).toBe(rf);

        // Shape by direction: strictly rising, constant or strictly falling in β.
        const values = BETAS.map((b) => securityMarketLineReturnAt(line, b));
        const steps = values.slice(1).map((v, i) => v - values[i]);
        if (line.direction === "flat") expect(values.every((v) => v === rf), label).toBe(true);
        else if (line.direction === "upward") expect(steps.every((d) => d >= 0), label).toBe(true);
        else expect(steps.every((d) => d <= 0), label).toBe(true);
      }
  });

  it("is available at and just above the CML threshold, and at MRP = −0 it is flat", () => {
    for (const mrp of [1e-12, NEXT_ABOVE_TOLERANCE, 5e-13, 1e-15])
      expect(smlOf(buildSecurityMarketLine({ capmPrior: prior(0.0513, mrp) })).direction).toBe("upward");
    expect(smlOf(buildSecurityMarketLine({ capmPrior: prior(0.0513, -0) })).direction).toBe("flat");
    expect(smlOf(buildSecurityMarketLine({ capmPrior: prior(0.0513, -1e-300) })).direction).toBe("downward");
  });

  it("carries the CAPM prior's lineage", () => {
    const line = smlOf(
      buildSecurityMarketLine({
        capmPrior: prior(0.04, 0.06, {
          riskModelHash: "rm-hash-xyz",
          marketProxy: "VT",
          riskWindow: "1Y",
          riskFreeObservationDate: "2024-05-30",
        }),
      }),
    );
    expect(line).toMatchObject({
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: "rm-hash-xyz",
      marketProxy: "VT",
      riskWindow: "1Y",
      riskFreeRate: 0.04,
      riskFreeObservationDate: "2024-05-30",
    });
  });

  it("non-finite Rf or MRP is invalid_inputs, never a line", () => {
    for (const [label, p] of [
      ["Rf NaN", { ...prior(0.04, 0.05), riskFreeRate: Number.NaN }],
      ["Rf +Infinity", { ...prior(0.04, 0.05), riskFreeRate: Infinity }],
      ["MRP NaN", { ...prior(0.04, 0.05), marketRiskPremium: Number.NaN }],
      ["MRP +Infinity", { ...prior(0.04, 0.05), marketRiskPremium: Infinity }],
      ["MRP −Infinity", { ...prior(0.04, 0.05), marketRiskPremium: -Infinity }],
    ] as const) {
      const out = buildSecurityMarketLine({ capmPrior: p });
      expect(out, label).toMatchObject({ available: false, code: "invalid_inputs" });
      expect(out, label).not.toHaveProperty("line");
    }
  });

  it("is evaluated only through the canonical capmRequiredReturn(Rf, β, MRP)", () => {
    const line = smlOf(buildSecurityMarketLine({ capmPrior: prior(0.0513, -0.04) }));
    const spy = vi.mocked(capmRequiredReturn);
    spy.mockClear();
    const value = securityMarketLineReturnAt(line, 0.7);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0.0513, 0.7, -0.04);
    expect(value).toBe(0.0513 + 0.7 * -0.04);
    // The canonical function's own validation is therefore inherited.
    expect(() => securityMarketLineReturnAt(line, Number.NaN)).toThrow();
    expect(() => securityMarketLineReturnAt(line, Infinity)).toThrow();
  });
});

describe("capitalLineReturnAt: one implementation for the CAL and the CML", () => {
  const SIGMAS_AT = [0, 0.01, 0.05, 0.2, 0.7, 2.5];

  it("is intercept + slope·σ for any definition, including a flat or falling one", () => {
    for (const line of [
      { intercept: 0.0513, slope: 0.3 },
      { intercept: -0.01, slope: 1.7 },
      { intercept: 0, slope: 0 },
      { intercept: 0.04, slope: -0.2 },
    ])
      for (const sigma of SIGMAS_AT)
        expect(capitalLineReturnAt(line, sigma), `${line.intercept}/${line.slope}@${sigma}`).toBe(
          line.intercept + line.slope * sigma,
        );
  });

  it("evaluates the Model CAL and the Market CML Proxy results with the same formula", () => {
    const calLine = calOf(buildModelCal(syntheticTangency(SIGMA3, [0.1, 0.07, 0.12])));
    const cmlLine = cmlOf(cml(0.0513, 0.05, 0.17));
    for (const line of [calLine, cmlLine])
      for (const sigma of SIGMAS_AT)
        expect(capitalLineReturnAt(line, sigma), `${line.kind}@${sigma}`).toBe(line.intercept + line.slope * sigma);
  });
});

// ---------------------------------------------------------------------------------
// Model CAL from the certified tangency
// ---------------------------------------------------------------------------------

describe("Model CAL: anchors, slope identity and pass-through of the certified tangency", () => {
  it("over seeded models: intercept Rf, slope = Sharpe, passes through (0, Rf) and (σ_t, μ_t)", () => {
    let checked = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const n = 2 + (seed % 8);
      const rf = [0.0513, 0.01, 0, 0.03, -0.005][seed % 5];
      const { sigma, mu } = seededModel(n, 1000 + seed);
      const out = syntheticTangency(sigma, mu, { rf });
      const cal = buildModelCal(out);
      expect(cal.available, `seed ${seed}`).toBe(out.available);
      if (!out.available) continue;
      checked++;
      const t = out.tangency;
      const line = calOf(cal);
      const label = `seed ${seed} n=${n} Rf=${rf}`;

      // The independent recomputation of the tangency's coordinates from its weights.
      const muT = dot(t.weights, mu);
      const sigmaT = Math.sqrt(quadratic(sigma, t.weights));
      const sharpe = (muT - rf) / sigmaT;
      expect(Math.abs(sharpe - line.slope) / line.slope, label).toBeLessThan(1e-12);
      expect(Math.abs(muT - t.expectedReturn), label).toBeLessThan(1e-14);
      expect(Math.abs(sigmaT - t.volatility) / t.volatility, label).toBeLessThan(1e-12);

      // Definition: intercept Rf, slope the tangency's Forward Model Sharpe.
      expect(line.kind, label).toBe("model_cal");
      expect(line.intercept, label).toBe(t.riskFreeRate);
      expect(line.intercept, label).toBe(rf);
      expect(line.slope, label).toBe(t.forwardModelSharpe);
      expect(line.slope, label).toBeGreaterThan(0);
      expect(line.solidThroughVolatility, label).toBe(t.volatility);
      expect(line.tangencyVolatility, label).toBe(t.volatility);
      expect(line.tangencyExpectedReturn, label).toBe(t.expectedReturn);
      expect(line.tangencyHash, label).toBe(t.tangencyHash);

      // Both anchors within 4·ε·(|Rf| + |slope·σ_t| + |μ_t|).
      const tolerance = allowance(rf, line.slope, t.volatility, t.expectedReturn);
      expect(capitalLineReturnAt(line, 0), label).toBe(rf);
      expect(Math.abs(capitalLineReturnAt(line, t.volatility) - t.expectedReturn), label).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(capitalLineReturnAt(line, line.solidThroughVolatility) - muT), label).toBeLessThanOrEqual(
        tolerance + 1e-14,
      );
      expect(Math.abs(line.anchorAllowance - tolerance), label).toBeLessThanOrEqual(1e-12 * tolerance);
      expect(line.anchorResidual, label).toBe(Math.abs(rf + line.slope * t.volatility - t.expectedReturn));
      expect(line.anchorResidual, label).toBeLessThanOrEqual(line.anchorAllowance);

      // Lineage.
      expect(line, label).toMatchObject({
        methodologyVersion: FORWARD_METHODOLOGY.version,
        riskModelHash: t.riskModelHash,
        marketProxy: t.marketProxy,
        riskWindow: t.riskWindow,
        riskFreeRate: rf,
        riskFreeObservationDate: t.riskFreeObservationDate,
      });
      expect(line.lineHash, label).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("a known closed-form two-asset tangency gives the expected line", () => {
    const S = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const mu = [0.09, 0.13];
    const rf = 0.04;
    const t = availableTangency(syntheticTangency(S, mu, { rf }));
    // w ∝ Σ⁻¹a for a = μ − Rf (both weights positive here).
    const a = [mu[0] - rf, mu[1] - rf];
    const raw = [S[1][1] * a[0] - S[0][1] * a[1], S[0][0] * a[1] - S[1][0] * a[0]];
    const w = raw.map((x) => x / (raw[0] + raw[1]));
    const muT = dot(w, mu);
    const sigmaT = Math.sqrt(quadratic(S, w));
    const line = calOf(buildModelCal({ available: true, tangency: t }));
    expect(line.intercept).toBe(rf);
    expect(Math.abs(line.slope - (muT - rf) / sigmaT)).toBeLessThan(1e-13);
    expect(Math.abs(line.solidThroughVolatility - sigmaT)).toBeLessThan(1e-13);
    // E[R](σ) at a few volatilities, including beyond σ_t (the dashed, leveraged side).
    for (const sigma of [0, 0.05, sigmaT, 2 * sigmaT, 5 * sigmaT])
      expect(Math.abs(capitalLineReturnAt(line, sigma) - (rf + ((muT - rf) / sigmaT) * sigma))).toBeLessThan(1e-13);
    // Beyond σ_t the value is still the straight line (no cap, no kink).
    expect(capitalLineReturnAt(line, 3 * sigmaT) - capitalLineReturnAt(line, 2 * sigmaT)).toBeCloseTo(
      capitalLineReturnAt(line, 2 * sigmaT) - capitalLineReturnAt(line, sigmaT),
      12,
    );
  });

  it("the CAL lies on or above every feasible long-only portfolio, and touches the tangency", () => {
    let portfolios = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const n = 2 + (seed % 7);
      const { sigma, mu } = seededModel(n, 2000 + seed);
      const out = syntheticTangency(sigma, mu, { rf: 0.02 });
      if (!out.available) continue;
      const line = calOf(buildModelCal(out));
      const rand = mulberry32(seed);
      const candidates: number[][] = [
        ...mu.map((_, i) => mu.map((__, j) => (i === j ? 1 : 0))),
        mu.map(() => 1 / n),
        ...Array.from({ length: 60 }, () => {
          const raw = mu.map(() => -Math.log(1 - rand()));
          const total = raw.reduce((u, v) => u + v, 0);
          return raw.map((v) => v / total);
        }),
      ];
      for (const w of candidates) {
        const muW = dot(w, mu);
        const sigmaW = Math.sqrt(quadratic(sigma, w));
        expect(muW, `seed ${seed}`).toBeLessThanOrEqual(capitalLineReturnAt(line, sigmaW) + 1e-10);
        portfolios++;
      }
      expect(capitalLineReturnAt(line, line.tangencyVolatility)).toBeCloseTo(line.tangencyExpectedReturn, 14);
    }
    expect(portfolios).toBeGreaterThan(1000);
  });

  it("scaling Σ by k scales the Sharpe by 1/√k and σ_t by √k; shifting Rf and μ together shifts the line", () => {
    const { sigma, mu } = seededModel(5, 77);
    const rf = 0.03;
    const base = calOf(buildModelCal(syntheticTangency(sigma, mu, { rf })));
    for (const k of [1e-6, 1e-3, 1e3, 1e6]) {
      const line = calOf(buildModelCal(syntheticTangency(sigma.map((r) => r.map((x) => x * k)), mu, { rf })));
      const label = `k=${k}`;
      expect(Math.abs((line.slope * Math.sqrt(k)) / base.slope - 1), label).toBeLessThan(1e-9);
      expect(Math.abs(line.solidThroughVolatility / Math.sqrt(k) / base.solidThroughVolatility - 1), label).toBeLessThan(1e-9);
      expect(Math.abs(line.tangencyExpectedReturn - base.tangencyExpectedReturn), label).toBeLessThan(1e-10);
      expect(line.anchorResidual, label).toBeLessThanOrEqual(line.anchorAllowance);
    }
    for (const shift of [-0.03, 0.02]) {
      const line = calOf(
        buildModelCal(syntheticTangency(sigma, mu.map((m) => m + shift), { rf: rf + shift })),
      );
      const label = `shift=${shift}`;
      expect(line.intercept, label).toBe(rf + shift);
      expect(Math.abs(line.slope / base.slope - 1), label).toBeLessThan(1e-9);
      for (const x of [0, 0.1, 0.5])
        expect(Math.abs(capitalLineReturnAt(line, x) - capitalLineReturnAt(base, x) - shift), `${label} σ=${x}`).toBeLessThan(1e-9);
    }
  });

  it("a universe that is only the market proxy gives a CAL identical to the CML", () => {
    const sigmaM = Math.sqrt(0.1734 ** 2);
    const rf = 0.0513;
    const mrp = 0.05;
    const cal = calOf(buildModelCal(syntheticTangency([[sigmaM ** 2]], [rf + mrp], { rf, hash: "single-model" })));
    const market = cmlOf(
      buildMarketCmlProxy({
        riskModel: marketModel(sigmaM, { hash: "single-model" }),
        capmPrior: prior(rf, mrp, { riskModelHash: "single-model" }),
      }),
    );
    expect(cal.intercept).toBe(market.intercept);
    expect(Math.abs(cal.slope - market.slope) / market.slope).toBeLessThan(1e-14);
    for (const sigma of [0, 0.05, sigmaM, 0.5, 2])
      expect(Math.abs(capitalLineReturnAt(cal, sigma) - capitalLineReturnAt(market, sigma))).toBeLessThan(1e-14 * (1 + sigma));
  });

  it("an unavailable tangency makes an unavailable CAL carrying its code, reason and cause unchanged", () => {
    const S = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    let loops = 0;
    const looping = (A: number[][], b: number[]) => {
      loops++;
      return b.length === 2 ? [2, 10] : b.length === 3 ? [-1, 1, 5] : solveLinear(A, b);
    };
    const unavailable: [string, TangencyOutcome][] = [
      ["no positive excess return", syntheticTangency(S, [0.03, 0.02], { rf: 0.04 })],
      ["exactly Rf", syntheticTangency(S, [0.04, 0.04], { rf: 0.04 })],
      ["no risky assets", syntheticTangency([], [])],
      ["invalid inputs (lineage mismatch)", syntheticTangency(S, [0.09, 0.13], { priorHash: "another-model" })],
      ["numerical failure (singular face)", syntheticTangency(SIGMA3, [0.1, 0.07, 0.12], { solve: () => null })],
      ["non-converged (active-set cycle)", syntheticTangency(SIGMA3, [0.1, 0.07, 0.12], { solve: looping })],
    ];
    expect(loops).toBeGreaterThan(0);
    const codes = new Set<string>();
    for (const [label, tangency] of unavailable) {
      if (tangency.available) throw new Error(`${label}: expected an unavailable tangency`);
      codes.add(tangency.code);
      const cal = buildModelCal(tangency);
      expect(cal.available, label).toBe(false);
      if (cal.available) continue;
      expect(cal.code, label).toBe(tangency.code);
      expect(cal.reason, label).toBe(tangency.reason);
      expect(cal.cause, label).toBe(tangency.cause);
      expect(cal, label).not.toHaveProperty("line");
    }
    expect([...codes].sort()).toEqual(
      ["invalid_inputs", "no_positive_excess_return", "no_risky_assets", "non_converged", "numerical_failure"].sort(),
    );
    // A typed numerical cause really is carried (not just null everywhere).
    const failure = buildModelCal(syntheticTangency(SIGMA3, [0.1, 0.07, 0.12], { solve: () => null }));
    expect(failure).toMatchObject({ available: false, code: "numerical_failure", cause: "singular_face" });
  });
});

// ---------------------------------------------------------------------------------
// The real forward chain
// ---------------------------------------------------------------------------------

describe("no-view relationship on the real forward chain: CAL Sharpe ≤ CML slope (CAPM)", () => {
  const universes = (proxy: MarketProxy): { name: string; universe: string[]; heldProxy: boolean }[] => [
    { name: "four securities", universe: ["AAA", "BBB", "CCC", "DDD"], heldProxy: false },
    { name: "two securities, unsorted", universe: ["CCC", "AAA"], heldProxy: false },
    { name: "proxy held with others", universe: ["BBB", "DDD", proxy], heldProxy: true },
    { name: "proxy only", universe: [proxy], heldProxy: true },
  ];

  for (const window of ["1Y", "3Y", "5Y"] as const)
    for (const proxy of ["VTI", "SPY", "VT"] as const)
      it(`window ${window}, proxy ${proxy}: slope_CAL ≤ slope_CML·(1 + 1e-12), equal when the proxy is held`, () => {
        for (const { name, universe, heldProxy } of universes(proxy))
          for (const mrp of [0.02, 0.05, 0.1]) {
            const label = `${name} MRP=${mrp}`;
            const c = chain({ universe, window, proxy, mrp });
            const cal = calOf(c.cal);
            const market = cmlOf(c.cml);
            const sigmaM = c.model.marketVolatility;

            // The CML is the CAPM line: slope MRP/σ_m through (σ_m, Rf + MRP).
            expect(market.slope, label).toBe(mrp / sigmaM);
            expect(market.intercept, label).toBe(0.0513);
            expect(market.marketProxyVolatility, label).toBe(sigmaM);
            expect(market.expectedMarketReturn, label).toBe(0.0513 + mrp);
            expect(cal.intercept, label).toBe(market.intercept);
            expect(cal.riskModelHash, label).toBe(market.riskModelHash);
            expect(cal.marketProxy, label).toBe(proxy);
            expect(market.marketProxy, label).toBe(proxy);

            expect(cal.slope, label).toBeLessThanOrEqual(market.slope * (1 + 1e-12));
            for (const sigma of [0.02, 0.1, 0.3, 1])
              expect(capitalLineReturnAt(cal, sigma), `${label} σ=${sigma}`).toBeLessThanOrEqual(
                capitalLineReturnAt(market, sigma) + 1e-12 * sigma * market.slope + 1e-15,
              );

            if (heldProxy) {
              // Holding the market proxy itself attains the CML: the lines coincide.
              expect(Math.abs(cal.slope - market.slope), label).toBeLessThanOrEqual(1e-12 * market.slope);
              expect(Math.abs(cal.tangencyVolatility - sigmaM) / sigmaM, label).toBeLessThanOrEqual(1e-9);
              expect(Math.abs(cal.tangencyExpectedReturn - market.expectedMarketReturn), label).toBeLessThanOrEqual(1e-9);
            } else {
              // No security replicates the market exactly, so the model line is strictly lower.
              expect(cal.slope, label).toBeLessThan(market.slope * (1 - 1e-6));
            }
          }
      });
});

describe("with a view the CAL can exceed the CML: the Sharpe reversal", () => {
  const universe = ["AAA", "BBB", "CCC", "DDD"];

  it("a high-confidence manual view lifting CCC makes slope_CAL > slope_CML", () => {
    const base = chain({ universe, mrp: 0.05 });
    const baseCml = cmlOf(base.cml);
    const baseCal = calOf(base.cal);
    expect(baseCal.slope).toBeLessThanOrEqual(baseCml.slope * (1 + 1e-12));

    for (const [value, confidence] of [
      [0.3, 0.9],
      [0.2, 0.95],
      [0.15, 0.5],
    ] as const) {
      const label = `CCC view ${value} @ ${confidence}`;
      const withView = chain({ universe, mrp: 0.05, views: { CCC: manual(value, confidence) } });
      const cal = calOf(withView.cal);
      const market = cmlOf(withView.cml);
      expect(cal.slope, label).toBeGreaterThan(market.slope);
      expect(cal.slope, label).toBeGreaterThan(market.slope * 1.5);
      // The tangency moved to the lifted security, and the line steepened.
      expect(cal.slope, label).toBeGreaterThan(baseCal.slope);
      expect(cal.lineHash, label).not.toBe(baseCal.lineHash);
      expect(cal.tangencyHash, label).not.toBe(baseCal.tangencyHash);
      if (withView.tangency.available) {
        const ccc = withView.tangency.tangency.tickers.indexOf("CCC");
        expect(withView.tangency.tangency.weights[ccc], label).toBeGreaterThan(0.5);
      }
      // Views do not touch the CAPM-based lines: the CML and the SML are unchanged.
      expect(withView.cml, label).toEqual(base.cml);
      expect(withView.sml, label).toEqual(base.sml);
    }
  });

  it("the reversal also occurs when the market proxy is itself held", () => {
    const held = ["BBB", "CCC", "VTI"];
    const none = chain({ universe: held, mrp: 0.05 });
    expect(Math.abs(calOf(none.cal).slope - cmlOf(none.cml).slope)).toBeLessThanOrEqual(1e-12 * cmlOf(none.cml).slope);
    const lifted = chain({ universe: held, mrp: 0.05, views: { CCC: manual(0.3, 0.9) } });
    expect(calOf(lifted.cal).slope).toBeGreaterThan(cmlOf(lifted.cml).slope * 1.5);
  });

  it("a zero-confidence view is ignored, so the CAL is exactly the no-view CAL", () => {
    const none = chain({ universe, mrp: 0.05 });
    const ignored = chain({ universe, mrp: 0.05, views: { CCC: manual(0.3, 0) } });
    expect(ignored.cal).toEqual(none.cal);
    expect(ignored.cml).toEqual(none.cml);
  });
});

describe("negative and zero MRP across all three lines", () => {
  const universe = ["AAA", "BBB", "CCC", "DDD"];

  it("MRP = 0 with no views: no CML, no CAL (nothing beats Rf), a flat SML at Rf", () => {
    const c = chain({ universe, mrp: 0 });
    expect(c.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: 0,
    });
    expect(c.tangency.available).toBe(false);
    expect(c.cal.available).toBe(false);
    if (!c.tangency.available && !c.cal.available) {
      expect(c.cal.code).toBe(c.tangency.code);
      expect(c.cal.reason).toBe(c.tangency.reason);
      expect(c.cal.cause).toBe(c.tangency.cause);
    }
    const sml = smlOf(c.sml);
    expect(sml.direction).toBe("flat");
    expect(sml.slope).toBe(0);
    expect(sml.intercept).toBe(0.0513);
    for (const beta of BETAS) expect(securityMarketLineReturnAt(sml, beta)).toBe(0.0513);
  });

  it("MRP < 0 with no views: no CML, no CAL, a downward SML below Rf for β > 0", () => {
    for (const mrp of [-0.01, -0.05, -0.1]) {
      const c = chain({ universe, mrp });
      expect(c.cml, `MRP=${mrp}`).toMatchObject({
        available: false,
        code: "market_proxy_has_no_positive_expected_excess_return",
        marketRiskPremium: mrp,
      });
      expect(c.cal.available, `MRP=${mrp}`).toBe(c.tangency.available);
      expect(c.cal.available, `MRP=${mrp}`).toBe(false);
      const sml = smlOf(c.sml);
      expect(sml.direction, `MRP=${mrp}`).toBe("downward");
      expect(sml.slope, `MRP=${mrp}`).toBe(mrp);
      expect(securityMarketLineReturnAt(sml, 0), `MRP=${mrp}`).toBe(0.0513);
      expect(securityMarketLineReturnAt(sml, 1), `MRP=${mrp}`).toBe(0.0513 + mrp);
      expect(securityMarketLineReturnAt(sml, 1), `MRP=${mrp}`).toBeLessThan(0.0513);
      expect(securityMarketLineReturnAt(sml, 2), `MRP=${mrp}`).toBeLessThan(securityMarketLineReturnAt(sml, 1));
      expect(securityMarketLineReturnAt(sml, -1), `MRP=${mrp}`).toBeGreaterThan(0.0513);
    }
  });

  it("MRP < 0 but a view lifts one security above Rf: the CAL exists (it follows the tangency), the CML does not", () => {
    const c = chain({ universe, mrp: -0.05, views: { CCC: manual(0.2, 0.5) } });
    expect(c.tangency.available).toBe(true);
    expect(c.cal.available).toBe(true);
    const cal = calOf(c.cal);
    expect(cal.slope).toBeGreaterThan(0);
    expect(cal.intercept).toBe(0.0513);
    expect(c.cml).toMatchObject({ available: false, code: "market_proxy_has_no_positive_expected_excess_return" });
    expect(smlOf(c.sml).direction).toBe("downward");
  });

  it("0 < MRP ≤ 1e-12: no CML, while the CAL and SML still exist when the tangency does", () => {
    // β_AAA ≈ 1.25, so max(μ_BL − Rf) ≈ 1.25e-12 exceeds the 1e-12 existence tolerance
    // even though the market's own excess return MRP = 1e-12 does not.
    const c = chain({ universe, mrp: 1e-12 });
    expect(c.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: 1e-12,
    });
    expect(c.cal.available).toBe(c.tangency.available);
    expect(smlOf(c.sml)).toMatchObject({ direction: "upward", slope: 1e-12 });
    // One double above the threshold, the CML exists too.
    const above = chain({ universe, mrp: NEXT_ABOVE_TOLERANCE });
    const market = cmlOf(above.cml);
    expect(market.slope).toBe(NEXT_ABOVE_TOLERANCE / above.model.marketVolatility);
    expect(above.cal.available).toBe(above.tangency.available);
  });

  it("the CAL's availability follows the tangency's for every MRP in the grid", () => {
    for (const mrp of [-0.1, -1e-6, 0, 5e-13, 1e-12, NEXT_ABOVE_TOLERANCE, 2e-12, 0.05, 0.2]) {
      const c = chain({ universe, mrp });
      expect(c.cal.available, `MRP=${mrp}`).toBe(c.tangency.available);
      expect(c.cml.available, `MRP=${mrp}`).toBe(mrp > TOLERANCE);
      expect(c.sml.available, `MRP=${mrp}`).toBe(true);
      if (!c.cal.available && !c.tangency.available) expect(c.cal.code).toBe(c.tangency.code);
    }
  });
});

// ---------------------------------------------------------------------------------
// Determinism, ordering and lineHash
// ---------------------------------------------------------------------------------

describe("determinism and ordering", () => {
  it("a permuted universe and permuted view-object key order give identical lines and hashes", () => {
    const a = chain({
      universe: ["AAA", "BBB", "CCC", "DDD"],
      mrp: 0.05,
      views: {
        AAA: { source: "manual", manualReturn: 0.11, confidence: 0.4 },
        CCC: { source: "manual", manualReturn: 0.15, confidence: 0.7 },
      },
    });
    const b = chain({
      universe: ["DDD", "CCC", "BBB", "AAA"],
      mrp: 0.05,
      views: {
        CCC: { confidence: 0.7, manualReturn: 0.15, source: "manual" },
        AAA: { confidence: 0.4, source: "manual", manualReturn: 0.11 },
      },
      riskFree: {
        ...RISK_FREE,
        provenance: { ...RISK_FREE.provenance, fetchedAt: "2024-06-04T20:00:00Z", cacheAgeSeconds: 7200 },
      },
    });
    expect(b.cal).toEqual(a.cal);
    expect(b.cml).toEqual(a.cml);
    expect(b.sml).toEqual(a.sml);
    expect(calOf(b.cal).lineHash).toBe(calOf(a.cal).lineHash);
    expect(cmlOf(b.cml).lineHash).toBe(cmlOf(a.cml).lineHash);
    expect(smlOf(b.sml).lineHash).toBe(smlOf(a.sml).lineHash);
    // Rebuilding from the same inputs is bit-identical.
    const again = chain({ universe: ["AAA", "BBB", "CCC", "DDD"], mrp: 0.05, views: { CCC: manual(0.15, 0.7), AAA: manual(0.11, 0.4) } });
    expect(again.cal).toEqual(a.cal);
  });

  it("synthetic tangencies in another ticker order give the same CAL and hash", () => {
    const tickers = ["AAPL", "JPM", "MSFT"];
    const mu = [0.1, 0.07, 0.12];
    const order = [2, 0, 1];
    const a = buildModelCal(syntheticTangency(SIGMA3, mu, { tickers }));
    const b = buildModelCal(
      syntheticTangency(
        order.map((i) => order.map((j) => SIGMA3[i][j])),
        order.map((i) => mu[i]),
        { tickers: order.map((i) => tickers[i]) },
      ),
    );
    expect(b).toEqual(a);
  });

  it("the three line hashes are well-formed and pairwise distinct for one chain", () => {
    const c = chain({ mrp: 0.05 });
    const hashes = [calOf(c.cal).lineHash, cmlOf(c.cml).lineHash, smlOf(c.sml).lineHash];
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(hashes).size).toBe(3);
  });

  it("builders are pure: frozen inputs are accepted, untouched and give the same results", () => {
    const tangency = syntheticTangency(SIGMA3, [0.1, 0.07, 0.12]);
    const p = prior(0.0513, 0.05);
    const m = marketModel(0.16);
    const expected = {
      cal: buildModelCal(tangency),
      cml: buildMarketCmlProxy({ riskModel: m, capmPrior: p }),
      sml: buildSecurityMarketLine({ capmPrior: p }),
    };
    const snapshot = JSON.stringify({ tangency, p, m });
    deepFreeze(tangency);
    deepFreeze(p);
    deepFreeze(m);
    expect(buildModelCal(tangency)).toEqual(expected.cal);
    expect(buildMarketCmlProxy({ riskModel: m, capmPrior: p })).toEqual(expected.cml);
    expect(buildSecurityMarketLine({ capmPrior: p })).toEqual(expected.sml);
    expect(JSON.stringify({ tangency, p, m })).toBe(snapshot);
  });
});

describe("lineHash: economic lineage only", () => {
  const hashCml = (p: CapmPrior, m: MarketModel = marketModel(0.15)) =>
    cmlOf(buildMarketCmlProxy({ riskModel: m, capmPrior: p })).lineHash;
  const hashSml = (p: CapmPrior) => smlOf(buildSecurityMarketLine({ capmPrior: p })).lineHash;

  it("CML and SML change with Rf, MRP, the risk model, the proxy and the window", () => {
    const baseCml = hashCml(prior(0.0513, 0.05));
    const baseSml = hashSml(prior(0.0513, 0.05));
    const cases: [string, CapmPrior, MarketModel][] = [
      ["Rf", prior(0.04, 0.05), marketModel(0.15)],
      ["MRP", prior(0.0513, 0.06), marketModel(0.15)],
      ["tiny MRP change", prior(0.0513, nextUp(0.05)), marketModel(0.15)],
      ["risk model hash", prior(0.0513, 0.05, { riskModelHash: "rm-hash-2" }), marketModel(0.15, { hash: "rm-hash-2" })],
      ["market proxy", prior(0.0513, 0.05, { marketProxy: "SPY" }), marketModel(0.15, { marketProxy: "SPY" })],
      ["risk window", prior(0.0513, 0.05, { riskWindow: "5Y" }), marketModel(0.15)],
    ];
    for (const [label, p, m] of cases) {
      expect(hashCml(p, m), `CML ${label}`).not.toBe(baseCml);
      expect(hashSml(p), `SML ${label}`).not.toBe(baseSml);
    }
  });

  it("Rf and MRP are hashed separately, not through Rf + MRP (the same E[R_m] with different parts differs)", () => {
    expect(hashCml(prior(0.04, 0.06))).not.toBe(hashCml(prior(0.06, 0.04)));
    expect(hashSml(prior(0.04, 0.06))).not.toBe(hashSml(prior(0.06, 0.04)));
    expect(hashCml(prior(0.04, 0.06))).not.toBe(hashCml(prior(0.05, 0.05)));
  });

  it("the CML hash changes with σ_m itself, even for the same risk-model hash", () => {
    const base = hashCml(prior(0.0513, 0.05), marketModel(0.15));
    expect(hashCml(prior(0.0513, 0.05), marketModel(0.16))).not.toBe(base);
    expect(hashCml(prior(0.0513, 0.05), marketModel(nextUp(0.15)))).not.toBe(base);
    expect(hashCml(prior(0.0513, 0.05), marketModel(0.15))).toBe(base);
  });

  it("is unchanged by provenance metadata and by object key order", () => {
    const p = prior(0.0513, 0.05);
    const m = marketModel(0.15);
    const baseCml = hashCml(p, m);
    const baseSml = hashSml(p);
    // Provenance: the reporting source of Rf is not economics.
    const relabelled = prior(0.0513, 0.05, { riskFreeSource: "another-provider" });
    expect(hashCml(relabelled, m)).toBe(baseCml);
    expect(hashSml(relabelled)).toBe(baseSml);
    // Key order of the inputs.
    const shuffled: CapmPrior = { ...reverseKeys(p), cash: reverseKeys(p.cash), rows: [...p.rows].map(reverseKeys) };
    expect(hashCml(shuffled, reverseKeys(m))).toBe(baseCml);
    expect(hashSml(shuffled)).toBe(baseSml);
    // The built lines are equal whatever the input key order.
    expect(buildMarketCmlProxy({ riskModel: reverseKeys(m), capmPrior: shuffled })).toEqual(
      buildMarketCmlProxy({ riskModel: m, capmPrior: p }),
    );
    expect(buildSecurityMarketLine({ capmPrior: shuffled })).toEqual(buildSecurityMarketLine({ capmPrior: p }));
  });

  it("is unchanged by Rf retrieval timestamps and cache metadata on the real chain", () => {
    const a = chain({ mrp: 0.05 });
    const b = chain({
      mrp: 0.05,
      riskFree: {
        ...RISK_FREE,
        provenance: {
          ...RISK_FREE.provenance,
          provider: "a-different-provider",
          fetchedAt: "2025-01-01T00:00:00Z",
          lastSuccessfulRefresh: "2025-01-01T00:00:00Z",
          cacheAgeSeconds: 99999,
          fallbackUsed: true,
          warnings: ["stale cache"],
        },
      },
    });
    expect(calOf(b.cal).lineHash).toBe(calOf(a.cal).lineHash);
    expect(cmlOf(b.cml).lineHash).toBe(cmlOf(a.cml).lineHash);
    expect(smlOf(b.sml).lineHash).toBe(smlOf(a.sml).lineHash);
  });

  it("CAL hash changes with Rf, μ_BL and the risk model; not with the key order of the tangency", () => {
    const mu = [0.1, 0.07, 0.12];
    const base = calOf(buildModelCal(syntheticTangency(SIGMA3, mu))).lineHash;
    const changed = [
      ["Rf", syntheticTangency(SIGMA3, mu, { rf: 0.05 })],
      ["μ_BL", syntheticTangency(SIGMA3, [0.1, 0.07, nextUp(0.12)])],
      ["risk model hash", syntheticTangency(SIGMA3, mu, { hash: "another-risk-model" })],
      ["market proxy", syntheticTangency(SIGMA3, mu, { proxy: "SPY" })],
      ["risk window", syntheticTangency(SIGMA3, mu, { window: "5Y" })],
    ] as const;
    for (const [label, out] of changed) expect(calOf(buildModelCal(out)).lineHash, label).not.toBe(base);

    const t = availableTangency(syntheticTangency(SIGMA3, mu));
    const reordered = buildModelCal({ available: true, tangency: reverseKeys(t) });
    expect(calOf(reordered).lineHash).toBe(base);
    // Solver bookkeeping (iteration counts) is not part of the economics.
    const reSolved = buildModelCal({
      available: true,
      tangency: { ...t, solver: { ...t.solver, iterations: t.solver.iterations + 7 } },
    });
    expect(calOf(reSolved).lineHash).toBe(base);
  });

  it("on the real chain a different Rf, MRP, proxy, window or view moves the right hashes", () => {
    const base = chain({ mrp: 0.05 });
    const hashes = (c: ReturnType<typeof chain>) => ({
      cal: calOf(c.cal).lineHash,
      cml: cmlOf(c.cml).lineHash,
      sml: smlOf(c.sml).lineHash,
    });
    const h = hashes(base);

    const moreRf = hashes(chain({ mrp: 0.05, riskFree: { ...RISK_FREE, annualYield: 0.05 } }));
    expect(moreRf.cal).not.toBe(h.cal);
    expect(moreRf.cml).not.toBe(h.cml);
    expect(moreRf.sml).not.toBe(h.sml);

    const moreMrp = hashes(chain({ mrp: 0.06 }));
    expect(moreMrp.cal).not.toBe(h.cal);
    expect(moreMrp.cml).not.toBe(h.cml);
    expect(moreMrp.sml).not.toBe(h.sml);

    // A different proxy: a different Σ, σ_m and lineage, so every line moves.
    const spy = hashes(chain({ mrp: 0.05, proxy: "SPY" }));
    expect(spy.cal).not.toBe(h.cal);
    expect(spy.cml).not.toBe(h.cml);
    expect(spy.sml).not.toBe(h.sml);

    // A different window: a different risk model.
    const fiveYear = hashes(chain({ mrp: 0.05, window: "5Y" }));
    expect(fiveYear.cal).not.toBe(h.cal);
    expect(fiveYear.cml).not.toBe(h.cml);
    expect(fiveYear.sml).not.toBe(h.sml);

    // A view changes μ_BL only: the CAL moves, the CAPM-based lines do not.
    const viewed = hashes(chain({ mrp: 0.05, views: { CCC: manual(0.12, 0.6) } }));
    expect(viewed.cal).not.toBe(h.cal);
    expect(viewed.cml).toBe(h.cml);
    expect(viewed.sml).toBe(h.sml);
  });
});

// ---------------------------------------------------------------------------------
// Results are definitions, not chart geometry
// ---------------------------------------------------------------------------------

describe("results hold definitions and breakpoints only (no chart-domain values)", () => {
  const LINEAGE = [
    "lineHash",
    "marketProxy",
    "methodologyVersion",
    "riskFreeObservationDate",
    "riskFreeRate",
    "riskModelHash",
    "riskWindow",
  ];
  const KEYS = {
    model_cal: [
      ...LINEAGE,
      "kind",
      "intercept",
      "slope",
      "solidThroughVolatility",
      "tangencyVolatility",
      "tangencyExpectedReturn",
      "tangencyHash",
      "anchorResidual",
      "anchorAllowance",
    ],
    market_cml_proxy: [
      ...LINEAGE,
      "kind",
      "marketRiskPremium",
      "intercept",
      "slope",
      "marketProxyVolatility",
      "expectedMarketReturn",
      "solidThroughVolatility",
      "anchorResidual",
      "anchorAllowance",
    ],
    security_market_line: [...LINEAGE, "kind", "marketRiskPremium", "intercept", "slope", "direction"],
  } as const;
  const CHART_WORDS = /x_?max|endpoint|domain|colou?r|dash|stroke|axis|label|style|width|series|points|samples|ticks?|legend|opacity|marker|grid/i;

  /** Every nested key and string value, plus a finiteness / plain-data check. */
  function scan(value: unknown, path: string, keys: string[], strings: string[]) {
    if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
    else if (typeof value === "string") strings.push(value);
    else if (typeof value === "boolean" || value === null) return;
    else if (Array.isArray(value)) throw new Error(`${path}: a sampled / array value (chart geometry?) at ${path}`);
    else if (typeof value === "object")
      for (const [k, v] of Object.entries(value as object)) {
        keys.push(k);
        expect(v, `${path}.${k}`).not.toBeUndefined();
        scan(v, `${path}.${k}`, keys, strings);
      }
    else throw new Error(`${path}: ${typeof value} is not plain data`);
  }

  it("each line has exactly its contract fields, all plain finite data, and nothing chart-shaped", () => {
    const c = chain({ mrp: 0.05 });
    const lines = [calOf(c.cal), cmlOf(c.cml), smlOf(c.sml)];
    for (const line of lines) {
      expect(Object.keys(line).sort(), line.kind).toEqual([...KEYS[line.kind]].sort());
      const keys: string[] = [];
      const strings: string[] = [];
      scan(line, line.kind, keys, strings);
      for (const k of keys) expect(k, `${line.kind}.${k}`).not.toMatch(CHART_WORDS);
      for (const s of strings) expect(s, `${line.kind} value ${s}`).not.toMatch(/dash|solid|#[0-9a-f]{3,8}\b|rgb|hsl|px\b/i);
      // The result survives a JSON round trip unchanged (no undefined, NaN or functions).
      expect(JSON.parse(JSON.stringify(line))).toEqual(line);
    }
  });

  it("the semantic breakpoint is the only extent: σ_t for the CAL, σ_m for the CML, none for the SML", () => {
    const c = chain({ mrp: 0.05 });
    const cal = calOf(c.cal);
    const market = cmlOf(c.cml);
    const sml = smlOf(c.sml);
    expect(cal.solidThroughVolatility).toBe(cal.tangencyVolatility);
    expect(market.solidThroughVolatility).toBe(c.model.marketVolatility);
    expect(sml).not.toHaveProperty("solidThroughVolatility");
    // Unavailable outcomes carry reasons, not geometry.
    const none = chain({ mrp: 0 });
    for (const out of [none.cal, none.cml]) {
      expect(out.available).toBe(false);
      const keys: string[] = [];
      scan(out, "unavailable", keys, []);
      for (const k of keys) expect(k).not.toMatch(CHART_WORDS);
    }
  });
});
