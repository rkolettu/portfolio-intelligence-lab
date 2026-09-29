import { describe, expect, it } from "vitest";
import {
  ercHessian,
  ercSecondOrder,
  equalRiskContribution,
} from "@/lib/analytics/construction/equalRisk";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";

const T = CONSTRUCTION_METHODOLOGY.tolerances;
type M = number[][];
const open = (n: number) => ({
  lower: new Array(n).fill(0),
  upper: new Array(n).fill(1),
});
const ew = (w: number[]) => [
  { name: "equal_weight", weights: w, reason: null },
];

/** Independent ERC objective F(w) = Σ(PCR_i − 1/N)², no shared code. */
function objective(S: M, w: number[]) {
  const m = S.map((r) => r.reduce((s, x, j) => s + x * w[j], 0));
  const V = m.reduce((s, x, i) => s + x * w[i], 0);
  return w.reduce((s, x, i) => s + ((x * m[i]) / V - 1 / w.length) ** 2, 0);
}
/** Independent Hessian: second differences of F with one Richardson step. */
function richardsonHessian(S: M, w: number[], h: number) {
  const n = w.length;
  const fd = (step: number) =>
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const at = (a: number, b: number) =>
          objective(
            S,
            w.map((x, k) => x + (k === i ? a : 0) + (k === j ? b : 0)),
          );
        return (
          (at(step, step) -
            at(step, -step) -
            at(-step, step) +
            at(-step, -step)) /
          (4 * step * step)
        );
      }),
    );
  const coarse = fd(h);
  const fine = fd(h / 2);
  return fine.map((r, i) => r.map((x, j) => (4 * x - coarse[i][j]) / 3));
}
const maxAbs = (A: M) => Math.max(...A.flat().map(Math.abs));
const quad = (H: M, d: number[]) =>
  d.reduce((s, x, i) => s + x * H[i].reduce((t, y, j) => t + y * d[j], 0), 0) /
  d.reduce((s, x) => s + x * x, 0);

const C3 = [
  [0.04, 0.018, 0.006],
  [0.018, 0.0225, 0.0045],
  [0.006, 0.0045, 0.01],
];
// First counterexample: exact ERC with an extremely small positive weight.
const TINY: M = [
  [1, 0],
  [0, 1 / 2.25e12],
];
const TINY_ERC = [0.0000006666662222, 0.9999993333337778];
// Second counterexample: equal weight is stationary (PCR = [1, 1, −1], ∇F = 0).
const SADDLE: M = [
  [1, 0, -2 / 3],
  [0, 1, -2 / 3],
  [-2 / 3, -2 / 3, 1],
];
const third = [1 / 3, 1 / 3, 1 / 3];

describe("ERC analytic Hessian", () => {
  it("matches an independent Richardson-refined finite-difference Hessian at ordinary points", () => {
    for (const [S, w] of [
      [C3, [0.2, 0.3, 0.5]],
      [C3, [0.5, 0.25, 0.25]],
      [SADDLE, third],
      [SADDLE, [0.3, 0.25, 0.45]],
    ] as [M, number[]][]) {
      const a = ercHessian(S, w)!;
      const ref = richardsonHessian(S, w, 1e-3);
      const scale = maxAbs(ref);
      a.hessian.forEach((r, i) =>
        r.forEach((x, j) =>
          expect(Math.abs(x - ref[i][j])).toBeLessThanOrEqual(1e-6 * scale),
        ),
      );
    }
  });

  it("stays exact at an extremely small weight, where the old fixed 1e-6·B step fails", () => {
    const a = ercHessian(TINY, TINY_ERC)!;
    // Scale-aware reference: step relative to the smallest weight, refined.
    const ref = richardsonHessian(TINY, TINY_ERC, 1e-3 * TINY_ERC[0]);
    const scale = maxAbs(ref);
    a.hessian.forEach((r, i) =>
      r.forEach((x, j) =>
        expect(Math.abs(x - ref[i][j])).toBeLessThanOrEqual(1e-5 * scale),
      ),
    );
    // Along the only feasible direction the exact global minimum curves upward.
    expect(quad(a.hessian, [1, -1])).toBeGreaterThan(0);
    // A fixed 1e-6·B step exceeds the small weight itself (6.7e-7): even refined, it
    // misstates this curvature by more than half (the old gradient-difference
    // version reported −2.4e11 here).
    const fixed = richardsonHessian(TINY, TINY_ERC, 1e-6);
    expect(
      Math.abs(quad(fixed, [1, -1]) / quad(a.hessian, [1, -1]) - 1),
    ).toBeGreaterThan(0.5);
  });
});

describe("ERC exact-parity acceptance (first counterexample)", () => {
  const run = () =>
    equalRiskContribution({
      covariance: TINY,
      ...open(2),
      budget: 1,
      starts: ew([0.5, 0.5]),
    });

  it("certifies the exact ERC with an extremely small positive weight", () => {
    const r = run();
    expect(r.status).toBe("success");
    expect(Math.abs(r.weights![0] / TINY_ERC[0] - 1)).toBeLessThan(1e-8);
    expect(Math.abs(r.weights![1] - TINY_ERC[1])).toBeLessThan(1e-14);
    expect(r.residuals.parity!).toBeLessThanOrEqual(T.parity);
  });

  it("never rejects an objective-zero candidate because of a curvature estimate", () => {
    const r = run();
    const selected = r.starts.find((s) => s.selected)!;
    expect(selected.secondOrder).toBe("parity_achieved");
    expect(selected.objective!).toBeLessThanOrEqual(2 * T.parity ** 2);
    // The ~50/50 plateau (F ≈ 0.5) is certified by its own start but never chosen.
    expect(r.objective.value!).toBeLessThan(1e-20);
    // The second-order check itself does not report a violation at the exact point.
    expect(
      ercSecondOrder({
        covariance: TINY,
        weights: TINY_ERC,
        ...open(2),
        budget: 1,
      }).status,
    ).not.toBe("violated");
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });
});

describe("ERC second-order check on the critical cone", () => {
  const check = (lower: number[], upper: number[], w = third, S = SADDLE) =>
    ercSecondOrder({ covariance: S, weights: w, lower, upper, budget: 1 });
  const unit = (d: number[]) => {
    const n = Math.hypot(...d);
    return d.map((x) => x / n);
  };
  const expectDirection = (d: number[], expected: number[]) => {
    const e = unit(expected);
    const s = Math.sign(d.reduce((a, x, i) => a + x * e[i], 0));
    d.forEach((x, i) => expect(s * x).toBeCloseTo(e[i], 6));
  };

  it("finds the unrestricted saddle's negative curvature", () => {
    const so = check([0, 0, 0], [1, 1, 1]);
    expect(so.status).toBe("violated");
    expect(so.curvature!).toBeCloseTo(-648, 3);
    expectDirection(so.direction!.d, [1, 1, -2]);
    expect(so.direction!.bidirectional).toBe(true);
  });

  it("rejects the weakly active-bound saddle with no free coordinate (review counterexample)", () => {
    const so = check([1 / 3, 1 / 3, 0], [1, 1, 1 / 3]);
    expect(so.status).toBe("violated");
    expect(so.released).toBe(3);
    expect(so.curvature!).toBeCloseTo(-648, 3);
  });

  it("finds the joint release direction (1, 1, −2) as the cone minimum, below any pair release", () => {
    const so = check([1 / 3, 1 / 3, 0], [1, 1, 1 / 3]);
    expectDirection(so.direction!.d, [1, 1, -2]);
    // Every coordinate moves: both lower bounds and the upper bound are released at once.
    so.direction!.d.forEach((x) => expect(Math.abs(x)).toBeGreaterThan(0.1));
    expect(so.direction!.d[0]).toBeGreaterThan(0);
    expect(so.direction!.d[1]).toBeGreaterThan(0);
    expect(so.direction!.d[2]).toBeLessThan(0);
    expect(so.direction!.bidirectional).toBe(false);
    const H = ercHessian(SADDLE, third)!.hessian;
    expect(quad(H, [1, 0, -1])).toBeGreaterThan(so.curvature!);
  });

  it("releases weakly active lower bounds", () => {
    const so = check([1 / 3, 1 / 3, 0], [1, 1, 1]);
    expect(so.status).toBe("violated");
    expect(so.released).toBe(2);
    expectDirection(so.direction!.d, [1, 1, -2]);
  });

  it("releases a weakly active upper bound", () => {
    const so = check([0, 0, 0], [1, 1, 1 / 3]);
    expect(so.status).toBe("violated");
    expect(so.released).toBe(1);
    expectDirection(so.direction!.d, [1, 1, -2]);
  });

  it("handles a mixed active/free point", () => {
    const so = check([1 / 3, 0, 0], [1, 1, 1]);
    expect(so.status).toBe("violated");
    expect(so.released).toBe(1);
    expect(so.curvature!).toBeCloseTo(-648, 3);
  });

  it("respects the cone's sign restrictions: an infeasible negative direction is not used", () => {
    // Asset 1 at its floor (d₁ ≥ 0), asset 2 at its cap (d₂ ≤ 0), asset 3 at its floor
    // (d₃ ≥ 0): ±(1, 1, −2) is infeasible, so the cone minimum is (0, −1, 1).
    const so = check([1 / 3, 0, 1 / 3], [1, 1 / 3, 1]);
    expect(so.status).toBe("violated");
    expectDirection(so.direction!.d, [0, -1, 1]);
    expect(so.direction!.d[1]).toBeLessThan(0);
    expect(so.curvature!).toBeCloseTo(-468, 3);
  });

  it("verifies a vertex whose bounds are strongly active: the critical cone is {0}", () => {
    const DIAG = [
      [0.04, 0],
      [0, 0.01],
    ];
    const so = check([0.6, 0], [1, 0.4], [0.6, 0.4], DIAG);
    expect(so.status).toBe("verified");
    expect(so.released).toBe(0);
    const r = equalRiskContribution({
      covariance: DIAG,
      lower: [0.6, 0],
      upper: [1, 0.4],
      budget: 1,
      starts: ew([0.6, 0.4]),
    });
    expect(r.status).toBe("converged_but_parity_not_achieved");
    [0.6, 0.4].forEach((x, i) => expect(r.weights![i]).toBeCloseTo(x, 12));
    expect(r.starts.find((s) => s.selected)!.secondOrder).toBe("verified");
  });

  it("does not certify the weakly active saddle in the full solver", () => {
    const run = () =>
      equalRiskContribution({
        covariance: SADDLE,
        lower: [1 / 3, 1 / 3, 0],
        upper: [1, 1, 1 / 3],
        budget: 1,
        starts: ew(third),
      });
    const r = run();
    // Exact ERC needs asset 3 at 40.96%, above its 1/3 cap; a brute-force grid over
    // the feasible set puts the constrained minimum F = 1/6 at [0.5, 0.5, 0].
    expect(r.status).toBe("converged_but_parity_not_achieved");
    [0.5, 0.5, 0].forEach((x, i) => expect(r.weights![i]).toBeCloseTo(x, 8));
    expect(r.objective.value!).toBeCloseTo(1 / 6, 10);
    expect(r.starts[0].escapes).toBeGreaterThanOrEqual(1);
    expect(r.starts[0].secondOrder).not.toBe("violated");
    expect(run()).toEqual(r);
  });

  it("classifies curvature near the threshold as unverifiable, never verified", () => {
    // Σ(ρ) = [[1,0,ρ],[0,1,ρ],[ρ,ρ,1]] at equal weight: curvature is −648 at
    // ρ = −2/3 and positive at ρ = 0. Bisect to the −tolerance crossing.
    const at = (rho: number) =>
      check([0, 0, 0], [1, 1, 1], third, [
        [1, 0, rho],
        [0, 1, rho],
        [rho, rho, 1],
      ]);
    const crossing = (target: number) => {
      let a = -2 / 3;
      let b = 0;
      for (let k = 0; k < 200; k++) {
        const mid = (a + b) / 2;
        if (at(mid).curvature! < target) a = mid;
        else b = mid;
      }
      return a;
    };
    expect(at(-2 / 3).status).toBe("violated");
    expect(at(0).status).toBe("verified");
    const edge = at(crossing(-T.curvature));
    expect(edge.error!).toBeGreaterThan(0);
    expect(Math.abs(edge.curvature! + T.curvature)).toBeLessThanOrEqual(
      edge.error!,
    );
    expect(edge.status).toBe("unverifiable");
    expect(at(crossing(-2 * T.curvature)).status).toBe("violated");
    expect(at(crossing(-T.curvature / 2)).status).toBe("verified");
  });

  it("is deterministic", () => {
    const a = check([1 / 3, 1 / 3, 0], [1, 1, 1 / 3]);
    expect(check([1 / 3, 1 / 3, 0], [1, 1, 1 / 3])).toEqual(a);
  });
});
