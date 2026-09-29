import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import { jacobiEigen, type EigenResult } from "@/lib/analytics/matrix";
import {
  allocationFeasible,
  kktResidual,
  projectBudgetBox,
  projectedGradientResidual,
} from "@/lib/analytics/optimization";
import {
  dot,
  failed,
  matVec,
  residualsOf,
  solveLinear,
  type MethodResult,
} from "./common";

const { tolerances: T, limits, tieRule: TIE_RULE } = CONSTRUCTION_METHODOLOGY;
type Matrix = readonly (readonly number[])[];

const objective = (S: Matrix, w: readonly number[]) => dot(matVec(S, w), w);
const gradient = (S: Matrix, w: readonly number[]) =>
  matVec(S, w).map((x) => 2 * x);

/** Solve the KKT system exactly on the identified free set (bound coordinates
 * snapped to their bound): 2Σ_FF w_F − ν1 = −2Σ_FA w_A, 1ᵀw_F = B − Σ w_A.
 * Not clipping: the caller keeps it only if it is feasible and certifies. */
function activeSetPolish(
  S: Matrix,
  w: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
): number[] | null {
  const fixed = w.map((x, i) =>
    upper[i] - lower[i] <= T.binding || x - lower[i] <= T.binding
      ? lower[i]
      : upper[i] - x <= T.binding
        ? upper[i]
        : null,
  );
  const free = fixed.flatMap((v, i) => (v === null ? [i] : []));
  if (!free.length) return null;
  const bound = fixed.flatMap((v, i) => (v === null ? [] : [i]));
  const m = free.length;
  const A = Array.from({ length: m + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const rhs = new Array<number>(m + 1).fill(0);
  free.forEach((i, a) => {
    free.forEach((j, b) => (A[a][b] = 2 * S[i][j]));
    A[a][m] = -1;
    rhs[a] = -2 * bound.reduce((s, j) => s + S[i][j] * fixed[j]!, 0);
    A[m][a] = 1;
  });
  rhs[m] = budget - bound.reduce((s, j) => s + fixed[j]!, 0);
  const x = solveLinear(A, rhs);
  if (!x) return null;
  const out = fixed.map((v) => v ?? 0);
  free.forEach((i, a) => (out[i] = x[a]));
  return out;
}

/** Tie rule for a singular Σ. Every optimum shares Σw (strict convexity along
 * range(Σ)), so the optimal set is the polyhedron F ∩ (w* + V), V = null(Σ) ∩ 1⊥.
 * Dykstra's alternating projections find the point of it closest to `anchor`
 * (the constrained equal-weight allocation). */
function nearestOptimum(
  eigen: EigenResult,
  wStar: readonly number[],
  anchor: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
): number[] | null {
  const n = wStar.length;
  const lmax = eigen.values.at(-1)!;
  const nullVectors = eigen.vectors.filter(
    (_, k) => eigen.values[k] <= T.matrixRelative * lmax,
  );
  if (!nullVectors.length) return null;
  // Remove the component of 1 lying in the null space so moves keep Σw = B.
  const ones = new Array<number>(n).fill(1);
  const u = new Array<number>(n).fill(0);
  for (const z of nullVectors) {
    const c = dot(z, ones);
    z.forEach((x, i) => (u[i] += c * x));
  }
  const uNorm = Math.sqrt(dot(u, u));
  const basis: number[][] = [];
  for (const z of nullVectors) {
    let v = [...z];
    if (uNorm > 1e-12) {
      const c = dot(v, u) / (uNorm * uNorm);
      v = v.map((x, i) => x - c * u[i]);
    }
    for (const b of basis) {
      const c = dot(v, b);
      v = v.map((x, i) => x - c * b[i]);
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > 1e-10) basis.push(v.map((x) => x / norm));
  }
  if (!basis.length) return null;
  const toAffine = (x: readonly number[]) => {
    const out = [...wStar];
    for (const b of basis) {
      const c = b.reduce((s, bi, i) => s + bi * (x[i] - wStar[i]), 0);
      b.forEach((bi, i) => (out[i] += c * bi));
    }
    return out;
  };
  const toBox = (x: readonly number[]) =>
    x.map((v, i) => Math.min(upper[i], Math.max(lower[i], v)));
  let x = [...anchor];
  let p = new Array<number>(n).fill(0);
  let q = new Array<number>(n).fill(0);
  for (let it = 0; it < limits.tieBreakIterations; it++) {
    const y = toAffine(x.map((v, i) => v + p[i]));
    p = x.map((v, i) => v + p[i] - y[i]);
    const next = toBox(y.map((v, i) => v + q[i]));
    q = y.map((v, i) => v + q[i] - next[i]);
    const change = next.reduce((m, v, i) => Math.max(m, Math.abs(v - x[i])), 0);
    x = next;
    if (change <= 1e-16) break;
  }
  return x;
}

/** minimize wᵀΣw subject to Σw = B, l ≤ w ≤ u (CASH fixed outside). FISTA with
 * gradient restart and step 1/L (L = 2λmax), each step an exact projection, from
 * the constrained equal-weight start. Success requires independent certification
 * of budget, bounds, finiteness and normalized stationarity/KKT. */
export function minimumVariance(input: {
  covariance: Matrix;
  lower: readonly number[];
  upper: readonly number[];
  budget: number;
  start: readonly number[];
  maxIterations?: number;
}): MethodResult {
  const { covariance: S, lower, upper, budget } = input;
  const maxIterations = input.maxIterations ?? limits.minimumVarianceIterations;
  const name = "wᵀΣw (annualized model variance)";
  const n = lower.length;
  if (!n || budget === 0) {
    const w = new Array<number>(n).fill(0);
    return {
      status: "success",
      reason: null,
      weights: w,
      constrained: false,
      objective: { name, value: 0 },
      iterations: 0,
      termination: "zero_budget",
      residuals: { budget: 0, bound: 0, stationarity: 0, kkt: 0, parity: null },
      reference: null,
      starts: [],
      tieRule: null,
      notes: ["The risky budget is zero: the allocation is entirely CASH."],
    };
  }
  const eigen = jacobiEigen(S, { maxSweeps: limits.eigenSweeps });
  const lmax = eigen.values.at(-1)!;
  const L = 2 * lmax;
  if (!eigen.converged || !Number.isFinite(L) || lmax < 0)
    return failed(
      "numerical_failure",
      "The covariance scale overflows the solver's arithmetic (non-finite Lipschitz constant).",
      { objective: { name, value: null } },
    );
  const singular = eigen.values[0] <= T.matrixRelative * lmax;
  const anchor = allocationFeasible(input.start, lower, upper, budget)
    ? [...input.start]
    : projectBudgetBox(input.start, lower, upper, budget);
  if (lmax === 0)
    return {
      status: "success",
      reason: null,
      weights: anchor,
      constrained: false,
      objective: { name, value: 0 },
      iterations: 0,
      termination: "zero_covariance",
      residuals: { budget: 0, bound: 0, stationarity: 0, kkt: 0, parity: null },
      reference: null,
      starts: [],
      tieRule: TIE_RULE,
      notes: [
        "Every feasible allocation has zero model variance; the tie rule applies.",
      ],
    };
  const step = 1 / L;
  const stationarity = (w: readonly number[]) =>
    projectedGradientResidual(w, gradient(S, w), step, lower, upper, budget);
  let x = anchor;
  let y = [...x];
  let t = 1;
  let best = { x, r: Infinity };
  let sinceBest = 0;
  let termination = "iteration_limit";
  let k = 0;
  for (;;) {
    const r = stationarity(x);
    if (!Number.isFinite(r) || !x.every(Number.isFinite))
      return failed(
        "numerical_failure",
        "The solver produced non-finite values.",
        {
          iterations: k,
          objective: { name, value: null },
        },
      );
    if (r < best.r) {
      best = { x, r };
      sinceBest = 0;
    } else sinceBest++;
    if (r <= T.solverTarget) {
      termination = "converged";
      break;
    }
    if (sinceBest > 5000 && best.r <= T.stationarity) {
      termination = "precision_floor";
      break;
    }
    if (k >= maxIterations) break;
    const gy = gradient(S, y);
    const next = projectBudgetBox(
      y.map((v, i) => v - step * gy[i]),
      lower,
      upper,
      budget,
    );
    const restart =
      dot(
        gy,
        next.map((v, i) => v - x[i]),
      ) > 0;
    const tNext = restart ? 1 : (1 + Math.sqrt(1 + 4 * t * t)) / 2;
    y = restart ? next : next.map((v, i) => v + ((t - 1) / tNext) * (v - x[i]));
    x = next;
    t = tNext;
    k++;
  }
  let w = best.x;
  const notes: string[] = [];
  let tieRule: string | null = singular
    ? TIE_RULE
    : "Unique optimum: Σ_construction is positive definite.";
  const certified = (c: readonly number[]) => {
    const g = gradient(S, c);
    return (
      allocationFeasible(c, lower, upper, budget) &&
      Number.isFinite(objective(S, c)) &&
      stationarity(c) <= T.stationarity &&
      kktResidual(c, g, lower, upper).residual / (L * budget) <= T.stationarity
    );
  };
  if (termination !== "iteration_limit" && certified(w)) {
    const polished = activeSetPolish(S, w, lower, upper, budget);
    // Exact bounds (not merely within tolerance): downstream schemas reject even −1e-18.
    if (
      polished &&
      polished.every((v, i) => v >= lower[i] && v <= upper[i]) &&
      certified(polished) &&
      stationarity(polished) <= stationarity(w) &&
      objective(S, polished) <= objective(S, w) + 1e-15 * lmax * budget ** 2
    ) {
      w = polished;
      notes.push(
        "Active-set polish: KKT system solved exactly on the free set.",
      );
    }
    if (singular) {
      const f = objective(S, w);
      const nearest = nearestOptimum(eigen, w, anchor, lower, upper);
      const candidate =
        nearest && projectBudgetBox(nearest, lower, upper, budget);
      if (
        candidate &&
        certified(candidate) &&
        objective(S, candidate) <= f + 1e-12 * lmax * budget ** 2
      ) {
        w = candidate;
        notes.push(
          "Σ is singular, so the optimum is not unique; the tie rule selected the optimal allocation nearest the constrained equal-weight start.",
        );
      } else {
        tieRule =
          "Σ is singular; the tie-rule refinement did not certify, so the solver's optimum is returned.";
      }
    }
  }
  const res = residualsOf(w, lower, upper, budget);
  const g = gradient(S, w);
  const residuals = {
    budget: res.budget,
    bound: res.bound,
    stationarity: stationarity(w),
    kkt: kktResidual(w, g, lower, upper).residual / (L * budget),
    parity: null,
  };
  const value = objective(S, w);
  const base = {
    constrained: false,
    objective: { name, value: Number.isFinite(value) ? value : null },
    iterations: k,
    termination,
    residuals,
    reference: null,
    starts: [],
    tieRule,
    notes,
  };
  if (!certified(w))
    return failed(
      termination === "iteration_limit" ? "non_converged" : "numerical_failure",
      termination === "iteration_limit"
        ? `The solver reached its ${maxIterations}-iteration limit without certified stationarity (residual ${residuals.stationarity.toExponential(2)}).`
        : `The solver stopped (${termination}) without certified stationarity (residual ${residuals.stationarity.toExponential(2)}).`,
      base,
    );
  return { ...base, status: "success", reason: null, weights: w };
}
