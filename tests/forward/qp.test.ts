import { describe, expect, it } from "vitest";
import { activeSetIterationCap, activeSetQp } from "@/lib/forward/qp";
import { solveLinear } from "@/lib/analytics/construction/common";

const SIGMA = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
const solve = (o: Partial<Parameters<typeof activeSetQp>[0]> = {}) =>
  activeSetQp({
    covariance: SIGMA,
    E: [[1, 1, 1]],
    f: [1],
    start: [1 / 3, 1 / 3, 1 / 3],
    optimalityTolerance: 1e-8 * 2 * 0.12,
    maxIterations: 100,
    ...o,
  });
const ok = (r: ReturnType<typeof activeSetQp>) => {
  if (!r.ok) throw new Error(`${r.status}: ${r.reason}`);
  return r;
};
/** Σ⁻¹b for the 3×3 test matrices (Cramer's rule, independent of the solver). */
function solve3(A: number[][], b: number[]) {
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  return [0, 1, 2].map((c) => det(A.map((row, i) => row.map((x, j) => (j === c ? b[i] : x)))) / d);
}

describe("activeSetQp — deterministic primal active-set solver", () => {
  it("budget only, interior optimum: the closed-form GMV Σ⁻¹1 / 1ᵀΣ⁻¹1 in one face solve", () => {
    const r = ok(solve());
    const raw = solve3(SIGMA, [1, 1, 1]);
    const total = raw.reduce((s, x) => s + x, 0);
    r.x.forEach((x, i) => expect(x).toBeCloseTo(raw[i] / total, 14));
    expect(r.iterations).toBe(1);
    expect(r.atBound).toEqual([]);
    // Stationarity 2Σx = λ1 with λ the reported multiplier.
    SIGMA.forEach((row) => expect(2 * row.reduce((s, c, j) => s + c * r.x[j], 0)).toBeCloseTo(r.multipliers[0], 14));
  });

  it("two equality rows on two variables: the unique feasible point", () => {
    const r = ok(
      activeSetQp({
        covariance: [
          [0.04, 0.01],
          [0.01, 0.09],
        ],
        E: [
          [1, 1],
          [0.05, 0.11],
        ],
        f: [1, 0.08],
        start: [0.5, 0.5],
        optimalityTolerance: 1e-9,
        maxIterations: 10,
      }),
    );
    expect(r.x[0]).toBeCloseTo(0.5, 15);
    expect(r.x[1]).toBeCloseTo(0.5, 15);
  });

  it("a weight the unconstrained optimum would short is held at exactly 0, and the rest is optimal on the face", () => {
    // Asset 2 is highly correlated with asset 0 and more volatile: the unconstrained
    // minimum-variance mix shorts it.
    const S = [
      [0.04, 0.006, 0.05],
      [0.006, 0.09, 0.02],
      [0.05, 0.02, 0.16],
    ];
    const unconstrained = solve3(S, [1, 1, 1]);
    expect(unconstrained[2]).toBeLessThan(0);
    const r = ok(solve({ covariance: S, optimalityTolerance: 1e-8 * 0.4 }));
    expect(r.x[2]).toBe(0);
    expect(r.atBound).toEqual([2]);
    // Two-asset GMV of assets 0 and 1: w0 = (σ1² − σ01)/(σ0² + σ1² − 2σ01).
    const w0 = (0.09 - 0.006) / (0.04 + 0.09 - 0.012);
    expect(r.x[0]).toBeCloseTo(w0, 14);
    expect(r.x[1]).toBeCloseTo(1 - w0, 14);
    // The bound's multiplier s_2 = (2Σx)_2 − λ is nonnegative.
    const g2 = 2 * S[2].reduce((s, c, j) => s + c * r.x[j], 0);
    expect(g2 - r.multipliers[0]).toBeGreaterThanOrEqual(0);
  });

  it("releases a bound whose multiplier is negative (start at a vertex), and counts it", () => {
    const r = ok(solve({ start: [1, 0, 0] }));
    const raw = solve3(SIGMA, [1, 1, 1]);
    const total = raw.reduce((s, x) => s + x, 0);
    r.x.forEach((x, i) => expect(x).toBeCloseTo(raw[i] / total, 14));
    expect(r.atBound).toEqual([]);
    // Both pinned bounds are released; nothing joins.
    expect(r).toMatchObject({ joins: 0, releases: 2, iterations: 3 });
  });

  it("ratio-test ties add only the lowest index; the other weight stays free at 0", () => {
    // Symmetric assets 1 and 2 both fall to 0 in the same step from this start.
    const S = [
      [0.01, 0.02, 0.02],
      [0.02, 0.09, 0.05],
      [0.02, 0.05, 0.09],
    ];
    const r = ok(solve({ covariance: S, start: [0.2, 0.4, 0.4], optimalityTolerance: 1e-8 * 0.3 }));
    expect(r.x).toEqual([1, 0, 0]);
    expect(r.atBound).toEqual([1, 2]);
    // Face {0,1,2} → bound 1 joins; face {0,2} → bound 2 joins by a zero-length step;
    // face {0} is optimal. Adding both at once would have taken two iterations.
    expect(r.iterations).toBe(3);
    expect(r).toMatchObject({ joins: 2, releases: 0 });
  });

  it("Q38: stops with active_set_cycle the moment a pinned set recurs", () => {
    // A faulty linear solve sends the solver around a loop: the full face "optimum"
    // pushes weight 0 negative (0 joins), then the next face reports a negative
    // multiplier for 0 (0 is released), which returns the pinned set to {} — already
    // visited. The guard stops there instead of looping.
    const looping = (A: number[][], b: number[]) =>
      b.length === 4 ? [-1, 1, 1, 0] : b.length === 3 ? [0.5, 0.5, 10] : solveLinear(A, b);
    const r = solve({ solve: looping, maxIterations: 50 });
    expect(r).toMatchObject({
      ok: false,
      status: "non_converged",
      cause: "active_set_cycle",
      iterations: 3,
      joins: 1,
      releases: 1,
    });
    if (!r.ok) expect(r.reason).toMatch(/^active_set_cycle: the pinned set \{\} recurred/);
  });

  it("Q38: the iteration cap is max(50, 2n²), and reaching it is a typed failure", () => {
    expect([1, 3, 5, 6, 20, 21].map(activeSetIterationCap)).toEqual([50, 50, 50, 72, 800, 882]);
    expect(solve({ start: [1, 0, 0], maxIterations: 2 })).toMatchObject({
      ok: false,
      status: "non_converged",
      cause: "iteration_cap",
      iterations: 2,
    });
  });

  it("is deterministic", () => {
    expect(solve({ start: [0.6, 0.1, 0.3] })).toEqual(solve({ start: [0.6, 0.1, 0.3] }));
  });

  it("returns typed failures and never a point it could not solve", () => {
    for (const start of [[-0.1, 0.6, 0.5], [Number.NaN, 0.5, 0.5], [0.5, 0.5]])
      expect(solve({ start })).toMatchObject({ ok: false, status: "invalid_inputs", iterations: 0 });
    expect(solve({ E: [[1, 1]] })).toMatchObject({ ok: false, status: "invalid_inputs" });
    expect(solve({ f: [1, 2] })).toMatchObject({ ok: false, status: "invalid_inputs" });
    // Dependent equality rows: the KKT system on every face is singular.
    expect(solve({ E: [[1, 1, 1], [2, 2, 2]], f: [1, 2] })).toMatchObject({
      ok: false,
      status: "numerical_failure",
      reason: expect.stringMatching(/singular under the existing pivot test/),
    });
    // A target return no allocation reaches (max μ is 12%): never a point.
    for (const r of [0.13, 0.5, -0.2])
      expect(solve({ E: [[1, 1, 1], [0.1, 0.07, 0.12]], f: [1, r] })).toMatchObject({ ok: false, status: "numerical_failure" });
    expect(solve({ start: [0, 0, 0] })).toMatchObject({
      ok: false,
      status: "numerical_failure",
      reason: expect.stringMatching(/Every variable reached its bound/),
    });
    expect(solve({ start: [1, 0, 0], maxIterations: 1 })).toEqual({
      ok: false,
      status: "non_converged",
      cause: "iteration_cap",
      reason: "iteration_cap: the active-set solver reached its 1-iteration limit.",
      iterations: 1,
      joins: 0,
      releases: 1,
    });
  });
});
