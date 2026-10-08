// Deterministic primal active-set solver for the forward model's convex QPs:
//   minimize xᵀΣx  subject to  E x = f,  x ≥ 0,
// from a feasible start (Nocedal & Wright, Algorithm 16.3). Each iteration solves
// the exact KKT system on the free set with the existing solveLinear, takes the
// longest feasible step toward that face's optimum (ratio test, lowest index on
// ties), and at a face optimum releases the bound with the most negative
// multiplier (lowest index on ties). No regularization, no randomness. The caller
// certifies the result independently.
import { solveLinear } from "@/lib/analytics/construction/common";

type Matrix = readonly (readonly number[])[];

export type ActiveSetResult =
  | {
      ok: true;
      x: number[];
      /** Indices held at the zero bound when the solver stopped. */
      atBound: number[];
      /** Equality multipliers of the final face (stationarity 2Σx = Eᵀy + s). */
      multipliers: number[];
      iterations: number;
    }
  | {
      ok: false;
      status: "numerical_failure" | "non_converged" | "invalid_inputs";
      reason: string;
      iterations: number;
    };

/** Solve the face problem: minimize x_Fᵀ Σ_FF x_F subject to E_F x_F = f, with
 * x = 0 off F. KKT: [2Σ_FF  −E_Fᵀ; E_F  0] [x_F; y] = [0; f]. */
function faceOptimum(
  sigma: Matrix,
  E: Matrix,
  f: readonly number[],
  free: readonly number[],
): { x: number[]; y: number[] } | null {
  const m = free.length;
  const k = E.length;
  const size = m + k;
  const K = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);
  free.forEach((i, a) => {
    free.forEach((j, b) => (K[a][b] = 2 * sigma[i][j]));
    for (let r = 0; r < k; r++) {
      K[a][m + r] = -E[r][i];
      K[m + r][a] = E[r][i];
    }
  });
  for (let r = 0; r < k; r++) rhs[m + r] = f[r];
  const solution = solveLinear(K, rhs);
  if (!solution) return null;
  return { x: solution.slice(0, m), y: solution.slice(m) };
}

/** Active-set solve from a feasible `start`. `optimalityTolerance` is the absolute
 * multiplier threshold for releasing a bound (the caller passes its normalized KKT
 * tolerance × its normalization), so stopping and certification agree. */
export function activeSetQp(input: {
  covariance: Matrix;
  E: Matrix;
  f: readonly number[];
  start: readonly number[];
  optimalityTolerance: number;
  maxIterations: number;
}): ActiveSetResult {
  const { covariance: sigma, E, f, optimalityTolerance, maxIterations } = input;
  const n = input.start.length;
  if (
    sigma.length !== n ||
    sigma.some((row) => row.length !== n) ||
    E.some((row) => row.length !== n) ||
    f.length !== E.length ||
    !input.start.every((x) => Number.isFinite(x) && x >= 0)
  )
    return {
      ok: false,
      status: "invalid_inputs",
      reason: "The QP start must be finite, nonnegative and match Σ and E.",
      iterations: 0,
    };
  let x = [...input.start];
  const atBound = new Set<number>();
  x.forEach((v, i) => {
    if (v === 0) atBound.add(i);
  });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const free = x.map((_, i) => i).filter((i) => !atBound.has(i));
    if (!free.length)
      return {
        ok: false,
        status: "numerical_failure",
        reason: "Every variable reached its bound; the equality constraints cannot be met.",
        iterations: iteration,
      };
    const face = faceOptimum(sigma, E, f, free);
    if (!face || !face.x.every(Number.isFinite) || !face.y.every(Number.isFinite))
      return {
        ok: false,
        status: "numerical_failure",
        reason:
          "The KKT system on the current free set is singular under the existing pivot test: the equality constraints are dependent on this face, or the target cannot be reached from it. The point is not certified.",
        iterations: iteration,
      };
    const target = new Array<number>(n).fill(0);
    free.forEach((i, a) => (target[i] = face.x[a]));

    // Ratio test toward the face optimum: longest step keeping x ≥ 0.
    let alpha = 1;
    let blocking = -1;
    for (const i of free) {
      const p = target[i] - x[i];
      if (p < 0) {
        const ratio = x[i] / -p;
        if (ratio < alpha) {
          alpha = ratio;
          blocking = i;
        }
      }
    }
    if (blocking >= 0) {
      // Step to the first bound reached. Only that bound joins the working set (one
      // per iteration, lowest index on ties), so the working set stays linearly
      // independent; a weight that reached zero in the same step stays free at 0
      // and joins only by blocking a later (zero-length) step.
      x = x.map((v, i) => (atBound.has(i) ? 0 : v + alpha * (target[i] - v)));
      x[blocking] = 0;
      atBound.add(blocking);
      // Rounding can leave such a weight a few ulps below zero: hold it at 0.
      for (const i of free) if (x[i] < 0) x[i] = 0;
      continue;
    }
    x = target;

    // At the face optimum: bound multipliers s_i = (2Σx)_i − (Eᵀy)_i must be ≥ 0.
    let release = -1;
    let most = -optimalityTolerance;
    for (const i of [...atBound].sort((a, b) => a - b)) {
      let g = 0;
      for (let j = 0; j < n; j++) g += 2 * sigma[i][j] * x[j];
      let ey = 0;
      for (let r = 0; r < E.length; r++) ey += E[r][i] * face.y[r];
      const s = g - ey;
      if (s < most) {
        most = s;
        release = i;
      }
    }
    if (release < 0)
      return {
        ok: true,
        x,
        atBound: [...atBound].sort((a, b) => a - b),
        multipliers: face.y,
        iterations: iteration,
      };
    atBound.delete(release);
  }
  return {
    ok: false,
    status: "non_converged",
    reason: `The active-set solver reached its ${maxIterations}-iteration limit.`,
    iterations: maxIterations,
  };
}
