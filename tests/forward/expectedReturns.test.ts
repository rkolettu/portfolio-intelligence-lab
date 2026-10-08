import { describe, expect, it } from "vitest";
import {
  buildForwardExpectedReturns,
  portfolioForwardMetrics,
} from "@/lib/forward/expectedReturns";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildCapmPrior, capmRequiredReturn } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import type {
  ForwardExpectedReturnsResult,
  ForwardRiskFree,
  ForwardRiskModel,
  PortfolioForwardMetrics,
  StreetViewInput,
} from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

const rf = (annualYield = 0.04, fetchedAt = "2024-06-04T15:00:00Z"): ForwardRiskFree => ({
  series: "DGS1",
  maturity: "1Y",
  observationDate: "2024-06-03",
  annualYield,
  provenance: {
    provider: "fixture",
    fetchedAt,
    lastSuccessfulRefresh: fetchedAt,
    cacheAgeSeconds: 0,
    observationDate: "2024-06-03",
    fallbackUsed: false,
    warnings: [],
  },
});
const SIGMA = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
type Model = Pick<
  ForwardRiskModel,
  "tickers" | "covariance" | "modelBeta" | "hash" | "marketProxy" | "proxyInUniverse" | "window"
>;
const synthetic = (o: Partial<Model> = {}): Model => ({
  tickers: ["AAPL", "JPM", "MSFT"],
  covariance: SIGMA,
  modelBeta: [1.2, 0.8, -0.3],
  hash: "risk-model-hash",
  marketProxy: "VTI",
  proxyInUniverse: false,
  window: { requested: "3Y" } as ForwardRiskModel["window"],
  ...o,
});
const manual = (manualReturn: number, confidence: number) => ({ source: "manual", manualReturn, confidence });

function run(opts: {
  model?: Model;
  views?: Record<string, unknown>;
  street?: Record<string, StreetViewInput>;
  weights?: { ticker: string; weight: number }[];
  mrp?: number;
  riskFree?: ForwardRiskFree;
}) {
  const model = opts.model ?? synthetic();
  const prior = buildCapmPrior({ riskModel: model, riskFree: opts.riskFree ?? rf(), marketRiskPremium: opts.mrp ?? 0.05 });
  if (!prior.available) throw new Error(prior.reason);
  const inputs = buildBlackLittermanInputs({ riskModel: model, views: opts.views ?? {}, street: opts.street });
  if (!inputs.available) throw new Error(inputs.reason);
  const posterior = buildBlackLittermanPosterior({ capmPrior: prior.prior, riskModel: model, inputs: inputs.inputs });
  if (!posterior.available) throw new Error(posterior.reason);
  return buildForwardExpectedReturns({
    riskModel: model,
    capmPrior: prior.prior,
    inputs: inputs.inputs,
    posterior: posterior.posterior,
    weights: opts.weights ?? [
      { ticker: "AAPL", weight: 0.4 },
      { ticker: "JPM", weight: 0.3 },
      { ticker: "MSFT", weight: 0.2 },
      { ticker: "CASH", weight: 0.1 },
    ],
  });
}
const ok = (o: ReturnType<typeof run>): ForwardExpectedReturnsResult => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.result;
};
const VIEWS = { AAPL: manual(0.2, 0.6), MSFT: manual(-0.05, 0.5) };

describe("security expected-return table", () => {
  it("reuses the one CAPM prior (= CAPM Required Return) and the BL posterior", () => {
    const r = ok(run({ views: VIEWS }));
    expect(r.rows.map((x) => x.ticker)).toEqual(["AAPL", "JPM", "MSFT"]);
    r.rows.forEach((row) => {
      expect(row.capmPrior).toBe(capmRequiredReturn(0.04, row.forwardModelBeta, 0.05));
      expect(row.expectedReturnGap).toBe(row.blackLittermanExpectedReturn - row.capmPrior);
    });
    expect(r.rows[0].forwardModelBeta).toBe(1.2);
    expect(r.blackLittermanStatus).toBe("posterior");
  });

  it("shows positive, negative and zero gaps as calculated", () => {
    const r = ok(run({ views: { AAPL: manual(0.3, 0.6), MSFT: manual(-0.2, 0.5) }, model: synthetic({ covariance: [[0.09, 0, 0], [0, 0.0625, 0], [0, 0, 0.0729]] }) }));
    expect(r.rows[0].expectedReturnGap).toBeGreaterThan(0);
    expect(r.rows[2].expectedReturnGap).toBeLessThan(0);
    expect(r.rows[1].expectedReturnGap).toBe(0); // no view, no covariance with the views
  });

  it("gives every security an exactly zero gap when no view is active", () => {
    const r = ok(run({ views: { JPM: manual(0.12, 0), NVDA: manual(0.4, 0.9) } }));
    r.rows.forEach((row) => expect(row.expectedReturnGap).toBe(0));
    expect(r.activeViewCount).toBe(0);
    expect(r.blackLittermanStatus).toBe("prior_only");
  });

  it("preserves each security's Task 5 view status, source, basis, return and reason", () => {
    const r = ok(
      run({
        views: { AAPL: manual(0.2, 0.6), JPM: manual(0.12, 0), MSFT: { source: "street", manualReturn: 0.09, confidence: 0.5 }, NVDA: manual(0.4, 0.9) },
      }),
    );
    expect(r.rows.map((x) => x.viewStatus)).toEqual(["ACTIVE", "ZERO_CONFIDENCE", "STREET_DATA_UNAVAILABLE"]);
    expect(r.rows[0]).toMatchObject({ viewSource: "manual", viewBasis: "total_return", viewReturn: 0.2, confidence: 0.6, viewReason: null });
    expect(r.rows[1]).toMatchObject({ viewReturn: 0.12, confidence: 0, viewReason: expect.stringMatching(/Confidence is 0%/) });
    expect(r.rows[2]).toMatchObject({ viewSource: "street", viewBasis: "price_return", viewReturn: null });
    expect(r.rows[2].expectedReturnGap).not.toBe(0); // AAPL's view propagates through covariance
    expect(r.notApplicableViews.map((v) => [v.ticker, v.status])).toEqual([["NVDA", "OUT_OF_UNIVERSE"]]);
  });

  it("keeps an active Street view's price-return basis", () => {
    const street: Record<string, StreetViewInput> = {
      JPM: { ticker: "JPM", available: true, priceTargetReturn: 0.08, basis: "price_return", horizonMonths: 12, targetStatistic: "median", provider: "fixture", retrievedAt: "2024-06-04T15:00:00Z" },
    };
    const r = ok(run({ views: { JPM: { source: "street", manualReturn: null, confidence: 0.6 } }, street }));
    expect(r.rows[1]).toMatchObject({ viewStatus: "ACTIVE", viewSource: "street", viewBasis: "price_return", viewReturn: 0.08 });
  });

  it("adds a CASH row (β 0, Rf, gap 0, no view) only when the portfolio lists CASH", () => {
    const r = ok(run({ riskFree: rf(0.0437) }));
    expect(r.cash).toEqual({
      ticker: "CASH",
      forwardModelBeta: 0,
      capmPrior: 0.0437,
      viewStatus: "NO_VIEW",
      blackLittermanExpectedReturn: 0.0437,
      expectedReturnGap: 0,
    });
    expect(ok(run({ weights: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "JPM", weight: 0.5 }] })).cash).toBeNull();
  });
});

describe("portfolio forward metrics", () => {
  const metrics = (o: Parameters<typeof run>[0] = {}): PortfolioForwardMetrics => ok(run(o)).portfolio;

  it("computes expected return, Forward Model Beta, required return and gap from the canonical pieces", () => {
    const r = ok(run({ views: VIEWS }));
    const p = r.portfolio;
    const w = [0.4, 0.3, 0.2];
    const mu = r.rows.map((x) => x.blackLittermanExpectedReturn);
    expect(p.expectedReturn).toBeCloseTo(w[0] * mu[0] + w[1] * mu[1] + w[2] * mu[2] + 0.1 * 0.04, 15);
    expect(p.forwardModelBeta).toBeCloseTo(0.4 * 1.2 + 0.3 * 0.8 + 0.2 * -0.3, 15);
    expect(p.capmRequiredReturn).toBe(capmRequiredReturn(0.04, p.forwardModelBeta, 0.05));
    expect(p.expectedReturnGap).toBe(p.expectedReturn - p.capmRequiredReturn);
    expect(p.weights).toEqual({ tickers: ["AAPL", "JPM", "MSFT"], risky: w, cash: 0.1 });
    expect(p.riskyWeight).toBeCloseTo(0.9, 15);
  });

  it("satisfies the weighted-gap identity: portfolio gap = Σ w_i gap_i (CASH gap 0)", () => {
    for (const views of [VIEWS, {}, { JPM: manual(-0.3, 1) }]) {
      for (const mrp of [0.05, -0.1, 0, 0.2]) {
        const r = ok(run({ views, mrp }));
        const p = r.portfolio;
        const weighted = r.rows.reduce((s, row, i) => s + p.weights.risky[i] * row.expectedReturnGap, 0) + p.weights.cash * 0;
        expect(p.expectedReturnGap).toBeCloseTo(weighted, 15);
      }
    }
  });

  it("gives an exactly-zero-in-tolerance portfolio gap with no active views", () => {
    const p = metrics({ views: {} });
    expect(Math.abs(p.expectedReturnGap)).toBeLessThan(1e-16);
  });

  it("uses the risky weights unscaled in w′Σw, with CASH at zero variance", () => {
    const half = metrics({ weights: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "CASH", weight: 0.5 }] });
    expect(half.modelVariance).toBeCloseTo(0.25 * SIGMA[0][0], 16);
    expect(half.modelVolatility).toBeCloseTo(0.5 * 0.3, 15);
    const full = metrics();
    const w = [0.4, 0.3, 0.2];
    const v = w.reduce((s, a, i) => s + a * w.reduce((t, b, j) => t + SIGMA[i][j] * b, 0), 0);
    expect(full.modelVariance).toBeCloseTo(v, 16);
  });

  it("computes Forward Model Sharpe = (E − Rf) / σ when σ > 0", () => {
    const p = metrics({ views: VIEWS });
    expect(p.forwardModelSharpe).toEqual({
      available: true,
      value: (p.expectedReturn - 0.04) / p.modelVolatility,
    });
  });

  it("reports an all-CASH portfolio as Rf, β 0, gap 0, σ 0 and Sharpe unavailable (No risky assets)", () => {
    for (const r of [
      ok(run({ weights: [{ ticker: "CASH", weight: 1 }] })),
      ok(run({ weights: [{ ticker: "AAPL", weight: 0 }, { ticker: "CASH", weight: 1 }] })),
      ok(run({ model: synthetic({ tickers: [], covariance: [], modelBeta: [] }), weights: [{ ticker: "CASH", weight: 1 }] })),
    ]) {
      const p = r.portfolio;
      expect(p.expectedReturn).toBe(0.04);
      expect(p.forwardModelBeta).toBe(0);
      expect(p.capmRequiredReturn).toBe(0.04);
      expect(p.expectedReturnGap).toBe(0);
      expect(p.modelVolatility).toBe(0);
      expect(p.noRiskyAssets).toBe(true);
      expect(p.forwardModelSharpe).toEqual({ available: false, reason: "No risky assets" });
    }
  });

  it("reports Zero portfolio volatility (not 0, NaN or Infinity) for a fully hedged risky portfolio", () => {
    const hedge = synthetic({ tickers: ["AAA", "BBB"], covariance: [[0.04, -0.04], [-0.04, 0.04]], modelBeta: [1, -1] });
    const p = ok(run({ model: hedge, weights: [{ ticker: "AAA", weight: 0.5 }, { ticker: "BBB", weight: 0.5 }] })).portfolio;
    expect(p.modelVolatility).toBe(0);
    expect(p.noRiskyAssets).toBe(false);
    expect(p.forwardModelSharpe).toEqual({ available: false, reason: "Zero portfolio volatility" });
  });

  it("matches the asset's own model quantities for a 100% single-asset portfolio", () => {
    const r = ok(run({ views: VIEWS, weights: [{ ticker: "AAPL", weight: 1 }] }));
    const a = r.rows[0];
    const p = r.portfolio;
    expect(p.expectedReturn).toBe(a.blackLittermanExpectedReturn);
    expect(p.forwardModelBeta).toBe(a.forwardModelBeta);
    expect(p.capmRequiredReturn).toBe(a.capmPrior);
    expect(p.expectedReturnGap).toBe(a.expectedReturnGap);
    expect(p.modelVolatility).toBeCloseTo(Math.sqrt(SIGMA[0][0]), 15);
  });

  it("shows negative MRP, negative beta and negative gaps as calculated", () => {
    const negMrp = metrics({ mrp: -0.1 });
    expect(negMrp.capmRequiredReturn).toBeCloseTo(0.04 + (0.4 * 1.2 + 0.3 * 0.8 + 0.2 * -0.3) * -0.1, 15);
    const shortBeta = metrics({ weights: [{ ticker: "MSFT", weight: 1 }] });
    expect(shortBeta.forwardModelBeta).toBe(-0.3);
    expect(shortBeta.capmRequiredReturn).toBeCloseTo(0.04 - 0.3 * 0.05, 15);
    const bearish = metrics({ views: { AAPL: manual(-0.4, 1) } });
    expect(bearish.expectedReturnGap).toBeLessThan(0);
  });

  it("decomposes the expected return into Expected Return Contributions w_i × μ_i", () => {
    const p = metrics({ views: VIEWS });
    expect(p.expectedReturnContributions.map((c) => c.ticker)).toEqual(["AAPL", "JPM", "MSFT", "CASH"]);
    expect(p.expectedReturnContributions.reduce((s, c) => s + c.contribution, 0)).toBeCloseTo(p.expectedReturn, 15);
  });
});

describe("portfolio weight validation", () => {
  const weightsRun = (weights: { ticker: string; weight: number }[]) => run({ weights });

  it("rejects totals outside the portfolio tolerance instead of rescaling them", () => {
    for (const total of [0.9, 1.01, 1 + 2e-6]) {
      const r = weightsRun([{ ticker: "AAPL", weight: total }]);
      expect(r).toMatchObject({ available: false, code: "invalid_weights" });
      if (!r.available) expect(r.reason).toMatch(/rejected, never rescaled/);
    }
  });

  it("uses an exact total as entered and normalizes an accepted residual once, recording it", () => {
    expect(ok(weightsRun([{ ticker: "AAPL", weight: 0.6 }, { ticker: "JPM", weight: 0.3 }, { ticker: "CASH", weight: 0.1 }])).portfolio.normalized).toBe(false);
    const r = ok(weightsRun([{ ticker: "AAPL", weight: 0.6000005 }, { ticker: "JPM", weight: 0.3 }, { ticker: "CASH", weight: 0.1 }]));
    expect(r.portfolio.normalized).toBe(true);
    expect(r.portfolio.weightTotal).toBeCloseTo(1.0000005, 15);
    const p = r.portfolio;
    expect(p.weights.risky.reduce((a, b) => a + b, 0) + p.weights.cash).toBeCloseTo(1, 15);
    const weighted = r.rows.reduce((s, row, i) => s + p.weights.risky[i] * row.expectedReturnGap, 0);
    expect(p.expectedReturnGap).toBeCloseTo(weighted, 15);
  });

  it("rejects negative, non-finite, duplicate and unmodeled weights", () => {
    for (const weights of [
      [{ ticker: "AAPL", weight: 1.2 }, { ticker: "JPM", weight: -0.2 }],
      [{ ticker: "AAPL", weight: NaN }],
      [{ ticker: "AAPL", weight: 0.5 }, { ticker: "AAPL", weight: 0.5 }],
      [{ ticker: "AAPL", weight: 0.5 }, { ticker: "NVDA", weight: 0.5 }],
    ])
      expect(weightsRun(weights)).toMatchObject({ available: false, code: "invalid_weights" });
  });

  it("rejects an inconsistent model context", () => {
    expect(
      portfolioForwardMetrics(
        { tickers: ["AAA"], covariance: [[0.04]], forwardModelBeta: [], expectedReturns: [0.1], riskFreeRate: 0.04, marketRiskPremium: 0.05, cashExpectedReturn: 0.04 },
        [{ ticker: "AAA", weight: 1 }],
      ),
    ).toMatchObject({ available: false, code: "invalid_inputs" });
  });
});

describe("derived result hash", () => {
  const hash = (o: Parameters<typeof run>[0] = {}) => ok(run({ views: VIEWS, ...o })).resultHash;

  it("is a 64-character hex hash above (not replacing) the risk-model hash", () => {
    const r = ok(run({ views: VIEWS }));
    expect(r.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.riskModelHash).toBe("risk-model-hash");
  });

  it("does not change with view creation order, weight order, retrieval time, CASH absent vs 0, or labels", () => {
    const base = hash();
    expect(hash({ views: { MSFT: VIEWS.MSFT, AAPL: VIEWS.AAPL } })).toBe(base);
    expect(
      hash({ weights: [{ ticker: "CASH", weight: 0.1 }, { ticker: "MSFT", weight: 0.2 }, { ticker: "JPM", weight: 0.3 }, { ticker: "AAPL", weight: 0.4 }] }),
    ).toBe(base);
    expect(hash({ riskFree: rf(0.04, "2024-06-04T20:30:00Z") })).toBe(base);
    const noCash = { weights: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "JPM", weight: 0.5 }] };
    expect(hash({ weights: [...noCash.weights, { ticker: "CASH", weight: 0 }] })).toBe(hash(noCash));
    // Inactive or out-of-universe views do not change the economics.
    expect(hash({ views: { ...VIEWS, JPM: manual(0.5, 0), NVDA: manual(0.4, 0.9) } })).toBe(base);
  });

  it("changes with any economic input: MRP, Rf, view, weights, proxy or risk model", () => {
    const base = hash();
    const changed = [
      hash({ mrp: 0.055 }),
      hash({ riskFree: rf(0.041) }),
      hash({ views: { ...VIEWS, AAPL: manual(0.21, 0.6) } }),
      hash({ views: { ...VIEWS, AAPL: manual(0.2, 0.61) } }),
      hash({ weights: [{ ticker: "AAPL", weight: 0.41 }, { ticker: "JPM", weight: 0.29 }, { ticker: "MSFT", weight: 0.2 }, { ticker: "CASH", weight: 0.1 }] }),
      hash({ model: synthetic({ marketProxy: "SPY" }) }),
      hash({ model: synthetic({ hash: "another-risk-model" }) }),
    ];
    for (const h of changed) expect(h).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("is identical for the same fixture model however the universe arrived", () => {
    const prices = ["AAA", "BBB", "CCC", "VTI"].map((t) => fixtureSeries(t));
    const model = (universe: string[], ps = prices) => {
      const m = buildForwardRiskModel({ universe, marketProxy: "VTI", riskWindow: "3Y", requestedStartDate: FORWARD_START_3Y, endDate: FORWARD_END, prices: ps, sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END) });
      if (!m.available) throw new Error(m.reason);
      return m.model;
    };
    const weights = [{ ticker: "AAA", weight: 0.5 }, { ticker: "BBB", weight: 0.3 }, { ticker: "CCC", weight: 0.2 }];
    const a = ok(run({ model: model(["AAA", "BBB", "CCC"]), views: { BBB: manual(0.1, 0.7) }, weights }));
    const b = ok(run({ model: model(["CCC", "AAA", "BBB"], [...prices].reverse()), views: { BBB: manual(0.1, 0.7) }, weights: [...weights].reverse() }));
    expect(b.resultHash).toBe(a.resultHash);
    expect(b).toEqual(a);
  });
});

describe("module boundaries", () => {
  it("imports nothing Node-only, server-only, historical-return or Street-provider related", async () => {
    const { readFileSync } = await import("node:fs");
    const imports = [...readFileSync("lib/forward/expectedReturns.ts", "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      "./capm",
      "@/config/methodology",
      "@/lib/analytics/riskContribution",
      "@/lib/types/forward",
      "@/lib/utils/errors",
      "@/lib/utils/sha256",
    ]);
  });
});
