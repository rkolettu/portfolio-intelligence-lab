import { RISK_METHODOLOGY } from "@/config/methodology";
import type { CovarianceDiagnostics } from "@/lib/types/analytics";
import { mean } from "@/lib/utils/numerical";
import { fail } from "@/lib/utils/errors";
import { jacobiEigen, validateCovariance } from "./matrix";

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
  return jacobiEigen(matrix).values;
}

/** Validates dimensions, finiteness, symmetry and positive semidefiniteness through
 * the hardened, scale-aware validator. A sample covariance of one complete common
 * sample is PSD in exact arithmetic, so only roundoff-sized negative eigenvalues
 * are tolerated; anything material is reported, never repaired. */
export function covarianceDiagnostics(
  matrix: readonly (readonly number[])[],
): CovarianceDiagnostics {
  const v = validateCovariance(matrix, {
    tolerance: RISK_METHODOLOGY.eigenTolerance,
  });
  if (!v.ok)
    fail(
      "MALFORMED_DATA",
      v.code === "asymmetric"
        ? "Covariance matrix is not symmetric."
        : v.code === "indefinite"
          ? "Covariance matrix is not positive semidefinite beyond roundoff."
          : `Covariance matrix is invalid: ${v.reason}`,
    );
  return {
    symmetric: true,
    minEigenvalue: v.diagnostics.minEigenvalue,
    maxEigenvalue: v.diagnostics.maxEigenvalue,
    singular: v.diagnostics.singular,
  };
}
