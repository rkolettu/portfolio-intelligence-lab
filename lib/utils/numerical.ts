import { fail } from "./errors";

function assertFinite(values: readonly number[]) {
  if (values.some((v) => !Number.isFinite(v)))
    fail("MALFORMED_DATA", "Statistics require finite observations.");
}

export function mean(values: readonly number[]): number {
  if (!values.length) fail("INVALID_INPUT", "Mean requires observations.");
  assertFinite(values);
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n - 1), two-pass for numerical stability. */
export function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2)
    fail(
      "INVALID_INPUT",
      "Sample standard deviation requires two observations.",
    );
  const m = mean(values);
  let squares = 0;
  for (const v of values) squares += (v - m) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

/** Relative tolerance for treating a dispersion as zero; see isEffectivelyZero. */
export const DISPERSION_RELATIVE_TOLERANCE = 1e-12;

/** Scale-aware zero test for a dispersion statistic: roundoff in a constant series
 * produces ~1e-17-sized spreads that must not become enormous ratios. */
export function isEffectivelyZero(
  dispersion: number,
  observations: readonly number[],
): boolean {
  let scale = 0;
  for (const v of observations) scale = Math.max(scale, Math.abs(v));
  return dispersion <= DISPERSION_RELATIVE_TOLERANCE * scale;
}
