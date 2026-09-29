import { RISK_METHODOLOGY } from "@/config/methodology";
import { fail } from "@/lib/utils/errors";

export type RiskDecomposition =
  | {
      ok: true;
      variance: number;
      volatility: number;
      /** (Σw)_i / σ */
      marginal: number[];
      /** w_i × MRC_i — may be negative (hedges); never clamped. */
      component: number[];
      /** CRC_i / σ — may be negative or exceed 1. */
      percentage: number[];
      residuals: { crc: number; pcr: number };
    }
  | { ok: false; variance: number; reason: string };

function matVec(
  matrix: readonly (readonly number[])[],
  w: readonly number[],
): number[] {
  return matrix.map((row) => row.reduce((s, cij, j) => s + cij * w[j], 0));
}

/** w'Σw with the documented roundoff rule: variance within ±1e-12 × (Σ|w_i|σ_i)²
 * is zero volatility (contributions unavailable); a materially negative value
 * means the inputs are invalid and is reported, never forced to zero. */
export function portfolioVariance(
  covariance: readonly (readonly number[])[],
  weights: readonly number[],
): number {
  if (covariance.length !== weights.length)
    fail("INVALID_INPUT", "Weights must match the covariance matrix.");
  const variance = matVec(covariance, weights).reduce(
    (s, x, i) => s + x * weights[i],
    0,
  );
  const scale =
    weights.reduce(
      (s, w, i) => s + Math.abs(w) * Math.sqrt(Math.max(0, covariance[i][i])),
      0,
    ) ** 2;
  if (variance < -RISK_METHODOLOGY.zeroTolerance * scale)
    fail(
      "MALFORMED_DATA",
      "Portfolio variance is materially negative; the covariance input is invalid.",
    );
  return Math.abs(variance) <= RISK_METHODOLOGY.zeroTolerance * scale
    ? 0
    : variance;
}

/** Euler decomposition of target-weight volatility over annualized Σ:
 * MRC = Σw / σ, CRC = w ∘ MRC, PCR = CRC / σ; Σ CRC = σ and Σ PCR = 1. */
export function riskContributions(
  covariance: readonly (readonly number[])[],
  weights: readonly number[],
): RiskDecomposition {
  const variance = portfolioVariance(covariance, weights);
  if (variance === 0)
    return {
      ok: false,
      variance,
      reason:
        "Target-weight portfolio volatility is zero, so marginal and percentage risk contributions are undefined.",
    };
  const volatility = Math.sqrt(variance);
  const sw = matVec(covariance, weights);
  const marginal = sw.map((x) => x / volatility);
  const component = marginal.map((m, i) => weights[i] * m);
  const percentage = component.map((c) => c / volatility);
  const residuals = {
    crc: Math.abs(component.reduce((a, b) => a + b, 0) - volatility),
    pcr: Math.abs(percentage.reduce((a, b) => a + b, 0) - 1),
  };
  if (residuals.pcr > 1e-9)
    fail(
      "MALFORMED_DATA",
      "Risk contributions fail the Euler identity beyond numerical tolerance.",
    );
  return {
    ok: true,
    variance,
    volatility,
    marginal,
    component,
    percentage,
    residuals,
  };
}
