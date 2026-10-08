import { describe, expect, it } from "vitest";
import {
  blackLittermanMean,
  buildBlackLittermanPosterior,
  matrixInfinityNorm,
  vectorInfinityNorm,
} from "@/lib/forward/blackLitterman";
import { buildCapmPrior } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { arithmeticReturn } from "@/lib/analytics/returns";
import type {
  BlackLittermanPosterior,
  BlackLittermanPosteriorOutcome,
  ForwardRiskFree,
  ForwardRiskModel,
  StreetViewInput,
} from "@/lib/types/forward";
import type { HistoricalSeries } from "@/lib/types/data";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

const TAU = 0.05;
const RF: ForwardRiskFree = {
  series: "DGS1",
  maturity: "1Y",
  observationDate: "2024-06-03",
  annualYield: 0.04,
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
// AAPL, JPM, MSFT (canonical order): positive definite annual covariance.
const SIGMA = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
type Synthetic = Pick<
  ForwardRiskModel,
  "tickers" | "covariance" | "modelBeta" | "hash" | "marketProxy" | "proxyInUniverse" | "window"
>;
const synthetic = (
  tickers = ["AAPL", "JPM", "MSFT"],
  covariance = SIGMA,
  modelBeta = [1.2, 0.8, 1.0],
): Synthetic => ({
  tickers,
  covariance,
  modelBeta,
  hash: "risk-model-hash",
  marketProxy: "VTI",
  proxyInUniverse: false,
  window: { requested: "3Y" } as ForwardRiskModel["window"],
});
const manual = (manualReturn: number, confidence: number) => ({
  source: "manual",
  manualReturn,
  confidence,
});

/** Task 4 → Task 5 → Task 6 on one risk model. */
function posterior(
  views: Record<string, unknown>,
  m: Synthetic = synthetic(),
  street?: Record<string, StreetViewInput>,
  mrp = 0.05,
): BlackLittermanPosteriorOutcome {
  const prior = buildCapmPrior({ riskModel: m, riskFree: RF, marketRiskPremium: mrp });
  if (!prior.available) throw new Error(prior.reason);
  const inputs = buildBlackLittermanInputs({ riskModel: m, views, street });
  if (!inputs.available) throw new Error(inputs.reason);
  return buildBlackLittermanPosterior({ capmPrior: prior.prior, riskModel: m, inputs: inputs.inputs });
}
const ok = (o: BlackLittermanPosteriorOutcome): BlackLittermanPosterior => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.posterior;
};
const delta = (p: BlackLittermanPosterior) =>
  p.blackLittermanExpectedReturn.map((x, i) => x - p.capmPrior[i]);

describe("no active views", () => {
  it("returns the CAPM prior exactly, bit for bit, with no solve", () => {
    for (const views of [{}, { JPM: manual(0.12, 0) }, { NVDA: manual(0.3, 0.9) }]) {
      const p = ok(posterior(views));
      expect(p.status).toBe("prior_only");
      p.blackLittermanExpectedReturn.forEach((x, i) => expect(Object.is(x, p.capmPrior[i])).toBe(true));
      expect(p.certification).toEqual({ required: false, reason: "no_active_views" });
      expect(p.blackLittermanExpectedReturn).not.toBe(p.capmPrior); // a copy, not the same array
    }
  });
});

describe("single-view identity and correlation propagation", () => {
  const single = (c: number, q = 0.12) => {
    const p = ok(posterior({ JPM: manual(q, c) }));
    const piJ = p.capmPrior[1];
    return { p, d: delta(p), target: c * (q - piJ) };
  };

  it("moves the viewed asset by exactly c × (Q − Π) at 50%, 25% and 100%", () => {
    for (const c of [0.5, 0.25, 1]) {
      const { p, d, target } = single(c);
      expect(d[1]).toBeCloseTo(target, 14);
      expect(p.status).toBe("posterior");
    }
    expect(single(1).p.blackLittermanExpectedReturn[1]).toBeCloseTo(0.12, 14);
  });

  it("propagates to other assets by (Σ_BA / Σ_AA) × c × (Q_A − Π_A)", () => {
    const { d, target } = single(0.6);
    expect(d[0]).toBeCloseTo((SIGMA[0][1] / SIGMA[1][1]) * target, 14);
    expect(d[2]).toBeCloseTo((SIGMA[2][1] / SIGMA[1][1]) * target, 14);
  });

  it("propagates in the opposite direction through negative covariance", () => {
    const neg = SIGMA.map((r) => [...r]);
    neg[0][1] = neg[1][0] = -0.02;
    const p = ok(posterior({ JPM: manual(0.2, 0.5) }, synthetic(undefined, neg)));
    const d = delta(p);
    expect(d[1]).toBeGreaterThan(0);
    expect(d[0]).toBeLessThan(0);
    expect(d[0]).toBeCloseTo((-0.02 / neg[1][1]) * d[1], 14);
  });

  it("leaves an asset with zero covariance to the viewed asset exactly unchanged", () => {
    const zero = SIGMA.map((r) => [...r]);
    zero[2][1] = zero[1][2] = 0;
    const p = ok(posterior({ JPM: manual(0.2, 0.7) }, synthetic(undefined, zero)));
    expect(p.blackLittermanExpectedReturn[2]).toBe(p.capmPrior[2]);
  });
});

describe("multiple views, solved simultaneously", () => {
  it("matches the closed-form joint solution, not a sequential or per-asset blend", () => {
    const p = ok(posterior({ AAPL: manual(0.15, 0.5), MSFT: manual(0.06, 0.75) }));
    const pi = p.capmPrior;
    // Independent closed form: views on AAPL (0) and MSFT (2).
    const s = [
      [TAU * SIGMA[0][0], TAU * SIGMA[0][2]],
      [TAU * SIGMA[2][0], TAU * SIGMA[2][2]],
    ];
    const omega = [s[0][0] * (0.5 / 0.5), s[1][1] * (0.25 / 0.75)];
    const a = [
      [s[0][0] + omega[0], s[0][1]],
      [s[1][0], s[1][1] + omega[1]],
    ];
    const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
    const b = [0.15 - pi[0], 0.06 - pi[2]];
    const x = [(a[1][1] * b[0] - a[0][1] * b[1]) / det, (a[0][0] * b[1] - a[1][0] * b[0]) / det];
    const expected = [0, 1, 2].map(
      (i) => pi[i] + TAU * SIGMA[i][0] * x[0] + TAU * SIGMA[i][2] * x[1],
    );
    p.blackLittermanExpectedReturn.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 14));
    // A per-asset blend (1 − c)Π + cQ would give a different AAPL value here.
    expect(Math.abs(p.blackLittermanExpectedReturn[0] - (0.5 * pi[0] + 0.5 * 0.15))).toBeGreaterThan(1e-4);
    expect(p.activeViews.map((v) => v.ticker)).toEqual(["AAPL", "MSFT"]);
  });

  it("hits every view exactly with several 100%-confidence views", () => {
    const p = ok(posterior({ AAPL: manual(0.15, 1), JPM: manual(0.05, 1) }));
    expect(p.blackLittermanExpectedReturn[0]).toBeCloseTo(0.15, 14);
    expect(p.blackLittermanExpectedReturn[1]).toBeCloseTo(0.05, 14);
    expect(p.certification.required && p.certification.passed).toBe(true);
  });
});

describe("τ, ordering and inputs", () => {
  it("is invariant to τ when τ scales τΣ and Ω together", () => {
    const pi = [0.1, 0.08, 0.09];
    const P = [
      [1, 0, 0],
      [0, 0, 1],
    ];
    const Q = [0.15, 0.06];
    const run = (tau: number) =>
      blackLittermanMean({
        prior: pi,
        covariance: SIGMA,
        P,
        Q,
        Omega: [
          [tau * SIGMA[0][0] * 1, 0],
          [0, tau * SIGMA[2][2] * (0.25 / 0.75)],
        ],
        tau,
      });
    const a = run(0.05);
    for (const tau of [0.001, 0.5, 1, 7]) {
      const b = run(tau);
      if (!a.ok || !b.ok) throw new Error("solve failed");
      b.mean.forEach((v, i) => expect(v).toBeCloseTo(a.mean[i], 14));
    }
  });

  it("does not depend on ticker, price or view order", () => {
    const prices = ["AAA", "BBB", "CCC", "VTI"].map((t) => fixtureSeries(t));
    const fixture = (universe: string[], ps: HistoricalSeries[]) => {
      const r = buildForwardRiskModel({
        universe,
        marketProxy: "VTI",
        riskWindow: "3Y",
        requestedStartDate: FORWARD_START_3Y,
        endDate: FORWARD_END,
        prices: ps,
        sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
      });
      if (!r.available) throw new Error(r.reason);
      return r.model;
    };
    const a = posterior({ CCC: manual(0.03, 0.4), AAA: manual(0.2, 0.7) }, fixture(["AAA", "BBB", "CCC"], prices));
    const b = posterior(
      { AAA: manual(0.2, 0.7), CCC: manual(0.03, 0.4) },
      fixture(["CCC", "BBB", "AAA"], [...prices].reverse()),
    );
    expect(b).toEqual(a);
  });

  it("refuses inputs from different risk models or with another τ", () => {
    const m = synthetic();
    const prior = buildCapmPrior({ riskModel: m, riskFree: RF, marketRiskPremium: 0.05 });
    const inputs = buildBlackLittermanInputs({ riskModel: m, views: { JPM: manual(0.1, 0.5) } });
    if (!prior.available || !inputs.available) throw new Error("setup");
    expect(
      buildBlackLittermanPosterior({
        capmPrior: prior.prior,
        riskModel: { ...m, hash: "another" },
        inputs: inputs.inputs,
      }),
    ).toMatchObject({ available: false, code: "invalid_inputs" });
    expect(
      buildBlackLittermanPosterior({
        capmPrior: prior.prior,
        riskModel: m,
        inputs: { ...inputs.inputs, tau: 0.025 },
      }),
    ).toMatchObject({ available: false, code: "invalid_inputs" });
  });
});

describe("solve failures and certification (Q32)", () => {
  it("reports a singular view system with the views involved, adding no epsilon", () => {
    const singular = [
      [0.04, 0.04],
      [0.04, 0.04],
    ];
    const r = posterior({ AAA: manual(0.1, 1), BBB: manual(0.2, 1) }, synthetic(["AAA", "BBB"], singular, [1, 1]));
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.code).toBe("singular_view_system");
    expect(r.activeViews.map((v) => [v.ticker, v.confidence])).toEqual([
      ["AAA", 1],
      ["BBB", 1],
    ]);
  });

  it("records the certification of a successful solve", () => {
    const p = ok(posterior({ AAPL: manual(0.15, 0.5), MSFT: manual(0.06, 0.75) }));
    const c = p.certification;
    if (!c.required) throw new Error("expected a solve");
    expect(c.passed).toBe(true);
    expect(c.tolerance).toBe(1e-12);
    expect(c.relativeBackwardError!).toBeLessThan(1e-15);
    expect(c.matrixNorm).toBeGreaterThan(0);
    expect(c.solutionNorm).toBeGreaterThan(0);
    expect(c.rhsNorm).toBeGreaterThan(0);
    expect(c.residualNorm).toBeLessThan(1e-15);
  });

  it("fails certification when the solution does not satisfy the system", () => {
    const r = blackLittermanMean({
      prior: [0.1, 0.08, 0.09],
      covariance: SIGMA,
      P: [[0, 1, 0]],
      Q: [0.12],
      Omega: [[TAU * SIGMA[1][1]]],
      tau: TAU,
      solve: (A, b) => [(b[0] / A[0][0]) * (1 + 1e-9)],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("numerical_failure");
    expect(r.certification).toMatchObject({ required: true, passed: false });
    if (r.certification?.required) expect(r.certification.relativeBackwardError!).toBeGreaterThan(1e-12);
  });

  it("passes a zero-scale system only with a zero residual, never dividing by zero", () => {
    const r = blackLittermanMean({
      prior: [0.12],
      covariance: [[0.04]],
      P: [[1]],
      Q: [0.12],
      Omega: [[0]],
      tau: TAU,
      solve: () => [0],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.certification.required) {
      expect(r.certification.relativeBackwardError).toBeNull();
      expect(r.certification.passed).toBe(true);
    }
  });

  it("fails cleanly on non-finite inputs, systems or solutions", () => {
    const base = {
      prior: [0.1, 0.08, 0.09],
      covariance: SIGMA,
      P: [[0, 1, 0]],
      Q: [0.12],
      Omega: [[TAU * SIGMA[1][1]]],
      tau: TAU,
    };
    expect(blackLittermanMean({ ...base, Q: [NaN] })).toMatchObject({ ok: false, code: "invalid_inputs" });
    expect(blackLittermanMean({ ...base, prior: [0.1, Infinity, 0.09] })).toMatchObject({ ok: false, code: "invalid_inputs" });
    // Finite inputs whose system overflows: A = τΣ_kk + Ω = 1e308 + 1.8e308 = ∞.
    expect(
      blackLittermanMean({
        ...base,
        Omega: [[1.7976931348623157e308]],
        covariance: [
          [0.09, 0.02, 0.04],
          [0.02, 1e308, 0.015],
          [0.04, 0.015, 0.0729],
        ],
        tau: 1,
      }),
    ).toMatchObject({ ok: false, code: "numerical_failure" });
    expect(blackLittermanMean({ ...base, solve: () => [NaN] })).toMatchObject({ ok: false, code: "numerical_failure" });
    expect(blackLittermanMean({ ...base, P: [[0, 1]] })).toMatchObject({ ok: false, code: "invalid_inputs" });
  });

  it("uses the stated infinity norms", () => {
    expect(vectorInfinityNorm([1, -3, 2])).toBe(3);
    expect(vectorInfinityNorm([])).toBe(0);
    expect(matrixInfinityNorm([[1, -2], [-3, 0.5]])).toBe(3.5);
  });
});

describe("impossible posterior returns", () => {
  it("rejects (never clamps) a posterior at or below −100%, naming the security and the views", () => {
    // Σ_BA / Σ_AA = 2: a −90% view on AAA at 100% pulls BBB to about −182%.
    const sigma = [
      [0.01, 0.02],
      [0.02, 0.09],
    ];
    const r = posterior({ AAA: manual(-0.9, 1) }, synthetic(["AAA", "BBB"], sigma, [0.2, 1.4]));
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.code).toBe("invalid_posterior");
    expect(r.invalid.map((x) => x.ticker)).toEqual(["BBB"]);
    expect(r.invalid[0].capmPrior).toBeCloseTo(0.04 + 1.4 * 0.05, 14);
    expect(r.invalid[0].blackLittermanExpectedReturn).toBeLessThanOrEqual(-1);
    expect(r.activeViews).toEqual([
      expect.objectContaining({ ticker: "AAA", viewReturn: -0.9, confidence: 1, source: "manual" }),
    ]);
    expect(r.reason).toMatch(/not clamped/);
  });

  it("imposes no upper cap", () => {
    const p = ok(posterior({ JPM: manual(1.9, 1) }));
    expect(p.blackLittermanExpectedReturn[1]).toBeCloseTo(1.9, 14);
  });
});

describe("CASH, return basis and independence", () => {
  it("keeps CASH at Rf, outside the universe and the solve", () => {
    const p = ok(posterior({ JPM: manual(0.12, 0.5) }));
    expect(p.cash).toEqual({ ticker: "CASH", forwardModelBeta: 0, expectedReturn: 0.04 });
    expect(p.universeTickers).not.toContain("CASH");
    expect(p.rows.map((r) => r.ticker)).toEqual(["AAPL", "JPM", "MSFT"]);
  });

  it("carries the Street view's price-return basis through unchanged", () => {
    const street: Record<string, StreetViewInput> = {
      MSFT: {
        ticker: "MSFT",
        available: true,
        priceTargetReturn: 0.134,
        basis: "price_return",
        horizonMonths: 12,
        targetStatistic: "median",
        provider: "fixture",
        retrievedAt: "2024-06-04T15:00:00Z",
      },
    };
    const p = ok(posterior({ MSFT: { source: "street", manualReturn: null, confidence: 0.6 } }, synthetic(), street));
    expect(p.activeViews[0]).toMatchObject({
      source: "street",
      basis: "price_return",
      label: "12M Price-Target Return · Dividends Excluded",
    });
  });

  it("never depends on historical mean returns", () => {
    const prices = ["AAA", "BBB", "VTI"].map((t) => fixtureSeries(t));
    const drifted: HistoricalSeries = {
      ...prices[0],
      observations: prices[0].observations.reduce<HistoricalSeries["observations"]>((out, o, i) => {
        if (i === 0) return [o];
        const r = arithmeticReturn(prices[0].observations[i - 1].adjustedClose, o.adjustedClose);
        return [...out, { date: o.date, adjustedClose: out[i - 1].adjustedClose * (1 + r + 0.001) }];
      }, []),
    };
    const run = (ps: HistoricalSeries[]) => {
      const r = buildForwardRiskModel({
        universe: ["AAA", "BBB"],
        marketProxy: "VTI",
        riskWindow: "3Y",
        requestedStartDate: FORWARD_START_3Y,
        endDate: FORWARD_END,
        prices: ps,
        sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
      });
      if (!r.available) throw new Error(r.reason);
      return ok(posterior({ BBB: manual(0.1, 0.6) }, r.model)).blackLittermanExpectedReturn;
    };
    const a = run(prices);
    run([drifted, ...prices.slice(1)]).forEach((v, i) => expect(v).toBeCloseTo(a[i], 12));
  });

  it("imports nothing Node-only, server-only, historical or Street-provider related", async () => {
    const { readFileSync } = await import("node:fs");
    const imports = [...readFileSync("lib/forward/blackLitterman.ts", "utf8").matchAll(/from "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imports.sort()).toEqual([
      "@/config/methodology",
      "@/lib/analytics/construction/common",
      "@/lib/types/forward",
    ]);
  });
});
