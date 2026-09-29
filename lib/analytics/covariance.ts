import { RISK_METHODOLOGY } from "@/config/methodology";
import type { CovarianceDiagnostics } from "@/lib/types/analytics";
import { mean } from "@/lib/utils/numerical";
import { fail } from "@/lib/utils/errors";

/** Sample (n − 1) covariance matrix of aligned return columns. Every cell uses the
 * same observations; the upper triangle is computed once and mirrored so the
 * matrix is exactly symmetric. `columns[i]` is holding i's return series. */
export function sampleCovarianceMatrix(
  columns: readonly (readonly number[])[],
): number[][] {
  const k = columns.length;
  const n = columns[0]?.length ?? 0;
  if (!k)
    fail("INVALID_INPUT", "Covariance requires at least one return series.");
  if (n < 2)
    fail("INVALID_INPUT", "Sample covariance requires two observations.");
  if (columns.some((c) => c.length !== n))
    fail("INVALID_INPUT", "Covariance columns must share one aligned sample.");
  const means = columns.map((c) => mean(c));
  const matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = i; j < k; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++)
        sum += (columns[i][t] - means[i]) * (columns[j][t] - means[j]);
      matrix[i][j] = matrix[j][i] = sum / (n - 1);
    }
  return matrix;
}

/** Σ_annual = 252 × Σ_daily. */
export function annualizeCovariance(
  daily: readonly (readonly number[])[],
): number[][] {
  return daily.map((row) =>
    row.map((v) => v * RISK_METHODOLOGY.riskAnnualization),
  );
}

/** Eigenvalues of a symmetric matrix (cyclic Jacobi), ascending. */
export function symmetricEigenvalues(
  matrix: readonly (readonly number[])[],
): number[] {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (
      off <=
      1e-30 *
        Math.max(
          1,
          a.reduce((s, r, i) => s + r[i] ** 2, 0),
        )
    )
      break;
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
      }
  }
  return a.map((row, i) => row[i]).sort((x, y) => x - y);
}

/** Validates symmetry and positive semidefiniteness. A sample covariance of one
 * complete common sample is PSD in exact arithmetic, so only roundoff-sized negative
 * eigenvalues are tolerated; anything material is reported, never repaired. */
export function covarianceDiagnostics(
  matrix: readonly (readonly number[])[],
): CovarianceDiagnostics {
  const n = matrix.length;
  let symmetric = true;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (matrix[i][j] !== matrix[j][i]) symmetric = false;
  if (!symmetric) fail("MALFORMED_DATA", "Covariance matrix is not symmetric.");
  const eigen = symmetricEigenvalues(matrix);
  const maxEigenvalue = eigen.at(-1)!;
  const minEigenvalue = eigen[0];
  const tolerance =
    RISK_METHODOLOGY.eigenTolerance *
    Math.max(Math.abs(maxEigenvalue), Number.MIN_VALUE);
  if (minEigenvalue < -tolerance)
    fail(
      "MALFORMED_DATA",
      "Covariance matrix is not positive semidefinite beyond roundoff.",
    );
  return {
    symmetric,
    minEigenvalue,
    maxEigenvalue,
    singular: minEigenvalue <= tolerance,
  };
}
