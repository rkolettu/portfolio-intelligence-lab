import { describe, expect, it } from "vitest";
import {
  buildMarketCmlProxy,
  buildModelCal,
  buildSecurityMarketLine,
  capitalLineReturnAt,
  securityMarketLineReturnAt,
} from "@/lib/forward/lines";
import { buildTangencyPortfolio } from "@/lib/forward/tangency";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildCapmPrior, capmRequiredReturn, expectedMarketReturn } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { solveLinear } from "@/lib/analytics/construction/common";
import { LabError } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/utils/sha256";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  CapmPrior,
  ForwardRiskFree,
  ForwardRiskModel,
  MarketProxy,
  ModelCal,
  TangencyOutcome,
  TangencyPortfolio,
} from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

type Matrix = number[][];
const RF = 0.04;
const SIGMA: Matrix = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
const ULPS = FORWARD_METHODOLOGY.lines.anchorAllowanceUlps;
const TOL = FORWARD_METHODOLOGY.tangency.positiveExcessReturnTolerance;
/** The methodology's anchor allowance, written out independently of the engine. */
const allowance = (intercept: number, slope: number, x: number, y: number) =>
  ULPS * Number.EPSILON * (Math.abs(intercept) + Math.abs(slope * x) + Math.abs(y));
const sorted = (o: object) => Object.keys(o).sort();
const LINEAGE_KEYS = [
  "methodologyVersion",
  "riskModelHash",
  "marketProxy",
  "riskWindow",
  "riskFreeRate",
  "riskFreeObservationDate",
  "lineHash",
];
const CAL_KEYS = [
  ...LINEAGE_KEYS,
  "kind",
  "intercept",
  "slope",
  "solidThroughVolatility",
  "tangencyVolatility",
  "tangencyExpectedReturn",
  "tangencyHash",
  "anchorResidual",
  "anchorAllowance",
].sort();
const CML_KEYS = [
  ...LINEAGE_KEYS,
  "kind",
  "marketRiskPremium",
  "intercept",
  "slope",
  "marketProxyVolatility",
  "expectedMarketReturn",
  "solidThroughVolatility",
  "anchorResidual",
  "anchorAllowance",
].sort();
const SML_KEYS = [...LINEAGE_KEYS, "kind", "marketRiskPremium", "intercept", "slope", "direction"].sort();

/** Synthetic tangency inputs in the shape the forward chain produces. */
function tangencyOutcome(
  sigma: Matrix,
  mu: number[],
  o: { rf?: number; solve?: (A: number[][], b: number[]) => number[] | null } = {},
): TangencyOutcome {
  const tickers = mu.map((_, i) => `T${i}`);
  const rf = o.rf ?? RF;
  return buildTangencyPortfolio({
    riskModel: { tickers, covariance: sigma, hash: "risk-model-hash" },
    capmPrior: {
      riskModelHash: "risk-model-hash",
      riskFreeRate: rf,
      riskFreeObservationDate: "2024-06-03",
      marketProxy: "VTI",
      riskWindow: "3Y",
    },
    posterior: {
      riskModelHash: "risk-model-hash",
      universeTickers: tickers,
      blackLittermanExpectedReturn: mu,
      marketProxy: "VTI",
      riskWindow: "3Y",
      cash: { ticker: "CASH", forwardModelBeta: 0, expectedReturn: rf },
    },
    solve: o.solve,
  });
}
const certified = (out: TangencyOutcome): TangencyPortfolio => {
  if (!out.available) throw new Error(`${out.code}: ${out.reason}`);
  return out.tangency;
};
const calOf = (out: TangencyOutcome): ModelCal => {
  const cal = buildModelCal(out);
  if (!cal.available) throw new Error(`${cal.code}: ${cal.reason}`);
  return cal.line;
};
function randomModel(n: number, seed: number) {
  let state = seed;
  const rand = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const B = Array.from({ length: n }, () => [rand() * 0.4 - 0.1, rand() * 0.4 - 0.1, rand() * 0.4 - 0.1]);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const sigma = B.map((bi, i) => B.map((bj, j) => dot(bi, bj) * 0.04 + (i === j ? 0.01 + rand() * 0.05 : 0)));
  return { sigma, mu: Array.from({ length: n }, () => 0.02 + rand() * 0.12) };
}

/** A synthetic CAPM prior with the canonical E[R_m] = Rf + MRP (overridable). */
function prior(rf: number, mrp: number, o: Partial<CapmPrior> = {}): CapmPrior {
  return {
    methodologyVersion: FORWARD_METHODOLOGY.version,
    riskModelHash: "risk-model-hash",
    marketProxy: "VTI",
    riskWindow: "3Y",
    riskFreeRate: rf,
    riskFreeObservationDate: "2024-06-03",
    riskFreeSource: "fixture",
    marketRiskPremium: mrp,
    expectedMarketReturn: Number.isFinite(rf) && Number.isFinite(mrp) ? expectedMarketReturn(rf, mrp) : NaN,
    rows: [],
    cash: { ticker: "CASH", forwardModelBeta: 0, expectedReturn: rf },
    ...o,
  };
}
const SIGMA_M = 0.1734;
const marketModel = (o: Partial<Pick<ForwardRiskModel, "hash" | "marketProxy" | "marketVolatility">> = {}) => ({
  hash: "risk-model-hash",
  marketProxy: "VTI" as MarketProxy,
  marketVolatility: SIGMA_M,
  ...o,
});

describe("the line equations: one implementation each", () => {
  it("capitalLineReturnAt is intercept + slope·σ, exactly Rf at σ = 0", () => {
    const line = { intercept: 0.0513, slope: 0.4321 };
    expect(capitalLineReturnAt(line, 0)).toBe(0.0513);
    for (const s of [0.05, 0.1734, 0.3, 1.2]) expect(capitalLineReturnAt(line, s)).toBe(0.0513 + 0.4321 * s);
    expect(capitalLineReturnAt({ intercept: -0.005, slope: 0.25 }, 0.2)).toBe(-0.005 + 0.25 * 0.2);
  });

  it("a non-finite input fails like capmRequiredReturn (INVALID_INPUT), never NaN", () => {
    const cases: [number, number, number][] = [
      [NaN, 0.5, 0.2],
      [0.04, Infinity, 0.2],
      [0.04, 0.5, -Infinity],
    ];
    for (const [intercept, slope, sigma] of cases) {
      try {
        capitalLineReturnAt({ intercept, slope }, sigma);
        throw new Error("expected a failure");
      } catch (error) {
        expect(error).toBeInstanceOf(LabError);
        expect((error as LabError).detail.code).toBe("INVALID_INPUT");
      }
    }
  });

  it("securityMarketLineReturnAt is capmRequiredReturn(Rf, β, MRP), including its failure", () => {
    const out = buildSecurityMarketLine({ capmPrior: prior(0.0513, 0.05) });
    if (!out.available) throw new Error(out.reason);
    for (const beta of [-0.7, 0, 0.2, 0.5, 1, 1.3, 2.5])
      expect(securityMarketLineReturnAt(out.line, beta)).toBe(capmRequiredReturn(0.0513, beta, 0.05));
    try {
      securityMarketLineReturnAt(out.line, NaN);
      throw new Error("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LabError);
      expect((error as LabError).detail.code).toBe("INVALID_INPUT");
    }
  });
});

describe("Model CAL", () => {
  it("is defined by the certified tangency: (0, Rf) exactly, (σ_t, μ_t) within the allowance", () => {
    const t = certified(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12]));
    const cal = buildModelCal({ available: true, tangency: t });
    if (!cal.available) throw new Error(cal.reason);
    const line = cal.line;
    expect(line).toMatchObject({
      kind: "model_cal",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: t.riskModelHash,
      marketProxy: t.marketProxy,
      riskWindow: t.riskWindow,
      riskFreeRate: RF,
      riskFreeObservationDate: t.riskFreeObservationDate,
      intercept: RF,
      tangencyHash: t.tangencyHash,
    });
    // The slope IS the tangency's Forward Model Sharpe (not recomputed).
    expect(line.slope).toBe(t.forwardModelSharpe);
    expect(line.solidThroughVolatility).toBe(t.volatility);
    expect(line.tangencyVolatility).toBe(t.volatility);
    expect(line.tangencyExpectedReturn).toBe(t.expectedReturn);
    expect(capitalLineReturnAt(line, 0)).toBe(RF);
    const residual = Math.abs(capitalLineReturnAt(line, t.volatility) - t.expectedReturn);
    expect(line.anchorResidual).toBe(residual);
    expect(line.anchorAllowance).toBe(allowance(RF, line.slope, t.volatility, t.expectedReturn));
    expect(residual).toBeLessThanOrEqual(line.anchorAllowance);
    // No chart domain, colour, dash style or label: exactly the contract's fields.
    expect(sorted(line)).toEqual(CAL_KEYS);
    expect(sorted(cal)).toEqual(["available", "line"]);
  });

  it("the anchor holds within the allowance on seeded models and on negative or zero Rf", () => {
    let worst = 0;
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sigma, mu } = randomModel(2 + (seed % 8), 300 + seed);
      for (const rf of [0.0513, 0, -0.005]) {
        const out = tangencyOutcome(sigma, mu, { rf });
        if (!out.available) continue;
        const line = calOf(out);
        const t = out.tangency;
        expect(line.intercept).toBe(rf);
        expect(line.slope).toBe(t.forwardModelSharpe);
        expect(capitalLineReturnAt(line, 0)).toBe(rf);
        expect(line.anchorResidual).toBeLessThanOrEqual(line.anchorAllowance);
        worst = Math.max(worst, line.anchorResidual / line.anchorAllowance);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("lineHash is the SHA-256 of the economic lineage only", () => {
    const line = calOf(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12]));
    expect(line.lineHash).toBe(
      sha256Hex(
        JSON.stringify({
          kind: "model_cal",
          methodologyVersion: FORWARD_METHODOLOGY.version,
          tangencyHash: line.tangencyHash,
          intercept: line.intercept,
          slope: line.slope,
          solidThroughVolatility: line.solidThroughVolatility,
        }),
      ),
    );
    expect(line.lineHash).toMatch(/^[0-9a-f]{64}$/);
  });

  const carried = (out: TangencyOutcome) => {
    if (out.available) throw new Error("expected an unavailable tangency");
    const cal = buildModelCal(out);
    // The tangency's own unavailability, carried through unchanged; never a line.
    expect(cal).toEqual({ available: false, code: out.code, reason: out.reason, cause: out.cause });
    expect(sorted(cal)).toEqual(["available", "cause", "code", "reason"]);
    if (cal.available) throw new Error("a line was drawn");
    return cal;
  };

  it("unavailable when there are no risky assets (reason carried through)", () => {
    expect(carried(tangencyOutcome([], [])).code).toBe("no_risky_assets");
  });

  it("unavailable when no security clears Rf (reason carried through)", () => {
    const cal = carried(tangencyOutcome(SIGMA, [RF, RF - 0.01, RF - 0.02]));
    expect(cal).toMatchObject({ code: "no_positive_excess_return", cause: null });
  });

  it("unavailable when the tangency solve fails numerically (code and cause carried through)", () => {
    expect(carried(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12], { solve: () => null }))).toMatchObject({
      code: "numerical_failure",
      cause: "singular_face",
    });
    // A face optimum 1e-6 off: the tangency certification gate fails.
    const skewed = (A: number[][], b: number[]) => {
      const x = solveLinear(A, b);
      return x && x.map((v, i) => (i < b.length - 1 ? v * (1 + 1e-6) : v));
    };
    expect(carried(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12], { solve: skewed }))).toMatchObject({
      code: "numerical_failure",
      cause: "certification_failed",
    });
    // A forced active-set cycle: non_converged (active_set_cycle).
    const looping = (A: number[][], b: number[]) =>
      b.length === 2 ? [2, 10] : b.length === 3 ? [-1, 1, 5] : solveLinear(A, b);
    expect(carried(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12], { solve: looping }))).toMatchObject({
      code: "non_converged",
      cause: "active_set_cycle",
    });
  });

  it("refuses a tangency whose anchor identity or geometry does not hold (numerical_failure)", () => {
    const t = certified(tangencyOutcome(SIGMA, [0.1, 0.07, 0.12]));
    const tampered: Partial<TangencyPortfolio>[] = [
      { expectedReturn: t.expectedReturn + 1e-9 },
      { forwardModelSharpe: t.forwardModelSharpe * (1 + 1e-9) },
      { volatility: 0 },
      { volatility: -t.volatility },
      { volatility: NaN },
      { forwardModelSharpe: Infinity },
      { expectedReturn: NaN },
      { riskFreeRate: NaN },
    ];
    for (const change of tampered) {
      const cal = buildModelCal({ available: true, tangency: { ...t, ...change } });
      expect(cal).toMatchObject({ available: false, code: "numerical_failure", cause: "certification_failed" });
      expect(sorted(cal)).toEqual(["available", "cause", "code", "reason"]);
    }
  });
});

describe("Market CML Proxy", () => {
  it("is Rf + (MRP/σ_m)·σ: (0, Rf) exactly, (σ_m, Rf + MRP) within the allowance", () => {
    const p = prior(0.0513, 0.05);
    const out = buildMarketCmlProxy({ riskModel: marketModel(), capmPrior: p });
    if (!out.available) throw new Error(out.reason);
    const line = out.line;
    expect(line).toMatchObject({
      kind: "market_cml_proxy",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: "risk-model-hash",
      marketProxy: "VTI",
      riskWindow: "3Y",
      riskFreeRate: 0.0513,
      riskFreeObservationDate: "2024-06-03",
      marketRiskPremium: 0.05,
      intercept: 0.0513,
    });
    expect(line.slope).toBe(0.05 / SIGMA_M);
    // σ_m and E[R_m] are reused, never recomputed.
    expect(line.marketProxyVolatility).toBe(SIGMA_M);
    expect(line.solidThroughVolatility).toBe(SIGMA_M);
    expect(line.expectedMarketReturn).toBe(p.expectedMarketReturn);
    expect(line.expectedMarketReturn).toBe(expectedMarketReturn(0.0513, 0.05));
    expect(capitalLineReturnAt(line, 0)).toBe(0.0513);
    const residual = Math.abs(capitalLineReturnAt(line, SIGMA_M) - (0.0513 + 0.05));
    expect(line.anchorResidual).toBe(residual);
    expect(line.anchorAllowance).toBe(allowance(0.0513, line.slope, SIGMA_M, line.expectedMarketReturn));
    expect(residual).toBeLessThanOrEqual(line.anchorAllowance);
    expect(sorted(line)).toEqual(CML_KEYS);
    expect(line.lineHash).toBe(
      sha256Hex(
        JSON.stringify({
          kind: "market_cml_proxy",
          methodologyVersion: FORWARD_METHODOLOGY.version,
          riskModelHash: "risk-model-hash",
          marketProxy: "VTI",
          riskWindow: "3Y",
          riskFree: { series: "DGS1", observationDate: "2024-06-03", annualYield: 0.0513 },
          marketRiskPremium: 0.05,
          marketProxyVolatility: SIGMA_M,
        }),
      ),
    );
  });

  it("the anchor holds within the allowance across Rf, MRP and σ_m", () => {
    let worst = 0;
    for (const rf of [-0.005, 0, 0.0123, 0.0513, 0.15])
      for (const mrp of [2e-12, 1e-6, 0.0001, 0.02, 0.05, 0.1, 0.2])
        for (const sm of [0.05, 0.11, SIGMA_M, 0.2, 0.37]) {
          const out = buildMarketCmlProxy({ riskModel: marketModel({ marketVolatility: sm }), capmPrior: prior(rf, mrp) });
          if (!out.available) throw new Error(out.reason);
          expect(out.line.slope).toBe(mrp / sm);
          expect(capitalLineReturnAt(out.line, 0)).toBe(rf);
          expect(out.line.anchorResidual).toBeLessThanOrEqual(out.line.anchorAllowance);
          worst = Math.max(worst, out.line.anchorResidual / out.line.anchorAllowance);
        }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("is withheld (never flat or downward) when MRP ≤ 1e-12; available at 2e-12", () => {
    expect(TOL).toBe(1e-12);
    for (const mrp of [0, -0.05, -0.1, 1e-12]) {
      const out = buildMarketCmlProxy({ riskModel: marketModel(), capmPrior: prior(0.0513, mrp) });
      expect(out).toMatchObject({
        available: false,
        code: "market_proxy_has_no_positive_expected_excess_return",
        marketRiskPremium: mrp,
      });
      expect(sorted(out)).toEqual(["available", "code", "marketRiskPremium", "reason"]);
      if (!out.available) {
        expect(out.reason).toMatch(/zero, negative or too small to distinguish from zero/);
        expect(out.reason).toMatch(/no Capital Market Line proxy is drawn/);
        expect(out.reason).toMatch(/assumption itself is unchanged/);
      }
    }
    const just = buildMarketCmlProxy({ riskModel: marketModel(), capmPrior: prior(0.0513, 2e-12) });
    if (!just.available) throw new Error(just.reason);
    expect(just.line.slope).toBe(2e-12 / SIGMA_M);
    expect(just.line.slope).toBeGreaterThan(0);
  });

  it("rejects inconsistent or non-finite inputs (invalid_inputs)", () => {
    const p = prior(0.0513, 0.05);
    const cases: [Parameters<typeof buildMarketCmlProxy>[0], number | null][] = [
      [{ riskModel: marketModel({ hash: "other" }), capmPrior: p }, 0.05],
      [{ riskModel: marketModel({ marketProxy: "SPY" }), capmPrior: p }, 0.05],
      [{ riskModel: marketModel(), capmPrior: prior(NaN, 0.05) }, 0.05],
      [{ riskModel: marketModel(), capmPrior: prior(0.0513, Infinity) }, null],
      [{ riskModel: marketModel(), capmPrior: prior(0.0513, NaN) }, null],
      [{ riskModel: marketModel(), capmPrior: { ...p, expectedMarketReturn: NaN } }, 0.05],
      // E[R_m] must be the canonical Task 4 Rf + MRP, not a different calculation.
      [{ riskModel: marketModel(), capmPrior: { ...p, expectedMarketReturn: 0.0513 + 0.05 + 1e-12 } }, 0.05],
      [{ riskModel: marketModel({ marketVolatility: 0 }), capmPrior: p }, 0.05],
      [{ riskModel: marketModel({ marketVolatility: -SIGMA_M }), capmPrior: p }, 0.05],
      [{ riskModel: marketModel({ marketVolatility: NaN }), capmPrior: p }, 0.05],
      [{ riskModel: marketModel({ marketVolatility: Infinity }), capmPrior: p }, 0.05],
      // A positive σ_m so small that MRP/σ_m overflows.
      [{ riskModel: marketModel({ marketVolatility: 5e-324 }), capmPrior: p }, 0.05],
      // Inconsistent inputs are invalid before the MRP rule is applied.
      [{ riskModel: marketModel({ hash: "other" }), capmPrior: prior(0.0513, 0) }, 0],
      [{ riskModel: marketModel({ marketVolatility: 0 }), capmPrior: prior(0.0513, -0.05) }, -0.05],
    ];
    for (const [input, mrp] of cases) {
      const out = buildMarketCmlProxy(input);
      expect(out).toMatchObject({ available: false, code: "invalid_inputs", marketRiskPremium: mrp });
      expect(sorted(out)).toEqual(["available", "code", "marketRiskPremium", "reason"]);
    }
  });
});

describe("Security Market Line", () => {
  it("β = 0 gives Rf, β = 1 gives the canonical Rf + MRP, β = 1.5 is capmRequiredReturn", () => {
    const p = prior(0.0513, 0.05);
    const out = buildSecurityMarketLine({ capmPrior: p });
    if (!out.available) throw new Error(out.reason);
    const line = out.line;
    expect(line).toMatchObject({
      kind: "security_market_line",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: "risk-model-hash",
      marketProxy: "VTI",
      riskWindow: "3Y",
      riskFreeRate: 0.0513,
      riskFreeObservationDate: "2024-06-03",
      marketRiskPremium: 0.05,
      intercept: 0.0513,
      slope: 0.05,
      direction: "upward",
    });
    expect(securityMarketLineReturnAt(line, 0)).toBe(0.0513);
    expect(securityMarketLineReturnAt(line, 1)).toBe(expectedMarketReturn(0.0513, 0.05));
    expect(securityMarketLineReturnAt(line, 1)).toBe(p.expectedMarketReturn);
    expect(securityMarketLineReturnAt(line, 1.5)).toBe(capmRequiredReturn(0.0513, 1.5, 0.05));
    expect(sorted(line)).toEqual(SML_KEYS);
    expect(line.lineHash).toBe(
      sha256Hex(
        JSON.stringify({
          kind: "security_market_line",
          methodologyVersion: FORWARD_METHODOLOGY.version,
          riskModelHash: "risk-model-hash",
          marketProxy: "VTI",
          riskWindow: "3Y",
          riskFree: { series: "DGS1", observationDate: "2024-06-03", annualYield: 0.0513 },
          marketRiskPremium: 0.05,
        }),
      ),
    );
  });

  it("is defined for every valid MRP: upward, flat at Rf, or downward — never withheld", () => {
    const expected = [
      [0.05, "upward"],
      [1e-12, "upward"],
      [0, "flat"],
      [-0.05, "downward"],
      [-0.1, "downward"],
    ] as const;
    for (const [mrp, direction] of expected) {
      const out = buildSecurityMarketLine({ capmPrior: prior(0.0513, mrp) });
      if (!out.available) throw new Error(out.reason);
      expect(out.line.direction).toBe(direction);
      expect(out.line.slope).toBe(mrp);
      expect(securityMarketLineReturnAt(out.line, 0)).toBe(0.0513);
      expect(securityMarketLineReturnAt(out.line, 1)).toBe(expectedMarketReturn(0.0513, mrp));
      if (mrp === 0) for (const b of [-1, 0.5, 2]) expect(securityMarketLineReturnAt(out.line, b)).toBe(0.0513);
    }
  });

  it("rejects a non-finite Rf or MRP (invalid_inputs)", () => {
    for (const p of [prior(NaN, 0.05), prior(0.0513, Infinity), prior(0.0513, NaN), prior(-Infinity, 0.05)]) {
      const out = buildSecurityMarketLine({ capmPrior: p });
      expect(out).toMatchObject({ available: false, code: "invalid_inputs" });
      expect(sorted(out)).toEqual(["available", "code", "reason"]);
    }
  });
});

describe("the forward chain: relationships between the lines", () => {
  const rf: ForwardRiskFree = {
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
  const model = (universe = ["AAA", "BBB", "CCC", "DDD"], proxy: MarketProxy = "VTI"): ForwardRiskModel => {
    const r = buildForwardRiskModel({
      universe,
      marketProxy: proxy,
      riskWindow: "3Y",
      requestedStartDate: FORWARD_START_3Y,
      endDate: FORWARD_END,
      prices: ["AAA", "BBB", "CCC", "DDD", "VTI", "SPY", "VT"].map((t) => fixtureSeries(t)),
      sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
    });
    if (!r.available) throw new Error(r.reason);
    return r.model;
  };
  const BASE = model();
  /** The real forward chain: risk model → CAPM prior → BL → tangency → lines. */
  const chain = (mrp: number, views: Record<string, unknown> = {}, m = BASE, riskFree = rf) => {
    const p = buildCapmPrior({ riskModel: m, riskFree, marketRiskPremium: mrp });
    if (!p.available) throw new Error(p.reason);
    const inputs = buildBlackLittermanInputs({ riskModel: m, views });
    if (!inputs.available) throw new Error(inputs.reason);
    const post = buildBlackLittermanPosterior({ capmPrior: p.prior, riskModel: m, inputs: inputs.inputs });
    if (!post.available) throw new Error(post.reason);
    const tangency = buildTangencyPortfolio({ riskModel: m, capmPrior: p.prior, posterior: post.posterior });
    return {
      model: m,
      prior: p.prior,
      posterior: post.posterior,
      tangency,
      cal: buildModelCal(tangency),
      cml: buildMarketCmlProxy({ riskModel: m, capmPrior: p.prior }),
      sml: buildSecurityMarketLine({ capmPrior: p.prior }),
    };
  };
  const lines = (c: ReturnType<typeof chain>) => {
    if (!c.cal.available || !c.cml.available || !c.sml.available) throw new Error("a line is unavailable");
    return { cal: c.cal.line, cml: c.cml.line, sml: c.sml.line };
  };

  it("every line carries the chain's lineage; σ_m and E[R_m] come from Task 3 / Task 4", () => {
    const c = chain(0.05);
    const { cal, cml, sml } = lines(c);
    for (const line of [cal, cml, sml])
      expect(line).toMatchObject({
        methodologyVersion: FORWARD_METHODOLOGY.version,
        riskModelHash: BASE.hash,
        marketProxy: "VTI",
        riskWindow: "3Y",
        riskFreeRate: 0.0513,
        riskFreeObservationDate: "2024-06-03",
      });
    expect(cml.marketProxyVolatility).toBe(BASE.marketVolatility);
    expect(cml.expectedMarketReturn).toBe(c.prior.expectedMarketReturn);
    expect(cml.slope).toBe(c.prior.marketRiskPremium / BASE.marketVolatility);
    if (!c.tangency.available) throw new Error(c.tangency.reason);
    expect(cal.slope).toBe(c.tangency.tangency.forwardModelSharpe);
    expect(cal.tangencyHash).toBe(c.tangency.tangency.tangencyHash);
  });

  it("the SML reproduces every CAPM prior row and CASH exactly (one formula)", () => {
    const c = chain(0.05);
    const { sml } = lines(c);
    for (const row of c.prior.rows) expect(securityMarketLineReturnAt(sml, row.forwardModelBeta)).toBe(row.capmPrior);
    expect(securityMarketLineReturnAt(sml, 0)).toBe(c.prior.cash.expectedReturn);
  });

  it("no views: the Model CAL is never steeper than the Market CML Proxy (proxy not held)", () => {
    for (const proxy of ["VTI", "SPY"] as const) {
      const m = model(["AAA", "BBB", "CCC", "DDD"], proxy);
      for (const mrp of [0.02, 0.05, 0.1]) {
        const { cal, cml } = lines(chain(mrp, {}, m));
        expect(cal.slope).toBeLessThanOrEqual(cml.slope * (1 + 1e-12));
        // Not perfectly correlated with the proxy: strictly below it.
        expect(cal.slope).toBeLessThan(cml.slope);
      }
    }
  });

  it("no views with the proxy held: the tangency is the proxy and the slopes agree within 1e-12", () => {
    for (const proxy of ["VTI", "SPY"] as const) {
      const m = model(["AAA", "BBB", "CCC", "DDD", proxy], proxy);
      expect(m.proxyInUniverse).toBe(true);
      for (const mrp of [0.02, 0.05, 0.1]) {
        const c = chain(mrp, {}, m);
        const { cal, cml } = lines(c);
        expect(cal.slope).toBeLessThanOrEqual(cml.slope * (1 + 1e-12));
        expect(Math.abs(cal.slope - cml.slope)).toBeLessThanOrEqual(1e-12 * cml.slope);
        if (!c.tangency.available) throw new Error(c.tangency.reason);
        const t = c.tangency.tangency;
        expect(t.weights[t.tickers.indexOf(proxy)]).toBeGreaterThan(1 - 1e-9);
        expect(Math.abs(cal.solidThroughVolatility - cml.solidThroughVolatility)).toBeLessThan(1e-9);
      }
    }
  });

  it("with an active strong view the Model CAL can be steeper than the Market CML Proxy", () => {
    const c = chain(0.05, { CCC: { source: "manual", manualReturn: 0.25, confidence: 1 } });
    const { cal, cml } = lines(c);
    const ccc = c.prior.rows.find((r) => r.ticker === "CCC")!;
    expect(ccc.forwardModelBeta).toBeLessThan(0.5);
    expect(ccc.capmPrior).toBeLessThan(0.1);
    expect(c.posterior.blackLittermanExpectedReturn[c.posterior.universeTickers.indexOf("CCC")]).toBeCloseTo(0.25, 12);
    expect(cal.slope).toBeGreaterThan(cml.slope);
    expect(cal.anchorResidual).toBeLessThanOrEqual(cal.anchorAllowance);
  });

  it("MRP = 0 or < 0 with no views: no Model CAL, no CML proxy, and an SML flat or downward", () => {
    const flat = chain(0);
    expect(flat.cal).toMatchObject({ available: false, code: "no_positive_excess_return", cause: null });
    expect(flat.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: 0,
    });
    expect(flat.sml).toMatchObject({ available: true, line: { direction: "flat", slope: 0, intercept: 0.0513 } });
    const down = chain(-0.05);
    expect(down.cal).toMatchObject({ available: false, code: "no_positive_excess_return" });
    expect(down.cml).toMatchObject({
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      marketRiskPremium: -0.05,
    });
    expect(down.sml).toMatchObject({ available: true, line: { direction: "downward", slope: -0.05 } });
  });

  it("negative MRP, but a view lifts one security above Rf: a Model CAL without a CML proxy", () => {
    const c = chain(-0.05, { CCC: { source: "manual", manualReturn: 0.2, confidence: 0.5 } });
    expect(c.cal.available).toBe(true);
    expect(c.cml).toMatchObject({ available: false, code: "market_proxy_has_no_positive_expected_excess_return" });
    expect(c.sml).toMatchObject({ available: true, line: { direction: "downward" } });
  });

  describe("determinism and line hashes", () => {
    const hashes = (c: ReturnType<typeof chain>) => {
      const l = lines(c);
      return { cal: l.cal.lineHash, cml: l.cml.lineHash, sml: l.sml.lineHash };
    };

    it("identical outputs and hashes on repeat", () => {
      const a = chain(0.05, { CCC: { source: "manual", manualReturn: 0.15, confidence: 0.7 } });
      const b = chain(0.05, { CCC: { source: "manual", manualReturn: 0.15, confidence: 0.7 } }, model());
      expect(lines(b)).toEqual(lines(a));
      expect(hashes(b)).toEqual(hashes(a));
    });

    it("retrieval timestamps and provenance do not change any line or hash", () => {
      const a = chain(0.05);
      const b = chain(0.05, {}, BASE, {
        ...rf,
        provenance: {
          ...rf.provenance,
          provider: "other-provider",
          fetchedAt: "2024-06-04T20:00:00Z",
          lastSuccessfulRefresh: "2024-06-04T20:00:00Z",
          cacheAgeSeconds: 7200,
          fallbackUsed: true,
          warnings: ["stale cache"],
        },
      });
      expect(b.prior.riskFreeSource).not.toBe(a.prior.riskFreeSource);
      expect(lines(b)).toEqual(lines(a));
    });

    it("Rf, MRP and the risk model change every line's hash", () => {
      const h = hashes(chain(0.05));
      const changed = [
        hashes(chain(0.05, {}, BASE, { ...rf, annualYield: 0.05 })), // Rf
        hashes(chain(0.05, {}, BASE, { ...rf, observationDate: "2024-05-31" })), // Rf date
        hashes(chain(0.06)), // MRP (and so μ_BL)
        hashes(chain(0.05, {}, model(["AAA", "BBB", "CCC", "DDD"], "SPY"))), // proxy → Σ, σ_m
        hashes(chain(0.05, {}, model(["AAA", "BBB", "CCC"]))), // universe → risk model, σ_m
      ];
      for (const c of changed) {
        expect(c.cal).not.toBe(h.cal);
        expect(c.cml).not.toBe(h.cml);
        expect(c.sml).not.toBe(h.sml);
      }
    });

    it("σ_m alone changes the CML proxy hash; the risk-model hash alone changes CML and SML", () => {
      const p = prior(0.0513, 0.05);
      const base = buildMarketCmlProxy({ riskModel: marketModel(), capmPrior: p });
      const sigma = buildMarketCmlProxy({ riskModel: marketModel({ marketVolatility: 0.18 }), capmPrior: p });
      const hash = buildMarketCmlProxy({
        riskModel: marketModel({ hash: "other" }),
        capmPrior: prior(0.0513, 0.05, { riskModelHash: "other" }),
      });
      if (!base.available || !sigma.available || !hash.available) throw new Error("unavailable");
      expect(sigma.line.lineHash).not.toBe(base.line.lineHash);
      expect(hash.line.lineHash).not.toBe(base.line.lineHash);
      const smlA = buildSecurityMarketLine({ capmPrior: p });
      const smlB = buildSecurityMarketLine({ capmPrior: prior(0.0513, 0.05, { riskModelHash: "other" }) });
      if (!smlA.available || !smlB.available) throw new Error("unavailable");
      expect(smlB.line.lineHash).not.toBe(smlA.line.lineHash);
    });

    it("μ_BL (a view) changes only the Model CAL hash", () => {
      const a = hashes(chain(0.05));
      const b = hashes(chain(0.05, { CCC: { source: "manual", manualReturn: 0.15, confidence: 0.7 } }));
      expect(b.cal).not.toBe(a.cal);
      expect(b.cml).toBe(a.cml);
      expect(b.sml).toBe(a.sml);
    });
  });
});
