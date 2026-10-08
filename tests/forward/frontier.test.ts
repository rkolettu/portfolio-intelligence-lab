import { describe, expect, it } from "vitest";
import {
  buildEfficientFrontier,
  certifyFrontierPoint,
  certifyTopEndpoint,
} from "@/lib/forward/frontier";
import { buildBlackLittermanPosterior } from "@/lib/forward/blackLitterman";
import { buildCapmPrior } from "@/lib/forward/capm";
import { buildBlackLittermanInputs } from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { equalWeight } from "@/lib/analytics/construction/equalWeight";
import { minimumVariance } from "@/lib/analytics/construction/minimumVariance";
import { jacobiEigen } from "@/lib/analytics/matrix";
import { sha256Hex } from "@/lib/utils/sha256";
import { CONSTRUCTION_METHODOLOGY, FORWARD_METHODOLOGY } from "@/config/methodology";
import type { EfficientFrontier, ForwardRiskFree, ForwardRiskModel } from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

const T = FORWARD_METHODOLOGY.frontier.tolerances;
type Matrix = number[][];
const SIGMA: Matrix = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
const TICKERS = ["AAPL", "JPM", "MSFT"];

const outcome = (sigma: Matrix, mu: number[], tickers = mu.map((_, i) => TICKERS[i] ?? `T${i}`), hash = "risk-model-hash") =>
  buildEfficientFrontier({
    riskModel: { tickers, covariance: sigma, hash },
    posterior: { universeTickers: tickers, blackLittermanExpectedReturn: mu, riskModelHash: hash },
  });
const frontier = (sigma: Matrix, mu: number[], tickers?: string[], hash?: string): EfficientFrontier => {
  const out = outcome(sigma, mu, tickers, hash);
  if (!out.available) throw new Error(`${out.code}: ${out.reason}`);
  return out.frontier;
};
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const variance = (S: Matrix, w: readonly number[]) => w.reduce((s, wi, i) => s + wi * dot(S[i], w), 0);

/** Independent oracle for min wᵀΣw s.t. 1ᵀw = 1, μᵀw = r, w ≥ 0: the convex optimum
 * is the equality-constrained optimum on its own support, so enumerate supports,
 * solve each KKT system by Gauss–Jordan elimination, keep the nonnegative solutions
 * and take the least variance. `scaled` writes the return row as its exact
 * equivalent ((μ − r)/max|μ − r|)ᵀw = 0, for nearly equal μ. */
function oracle(S: Matrix, mu: number[], r: number, scaled = false): number[] {
  const n = mu.length;
  const s = Math.max(...mu.map((m) => Math.abs(m - r)));
  const row = scaled ? mu.map((m) => (m - r) / s) : mu;
  let best: { w: number[]; v: number } | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const idx = [...Array(n).keys()].filter((i) => mask & (1 << i));
    const m = idx.length;
    const M = Array.from({ length: m + 2 }, () => new Array<number>(m + 3).fill(0));
    idx.forEach((i, a) => {
      idx.forEach((j, b) => (M[a][b] = 2 * S[i][j]));
      M[a][m] = -1;
      M[a][m + 1] = -row[i];
      M[m][a] = 1;
      M[m + 1][a] = row[i];
    });
    M[m][m + 2] = 1;
    M[m + 1][m + 2] = scaled ? 0 : r;
    let singular = false;
    for (let c = 0; c < m + 2 && !singular; c++) {
      let p = c;
      for (let q = c + 1; q < m + 2; q++) if (Math.abs(M[q][c]) > Math.abs(M[p][c])) p = q;
      if (Math.abs(M[p][c]) < 1e-14) singular = true;
      else {
        [M[c], M[p]] = [M[p], M[c]];
        for (let q = 0; q < m + 2; q++)
          if (q !== c) {
            const f = M[q][c] / M[c][c];
            for (let k = c; k <= m + 2; k++) M[q][k] -= f * M[c][k];
          }
      }
    }
    if (singular) continue;
    const x = idx.map((_, a) => M[a][m + 2] / M[a][a]);
    if (x.some((v) => v < -1e-12)) continue;
    const w = new Array<number>(n).fill(0);
    idx.forEach((i, a) => (w[i] = x[a]));
    const v = variance(S, w);
    if (!best || v < best.v) best = { w, v };
  }
  return best!.w;
}

/** Seeded factor-model Σ (positive definite) and expected returns. */
function randomModel(n: number, seed: number) {
  let state = seed;
  const rand = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const B = Array.from({ length: n }, () => [rand() * 0.4 - 0.1, rand() * 0.4 - 0.1, rand() * 0.4 - 0.1]);
  const sigma = B.map((bi, i) =>
    B.map((bj, j) => dot(bi, bj) * 0.04 + (i === j ? 0.01 + rand() * 0.05 : 0)),
  );
  const mu = Array.from({ length: n }, () => 0.02 + rand() * 0.12);
  return { sigma, mu };
}

/** Invariants every frontier must satisfy: only certified points carry weights, and
 * every certified point records residuals within the Q34 tolerances. */
function expectWellFormed(f: EfficientFrontier, sigma?: Matrix) {
  const count = f.status === "single_point" ? 1 : FORWARD_METHODOLOGY.frontierPoints;
  expect(f.points).toHaveLength(count);
  f.points.forEach((p, k) => {
    expect(p.index).toBe(k);
    expect(p.role).toBe(k === 0 ? "gmv" : k === count - 1 ? "max_return" : "interior");
    if (p.certified) {
      expect(p.status).toBe("success");
      expect(p.reason).toBeNull();
      expect(p.weights).not.toBeNull();
      expect(p.cause).toBeNull();
      expect(p.weights!.every((w) => w >= 0)).toBe(true);
      expect(p.expectedReturn).toBe(dot(p.weights!, f.expectedReturns));
      const c = p.certification;
      if (c.kind === "top_endpoint") {
        // Q39: the top endpoint is certified as the tie-set minimum-variance problem.
        expect(p.role).toBe("max_return");
        expect(c.residuals.budget!).toBeLessThanOrEqual(T.budget);
        expect(c.residuals.bound!).toBeLessThanOrEqual(T.bound);
        expect(c.residuals.outsideTieSet).toBe(0);
        expect(c.residuals.stationarity!).toBeLessThanOrEqual(T.kkt);
        expect(c.residuals.kkt!).toBeLessThanOrEqual(T.kkt);
        expect(c.residuals.returnShortfall!).toBeLessThanOrEqual(1e-12 + c.returnAllowance);
        expect(c.tieSet).toEqual(f.maxReturnTickers);
        p.weights!.forEach((w, i) => w !== 0 && expect(c.tieSet).toContain(f.tickers[i]));
      } else {
        expect(p.role).not.toBe("max_return");
        expect(c.residuals.budget!).toBeLessThanOrEqual(T.budget);
        expect(c.residuals.bound!).toBeLessThanOrEqual(T.bound);
        expect(c.residuals.return!).toBeLessThanOrEqual(T.targetReturn);
        expect(c.residuals.kkt!).toBeLessThanOrEqual(T.kkt);
        expect(Math.abs(p.expectedReturn! - p.targetReturn)).toBeLessThanOrEqual(T.targetReturn);
      }
      if (sigma) expect(Math.abs(p.volatility! - Math.sqrt(variance(sigma, p.weights!)))).toBeLessThan(1e-15);
    } else {
      expect(p.status).not.toBe("success");
      expect(p.reason).toEqual(expect.any(String));
      expect(p.cause).toEqual(expect.any(String));
      expect(p.weights).toBeNull();
      expect(p.expectedReturn).toBeNull();
      expect(p.volatility).toBeNull();
      expect(p.binding).toEqual({ lower: [], upper: [] });
    }
    // Q38: how the point was solved.
    const r = p.solver;
    expect(r.method).toBe(
      p.role === "gmv" ? "minimum_variance" : p.role === "interior" ? "active_set" : r.method,
    );
    if (r.method === "active_set") {
      expect(r.maxIterations).toBe(Math.max(50, 2 * f.tickers.length ** 2));
      expect(r.iterations).toBeLessThanOrEqual(r.maxIterations!);
      if (p.certified) {
        expect(r.joins! + r.releases!).toBe(r.iterations - 1);
        expect(r.cycleDetected).toBe(false);
      }
    } else {
      expect(r.joins).toBeNull();
      expect(r.releases).toBeNull();
      expect(r.cycleDetected).toBe(false);
    }
  });
  expect(f.certifiedCount).toBe(f.points.filter((p) => p.certified).length);
}
/** The target-return residuals of a GMV or interior point. */
const targetResiduals = (p: EfficientFrontier["points"][number]) => {
  if (p.certification.kind !== "target_return") throw new Error("not a target-return point");
  return p.certification.residuals;
};

describe("buildEfficientFrontier — the certified efficient branch", () => {
  const MU = [0.1, 0.07, 0.12];

  it("solves 41 certified points evenly spaced in target return from r_GMV to max μ", () => {
    const f = frontier(SIGMA, MU);
    expectWellFormed(f, SIGMA);
    expect(f.status).toBe("frontier");
    expect(f.certifiedCount).toBe(41);
    const rGmv = dot(f.gmv.weights, MU);
    expect(f.gmv.expectedReturn).toBe(rGmv);
    expect(f.points[0].targetReturn).toBe(rGmv);
    expect(f.points[40].targetReturn).toBe(0.12);
    expect(f.maxExpectedReturn).toBe(0.12);
    expect(f.maxReturnTickers).toEqual(["MSFT"]);
    for (let k = 1; k < 40; k++)
      expect(f.points[k].targetReturn).toBe(rGmv + (k / 40) * (0.12 - rGmv));
  });

  it("anchors on the existing minimumVariance GMV, called exactly as the Constructor calls it", () => {
    const f = frontier(SIGMA, MU);
    const lower = [0, 0, 0];
    const upper = [1, 1, 1];
    const mv = minimumVariance({
      covariance: SIGMA,
      lower,
      upper,
      budget: 1,
      start: equalWeight({ lower, upper, budget: 1 }).weights!,
    });
    expect(mv.status).toBe("success");
    expect(f.gmv.weights).toEqual(mv.weights);
    expect(f.points[0].weights).toEqual(mv.weights);
    expect(f.gmv.solver).toEqual({ termination: mv.termination, iterations: mv.iterations });
    expect(f.gmv.volatility).toBe(f.points[0].volatility);
  });

  it("matches an independent brute-force optimum at every interior point (3 to 8 assets)", () => {
    const cases = [
      { sigma: SIGMA, mu: MU },
      ...[11, 12, 13, 14, 15, 16].map((seed) => randomModel(3 + (seed % 6), seed)),
    ];
    for (const { sigma, mu } of cases) {
      const f = frontier(sigma, mu);
      expectWellFormed(f, sigma);
      expect(f.certifiedCount).toBe(41);
      for (const p of f.points.filter((q) => q.role === "interior")) {
        const w = oracle(sigma, mu, p.targetReturn);
        p.weights!.forEach((x, i) => expect(Math.abs(x - w[i])).toBeLessThan(1e-12));
        expect(Math.abs(p.volatility! ** 2 - variance(sigma, w)) / variance(sigma, w)).toBeLessThan(1e-12);
      }
    }
  });

  it("certifies all 41 points at the maximum universe (21 risky securities) on seeded models", () => {
    for (let seed = 5001; seed <= 5010; seed++) {
      const { sigma, mu } = randomModel(21, seed);
      const f = frontier(sigma, mu);
      expectWellFormed(f, sigma);
      expect(f.certifiedCount).toBe(41);
    }
  });

  it("Q38: on seeded stress models releases do occur, no active set cycles, and the cap is never approached", () => {
    // 21-security seeds whose frontiers need releases, plus 60 smaller seeded models.
    const models = [
      ...[5014, 5032, 5068, 5086, 5132, 5161, 5183, 5188, 5203, 5204].map((seed) => randomModel(21, seed)),
      ...Array.from({ length: 60 }, (_, k) => randomModel(2 + ((k + 1) % 9), k + 1)),
    ];
    let releases = 0;
    let maxIterations = 0;
    for (const { sigma, mu } of models) {
      const f = frontier(sigma, mu);
      expectWellFormed(f, sigma);
      expect(f.certifiedCount).toBe(41);
      for (const p of f.points.filter((q) => q.solver.method === "active_set")) {
        expect(p.solver.cycleDetected).toBe(false);
        expect(p.cause).toBeNull();
        expect(p.solver.iterations).toBeLessThanOrEqual(p.solver.maxIterations!);
        // Observed on these fixed seeds (not a bound: releases rule out n + 2).
        expect(p.solver.iterations).toBeLessThanOrEqual(mu.length);
        releases += p.solver.releases!;
        maxIterations = Math.max(maxIterations, p.solver.iterations);
      }
    }
    // Releases are kept: valid points need them.
    expect(releases).toBeGreaterThan(0);
    // At n = 21 the cap is 882; the most any solve here needs is 21.
    expect(maxIterations).toBeLessThanOrEqual(21);
  });

  it("two assets: each point is the unique feasible allocation and its closed-form volatility", () => {
    const S = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const mu = [0.05, 0.11];
    const f = frontier(S, mu, ["A", "B"]);
    expectWellFormed(f, S);
    for (const p of f.points.slice(1)) {
      const wB = (p.targetReturn - 0.05) / 0.06;
      expect(p.weights![1]).toBeCloseTo(wB, 14);
      const v = (1 - wB) ** 2 * 0.04 + 2 * (1 - wB) * wB * 0.01 + wB ** 2 * 0.09;
      expect(p.volatility).toBeCloseTo(Math.sqrt(v), 14);
    }
    // GMV of two assets: w_A = (σ_B² − σ_AB)/(σ_A² + σ_B² − 2σ_AB) = 0.08/0.11.
    expect(f.gmv.weights[0]).toBeCloseTo(0.08 / 0.11, 12);
    expect(f.points[40].weights).toEqual([0, 1]);
  });

  it("expected return rises and volatility never falls along the efficient branch", () => {
    for (const seed of [21, 22, 23, 24]) {
      const { sigma, mu } = randomModel(6, seed);
      const f = frontier(sigma, mu);
      for (let k = 1; k < f.points.length; k++) {
        expect(f.points[k].expectedReturn!).toBeGreaterThan(f.points[k - 1].expectedReturn!);
        expect(f.points[k].volatility!).toBeGreaterThanOrEqual(f.points[k - 1].volatility! * (1 - 1e-14));
      }
    }
  });

  it("normalizes the KKT residual by 2·λmax(Σ), exactly as minimumVariance does", () => {
    const f = frontier(SIGMA, MU);
    const eigen = jacobiEigen(SIGMA, { maxSweeps: CONSTRUCTION_METHODOLOGY.limits.eigenSweeps });
    expect(f.kktNormalization).toBe(2 * eigen.values.at(-1)!);
    expect(f.tolerances).toEqual({ budget: 1e-10, bound: 1e-10, targetReturn: 1e-10, kkt: 1e-8 });
  });

  it("records residuals and how every point was solved", () => {
    const f = frontier(SIGMA, MU);
    for (const p of f.points)
      expect(Object.values(p.certification.residuals).every((r) => typeof r === "number")).toBe(true);
    expect(f.points[0].solver).toEqual({
      method: "minimum_variance",
      iterations: f.gmv.solver.iterations,
      joins: null,
      releases: null,
      maxIterations: CONSTRUCTION_METHODOLOGY.limits.minimumVarianceIterations,
      cycleDetected: false,
    });
    for (const p of f.points.filter((q) => q.role === "interior"))
      expect(p.solver).toMatchObject({ method: "active_set", maxIterations: 50, cycleDetected: false });
    expect(f.points[40].solver).toEqual({
      method: "single_security",
      iterations: 0,
      joins: null,
      releases: null,
      maxIterations: null,
      cycleDetected: false,
    });
  });

  it("reports tickers held at the 0% floor, and the 100% endpoint at its 100% limit", () => {
    // DUD: low return, high volatility, highly correlated — never held on the branch.
    const S = [
      [0.04, 0.006, 0.05],
      [0.006, 0.09, 0.02],
      [0.05, 0.02, 0.16],
    ];
    const f = frontier(S, [0.06, 0.12, 0.03], ["LOW", "HIGH", "DUD"]);
    expectWellFormed(f, S);
    for (const p of f.points) expect(p.binding.lower).toContain("DUD");
    expect(f.points[40].weights).toEqual([0, 1, 0]);
    expect(f.points[40].binding).toEqual({ lower: ["LOW", "DUD"], upper: ["HIGH"] });
  });
});

describe("Q35 — single-point frontier", () => {
  const S = [
    [0.04, 0.006, 0.01],
    [0.006, 0.09, 0.02],
    [0.01, 0.02, 0.0625],
  ];

  it("one risky asset: the GMV alone, 100% in it", () => {
    const f = frontier([[0.04]], [0.07], ["ONLY"]);
    expectWellFormed(f, [[0.04]]);
    expect(f.status).toBe("single_point");
    expect(f.points[0].weights).toEqual([1]);
    expect(f.points[0].volatility).toBeCloseTo(0.2, 15);
  });

  it("equal expected returns: the GMV alone", () => {
    const f = frontier(S, [0.07, 0.07, 0.07]);
    expectWellFormed(f, S);
    expect(f.status).toBe("single_point");
    expect(f.certifiedCount).toBe(1);
  });

  it("uses the 1e-12 threshold, never exact equality: a near-tie is a single point, a wider range is not", () => {
    const narrow = frontier(S, [0.08, 0.08 + 5e-13, 0.08 - 5e-13]);
    const range = narrow.maxExpectedReturn - narrow.gmv.expectedReturn;
    expect(range).toBeGreaterThan(0);
    expect(range).toBeLessThanOrEqual(1e-12);
    expect(narrow.status).toBe("single_point");
    expect(narrow.points).toHaveLength(1);

    const wider = frontier(S, [0.08, 0.08 + 2e-12, 0.08 - 2e-12]);
    expect(wider.maxExpectedReturn - wider.gmv.expectedReturn).toBeGreaterThan(1e-12);
    expect(wider.status).toBe("frontier");
    expect(wider.points).toHaveLength(41);
  });
});

describe("top endpoint", () => {
  const S = [
    [0.04, 0.006, 0.01, 0],
    [0.006, 0.09, 0.02, 0.01],
    [0.01, 0.02, 0.0625, 0.005],
    [0, 0.01, 0.005, 0.05],
  ];

  it("a unique highest return: 100% in that security", () => {
    const f = frontier(S, [0.05, 0.12, 0.1, 0.07], ["A", "B", "C", "D"]);
    expect(f.points[40]).toMatchObject({ role: "max_return", certified: true, targetReturn: 0.12, weights: [0, 1, 0, 0] });
    expect(f.maxReturnTickers).toEqual(["B"]);
  });

  it("an exact tie: the minimum-variance mix of the tied securities (two-asset closed form)", () => {
    const f = frontier(S, [0.05, 0.12, 0.12, 0.07], ["A", "B", "C", "D"]);
    expectWellFormed(f, S);
    expect(f.maxReturnTickers).toEqual(["B", "C"]);
    const end = f.points[40];
    expect(end.certified).toBe(true);
    const wB = (0.0625 - 0.02) / (0.09 + 0.0625 - 0.04);
    expect(end.weights![0]).toBe(0);
    expect(end.weights![3]).toBe(0);
    expect(end.weights![1]).toBeCloseTo(wB, 10);
    expect(end.weights![2]).toBeCloseTo(1 - wB, 10);
  });

  it("Q37: a near-tie within 1e-12 gives the exact tie's minimum-variance mix, at its actual return", () => {
    const top = 0.12;
    const exact = frontier(S, [0.05, top, top, 0.07], ["A", "B", "C", "D"]).points[40];
    for (const mu of [
      [0.05, top + Number.EPSILON * top, top, 0.07], // one ulp apart
      [0.05, top, top - 0.5e-12, 0.07],
    ]) {
      const f = frontier(S, mu, ["A", "B", "C", "D"]);
      expectWellFormed(f, S);
      expect(f.maxReturnTickers).toEqual(["B", "C"]);
      // Each μ is kept as given; nothing is equalized.
      expect(f.expectedReturns).toEqual(mu);
      const end = f.points[40];
      expect(end.certified).toBe(true);
      expect(end.targetReturn).toBe(Math.max(...mu));
      expect(end.expectedReturn).toBe(dot(end.weights!, mu));
      if (end.certification.kind !== "top_endpoint") throw new Error("top endpoint");
      expect(end.certification.residuals.returnShortfall!).toBeLessThanOrEqual(1e-12);
      expect(end.certification.residuals.returnShortfall).toBe(Math.max(...mu) - end.expectedReturn!);
      end.weights!.forEach((w, i) => expect(Math.abs(w - exact.weights![i])).toBeLessThan(1e-12));
      // The same top allocation whatever the universe order.
      const order = [2, 3, 0, 1];
      const permuted = frontier(
        order.map((i) => order.map((j) => S[i][j])),
        order.map((i) => mu[i]),
        order.map((i) => ["A", "B", "C", "D"][i]),
      ).points[40];
      order.forEach((i, pos) => expect(Math.abs(permuted.weights![pos] - end.weights![i])).toBeLessThan(1e-12));
    }
  });

  it("Q37: a gap above 1e-12 is not a tie, and the top point is unchanged (100% in it)", () => {
    const f = frontier(S, [0.05, 0.12, 0.12 - 2e-12, 0.07], ["A", "B", "C", "D"]);
    expectWellFormed(f, S);
    expect(f.maxReturnTickers).toEqual(["B"]);
    expect(f.points[40].weights).toEqual([0, 1, 0, 0]);
    expect(f.thresholds).toEqual({ singlePoint: 1e-12, topReturnTie: 1e-12 });
  });

  it("Q39: a near-tied pair with a lower-variance security just below still gives a certified top endpoint", () => {
    // B and C tie within 1e-12; D sits just below with lower marginal variance. The
    // endpoint is the B/C minimum-variance mix, certified as that problem.
    const exact = frontier(S, [0.05, 0.12, 0.12, 0.07], ["A", "B", "C", "D"]).points[40];
    for (const gap of [2e-12, 1e-9, 1e-6]) {
      const mu = [0.05, 0.12, 0.12 - 0.5e-12, 0.12 - gap];
      const f = frontier(S, mu, ["A", "B", "C", "D"]);
      expectWellFormed(f, S);
      expect(f.certifiedCount).toBe(41);
      const end = f.points[40];
      expect(end.certification).toMatchObject({ kind: "top_endpoint", tieSet: ["B", "C"] });
      end.weights!.forEach((w, i) => expect(Math.abs(w - exact.weights![i])).toBeLessThan(1e-12));
      // The exact target-return KKT is the wrong problem for this endpoint: it rejects
      // the same allocation, which is why the endpoint has its own certification.
      const wrong = certifyFrontierPoint({
        weights: end.weights!,
        targetReturn: 0.12,
        covariance: S,
        expectedReturns: mu,
        normalization: f.kktNormalization,
      });
      expect(wrong.failures).toEqual([expect.stringMatching(/^KKT residual/)]);
      // Stable under ticker permutation.
      const order = [3, 1, 0, 2];
      const permuted = frontier(
        order.map((i) => order.map((j) => S[i][j])),
        order.map((i) => mu[i]),
        order.map((i) => ["A", "B", "C", "D"][i]),
      ).points[40];
      expect(permuted.certified).toBe(true);
      order.forEach((i, pos) => expect(Math.abs(permuted.weights![pos] - end.weights![i])).toBeLessThan(1e-12));
    }
  });

  it("Q39: the top-endpoint certification rejects weight outside the tie set and a non-minimum-variance mix", () => {
    const mu = [0.05, 0.12, 0.12, 0.07];
    const end = frontier(S, mu, ["A", "B", "C", "D"]).points[40];
    const check = (weights: number[]) =>
      certifyTopEndpoint({ weights, tieSet: [1, 2], covariance: S, expectedReturns: mu });
    expect(check(end.weights!).certified).toBe(true);
    const leaked = check([1e-14, end.weights![1] - 1e-14, end.weights![2], 0]);
    expect(leaked.failures).toContainEqual(expect.stringMatching(/^weight outside the tie set/));
    const notMinVar = check([0, 0.5, 0.5, 0]);
    expect(notMinVar.failures).toContainEqual(expect.stringMatching(/^tie-set KKT residual/));
    // A tie set whose spread exceeds the tolerance cannot pass the return test.
    const wide = certifyTopEndpoint({ weights: [0, 0.5, 0.5, 0], tieSet: [1, 2], covariance: S, expectedReturns: [0.05, 0.12, 0.12 - 1e-9, 0.07] });
    expect(wide.failures).toContainEqual(expect.stringMatching(/^return shortfall/));
  });
});

describe("degenerate and ill-conditioned cases", () => {
  it("certifies a corner portfolio that falls exactly on a grid point (100% of one security mid-frontier)", () => {
    // GMV is 100% A (r = 0); the branch passes through 100% B exactly at r_20 = 0.2.
    const S = [
      [0.01, 0.012, 0.015],
      [0.012, 0.02, 0.03],
      [0.015, 0.03, 0.09],
    ];
    const f = frontier(S, [0, 0.2, 0.4], ["A", "B", "C"]);
    expectWellFormed(f, S);
    expect(f.certifiedCount).toBe(41);
    expect(f.gmv.weights.map((w) => +w.toFixed(12))).toEqual([1, 0, 0]);
    expect(f.points[20].targetReturn).toBe(0.2);
    f.points[20].weights!.forEach((w, i) => expect(w).toBeCloseTo([0, 1, 0][i], 12));
  });

  it("a duplicated security through the real Ledoit–Wolf model keeps Σ positive definite and certifies", () => {
    const aaa = fixtureSeries("AAA");
    const twin = { ...aaa, ticker: "AAB", observations: aaa.observations.map((o) => ({ ...o })) };
    const r = buildForwardRiskModel({
      universe: ["AAA", "AAB", "BBB", "CCC"],
      marketProxy: "VTI",
      riskWindow: "3Y",
      requestedStartDate: FORWARD_START_3Y,
      endDate: FORWARD_END,
      prices: [aaa, twin, ...["BBB", "CCC", "VTI"].map((t) => fixtureSeries(t))],
      sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
    });
    if (!r.available) throw new Error(r.reason);
    expect(jacobiEigen(r.model.covariance).values[0]).toBeGreaterThan(0);
    const mu = r.model.modelBeta.map((b) => 0.04 + 0.05 * b);
    const f = frontier(r.model.covariance, mu, r.model.tickers, r.model.hash);
    expectWellFormed(f, r.model.covariance);
    expect(f.certifiedCount).toBe(41);
    for (const p of f.points) expect(p.weights![0]).toBeCloseTo(p.weights![1], 9);
  });

  it("Q36: nearly equal expected returns give all 41 points, certified in original coordinates", () => {
    const S = [
      [0.04, 0.006, 0.01],
      [0.006, 0.09, 0.02],
      [0.01, 0.02, 0.0625],
    ];
    for (const spread of [2e-12, 1e-11, 1e-9, 1e-7, 1e-5]) {
      const mu = [0.08, 0.08 + spread, 0.08 - spread];
      const f = frontier(S, mu);
      expectWellFormed(f, S);
      expect(f.status).toBe("frontier");
      expect(f.certifiedCount).toBe(41);
      for (const p of f.points) {
        // The original equation μᵀw = r, checked here, not the solver's scaled row.
        expect(Math.abs(dot(mu, p.weights!) - p.targetReturn)).toBeLessThanOrEqual(1e-10);
        if (p.role === "interior") {
          const w = oracle(S, mu, p.targetReturn, true);
          p.weights!.forEach((x, i) => expect(Math.abs(x - w[i])).toBeLessThan(1e-11));
        }
      }
      // The scaled row is homogeneous, so it cannot see a budget scaled by 1 + 1e-8;
      // certification in original coordinates does.
      const p = f.points[20];
      const scaled = p.weights!.map((x) => x * (1 + 1e-8));
      const d = mu.map((m) => m - p.targetReturn);
      const sMax = Math.max(...d.map(Math.abs));
      expect(Math.abs(dot(d.map((x) => x / sMax), scaled))).toBeLessThan(1e-12);
      const check = certifyFrontierPoint({
        weights: scaled,
        targetReturn: p.targetReturn,
        covariance: S,
        expectedReturns: mu,
        normalization: f.kktNormalization,
      });
      expect(check.certified).toBe(false);
      expect(check.failures).toContainEqual(expect.stringMatching(/^target-return residual/));
    }
  });

  it("a singular Σ supplied directly (outside the Ledoit–Wolf path) never yields an uncertified plotted point", () => {
    const S = [
      [0.04, 0.01, 0.01],
      [0.01, 0.09, 0.09],
      [0.01, 0.09, 0.09],
    ];
    const f = frontier(S, [0.05, 0.1, 0.1], ["A", "B", "B2"]);
    expectWellFormed(f, S);
    const failed = f.points.filter((p) => !p.certified);
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) expect(p.reason).toMatch(/singular/);
  });
});

describe("independent certification", () => {
  const MU = [0.1, 0.07, 0.12];
  const f = frontier(SIGMA, MU);
  const L = f.kktNormalization;
  const p = f.points[20];
  const certify = (weights: number[], targetReturn = p.targetReturn) =>
    certifyFrontierPoint({ weights, targetReturn, covariance: SIGMA, expectedReturns: MU, normalization: L });

  it("accepts the solved point and rejects each kind of violation", () => {
    expect(certify(p.weights!).certified).toBe(true);
    const budget = certify(p.weights!.map((w, i) => (i === 0 ? w + 2e-10 : w)));
    expect(budget.certified).toBe(false);
    expect(budget.failures[0]).toMatch(/^budget residual/);
    const ret = certify(p.weights!, p.targetReturn + 2e-10);
    expect(ret.certified).toBe(false);
    expect(ret.failures).toEqual([expect.stringMatching(/^target-return residual/)]);
    const negative = certify([-2e-10, 0.5, 0.5 + 2e-10], 0.5 * 0.07 + 0.5 * 0.12);
    expect(negative.failures).toContainEqual(expect.stringMatching(/^bound residual/));
  });

  it("rejects a feasible but suboptimal allocation through the KKT residual alone", () => {
    // Same budget and target return as point 20, moved along the null space of [1ᵀ; μᵀ].
    const z = [0.07 - 0.12, 0.12 - 0.1, 0.1 - 0.07];
    const moved = p.weights!.map((w, i) => w + 0.05 * z[i]);
    expect(moved.every((w) => w > 0)).toBe(true);
    const check = certify(moved);
    expect(check.residuals.budget!).toBeLessThan(1e-15);
    expect(check.residuals.return!).toBeLessThan(1e-15);
    expect(check.certified).toBe(false);
    expect(check.failures).toEqual([expect.stringMatching(/^KKT residual/)]);
  });

  it("a certified GMV always passes: its frontier KKT residual never exceeds minimumVariance's own", () => {
    for (let seed = 31; seed < 61; seed++) {
      const { sigma, mu } = randomModel(2 + (seed % 9), seed);
      const n = mu.length;
      const lower = new Array<number>(n).fill(0);
      const upper = new Array<number>(n).fill(1);
      const mv = minimumVariance({ covariance: sigma, lower, upper, budget: 1, start: equalWeight({ lower, upper, budget: 1 }).weights! });
      const g = frontier(sigma, mu);
      expect(g.points[0].certified).toBe(true);
      expect(targetResiduals(g.points[0]).kkt!).toBeLessThanOrEqual(mv.residuals.kkt! + 1e-15);
    }
  });
});

describe("determinism, ordering and the frontier hash", () => {
  const MU = [0.1, 0.07, 0.12];

  it("returns identical results and hash on every run", () => {
    expect(frontier(SIGMA, MU)).toEqual(frontier(SIGMA, MU));
  });

  it("is independent of universe order (same frontier, permuted)", () => {
    const { sigma, mu } = randomModel(6, 77);
    const tickers = ["A", "B", "C", "D", "E", "F"];
    const order = [3, 0, 5, 1, 4, 2];
    const a = frontier(sigma, mu, tickers);
    const b = frontier(
      order.map((i) => order.map((j) => sigma[i][j])),
      order.map((i) => mu[i]),
      order.map((i) => tickers[i]),
    );
    expect(b.certifiedCount).toBe(a.certifiedCount);
    a.points.forEach((p, k) => {
      const q = b.points[k];
      expect(Math.abs(q.targetReturn - p.targetReturn)).toBeLessThan(1e-15);
      expect(Math.abs(q.volatility! - p.volatility!)).toBeLessThan(1e-13);
      order.forEach((i, pos) => expect(Math.abs(q.weights![pos] - p.weights![i])).toBeLessThan(1e-12));
    });
  });

  it("hashes the canonical economic payload and changes when an input changes", () => {
    const f = frontier(SIGMA, MU);
    const payload = {
      kind: "efficient-frontier",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: "risk-model-hash",
      tickers: TICKERS,
      expectedReturns: MU,
      status: "frontier",
      points: f.points.map((p) => [p.index, p.role, p.targetReturn, p.status, p.weights]),
    };
    expect(f.frontierHash).toBe(sha256Hex(JSON.stringify(payload)));
    expect(frontier(SIGMA, [0.1, 0.07, 0.12 + 1e-12]).frontierHash).not.toBe(f.frontierHash);
    expect(frontier(SIGMA, MU, TICKERS, "other-model").frontierHash).not.toBe(f.frontierHash);
  });
});

describe("input validation", () => {
  const MU = [0.1, 0.07, 0.12];
  const base = { riskModel: { tickers: TICKERS, covariance: SIGMA, hash: "h" } };
  const posterior = (o: object = {}) => ({ universeTickers: TICKERS, blackLittermanExpectedReturn: MU, riskModelHash: "h", ...o });

  it("rejects a posterior from another risk model, another order, or non-finite inputs", () => {
    for (const p of [
      posterior({ riskModelHash: "other" }),
      posterior({ universeTickers: ["JPM", "AAPL", "MSFT"] }),
      posterior({ blackLittermanExpectedReturn: [0.1, Number.NaN, 0.12] }),
      posterior({ blackLittermanExpectedReturn: [0.1, 0.07] }),
    ]) {
      const out = buildEfficientFrontier({ ...base, posterior: p });
      expect(out).toMatchObject({ available: false, code: "invalid_inputs" });
    }
    const badSigma = buildEfficientFrontier({
      riskModel: { tickers: TICKERS, covariance: [[0.09, 0.02], [0.02, 0.0625]], hash: "h" },
      posterior: posterior(),
    });
    expect(badSigma).toMatchObject({ available: false, code: "invalid_inputs" });
  });

  it("no risky assets: no frontier", () => {
    const out = buildEfficientFrontier({
      riskModel: { tickers: [], covariance: [], hash: "h" },
      posterior: { universeTickers: [], blackLittermanExpectedReturn: [], riskModelHash: "h" },
    });
    expect(out).toEqual({ available: false, code: "no_risky_assets", reason: "No risky assets: there is no risky efficient frontier." });
  });
});

describe("integration with the forward chain (risk model → CAPM prior → views → posterior)", () => {
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
  const r = buildForwardRiskModel({
    universe: ["AAA", "BBB", "CCC", "DDD"],
    marketProxy: "VTI",
    riskWindow: "3Y",
    requestedStartDate: FORWARD_START_3Y,
    endDate: FORWARD_END,
    prices: ["AAA", "BBB", "CCC", "DDD", "VTI"].map((t) => fixtureSeries(t)),
    sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
  });
  if (!r.available) throw new Error(r.reason);
  const model: ForwardRiskModel = r.model;
  const chain = (views: Record<string, unknown>) => {
    const prior = buildCapmPrior({ riskModel: model, riskFree: rf, marketRiskPremium: 0.05 });
    if (!prior.available) throw new Error(prior.reason);
    const inputs = buildBlackLittermanInputs({ riskModel: model, views });
    if (!inputs.available) throw new Error(inputs.reason);
    const post = buildBlackLittermanPosterior({ capmPrior: prior.prior, riskModel: model, inputs: inputs.inputs });
    if (!post.available) throw new Error(post.reason);
    return { posterior: post.posterior, out: buildEfficientFrontier({ riskModel: model, posterior: post.posterior }) };
  };

  it("certifies the frontier of the CAPM prior (no views) and of a 100%-confidence view", () => {
    for (const views of [{}, { CCC: { source: "manual", manualReturn: 0.2, confidence: 1 } }]) {
      const { posterior, out } = chain(views);
      if (!out.available) throw new Error(out.reason);
      const f = out.frontier;
      expectWellFormed(f, model.covariance);
      expect(f.certifiedCount).toBe(41);
      expect(f.riskModelHash).toBe(model.hash);
      expect(f.expectedReturns).toEqual(posterior.blackLittermanExpectedReturn);
      for (const p of f.points.filter((q) => q.role === "interior")) {
        const w = oracle(model.covariance, posterior.blackLittermanExpectedReturn, p.targetReturn);
        p.weights!.forEach((x, i) => expect(Math.abs(x - w[i])).toBeLessThan(1e-10));
      }
    }
  });
});

describe("module boundary", () => {
  it("frontier and QP import only the forward engine, existing construction code and config", async () => {
    const { readFileSync } = await import("node:fs");
    const imports = (file: string) =>
      [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports("lib/forward/frontier.ts")).toEqual([
      "./qp",
      "@/config/methodology",
      "@/lib/analytics/construction/common",
      "@/lib/analytics/construction/equalWeight",
      "@/lib/analytics/construction/minimumVariance",
      "@/lib/analytics/matrix",
      "@/lib/analytics/optimization",
      "@/lib/analytics/riskContribution",
      "@/lib/types/forward",
      "@/lib/utils/errors",
      "@/lib/utils/sha256",
    ]);
    expect(imports("lib/forward/qp.ts")).toEqual([
      "@/config/methodology",
      "@/lib/analytics/construction/common",
    ]);
  });
});
