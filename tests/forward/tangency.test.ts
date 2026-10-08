import { describe, expect, it } from "vitest";
import {
  buildTangencyPortfolio,
  certifyTangencyEconomics,
  certifyTangencyY,
} from "@/lib/forward/tangency";
import {
  buildEfficientFrontier,
  certifyFrontierPoint,
  solveTargetReturn,
} from "@/lib/forward/frontier";
import { activeSetQp } from "@/lib/forward/qp";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildCapmPrior } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { solveLinear } from "@/lib/analytics/construction/common";
import { jacobiEigen } from "@/lib/analytics/matrix";
import { sha256Hex } from "@/lib/utils/sha256";
import { CONSTRUCTION_METHODOLOGY, FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ForwardRiskFree,
  ForwardRiskModel,
  TangencyOutcome,
  TangencyPortfolio,
} from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

type Matrix = number[][];
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const variance = (S: Matrix, w: readonly number[]) => w.reduce((s, wi, i) => s + wi * dot(S[i], w), 0);
const RF = 0.04;
const SIGMA: Matrix = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];

/** Synthetic inputs in the shape the forward chain produces. */
function outcome(
  sigma: Matrix,
  mu: number[],
  o: {
    rf?: number;
    tickers?: string[];
    hash?: string;
    proxy?: "VTI" | "SPY" | "VT";
    date?: string;
    solve?: (A: number[][], b: number[]) => number[] | null;
  } = {},
): TangencyOutcome {
  const tickers = o.tickers ?? mu.map((_, i) => `T${i}`);
  const rf = o.rf ?? RF;
  const hash = o.hash ?? "risk-model-hash";
  const proxy = o.proxy ?? "VTI";
  return buildTangencyPortfolio({
    riskModel: { tickers, covariance: sigma, hash },
    capmPrior: {
      riskModelHash: hash,
      riskFreeRate: rf,
      riskFreeObservationDate: o.date ?? "2024-06-03",
      marketProxy: proxy,
      riskWindow: "3Y",
    },
    posterior: {
      riskModelHash: hash,
      universeTickers: tickers,
      blackLittermanExpectedReturn: mu,
      marketProxy: proxy,
      riskWindow: "3Y",
      cash: { ticker: "CASH", forwardModelBeta: 0, expectedReturn: rf },
    },
    solve: o.solve,
  });
}
const tangency = (sigma: Matrix, mu: number[], o: Parameters<typeof outcome>[2] = {}): TangencyPortfolio => {
  const out = outcome(sigma, mu, o);
  if (!out.available) throw new Error(`${out.code}: ${out.reason}`);
  return out.tangency;
};

/** Independent oracle: on a support S the y-problem's optimum is Σ_SS⁻¹a_S scaled;
 * the maximum Sharpe over every support with a nonnegative solution is the answer.
 * Solved by Gauss–Jordan elimination, independent of the solver. */
function oracle(S: Matrix, a: number[]): { w: number[]; sharpe: number } {
  const n = a.length;
  let best: { w: number[]; sharpe: number } | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const idx = [...Array(n).keys()].filter((i) => mask & (1 << i));
    const m = idx.length;
    const M = idx.map((i) => [...idx.map((j) => S[i][j]), a[i]]);
    let ok = true;
    for (let c = 0; c < m && ok; c++) {
      let p = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-15) ok = false;
      else {
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = 0; r < m; r++)
          if (r !== c) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
          }
      }
    }
    if (!ok) continue;
    const z = idx.map((_, p) => M[p][m] / M[p][p]);
    if (!(dot(z, idx.map((i) => a[i])) > 0) || z.some((v) => v < -1e-13)) continue;
    const sum = z.reduce((t, v) => t + v, 0);
    const w = new Array<number>(n).fill(0);
    idx.forEach((i, p) => (w[i] = Math.max(0, z[p]) / sum));
    const sharpe = dot(w, a) / Math.sqrt(variance(S, w));
    if (!best || sharpe > best.sharpe) best = { w, sharpe };
  }
  return best!;
}
function randomModel(n: number, seed: number) {
  let state = seed;
  const rand = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const B = Array.from({ length: n }, () => [rand() * 0.4 - 0.1, rand() * 0.4 - 0.1, rand() * 0.4 - 0.1]);
  const sigma = B.map((bi, i) => B.map((bj, j) => dot(bi, bj) * 0.04 + (i === j ? 0.01 + rand() * 0.05 : 0)));
  return { sigma, mu: Array.from({ length: n }, () => 0.02 + rand() * 0.12) };
}

/** Every certified tangency satisfies its own definitions. */
function expectCertified(t: TangencyPortfolio, sigma: Matrix) {
  const T = FORWARD_METHODOLOGY.tangency.tolerances;
  const mu = t.expectedReturns;
  expect(Math.abs(t.weights.reduce((s, w) => s + w, 0) - 1)).toBeLessThanOrEqual(T.budget);
  expect(t.weights.every((w) => w >= 0)).toBe(true);
  expect(Math.abs(t.variance - variance(sigma, t.weights))).toBeLessThanOrEqual(1e-15);
  expect(t.volatility).toBe(Math.sqrt(t.variance));
  expect(t.expectedReturn).toBe(dot(t.weights, mu));
  expect(t.excessReturn).toBe(t.expectedReturn - t.riskFreeRate);
  expect(t.excessReturn).toBeGreaterThan(0);
  expect(t.forwardModelSharpe).toBe(t.excessReturn / t.volatility);
  const c = t.certification;
  expect(c.scaled.scaledEquality!).toBeLessThanOrEqual(T.scaledEquality);
  expect(c.scaled.bound!).toBeLessThanOrEqual(T.bound);
  expect(c.scaled.kkt!).toBeLessThanOrEqual(T.kkt);
  expect(c.economic.budget!).toBeLessThanOrEqual(T.budget);
  expect(c.economic.bound!).toBeLessThanOrEqual(T.bound);
  expect(c.economic.scaleIdentity!).toBeLessThanOrEqual(T.scaledEquality);
  expect(c.economic.positiveExcessReturn).toBe(true);
  expect(c.economic.sharpeIdentity!).toBeLessThanOrEqual(c.economic.sharpeIdentityTolerance!);
  expect(Math.abs(t.forwardModelSharpe - t.yIdentitySharpe)).toBe(c.economic.sharpeIdentity);
  const s = Math.max(...mu.map((m) => m - t.riskFreeRate));
  expect(t.solver.excessReturnScale).toBe(s);
  // The y-space values come from y itself: w = y / Σy exactly, aᵀy = s, and the
  // identity Sharpe is s/√(yᵀΣy), recomputed here independently of w.
  const y = t.solver.y!;
  expect(t.solver.ySum).toBe(y.reduce((u, v) => u + v, 0));
  t.weights.forEach((w, i) => expect(w).toBe(y[i] / t.solver.ySum!));
  expect(Math.abs(dot(mu.map((m) => m - t.riskFreeRate), y) / s - 1)).toBeLessThanOrEqual(T.scaledEquality);
  expect(Math.abs(t.yIdentitySharpe - s / Math.sqrt(variance(sigma, y))) / t.yIdentitySharpe).toBeLessThan(1e-14);
  // KKT normalization: 2·λmax(Σ)·1ᵀy, minimumVariance's L·B with B = 1ᵀy.
  const L = 2 * jacobiEigen(sigma, { maxSweeps: CONSTRUCTION_METHODOLOGY.limits.eigenSweeps }).values.at(-1)!;
  expect(c.scaled.kktNormalization).toBe(L * t.solver.ySum!);
  if (t.solver.method === "active_set") {
    expect(t.solver.maxIterations).toBe(Math.max(50, 2 * mu.length ** 2));
    expect(t.solver.iterations).toBeLessThanOrEqual(t.solver.maxIterations!);
    expect(t.solver.joins! + t.solver.releases!).toBe(t.solver.iterations - 1);
    expect(t.solver.cycleDetected).toBe(false);
  }
}

describe("buildTangencyPortfolio — exact solutions", () => {
  it("two assets, both held: w ∝ Σ⁻¹a (closed form)", () => {
    const S = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const mu = [0.09, 0.13];
    const t = tangency(S, mu);
    expectCertified(t, S);
    const a = mu.map((m) => m - RF);
    const raw = [S[1][1] * a[0] - S[0][1] * a[1], S[0][0] * a[1] - S[1][0] * a[0]];
    const sum = raw[0] + raw[1];
    expect(t.weights[0]).toBeCloseTo(raw[0] / sum, 14);
    expect(t.weights[1]).toBeCloseTo(raw[1] / sum, 14);
  });

  it("three assets, all held: w ∝ Σ⁻¹a, and the oracle agrees", () => {
    const mu = [0.1, 0.07, 0.12];
    const t = tangency(SIGMA, mu);
    expectCertified(t, SIGMA);
    const a = mu.map((m) => m - RF);
    const raw = solveLinear(SIGMA.map((r) => [...r]), a)!;
    expect(raw.every((x) => x > 0)).toBe(true);
    const sum = raw.reduce((s, x) => s + x, 0);
    t.weights.forEach((w, i) => expect(w).toBeCloseTo(raw[i] / sum, 13));
    expect(t.binding).toEqual({ lower: [], upper: [] });
  });

  it("a constrained solution holds a security at exactly 0% (Σ⁻¹a would short it)", () => {
    const S = [
      [0.04, 0.006, 0.05],
      [0.006, 0.09, 0.02],
      [0.05, 0.02, 0.16],
    ];
    const mu = [0.1, 0.12, 0.07];
    const a = mu.map((m) => m - RF);
    expect(solveLinear(S.map((r) => [...r]), a)!.some((x) => x < 0)).toBe(true);
    const t = tangency(S, mu, { tickers: ["LOW", "HIGH", "DUD"] });
    // Results are in canonical (sorted) order: DUD, HIGH, LOW.
    expect(t.tickers).toEqual(["DUD", "HIGH", "LOW"]);
    expectCertified(t, [2, 1, 0].map((i) => [2, 1, 0].map((j) => S[i][j])));
    expect(t.weights[0]).toBe(0);
    expect(t.binding.lower).toEqual(["DUD"]);
    const o = oracle(
      [2, 1, 0].map((i) => [2, 1, 0].map((j) => S[i][j])),
      [2, 1, 0].map((i) => a[i]),
    );
    t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-12));
  });

  it("matches the brute-force maximum Sharpe on seeded models of 2–10 securities", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { sigma, mu } = randomModel(2 + (seed % 9), seed);
      const out = outcome(sigma, mu);
      if (!out.available) {
        expect(out.code).toBe("no_positive_excess_return");
        continue;
      }
      const t = out.tangency;
      expectCertified(t, sigma);
      // Tickers T0…T9 already sort in index order here.
      const o = oracle(sigma, mu.map((m) => m - RF));
      t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-12));
      expect(Math.abs(t.forwardModelSharpe - o.sharpe) / o.sharpe).toBeLessThan(1e-12);
    }
  });

  it("the top security can leave the solution (a join), and a security can leave and re-enter", () => {
    // Two securities: the top one is highly correlated with a quieter one, so the
    // solve releases the quieter one and then pins the top one: 100% in the quieter.
    const two = tangency(
      [
        [0.09, 0.0285],
        [0.0285, 0.01],
      ],
      [RF + 0.1, RF + 0.09],
    );
    expect(two.weights).toEqual([0, 1]);
    expect(two.solver).toMatchObject({ startTicker: "T0", joins: 1, releases: 1, iterations: 3 });
    // Four securities: release 1, release 2, join 1, release 3, join 0, release 1 —
    // security 1 leaves and re-enters; the start security leaves.
    const S = [
      [0.10293743612151023, 0.0010030623814201976, 0.005465120657700752, 0.038551344369317085],
      [0.0010030623814201978, 0.09134448386148905, 0.005529444981925105, -0.0011923266604540585],
      [0.005465120657700752, 0.005529444981925105, 0.004223953161583532, 0.0021333661137427113],
      [0.038551344369317085, -0.0011923266604540585, 0.0021333661137427113, 0.015943787136496242],
    ];
    const a = [0.11310380714624364, 0.08387475632777193, 0.06836269787902137, 0.08578931824108088];
    const four = tangency(S, a.map((x) => x + RF));
    expectCertified(four, S);
    expect(four.solver).toMatchObject({ joins: 2, releases: 4, iterations: 7, cycleDetected: false });
    expect(four.weights[0]).toBe(0);
    expect(four.weights[1]).toBeGreaterThan(0);
    const o = oracle(S, four.expectedReturns.map((m) => m - RF));
    four.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-12));
  });

  it("alternate valid starts give the same tangency (the start is an implementation detail)", () => {
    const { sigma, mu } = randomModel(7, 404);
    const t = tangency(sigma, mu);
    const a = mu.map((m) => m - RF);
    const s = Math.max(...a);
    const c = a.map((x) => x / s);
    const L = 2 * jacobiEigen(sigma, { maxSweeps: CONSTRUCTION_METHODOLOGY.limits.eigenSweeps }).values.at(-1)!;
    const starts = [
      ...c.flatMap((ci, j) => (ci > 0 ? [c.map((_, i) => (i === j ? 1 / ci : 0))] : [])),
      // An equal mix of every feasible single-security start is feasible too.
      c.map((ci) => (ci > 0 ? 1 / ci / c.filter((x) => x > 0).length : 0)),
    ];
    expect(starts.length).toBeGreaterThan(2);
    for (const start of starts) {
      const qp = activeSetQp({ covariance: sigma, E: [c], f: [1], start, optimalityTolerance: 1e-8 * L, maxIterations: 98 });
      if (!qp.ok) throw new Error(qp.reason);
      const sum = qp.x.reduce((u, v) => u + v, 0);
      qp.x.forEach((v, i) => expect(Math.abs(v / sum - t.weights[i])).toBeLessThan(1e-12));
    }
  });
});

describe("existence: max(μ_BL − Rf) > 1e-12, whatever the sign of the MRP", () => {
  it("records the tolerance in the versioned methodology", () => {
    expect(FORWARD_METHODOLOGY.tangency.positiveExcessReturnTolerance).toBe(1e-12);
  });

  it("the threshold is strict: a max excess return of exactly 1e-12 is unavailable, 2e-12 exists", () => {
    const S = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    expect(outcome(S, [1e-12, -0.01], { rf: 0 })).toMatchObject({
      available: false,
      code: "no_positive_excess_return",
      maxExcessReturn: 1e-12,
    });
    expect(outcome(S, [2e-12, -0.01], { rf: 0 }).available).toBe(true);
  });

  it("one security barely below the threshold: unavailable; clearly above: tangency", () => {
    const below = outcome(SIGMA, [RF + 0.9e-12, RF - 0.01, RF - 0.02]);
    expect(below).toMatchObject({ available: false, code: "no_positive_excess_return" });
    if (!below.available) expect(below.maxExcessReturn!).toBeLessThanOrEqual(1e-12);
    for (const gap of [1e-11, 1e-9, 1e-6]) {
      const t = tangency(SIGMA, [RF + gap, RF - 0.01, RF - 0.02]);
      expectCertified(t, SIGMA);
      expect(t.solver.excessReturnScale).toBeGreaterThan(1e-12);
      // Securities below Rf stay in the problem: the oracle on the full universe agrees.
      const o = oracle(SIGMA, t.expectedReturns.map((m) => m - RF));
      t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-9));
    }
  });

  it("does not filter securities: one below Rf is held when it diversifies", () => {
    // B returns less than Rf but is strongly negatively correlated with A.
    const S = [
      [0.04, -0.032],
      [-0.032, 0.04],
    ];
    const t = tangency(S, [RF + 0.05, RF - 0.01]);
    expectCertified(t, S);
    expect(t.weights[1]).toBeGreaterThan(0.4);
    // Σ⁻¹a = [0.042, 0.030] (up to scale): B holds 0.030/0.072.
    expect(t.weights[1]).toBeCloseTo(0.03 / 0.072, 12);
  });

  it("negative expected returns stay eligible, and one is held when it hedges", () => {
    const mu = [-0.05, 0.08, -0.2];
    const t = tangency(SIGMA, mu);
    expectCertified(t, SIGMA);
    expect(t.tickers).toHaveLength(3);
    const o = oracle(SIGMA, mu.map((m) => m - RF));
    t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-12));
    // B has a NEGATIVE expected return but correlation −0.8 with A: with Rf = 1%,
    // Σ⁻¹a ∝ [0.00216, 0.00144], so B holds 40%.
    const S = [
      [0.04, -0.032],
      [-0.032, 0.04],
    ];
    const hedge = tangency(S, [0.08, -0.01], { rf: 0.01 });
    expectCertified(hedge, S);
    expect(hedge.expectedReturns[1]).toBeLessThan(0);
    expect(hedge.weights[1]).toBeCloseTo(0.4, 12);
  });

  it("an exact tie in the largest excess return starts from the lowest canonical ticker", () => {
    const mu = [0.1, 0.07, 0.1];
    const t = tangency(SIGMA, mu, { tickers: ["ZZZ", "MMM", "AAA"] });
    expect(t.solver.startTicker).toBe("AAA");
    const order = [2, 1, 0];
    const S = order.map((i) => order.map((j) => SIGMA[i][j]));
    expectCertified(t, S);
    const o = oracle(S, order.map((i) => mu[i] - RF));
    t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-12));
  });

  it("no risky assets: unavailable, 'No risky assets', no solver", () => {
    const out = outcome([], []);
    expect(out).toMatchObject({ available: false, code: "no_risky_assets", reason: "No risky assets", solver: null });
  });

  it("a single risky security: 100% when it clears Rf, otherwise unavailable — no QP", () => {
    const one = tangency([[0.04]], [RF + 0.03]);
    expectCertified(one, [[0.04]]);
    expect(one.weights).toEqual([1]);
    expect(one.solver).toMatchObject({ method: "single_security", iterations: 0, maxIterations: null });
    expect(one.forwardModelSharpe).toBeCloseTo(0.03 / 0.2, 15);
    expect(outcome([[0.04]], [RF])).toMatchObject({ available: false, code: "no_positive_excess_return" });
    expect(outcome([[0.04]], [RF - 0.01])).toMatchObject({ available: false, code: "no_positive_excess_return" });
  });
});

describe("the forward chain: MRP and views", () => {
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
  const model = (universe = ["AAA", "BBB", "CCC", "DDD"], proxy: "VTI" | "SPY" = "VTI"): ForwardRiskModel => {
    const r = buildForwardRiskModel({
      universe,
      marketProxy: proxy,
      riskWindow: "3Y",
      requestedStartDate: FORWARD_START_3Y,
      endDate: FORWARD_END,
      prices: ["AAA", "BBB", "CCC", "DDD", "VTI", "SPY"].map((t) => fixtureSeries(t)),
      sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
    });
    if (!r.available) throw new Error(r.reason);
    return r.model;
  };
  const chain = (mrp: number, views: Record<string, unknown> = {}, m = model(), riskFree = rf) => {
    const prior = buildCapmPrior({ riskModel: m, riskFree, marketRiskPremium: mrp });
    if (!prior.available) throw new Error(prior.reason);
    const inputs = buildBlackLittermanInputs({ riskModel: m, views });
    if (!inputs.available) throw new Error(inputs.reason);
    const post = buildBlackLittermanPosterior({ capmPrior: prior.prior, riskModel: m, inputs: inputs.inputs });
    if (!post.available) throw new Error(post.reason);
    return buildTangencyPortfolio({ riskModel: m, capmPrior: prior.prior, posterior: post.posterior });
  };

  it("positive MRP, no views: a certified tangency with the chain's lineage", () => {
    const m = model();
    const out = chain(0.05, {}, m);
    if (!out.available) throw new Error(out.reason);
    const t = out.tangency;
    expectCertified(t, m.covariance);
    expect(t).toMatchObject({ riskModelHash: m.hash, marketProxy: "VTI", riskWindow: "3Y", riskFreeRate: 0.0513 });
    const o = oracle(m.covariance, t.expectedReturns.map((x) => x - 0.0513));
    t.weights.forEach((w, i) => expect(Math.abs(w - o.w[i])).toBeLessThan(1e-11));
  });

  it("MRP = 0 with no views: every prior equals Rf, so no tangency", () => {
    expect(chain(0)).toMatchObject({ available: false, code: "no_positive_excess_return", maxExcessReturn: 0 });
  });

  it("negative MRP with no security above Rf: unavailable — never the least-negative portfolio", () => {
    const out = chain(-0.05);
    expect(out).toMatchObject({ available: false, code: "no_positive_excess_return" });
    if (!out.available) expect(out.maxExcessReturn!).toBeLessThan(0);
  });

  it("negative MRP, but a view lifts one security above Rf: tangency is computed normally", () => {
    const m = model();
    const out = chain(-0.05, { CCC: { source: "manual", manualReturn: 0.2, confidence: 0.5 } }, m);
    if (!out.available) throw new Error(out.reason);
    expectCertified(out.tangency, m.covariance);
    expect(out.tangency.weights[out.tangency.tickers.indexOf("CCC")]).toBeGreaterThan(0);
  });

  it("the same economics in another order gives the same tangency and hash", () => {
    const a = chain(0.05, { CCC: { source: "manual", manualReturn: 0.15, confidence: 0.7 } });
    const b = chain(0.05, { CCC: { confidence: 0.7, manualReturn: 0.15, source: "manual" } }, model(["DDD", "CCC", "BBB", "AAA"]), {
      ...rf,
      provenance: { ...rf.provenance, fetchedAt: "2024-06-04T20:00:00Z", cacheAgeSeconds: 7200 },
    });
    expect(b).toEqual(a);
  });

  it("the hash changes with Σ, μ_BL, Rf and the market proxy lineage", () => {
    const base = chain(0.05);
    if (!base.available) throw new Error(base.reason);
    const h = base.tangency.tangencyHash;
    const changed = [
      chain(0.06), // μ_BL
      chain(0.05, {}, model(), { ...rf, annualYield: 0.05 }), // Rf
      chain(0.05, {}, model(["AAA", "BBB", "CCC", "DDD"], "SPY")), // proxy → Σ, β, lineage
    ];
    for (const c of changed) {
      if (!c.available) throw new Error(c.reason);
      expect(c.tangency.tangencyHash).not.toBe(h);
    }
  });
});

describe("frontier consistency and independent checks", () => {
  const frontierOf = (sigma: Matrix, mu: number[]) => {
    const t = mu.map((_, i) => `T${i}`);
    const f = buildEfficientFrontier({
      riskModel: { tickers: t, covariance: sigma, hash: "h" },
      posterior: { universeTickers: t, blackLittermanExpectedReturn: mu, riskModelHash: "h" },
    });
    if (!f.available) throw new Error(f.reason);
    return f.frontier;
  };

  it("lies on the constrained frontier: the exact target-return solve at its return reproduces it", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sigma, mu } = randomModel(3 + (seed % 7), 100 + seed);
      const out = outcome(sigma, mu);
      if (!out.available) continue;
      const t = out.tangency;
      const f = frontierOf(sigma, mu);
      if (f.maxExpectedReturn - t.expectedReturn <= FORWARD_METHODOLOGY.frontier.topReturnTieTolerance) {
        // Near-tie top region: the approved top-endpoint methodology.
        f.points[40].weights!.forEach((w, i) => expect(Math.abs(w - t.weights[i])).toBeLessThan(1e-12));
        continue;
      }
      const solved = solveTargetReturn({
        covariance: sigma,
        expectedReturns: mu,
        gmvWeights: f.gmv.weights,
        targetReturn: t.expectedReturn,
        normalization: f.kktNormalization,
      });
      if (!solved.ok) throw new Error(solved.reason);
      const check = certifyFrontierPoint({
        weights: solved.weights,
        targetReturn: t.expectedReturn,
        covariance: sigma,
        expectedReturns: mu,
        normalization: f.kktNormalization,
      });
      expect(check.certified).toBe(true);
      expect(Math.abs(variance(sigma, solved.weights) - t.variance) / t.variance).toBeLessThan(1e-12);
      solved.weights.forEach((w, i) => expect(Math.abs(w - t.weights[i])).toBeLessThan(1e-11));
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("in the near-tie top region it is checked against the approved top endpoint", () => {
    // A and B highly correlated, A higher: Σ⁻¹a shorts B, so the tangency is 100% A,
    // the highest-return security — the frontier's top endpoint.
    const S = [
      [0.04, 0.036],
      [0.036, 0.04],
    ];
    const mu = [RF + 0.06, RF + 0.04];
    const t = tangency(S, mu);
    expectCertified(t, S);
    const f = frontierOf(S, mu);
    expect(f.maxExpectedReturn - t.expectedReturn).toBeLessThanOrEqual(FORWARD_METHODOLOGY.frontier.topReturnTieTolerance);
    expect(f.points[40]).toMatchObject({ certified: true, certification: { kind: "top_endpoint" } });
    f.points[40].weights!.forEach((w, i) => expect(Math.abs(w - t.weights[i])).toBeLessThan(1e-12));
  });

  it("its Sharpe is ≥ every certified frontier point's and every single security's", () => {
    let compared = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sigma, mu } = randomModel(2 + (seed % 9), 200 + seed);
      const out = outcome(sigma, mu);
      if (!out.available) continue;
      const t = out.tangency;
      const slack = 1e-12 * Math.abs(t.forwardModelSharpe);
      for (const p of frontierOf(sigma, mu).points.filter((q) => q.certified)) {
        expect((p.expectedReturn! - RF) / p.volatility!).toBeLessThanOrEqual(t.forwardModelSharpe + slack);
        compared++;
      }
      mu.forEach((m, i) => expect((m - RF) / Math.sqrt(sigma[i][i])).toBeLessThanOrEqual(t.forwardModelSharpe + slack));
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("the y-space identity: Sharpe from w equals s/√(yᵀΣy), and aᵀy/s = 1", () => {
    const t = tangency(SIGMA, [0.1, 0.07, 0.12]);
    expect(Math.abs(t.forwardModelSharpe - t.yIdentitySharpe)).toBeLessThan(1e-15);
    expect(t.certification.economic.scaleIdentity!).toBeLessThan(1e-15);
    expect(t.solver.ySum!).toBeGreaterThanOrEqual(1);
    // portfolio excess return = s / 1ᵀy
    expect(t.excessReturn).toBeCloseTo(t.solver.excessReturnScale / t.solver.ySum!, 15);
  });

  it("is order-invariant and deterministic, and its hash is the canonical payload", () => {
    const mu = [0.1, 0.07, 0.12];
    const a = tangency(SIGMA, mu, { tickers: ["AAPL", "JPM", "MSFT"] });
    const order = [2, 0, 1];
    const b = tangency(
      order.map((i) => order.map((j) => SIGMA[i][j])),
      order.map((i) => mu[i]),
      { tickers: order.map((i) => ["AAPL", "JPM", "MSFT"][i]) },
    );
    expect(b).toEqual(a);
    expect(tangency(SIGMA, mu, { tickers: ["AAPL", "JPM", "MSFT"] })).toEqual(a);
    expect(a.tangencyHash).toBe(
      sha256Hex(
        JSON.stringify({
          kind: "tangency",
          methodologyVersion: FORWARD_METHODOLOGY.version,
          riskModelHash: "risk-model-hash",
          marketProxy: "VTI",
          riskWindow: "3Y",
          riskFree: { series: "DGS1", observationDate: "2024-06-03", annualYield: RF },
          tickers: ["AAPL", "JPM", "MSFT"],
          expectedReturns: mu,
          weights: a.weights,
        }),
      ),
    );
    expect(a.expectedReturnsHash).toBe(
      sha256Hex(
        JSON.stringify({
          kind: "bl-expected-returns",
          methodologyVersion: FORWARD_METHODOLOGY.version,
          riskModelHash: "risk-model-hash",
          tickers: ["AAPL", "JPM", "MSFT"],
          expectedReturns: mu,
        }),
      ),
    );
    expect(b.expectedReturnsHash).toBe(a.expectedReturnsHash);
    expect(tangency(SIGMA, [0.1, 0.07, 0.121], { tickers: ["AAPL", "JPM", "MSFT"] }).expectedReturnsHash).not.toBe(
      a.expectedReturnsHash,
    );
    expect(tangency(SIGMA, mu, { tickers: ["AAPL", "JPM", "MSFT"], hash: "other" }).tangencyHash).not.toBe(a.tangencyHash);
    expect(tangency(SIGMA, mu, { tickers: ["AAPL", "JPM", "MSFT"], date: "2024-05-31" }).tangencyHash).not.toBe(
      a.tangencyHash,
    );
  });
});

describe("failures are typed, never a manufactured portfolio", () => {
  it("a forced active-set cycle stops as non_converged (active_set_cycle)", () => {
    // A faulty linear solve that makes the solver revisit the start's pinned set.
    let calls = 0;
    const looping = (A: number[][], b: number[]) => {
      calls++;
      return b.length === 2 ? [2, 10] : b.length === 3 ? [-1, 1, 5] : solveLinear(A, b);
    };
    const out = outcome(SIGMA, [0.1, 0.07, 0.12], { solve: looping });
    expect(calls).toBeGreaterThan(0);
    expect(out).toMatchObject({ available: false, code: "non_converged", cause: "active_set_cycle" });
    if (!out.available) expect(out.solver).toMatchObject({ cycleDetected: true, maxIterations: 50 });
  });

  it("a solver failure that is not a cycle maps to numerical_failure (singular_face)", () => {
    const out = outcome(SIGMA, [0.1, 0.07, 0.12], { solve: () => null });
    expect(out).toMatchObject({
      available: false,
      code: "numerical_failure",
      cause: "singular_face",
      maxExcessReturn: 0.12 - RF,
      solver: { method: "active_set", cycleDetected: false, maxIterations: 50, y: null, ySum: null },
    });
  });

  it("the certification gate blocks a solve that is not certified: nothing is published", () => {
    // A linear solve that returns a face optimum 1e-6 off: the scaled equality fails.
    const skewed = (A: number[][], b: number[]) => {
      const x = solveLinear(A, b);
      return x && x.map((v, i) => (i < b.length - 1 ? v * (1 + 1e-6) : v));
    };
    const out = outcome(SIGMA, [0.1, 0.07, 0.12], { solve: skewed });
    expect(out).toMatchObject({ available: false, code: "numerical_failure", cause: "certification_failed" });
    if (out.available) throw new Error("published");
    expect(out.certification!.scaled.scaledEquality!).toBeGreaterThan(FORWARD_METHODOLOGY.tangency.tolerances.scaledEquality);
    expect(out.reason).toMatch(/scaled equality residual/);
  });

  it("rejects inconsistent or invalid inputs", () => {
    const base = {
      riskModel: { tickers: ["A", "B"], covariance: [[0.04, 0.01], [0.01, 0.09]], hash: "h" },
      capmPrior: { riskModelHash: "h", riskFreeRate: RF, riskFreeObservationDate: "2024-06-03", marketProxy: "VTI" as const, riskWindow: "3Y" as const },
      posterior: {
        riskModelHash: "h",
        universeTickers: ["A", "B"],
        blackLittermanExpectedReturn: [0.1, 0.12],
        marketProxy: "VTI" as const,
        riskWindow: "3Y" as const,
        cash: { ticker: "CASH" as const, forwardModelBeta: 0 as const, expectedReturn: RF },
      },
    };
    expect(buildTangencyPortfolio(base).available).toBe(true);
    const bad = [
      { ...base, capmPrior: { ...base.capmPrior, riskModelHash: "x" } },
      { ...base, posterior: { ...base.posterior, cash: { ...base.posterior.cash, expectedReturn: 0.03 } } },
      { ...base, posterior: { ...base.posterior, marketProxy: "SPY" as const } },
      { ...base, posterior: { ...base.posterior, universeTickers: ["B", "A"] } },
      { ...base, posterior: { ...base.posterior, blackLittermanExpectedReturn: [0.1, Number.NaN] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, 0.01]] } },
      { ...base, riskModel: { ...base.riskModel, tickers: ["A", "A"] }, posterior: { ...base.posterior, universeTickers: ["A", "A"] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0, 0], [0, 0]] } },
      { ...base, posterior: { ...base.posterior, riskModelHash: "x" } },
      { ...base, posterior: { ...base.posterior, riskWindow: "5Y" as const } },
      { ...base, posterior: { ...base.posterior, blackLittermanExpectedReturn: [0.1] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, 0.01], [0.01]] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, Infinity], [Infinity, 0.09]] } },
      // Asymmetric, indefinite and singular (non-unique tangency) Σ.
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, 0.01], [0.02, 0.09]] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, 0.01], [0.01, -0.09]] } },
      { ...base, riskModel: { ...base.riskModel, covariance: [[0.04, 0.04], [0.04, 0.04]] } },
    ];
    for (const input of bad) expect(buildTangencyPortfolio(input)).toMatchObject({ available: false, code: "invalid_inputs" });
  });
});

describe("the certifiers reject each kind of violation", () => {
  const mu = [0.1, 0.07, 0.12];
  const t = tangency(SIGMA, mu);
  const a = mu.map((m) => m - RF);
  const s = Math.max(...a);
  const c = a.map((x) => x / s);
  const L = 2 * jacobiEigen(SIGMA, { maxSweeps: CONSTRUCTION_METHODOLOGY.limits.eigenSweeps }).values.at(-1)!;
  const y = t.solver.y!;
  const certY = (v: number[]) => certifyTangencyY({ y: v, scaledExcessReturns: c, covariance: SIGMA, normalization: L });
  const econ = (o: Partial<Parameters<typeof certifyTangencyEconomics>[0]> = {}) =>
    certifyTangencyEconomics({
      weights: t.weights,
      y,
      excessReturns: a,
      excessReturnScale: s,
      expectedReturns: mu,
      riskFreeRate: RF,
      volatility: t.volatility,
      ySharpe: t.yIdentitySharpe,
      covariance: SIGMA,
      ...o,
    });

  it("y-problem: accepts the solution; rejects a feasible non-optimal y, a broken equality and a negative entry", () => {
    expect(certY(y).failures).toEqual([]);
    // 100% in the top security: feasible, not optimal.
    const start = c.map((_, i) => (i === c.indexOf(1) ? 1 : 0));
    expect(certY(start).failures).toEqual([expect.stringMatching(/^y KKT residual/)]);
    expect(certY(y.map((v) => v * (1 + 1e-6))).failures).toContainEqual(expect.stringMatching(/^scaled equality residual/));
    expect(certY(y.map((v, i) => (i === 0 ? -1e-6 : v))).failures).toContainEqual(expect.stringMatching(/^y bound residual/));
  });

  it("final portfolio: accepts the solution; rejects budget, scale-identity and Sharpe-identity breaks", () => {
    expect(econ().failures).toEqual([]);
    expect(econ({ weights: t.weights.map((w, i) => (i === 0 ? w + 1e-9 : w)) }).failures).toContainEqual(
      expect.stringMatching(/^budget residual/),
    );
    expect(econ({ y: y.map((v) => v * (1 + 1e-6)) }).failures).toContainEqual(expect.stringMatching(/^scale identity residual/));
    expect(econ({ ySharpe: t.yIdentitySharpe * (1 + 1e-9) }).failures).toEqual([
      expect.stringMatching(/^Sharpe identity discrepancy/),
    ]);
    expect(econ({ expectedReturns: mu.map(() => RF - 0.01) }).failures).toContainEqual(
      expect.stringMatching(/is not positive/),
    );
  });
});

describe("module boundary", () => {
  it("tangency imports only the forward engine, existing analytics and config", async () => {
    const { readFileSync } = await import("node:fs");
    const imports = [...readFileSync("lib/forward/tangency.ts", "utf8").matchAll(/from "([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(imports).toEqual([
      "./qp",
      "@/config/methodology",
      "@/lib/analytics/construction/common",
      "@/lib/analytics/matrix",
      "@/lib/analytics/optimization",
      "@/lib/analytics/riskContribution",
      "@/lib/types/forward",
      "@/lib/utils/errors",
      "@/lib/utils/sha256",
    ]);
  });
});
