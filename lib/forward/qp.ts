// Deterministic primal active-set solver for the forward model's convex QPs:
//   minimize xᵀΣx  subject to  E x = f,  x ≥ 0,
// from a feasible start (Nocedal & Wright, Algorithm 16.3). Each iteration solves
// the exact KKT system on the free set with the existing solveLinear, takes the
// longest feasible step toward that face's optimum (ratio test, lowest index on
// ties), and at a face optimum releases the bound with the most negative
// multiplier (lowest index on ties). Bounds both join and leave the pinned set, so
// there is no n + 2 bound on iterations (Q38): a recurring pinned set stops the
// solve as an active-set cycle, and a universe-size cap stops a runaway one. No
// regularization, no randomness, no retries. The caller certifies the result
// independently.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { solveLinear } from "@/lib/analytics/construction/common";

type Matrix = readonly (readonly number[])[];

/** Why a solve produced no point. */
export type ActiveSetFailureCause =
  | "invalid_inputs"
  | "invalid_gradient_scale"
  | "no_free_variables"
  | "singular_face"
  | "iteration_cap"
  | "active_set_cycle";

type Counts = {
  iterations: number;
  /** Bounds that joined the pinned set (blocking steps). */
  joins: number;
  /** Bounds released at a face optimum (negative multiplier). */
  releases: number;
};

export type ActiveSetResult =
  | (Counts & {
      ok: true;
      x: number[];
      /** Indices held at the zero bound when the solver stopped. */
      atBound: number[];
      /** Equality multipliers of the final face (stationarity 2Σx = Eᵀy + s). */
      multipliers: number[];
    })
  | (Counts & {
      ok: false;
      status: "numerical_failure" | "non_converged" | "invalid_inputs";
      cause: ActiveSetFailureCause;
      reason: string;
    });

/** Q38: the safety cap for an n-variable solve, max(50, 2n²) (882 at n = 21). */
export function activeSetIterationCap(n: number): number {
  const cap = FORWARD_METHODOLOGY.activeSet.iterationCap;
  return Math.max(cap.minimum, cap.perVariableSquared * n * n);
}

/** Solve the face problem: minimize x_Fᵀ Σ_FF x_F subject to E_F x_F = f, with
 * x = 0 off F. KKT: [2Σ_FF  −E_Fᵀ; E_F  0] [x_F; y] = [0; f]. */
function faceOptimum(
  sigma: Matrix,
  E: Matrix,
  f: readonly number[],
  free: readonly number[],
  solve: (A: number[][], b: number[]) => number[] | null,
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
  const solution = solve(K, rhs);
  if (!solution) return null;
  return { x: solution.slice(0, m), y: solution.slice(m) };
}

/** Active-set solve from a feasible `start`. A bound is released when its multiplier
 * is below −threshold, the same threshold the caller certifies against:
 * - releaseScale "absolute" (default; Task 8 frontier): threshold =
 *   optimalityTolerance, an absolute number the caller passes (its normalized KKT
 *   tolerance × its normalization);
 * - releaseScale "gradient" (Q41; tangency): threshold = optimalityTolerance ×
 *   ‖2Σx‖∞ at the face optimum. A zero or non-finite gradient scale stops the solve
 *   (invalid_gradient_scale); no other scale is substituted.
 * `maxIterations` is the caller's cap (activeSetIterationCap for the forward
 * model). `solve` defaults to the existing solveLinear; tests inject others. */
export function activeSetQp(input: {
  covariance: Matrix;
  E: Matrix;
  f: readonly number[];
  start: readonly number[];
  optimalityTolerance: number;
  releaseScale?: "absolute" | "gradient";
  maxIterations: number;
  solve?: (A: number[][], b: number[]) => number[] | null;
}): ActiveSetResult {
  const { covariance: sigma, E, f, optimalityTolerance, maxIterations } = input;
  const solve = input.solve ?? solveLinear;
  const n = input.start.length;
  let joins = 0;
  let releases = 0;
  const fail = (
    status: "numerical_failure" | "non_converged" | "invalid_inputs",
    cause: ActiveSetFailureCause,
    reason: string,
    iterations: number,
  ): ActiveSetResult => ({ ok: false, status, cause, reason, iterations, joins, releases });
  if (
    sigma.length !== n ||
    sigma.some((row) => row.length !== n) ||
    E.some((row) => row.length !== n) ||
    f.length !== E.length ||
    !input.start.every((x) => Number.isFinite(x) && x >= 0)
  )
    return fail(
      "invalid_inputs",
      "invalid_inputs",
      "The QP start must be finite, nonnegative and match Σ and E.",
      0,
    );
  let x = [...input.start];
  const atBound = new Set<number>();
  x.forEach((v, i) => {
    if (v === 0) atBound.add(i);
  });
  // Every pinned set this solve has started an iteration with, as its canonical
  // sorted index list.
  const visited = new Set<string>();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const pinned = [...atBound].sort((a, b) => a - b);
    const key = pinned.join(",");
    if (visited.has(key))
      return fail(
        "non_converged",
        "active_set_cycle",
        `active_set_cycle: the pinned set {${key}} recurred; the solve stopped instead of looping.`,
        iteration,
      );
    visited.add(key);
    const free = x.map((_, i) => i).filter((i) => !atBound.has(i));
    if (!free.length)
      return fail(
        "numerical_failure",
        "no_free_variables",
        "Every variable reached its bound; the equality constraints cannot be met.",
        iteration,
      );
    const face = faceOptimum(sigma, E, f, free, solve);
    if (!face || !face.x.every(Number.isFinite) || !face.y.every(Number.isFinite))
      return fail(
        "numerical_failure",
        "singular_face",
        "The KKT system on the current free set is singular under the existing pivot test: the equality constraints are dependent on this face, or the target cannot be reached from it. The point is not certified.",
        iteration,
      );
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
      joins++;
      // Rounding can leave such a weight a few ulps below zero: hold it at 0.
      for (const i of free) if (x[i] < 0) x[i] = 0;
      continue;
    }
    x = target;

    // At the face optimum: bound multipliers s_i = (2Σx)_i − (Eᵀy)_i must be ≥ 0.
    let release = -1;
    let threshold = optimalityTolerance;
    if (input.releaseScale === "gradient") {
      let scale = 0;
      for (let i = 0; i < n; i++) {
        let g = 0;
        for (let j = 0; j < n; j++) g += 2 * sigma[i][j] * x[j];
        scale = Math.max(scale, Math.abs(g));
      }
      if (!(Number.isFinite(scale) && scale > 0))
        return fail(
          "numerical_failure",
          "invalid_gradient_scale",
          `The gradient scale ‖2Σx‖∞ = ${scale} is not positive and finite; no other scale is substituted.`,
          iteration,
        );
      threshold = optimalityTolerance * scale;
    }
    let most = -threshold;
    for (const i of pinned) {
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
        atBound: pinned,
        multipliers: face.y,
        iterations: iteration,
        joins,
        releases,
      };
    atBound.delete(release);
    releases++;
  }
  return fail(
    "non_converged",
    "iteration_cap",
    `iteration_cap: the active-set solver reached its ${maxIterations}-iteration limit.`,
    maxIterations,
  );
}
