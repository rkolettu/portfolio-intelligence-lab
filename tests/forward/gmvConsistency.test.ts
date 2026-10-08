// Task 9: Portfolio Theory GMV vs the Constructor's Minimum Variance. On identical
// inputs (universe, Σ, risky budget, bounds, CASH treatment) they are the same
// optimization problem and must agree; where those inputs differ, they may not.
import { describe, expect, it } from "vitest";
import { runConstruction, type ConstructionInput } from "@/lib/backtest/construction";
import { sessionsBetween } from "@/lib/backtest/calendar";
import { equalWeight } from "@/lib/analytics/construction/equalWeight";
import { minimumVariance } from "@/lib/analytics/construction/minimumVariance";
import { portfolioVariance } from "@/lib/analytics/riskContribution";
import { buildEfficientFrontier } from "@/lib/forward/frontier";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import type { ConstructionAnalytics, OptimizationConstraint } from "@/lib/types/construction";
import type { HistoricalSeries, TreasurySeries } from "@/lib/types/data";
import type { EfficientFrontier } from "@/lib/types/forward";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { FORWARD_END, FORWARD_NOW, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";
import { provenance } from "../fixtures/helpers";

const FAR = "2100-01-01T00:00:00Z";
const WEIGHT_TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;
const UNIVERSE = ["AAA", "BBB", "CCC", "DDD"];
const sessions = sessionsBetween("2019-05-15", FORWARD_END, FAR);
const treasury: TreasurySeries = {
  series: "DGS3MO",
  observations: sessionsBetween("2019-05-01", FORWARD_END, FAR).map((s) => ({
    date: s.date,
    annualYield: 0.04,
    availableAt: `${s.date}T23:59:00-05:00`,
    availability: "modeled",
  })),
  provenance,
};
const PRICES = [...UNIVERSE, "VTI"].map((t) => fixtureSeries(t));
const MU = [0.1, 0.07, 0.05, 0.11];

const config = (o: Partial<PortfolioConfig> = {}): PortfolioConfig => ({
  holdings: [
    { ticker: "AAA", weight: 0.3 },
    { ticker: "BBB", weight: 0.3 },
    { ticker: "CCC", weight: 0.2 },
    { ticker: "DDD", weight: 0.2 },
  ],
  benchmark: "VTI",
  requestedStartDate: FORWARD_START_3Y,
  endDate: FORWARD_END,
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
  ...o,
});
const construct = (
  o: {
    config?: PortfolioConfig;
    cash?: number;
    constraints?: OptimizationConstraint[];
    prices?: HistoricalSeries[];
  } = {},
): ConstructionAnalytics => {
  const prices = o.prices ?? PRICES;
  const input: ConstructionInput = {
    config: o.config ?? config(),
    constraints: o.constraints ?? [],
    cash: { mode: "fixed", weight: o.cash ?? 0 },
    estimation: { prices, treasury, sessions, eligibleEndDate: FORWARD_END },
    stress: { windows: [], prices, treasury, sessions, unavailable: [] },
    now: FORWARD_NOW,
  };
  return runConstruction(input);
};
/** The Constructor's own Σ_construction, moved from universe order to canonical. */
const constructorSigma = (r: ConstructionAnalytics) => {
  if (!r.covariance.available) throw new Error("no construction covariance");
  const cov = r.covariance.construction;
  const order = [...r.inputs.universe].sort().map((t) => r.inputs.universe.indexOf(t));
  return order.map((i) => order.map((j) => cov[i][j]));
};
/** The Constructor's Minimum Variance risky weights, canonical order. */
const constructorMv = (r: ConstructionAnalytics) => {
  const p = r.proposals.find((q) => q.method === "minimum_variance")!;
  expect(p.status).toBe("success");
  return [...r.inputs.universe].sort().map((t) => p.weights!.find((w) => w.ticker === t)!.weight);
};
const frontierOn = (sigma: number[][], mu = MU, tickers = UNIVERSE): EfficientFrontier => {
  const out = buildEfficientFrontier({
    riskModel: { tickers, covariance: sigma, hash: "snapshot" },
    posterior: { universeTickers: tickers, blackLittermanExpectedReturn: mu, riskModelHash: "snapshot" },
  });
  if (!out.available) throw new Error(out.reason);
  return out.frontier;
};
const maxDiff = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((x, i) => Math.abs(x - b[i])));

describe("Task 9 — identical inputs: Portfolio Theory GMV = Constructor Minimum Variance", () => {
  const r = construct();
  const sigma = constructorSigma(r);
  const f = frontierOn(sigma);

  it("no CASH: the same weights, bit for bit (one optimizer, one call)", () => {
    expect(r.inputs.riskyBudget).toBe(1);
    expect(f.gmv.weights).toEqual(constructorMv(r));
  });

  it("no CASH: the same variance and volatility", () => {
    const p = r.proposals.find((q) => q.method === "minimum_variance")!;
    if (!p.modelRisk.available) throw new Error("model risk unavailable");
    expect(portfolioVariance(sigma, f.gmv.weights)).toBe(p.modelRisk.variance);
    expect(f.gmv.volatility).toBe(p.modelRisk.volatility);
    expect(f.points[0].volatility).toBe(p.modelRisk.volatility);
  });

  it.each([0, 0.1, 0.25, 0.5])(
    "CASH %s fixed outside the optimizer: risky weights = (1 − c) × GMV, summing to 1 − c (not renormalized)",
    (c) => {
      const rc = construct({ cash: c });
      expect(rc.inputs.riskyBudget).toBe(1 - c);
      // Same risky Σ whatever the CASH weight: CASH is outside the covariance.
      expect(constructorSigma(rc)).toEqual(sigma);
      const w = constructorMv(rc);
      expect(Math.abs(w.reduce((s, x) => s + x, 0) - (1 - c))).toBeLessThanOrEqual(WEIGHT_TOL);
      expect(maxDiff(w, f.gmv.weights.map((x) => (1 - c) * x))).toBeLessThanOrEqual(1e-15);
      const p = rc.proposals.find((q) => q.method === "minimum_variance")!;
      // CASH is held exactly at c (no row is listed when c = 0).
      expect(p.weights!.find((x) => x.ticker === "CASH")?.weight ?? 0).toBe(c);
    },
  );

  it("the same Σ snapshot gives the same result whatever the ticker order, object key order or retrieval metadata", () => {
    // Holdings listed in reverse, with their keys in reverse order.
    const reversed = config({
      holdings: [...config().holdings].reverse().map((h) => ({ weight: h.weight, ticker: h.ticker })),
    });
    // The same prices with different retrieval metadata.
    const refetched = PRICES.map((s) => ({
      ...s,
      provenance: { ...s.provenance, fetchedAt: "2024-06-04T20:59:59Z", cacheAgeSeconds: 86_399 },
    })).reverse();
    const r2 = construct({ config: reversed, prices: refetched });
    expect(constructorSigma(r2)).toEqual(sigma);
    expect(constructorMv(r2)).toEqual(constructorMv(r));
    expect(frontierOn(constructorSigma(r2)).gmv.weights).toEqual(f.gmv.weights);
    // A permuted universe through the frontier gives the same GMV, permuted.
    const order = [2, 0, 3, 1];
    const permuted = frontierOn(
      order.map((i) => order.map((j) => sigma[i][j])),
      order.map((i) => MU[i]),
      order.map((i) => UNIVERSE[i]),
    );
    order.forEach((i, pos) =>
      expect(Math.abs(permuted.gmv.weights[pos] - f.gmv.weights[i])).toBeLessThanOrEqual(1e-12),
    );
  });
});

describe("Task 9 — different feasible sets: a difference is expected, not an inconsistency", () => {
  const r = construct();
  const sigma = constructorSigma(r);
  const gmv = frontierOn(sigma).gmv.weights;
  /** minimumVariance with these bounds, called as both paths call it. */
  const direct = (lower: number[], upper: number[]) =>
    minimumVariance({
      covariance: sigma,
      lower,
      upper,
      budget: 1,
      start: equalWeight({ lower, upper, budget: 1 }).weights!,
    });
  const constraint = (ticker: string, minWeight: number, maxWeight: number): OptimizationConstraint => ({
    ticker,
    minWeight,
    maxWeight,
    required: minWeight > 0,
  });

  it("a binding cap: the Constructor holds the capped security at its cap, so its allocation differs from GMV", () => {
    const top = gmv.indexOf(Math.max(...gmv));
    const cap = gmv[top] / 2;
    const rc = construct({ constraints: [constraint(UNIVERSE[top], 0, cap)] });
    const w = constructorMv(rc);
    // GMV is infeasible under the cap; the Constructor's allocation sits on it.
    expect(gmv[top]).toBeGreaterThan(cap);
    expect(Math.abs(w[top] - cap)).toBeLessThanOrEqual(WEIGHT_TOL);
    expect(maxDiff(w, gmv)).toBeGreaterThan(0.01);
    // Higher variance than the unconstrained minimum, as a smaller feasible set must give.
    expect(portfolioVariance(sigma, w)).toBeGreaterThan(portfolioVariance(sigma, gmv));
    // The difference is the feasible set alone: the same optimizer with the same cap
    // reproduces the Constructor exactly.
    const upper = UNIVERSE.map((_, i) => (i === top ? cap : 1));
    expect(direct(UNIVERSE.map(() => 0), upper).weights).toEqual(w);
  });

  it("a binding floor: the Constructor holds the floored security at its floor, so its allocation differs from GMV", () => {
    const low = gmv.indexOf(Math.min(...gmv));
    const floor = gmv[low] + 0.2;
    const rc = construct({ constraints: [constraint(UNIVERSE[low], floor, 1)] });
    const w = constructorMv(rc);
    expect(gmv[low]).toBeLessThan(floor);
    expect(Math.abs(w[low] - floor)).toBeLessThanOrEqual(WEIGHT_TOL);
    expect(maxDiff(w, gmv)).toBeGreaterThan(0.01);
    expect(portfolioVariance(sigma, w)).toBeGreaterThan(portfolioVariance(sigma, gmv));
    const lower = UNIVERSE.map((_, i) => (i === low ? floor : 0));
    expect(direct(lower, UNIVERSE.map(() => 1)).weights).toEqual(w);
  });

  it("a cap that does not bind leaves the allocation equal to GMV", () => {
    const top = gmv.indexOf(Math.max(...gmv));
    const rc = construct({ constraints: [constraint(UNIVERSE[top], 0, Math.min(1, gmv[top] + 0.1))] });
    expect(maxDiff(constructorMv(rc), gmv)).toBeLessThanOrEqual(1e-15);
  });
});

describe("Task 9 — different covariance: a difference is expected, not an inconsistency", () => {
  const forward = (() => {
    const out = buildForwardRiskModel({
      universe: UNIVERSE,
      marketProxy: "VTI",
      riskWindow: "3Y",
      requestedStartDate: FORWARD_START_3Y,
      endDate: FORWARD_END,
      prices: PRICES,
      sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
    });
    if (!out.available) throw new Error(out.reason);
    return out.model;
  })();
  const portfolioTheory = frontierOn(forward.covariance, MU, forward.tickers);

  it("the same window but holdings-only Ledoit–Wolf (no market proxy) gives a different Σ and different weights", () => {
    const r = construct();
    const sigma = constructorSigma(r);
    expect(forward.tickers).toEqual([...r.inputs.universe].sort());
    // The proxy joins the forward estimation universe, which changes the shrinkage
    // target and intensity, so even the same window yields another Σ.
    expect(maxDiff(sigma.flat(), forward.covariance.flat())).toBeGreaterThan(1e-6);
    const w = constructorMv(r);
    expect(maxDiff(w, portfolioTheory.gmv.weights)).toBeGreaterThan(1e-6);
    // Each is exactly the minimum-variance allocation of its own Σ.
    expect(frontierOn(sigma).gmv.weights).toEqual(w);
  });

  it("a different analysis period gives a further different Minimum Variance allocation", () => {
    const r = construct({ config: config({ requestedStartDate: "2023-06-01" }) });
    const w = constructorMv(r);
    expect(maxDiff(w, portfolioTheory.gmv.weights)).toBeGreaterThan(1e-3);
    expect(frontierOn(constructorSigma(r)).gmv.weights).toEqual(w);
  });
});

describe("Task 9 — GMV is a risk-only allocation and the frontier's anchor", () => {
  it("changing μ_BL never changes GMV weights; it moves only the chart's y-coordinate w_GMVᵀμ_BL", () => {
    const sigma = constructorSigma(construct());
    const a = frontierOn(sigma, MU);
    for (const mu of [
      [0.2, -0.05, 0.03, 0.01],
      [-0.5, -0.4, -0.3, -0.2],
      [0.07, 0.07, 0.07, 0.07],
    ]) {
      const b = frontierOn(sigma, mu);
      expect(b.gmv.weights).toEqual(a.gmv.weights);
      expect(b.gmv.volatility).toBe(a.gmv.volatility);
      expect(b.gmv.expectedReturn).toBe(b.gmv.weights.reduce((s, w, i) => s + w * mu[i], 0));
      expect(b.gmv.expectedReturn).not.toBe(a.gmv.expectedReturn);
    }
  });

  it("the GMV point has the lowest volatility of every certified frontier point", () => {
    const models = [constructorSigma(construct())];
    let seed = 91;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let m = 0; m < 20; m++) {
      const n = 3 + (m % 6);
      const B = Array.from({ length: n }, () => [rand() - 0.3, rand() - 0.3]);
      models.push(
        B.map((bi, i) => B.map((bj, j) => (bi[0] * bj[0] + bi[1] * bj[1]) * 0.04 + (i === j ? 0.01 + 0.05 * rand() : 0))),
      );
    }
    for (const sigma of models) {
      const mu = sigma.map((_, i) => 0.03 + 0.02 * i);
      const f = frontierOn(sigma, mu, sigma.map((_, i) => `T${i}`));
      const gmv = f.points[0];
      expect(gmv.role).toBe("gmv");
      for (const p of f.points.filter((q) => q.certified))
        expect(gmv.volatility!).toBeLessThanOrEqual(p.volatility! * (1 + 1e-14));
    }
  });
});
