import type { ConstructionStatus, SolverStart } from "@/lib/types/construction";
import { allocationResiduals } from "@/lib/analytics/optimization";

/** Solver-level outcome over risky weights in canonical order (CASH handled by the caller). */
export type MethodResult = {
  status: ConstructionStatus;
  reason: string | null;
  weights: number[] | null;
  /** True when bounds changed the unconstrained reference (equal weight, inverse volatility). */
  constrained: boolean;
  objective: { name: string; value: number | null };
  iterations: number;
  termination: string;
  residuals: {
    budget: number | null;
    bound: number | null;
    stationarity: number | null;
    kkt: number | null;
    parity: number | null;
  };
  reference: number[] | null;
  starts: SolverStart[];
  tieRule: string | null;
  notes: string[];
};

export const emptyResiduals = () => ({
  budget: null,
  bound: null,
  stationarity: null,
  kkt: null,
  parity: null,
});

/** A failed method never carries usable weights. */
export function failed(
  status: Exclude<
    ConstructionStatus,
    "success" | "converged_but_parity_not_achieved"
  >,
  reason: string,
  partial: Partial<MethodResult> = {},
): MethodResult {
  return {
    constrained: false,
    objective: { name: "", value: null },
    iterations: 0,
    termination: status,
    residuals: emptyResiduals(),
    reference: null,
    starts: [],
    tieRule: null,
    notes: [],
    ...partial,
    status,
    reason,
    weights: null,
  };
}

export const matVec = (
  m: readonly (readonly number[])[],
  w: readonly number[],
) => m.map((row) => row.reduce((s, x, j) => s + x * w[j], 0));
export const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);

/** Budget/bound residuals of a candidate; used by every method before success. */
export const residualsOf = (
  w: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
) => allocationResiduals(w, lower, upper, budget);

/** Gaussian elimination with partial pivoting; null when numerically singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A)
    for (const x of row) scale = Math.max(scale, Math.abs(x));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) <= 1e-13 * scale) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}
