import { describe, expect, it } from "vitest";
import { equalWeight } from "@/lib/analytics/construction/equalWeight";
import { inverseVolatility } from "@/lib/analytics/construction/inverseVolatility";
import { minimumVariance } from "@/lib/analytics/construction/minimumVariance";
import {
  ercSecondOrder,
  equalRiskContribution,
} from "@/lib/analytics/construction/equalRisk";
import { allocationResiduals } from "@/lib/analytics/optimization";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";

const T = CONSTRUCTION_METHODOLOGY.tolerances;
const DIAG = [
  [0.04, 0],
  [0, 0.01],
];
const open = (n: number) => ({
  lower: new Array(n).fill(0),
  upper: new Array(n).fill(1),
});
// Correlated three-asset matrix (annual), positive definite.
const C3 = [
  [0.04, 0.018, 0.006],
  [0.018, 0.0225, 0.0045],
  [0.006, 0.0045, 0.01],
];
const pcr = (S: number[][], w: number[]) => {
  const m = S.map((r) => r.reduce((s, x, j) => s + x * w[j], 0));
  const v = m.reduce((s, x, i) => s + x * w[i], 0);
  return w.map((x, i) => (x * m[i]) / v);
};
function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    const p = M.slice(c).reduce(
      (best, r, i) => (Math.abs(r[c]) > Math.abs(M[best][c]) ? c + i : best),
      c,
    );
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--)
    x[r] =
      (M[r][n] -
        M[r].slice(r + 1, n).reduce((s, v, k) => s + v * x[r + 1 + k], 0)) /
      M[r][r];
  return x;
}

describe("equal weight", () => {
  it("is B/N exactly when bounds allow it", () => {
    const r = equalWeight({ ...open(4), budget: 0.8 });
    expect(r.status).toBe("success");
    expect(r.weights).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(r.constrained).toBe(false);
  });

  it("projects onto binding bounds and labels the result constrained", () => {
    const r = equalWeight({
      lower: [0, 0, 0.3],
      upper: [0.1, 1, 1],
      budget: 0.9,
    });
    expect(r.constrained).toBe(true);
    [0.1, 0.4, 0.4].forEach((x, i) => expect(r.weights![i]).toBeCloseTo(x, 15));
  });
});

describe("inverse volatility", () => {
  it("allocates B ∝ 1/σ: diag(0.04, 0.01) with 20% CASH → [0.8/3, 1.6/3]", () => {
    const r = inverseVolatility({ covariance: DIAG, ...open(2), budget: 0.8 });
    expect(r.status).toBe("success");
    expect(r.weights![0]).toBeCloseTo(0.8 / 3, 15);
    expect(r.weights![1]).toBeCloseTo(1.6 / 3, 15);
  });

  it("projects the inverse-volatility reference onto caps with the same projection", () => {
    const r = inverseVolatility({
      covariance: DIAG,
      lower: [0, 0],
      upper: [1, 0.5],
      budget: 0.8,
    });
    expect(r.constrained).toBe(true);
    expect(r.weights![1]).toBeCloseTo(0.5, 15);
    expect(r.weights![0]).toBeCloseTo(0.3, 15);
  });

  it("rejects a zero-volatility asset", () => {
    const r = inverseVolatility({
      covariance: [
        [0.04, 0],
        [0, 0],
      ],
      ...open(2),
      budget: 1,
    });
    expect(r.status).toBe("invalid_inputs");
    expect(r.weights).toBeNull();
  });
});

describe("minimum variance", () => {
  const start = (n: number, B: number) => new Array(n).fill(B / n);

  it("solves diag(0.04, 0.01) with 20% CASH → [0.16, 0.64] and certifies KKT", () => {
    const r = minimumVariance({
      covariance: DIAG,
      ...open(2),
      budget: 0.8,
      start: start(2, 0.8),
    });
    expect(r.status).toBe("success");
    expect(r.weights![0]).toBeCloseTo(0.16, 12);
    expect(r.weights![1]).toBeCloseTo(0.64, 12);
    expect(r.residuals.stationarity!).toBeLessThanOrEqual(T.stationarity);
    expect(r.residuals.kkt!).toBeLessThanOrEqual(T.stationarity);
    expect(r.objective.value).toBeCloseTo(0.04 * 0.0256 + 0.01 * 0.4096, 14);
    expect(r.tieRule).toMatch(/positive definite/);
  });

  it("matches the closed-form interior solution B Σ⁻¹1 / 1ᵀΣ⁻¹1 when no bound binds", () => {
    const P3 = [
      [0.04, 0.006, 0.004],
      [0.006, 0.0225, 0.003],
      [0.004, 0.003, 0.01],
    ];
    const inv = solve(P3, [1, 1, 1]);
    const total = inv.reduce((s, x) => s + x, 0);
    const r = minimumVariance({
      covariance: P3,
      ...open(3),
      budget: 1,
      start: start(3, 1),
    });
    expect(r.status).toBe("success");
    r.weights!.forEach((w, i) => expect(w).toBeCloseTo(inv[i] / total, 12));
  });

  it("holds a long-only floor where the unconstrained solution would short (C3 → [0, 0.2340, 0.7660])", () => {
    // Unconstrained weights are [−0.0038, …]; with w ≥ 0 asset 0 sits at zero and
    // the rest is the two-asset closed form on assets 1 and 2.
    const sub = solve(
      [
        [0.0225, 0.0045],
        [0.0045, 0.01],
      ],
      [1, 1],
    );
    const total = sub[0] + sub[1];
    const r = minimumVariance({
      covariance: C3,
      ...open(3),
      budget: 1,
      start: start(3, 1),
    });
    expect(r.status).toBe("success");
    expect(r.weights![0]).toBeCloseTo(0, 12);
    expect(r.weights![1]).toBeCloseTo(sub[0] / total, 12);
    expect(r.weights![2]).toBeCloseTo(sub[1] / total, 12);
    expect(r.residuals.kkt!).toBeLessThanOrEqual(T.stationarity);
  });

  it("binds upper and lower limits without violating them", () => {
    const up = minimumVariance({
      covariance: DIAG,
      lower: [0, 0],
      upper: [1, 0.5],
      budget: 0.8,
      start: [0.3, 0.5],
    });
    [0.3, 0.5].forEach((x, i) => expect(up.weights![i]).toBeCloseTo(x, 12));
    const lo = minimumVariance({
      covariance: DIAG,
      lower: [0.4, 0],
      upper: [1, 1],
      budget: 0.8,
      start: [0.4, 0.4],
    });
    [0.4, 0.4].forEach((x, i) => expect(lo.weights![i]).toBeCloseTo(x, 12));
    for (const r of [up, lo]) {
      const res = allocationResiduals(
        r.weights!,
        r === up ? [0, 0] : [0.4, 0],
        r === up ? [1, 0.5] : [1, 1],
        0.8,
      );
      expect(res.bound).toBeLessThanOrEqual(T.weight);
      expect(res.budget).toBeLessThanOrEqual(T.weight);
    }
  });

  it("picks the optimum nearest the constrained equal-weight start when a singular Σ makes it nonunique", () => {
    // A and B are duplicates. Optimal A + B = 0.2 with C = 0.8; any split with A ≤ 0.1 is
    // optimal. The constrained equal-weight point is (0.1, 0.45, 0.45); the nearest
    // optimum to it is (0, 0.2, 0.8).
    const S = [
      [0.04, 0.04, 0],
      [0.04, 0.04, 0],
      [0, 0, 0.01],
    ];
    const r = minimumVariance({
      covariance: S,
      lower: [0, 0, 0],
      upper: [0.1, 1, 1],
      budget: 1,
      start: [0.1, 0.45, 0.45],
    });
    expect(r.status).toBe("success");
    [0, 0.2, 0.8].forEach((x, i) => expect(r.weights![i]).toBeCloseTo(x, 9));
    expect(r.tieRule).toMatch(/closest/);
  });

  it("reports iteration exhaustion instead of success", () => {
    const r = minimumVariance({
      covariance: C3,
      ...open(3),
      budget: 1,
      start: start(3, 1),
      maxIterations: 1,
    });
    expect(r.status).toBe("non_converged");
    expect(r.weights).toBeNull();
    expect(r.termination).toBe("iteration_limit");
  });

  it("fails explicitly on non-finite solver arithmetic", () => {
    const r = minimumVariance({
      covariance: [
        [1e308, 0],
        [0, 1e308],
      ],
      ...open(2),
      budget: 1,
      start: [0.5, 0.5],
    });
    expect(r.status).toBe("numerical_failure");
    expect(r.weights).toBeNull();
  });

  it("is deterministic and invariant to rescaling Σ", () => {
    const a = minimumVariance({
      covariance: C3,
      ...open(3),
      budget: 0.9,
      start: start(3, 0.9),
    });
    expect(
      minimumVariance({
        covariance: C3,
        ...open(3),
        budget: 0.9,
        start: start(3, 0.9),
      }),
    ).toEqual(a);
    const b = minimumVariance({
      covariance: C3.map((r) => r.map((x) => x * 4)),
      ...open(3),
      budget: 0.9,
      start: start(3, 0.9),
    });
    expect(b.weights).toEqual(a.weights);
  });
});

describe("equal risk contribution", () => {
  const starts = (...w: (number[] | null)[]) =>
    w.map((weights, i) => ({
      name: (["equal_weight", "inverse_volatility", "current"] as const)[i],
      weights,
      reason: weights ? null : "not available",
    }));

  it("equals inverse volatility for a diagonal Σ: [0.8/3, 1.6/3] with 20% CASH", () => {
    const r = equalRiskContribution({
      covariance: DIAG,
      ...open(2),
      budget: 0.8,
      starts: starts([0.4, 0.4]),
    });
    expect(r.status).toBe("success");
    expect(r.weights![0]).toBeCloseTo(0.8 / 3, 10);
    expect(r.weights![1]).toBeCloseTo(1.6 / 3, 10);
    expect(r.residuals.parity!).toBeLessThanOrEqual(T.parity);
  });

  it("differs from inverse volatility on a correlated three-asset matrix and equalizes PCR", () => {
    const iv = inverseVolatility({ covariance: C3, ...open(3), budget: 1 });
    const r = equalRiskContribution({
      covariance: C3,
      ...open(3),
      budget: 1,
      starts: starts([1 / 3, 1 / 3, 1 / 3], iv.weights),
    });
    expect(r.status).toBe("success");
    pcr(C3, r.weights!).forEach((p) => expect(p).toBeCloseTo(1 / 3, 7));
    expect(
      Math.max(...r.weights!.map((w, i) => Math.abs(w - iv.weights![i]))),
    ).toBeGreaterThan(1e-3);
    // Both caller starts run (plus the distinct log-barrier and tilt starts).
    for (const n of ["equal_weight", "inverse_volatility"])
      expect(r.starts.find((s) => s.name === n)!.used).toBe(true);
    expect(r.starts.filter((s) => s.selected)).toHaveLength(1);
  });

  it("reports a Constrained Risk-Balance Approximation, claiming infeasibility only when proven", () => {
    const r = equalRiskContribution({
      covariance: DIAG,
      lower: [0, 0],
      upper: [1, 0.4],
      budget: 0.8,
      starts: starts([0.4, 0.4]),
      names: ["A", "B"],
    });
    expect(r.status).toBe("converged_but_parity_not_achieved");
    expect(r.weights).not.toBeNull();
    [0.4, 0.4].forEach((x, i) => expect(r.weights![i]).toBeCloseTo(x, 10));
    expect(r.residuals.parity!).toBeCloseTo(0.3, 10);
    expect(r.residuals.stationarity!).toBeLessThanOrEqual(T.stationarity);
    // Σ is positive definite, so the unique long-only ERC allocation [0.8/3, 1.6/3]
    // exists and needs B at 53.33%, above its 40% cap: infeasibility is demonstrated.
    expect(r.reason).toMatch(
      /Exact equal risk contribution is infeasible under the selected constraints/,
    );
    expect(r.reason).toMatch(/B at 53\.33%/);
  });

  // Adversarial-review counterexample: equal weight is a first-order stationary point
  // (PCR = [1, 1, −1]) with feasible negative curvature, i.e. a saddle, not a minimum.
  const SADDLE = [
    [1, 0, -2 / 3],
    [0, 1, -2 / 3],
    [-2 / 3, -2 / 3, 1],
  ];
  const third = [1 / 3, 1 / 3, 1 / 3];
  const saddleRun = () =>
    equalRiskContribution({
      covariance: SADDLE,
      ...open(3),
      budget: 1,
      starts: starts(third, third, third),
    });

  it("detects feasible negative curvature at the stationary saddle and none at the true ERC", () => {
    const saddle = ercSecondOrder({
      covariance: SADDLE,
      weights: third,
      ...open(3),
      budget: 1,
    });
    expect(saddle.status).toBe("violated");
    expect(saddle.curvature!).toBeLessThan(-1e-3);
    const r = saddleRun();
    const at = ercSecondOrder({
      covariance: SADDLE,
      weights: r.weights!,
      ...open(3),
      budget: 1,
    });
    expect(at.status).toBe("verified");
  });

  it("never certifies the saddle: reaches the feasible exact ERC from coincident equal-weight starts", () => {
    const r = saddleRun();
    expect(r.status).toBe("success");
    expect(r.reason).toBeNull();
    expect(r.residuals.parity!).toBeLessThanOrEqual(T.parity);
    [0.2952094, 0.2952094, 0.4095812].forEach((x, i) =>
      expect(r.weights![i]).toBeCloseTo(x, 6),
    );
    pcr(SADDLE, r.weights!).forEach((p) => expect(p).toBeCloseTo(1 / 3, 7));
    // The equal-weight run met negative curvature and escaped instead of stopping.
    expect(r.starts[0].escapes).toBeGreaterThanOrEqual(1);
    // Exact parity is the global minimum of the nonnegative objective.
    expect(r.starts.find((s) => s.selected)!.secondOrder).toBe(
      "parity_achieved",
    );
  });

  it("does not count coincident starts as distinct and adds distinct deterministic starts", () => {
    const r = saddleRun();
    expect(r.starts[1]).toMatchObject({
      used: false,
      reason: "Coincides with the equal_weight start.",
    });
    expect(r.starts[2]).toMatchObject({
      used: false,
      reason: "Coincides with the equal_weight start.",
    });
    expect(
      r.starts.slice(3).filter((s) => s.used).length,
    ).toBeGreaterThanOrEqual(2);
    expect(r.starts.map((s) => s.name)).toContain("log_barrier_risk_budget");
  });

  it("is deterministic on the counterexample", () => {
    expect(saddleRun()).toEqual(saddleRun());
  });

  it("skips zero-variance starts (a perfect hedge) and never redefines N", () => {
    const hedge = [
      [0.04, -0.04],
      [-0.04, 0.04],
    ];
    const r = equalRiskContribution({
      covariance: hedge,
      ...open(2),
      budget: 0.8,
      starts: starts([0.4, 0.4], [0.4, 0.4], [0.6, 0.2]),
    });
    expect(r.starts[0].used).toBe(false);
    expect(r.starts[0].reason).toMatch(/zero portfolio variance/);
    expect(r.starts[1].reason).toBe("Coincides with the equal_weight start.");
    expect(r.status).toBe("converged_but_parity_not_achieved");
    expect(r.residuals.parity!).toBeCloseTo(0.5, 8);
    // Σ is singular, so no uniqueness argument exists: safe wording only.
    expect(r.reason).toMatch(
      /^Exact risk parity was not achieved by the solver under the selected constraints/,
    );
    expect(r.reason).not.toMatch(/prevent|infeasible/);
    // A zero covariance puts every start (supplied or added) outside the domain.
    const none = equalRiskContribution({
      covariance: [
        [0, 0],
        [0, 0],
      ],
      ...open(2),
      budget: 0.8,
      starts: starts([0.4, 0.4]),
    });
    expect(none.status).toBe("numerical_failure");
  });

  it("is unavailable at a zero risky budget and reports iteration exhaustion", () => {
    expect(
      equalRiskContribution({
        covariance: DIAG,
        ...open(2),
        budget: 0,
        starts: starts([0, 0]),
      }).status,
    ).toBe("invalid_inputs");
    // A binding cap keeps every start (the log-barrier one included) away from the
    // constrained solution, so one iteration cannot certify.
    const r = equalRiskContribution({
      covariance: C3,
      lower: [0, 0, 0],
      upper: [1, 1, 0.4],
      budget: 1,
      starts: starts([1 / 3, 1 / 3, 1 / 3]),
      maxIterations: 1,
    });
    expect(r.status).toBe("non_converged");
    expect(r.weights).toBeNull();
  });

  it("is deterministic and invariant to rescaling Σ", () => {
    const run = (S: number[][]) =>
      equalRiskContribution({
        covariance: S,
        ...open(3),
        budget: 0.95,
        starts: starts([0.95 / 3, 0.95 / 3, 0.95 / 3]),
      });
    const a = run(C3);
    expect(run(C3)).toEqual(a);
    expect(run(C3.map((r) => r.map((x) => x * 4))).weights).toEqual(a.weights);
  });
});
