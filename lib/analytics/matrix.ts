// Hardened symmetric-matrix validation shared by Phase 4 risk reporting and
// Phase 6 construction. Every check is scale-aware: multiplying a matrix by any
// positive constant never changes whether it is accepted.

export type EigenResult = {
  /** Ascending. */
  values: number[];
  /** vectors[k] is the unit eigenvector for values[k]. */
  vectors: number[][];
  converged: boolean;
  sweeps: number;
};

export type MatrixDiagnostics = {
  dimension: number;
  /** max |a_ij − a_ji| relative to the largest absolute entry. */
  maxAsymmetry: number;
  minEigenvalue: number;
  maxEigenvalue: number;
  /** λmax / λmin when positive definite; null when singular within tolerance. */
  conditionNumber: number | null;
  /** Rank deficient within tolerance: duplicate, perfectly (anti)correlated or constant assets. */
  singular: boolean;
  rank: number;
  eigenSweeps: number;
};

export type MatrixValidation =
  | { ok: true; diagnostics: MatrixDiagnostics }
  | {
      ok: false;
      code:
        | "malformed"
        | "non_finite"
        | "asymmetric"
        | "indefinite"
        | "eigensolver_failed";
      reason: string;
    };

const DEFAULT_TOLERANCE = 1e-10;
const DEFAULT_SWEEPS = 100;

/** Cyclic Jacobi eigen-decomposition of a symmetric matrix. Convergence is judged
 * relative to the matrix's own Frobenius norm (off-diagonal mass ≤ 1e-30 × ‖A‖²_F),
 * never against an absolute floor, so tiny- and huge-scale matrices are treated
 * identically. Non-convergence is reported, not hidden. */
export function jacobiEigen(
  matrix: readonly (readonly number[])[],
  options: { maxSweeps?: number } = {},
): EigenResult {
  const n = matrix.length;
  const maxSweeps = options.maxSweeps ?? DEFAULT_SWEEPS;
  // Normalize by an exact power of two so squares in the convergence test neither
  // underflow nor overflow at any finite scale. Power-of-two scaling is exact, so a
  // normal-scale matrix goes through bit-identical rotations; eigenvalues are
  // rescaled on return.
  let maxAbs = 0;
  for (const row of matrix)
    for (const x of row) maxAbs = Math.max(maxAbs, Math.abs(x));
  const scale =
    maxAbs > 0 && Number.isFinite(maxAbs)
      ? 2 ** Math.floor(Math.log2(maxAbs))
      : 1;
  const a = matrix.map((row) => row.map((x) => x / scale));
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  let frobenius = 0;
  for (const row of a) for (const x of row) frobenius += x * x;
  const threshold = 1e-30 * frobenius;
  let converged = false;
  let sweeps = 0;
  for (; sweeps <= maxSweeps; sweeps++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off <= threshold) {
      converged = true;
      break;
    }
    if (sweeps === maxSweeps) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let r = 0; r < n; r++) {
          const arp = a[r][p];
          const arq = a[r][q];
          a[r][p] = c * arp - s * arq;
          a[r][q] = s * arp + c * arq;
        }
        for (let r = 0; r < n; r++) {
          const apr = a[p][r];
          const aqr = a[q][r];
          a[p][r] = c * apr - s * aqr;
          a[q][r] = s * apr + c * aqr;
        }
        for (let r = 0; r < n; r++) {
          const vrp = v[r][p];
          const vrq = v[r][q];
          v[r][p] = c * vrp - s * vrq;
          v[r][q] = s * vrp + c * vrq;
        }
      }
  }
  // Non-finite intermediate arithmetic is a failure, never a result.
  const finite =
    a.every((row) => row.every(Number.isFinite)) &&
    v.every((row) => row.every(Number.isFinite));
  const order = a.map((_, i) => i).sort((x, y) => a[x][x] - a[y][y]);
  return {
    values: order.map((i) => a[i][i] * scale),
    vectors: order.map((i) => v.map((row) => row[i])),
    converged: converged && finite,
    sweeps,
  };
}

/** Validate a covariance matrix before any risk calculation or optimizer uses it.
 * Singular PSD matrices are valid (flagged, with rank); indefinite ones are not.
 * `tolerance` is relative: to the largest absolute entry for symmetry and to the
 * largest absolute eigenvalue for PSD and rank. */
export function validateCovariance(
  matrix: unknown,
  options: { tolerance?: number; maxSweeps?: number } = {},
): MatrixValidation {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (
    !Array.isArray(matrix) ||
    matrix.length === 0 ||
    matrix.some((row) => !Array.isArray(row) || row.length !== matrix.length)
  )
    return {
      ok: false,
      code: "malformed",
      reason: "The covariance matrix must be a non-empty square matrix.",
    };
  const m = matrix as number[][];
  if (
    m.some((row) =>
      row.some((x) => typeof x !== "number" || !Number.isFinite(x)),
    )
  )
    return {
      ok: false,
      code: "non_finite",
      reason: "The covariance matrix contains NaN or infinite entries.",
    };
  const n = m.length;
  let scale = 0;
  for (const row of m)
    for (const x of row) scale = Math.max(scale, Math.abs(x));
  let asymmetry = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      asymmetry = Math.max(asymmetry, Math.abs(m[i][j] - m[j][i]));
  const maxAsymmetry = scale > 0 ? asymmetry / scale : 0;
  if (maxAsymmetry > tolerance)
    return {
      ok: false,
      code: "asymmetric",
      reason: `The covariance matrix is not symmetric (relative asymmetry ${maxAsymmetry.toExponential(2)}).`,
    };
  // Decompose the exactly symmetric part so roundoff asymmetry cannot bias it.
  const sym = m.map((row, i) =>
    row.map((x, j) => (i === j ? x : (x + m[j][i]) / 2)),
  );
  const eigen = jacobiEigen(sym, { maxSweeps: options.maxSweeps });
  if (!eigen.converged || eigen.values.some((x) => !Number.isFinite(x)))
    return {
      ok: false,
      code: "eigensolver_failed",
      reason: `The eigensolver did not converge within ${eigen.sweeps} sweeps; positive semidefiniteness cannot be certified.`,
    };
  const minEigenvalue = eigen.values[0];
  const maxEigenvalue = eigen.values.at(-1)!;
  const eigenScale = Math.max(Math.abs(minEigenvalue), Math.abs(maxEigenvalue));
  const threshold = tolerance * Math.max(eigenScale, Number.MIN_VALUE);
  if (minEigenvalue < -threshold)
    return {
      ok: false,
      code: "indefinite",
      reason: `The covariance matrix is not positive semidefinite beyond roundoff (λmin ${minEigenvalue.toExponential(3)}, λmax ${maxEigenvalue.toExponential(3)}).`,
    };
  const singular = minEigenvalue <= threshold;
  return {
    ok: true,
    diagnostics: {
      dimension: n,
      maxAsymmetry,
      minEigenvalue,
      maxEigenvalue,
      conditionNumber: singular ? null : maxEigenvalue / minEigenvalue,
      singular,
      rank: eigen.values.filter((x) => x > threshold).length,
      eigenSweeps: eigen.sweeps,
    },
  };
}
