import { fail } from "@/lib/utils/errors";
import { validDate } from "@/lib/utils/dates";
import { METHODOLOGY } from "@/config/methodology";
export function applyReturns(
  weights: number[],
  returns: number[],
): { portfolioReturn: number; contributions: number[]; endWeights: number[] } {
  if (
    weights.length === 0 ||
    weights.length !== returns.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0) ||
    Math.abs(weights.reduce((a, b) => a + b, 0) - 1) >
      METHODOLOGY.weightTolerance ||
    returns.some((r) => !Number.isFinite(r) || r <= -1)
  )
    fail("INVALID_INPUT", "Invalid return vector or allocation.");
  const contributions = weights.map((w, i) => w * returns[i]);
  const portfolioReturn = contributions.reduce((a, b) => a + b, 0);
  if (
    !Number.isFinite(portfolioReturn) ||
    1 + portfolioReturn <= METHODOLOGY.numericalTolerance
  )
    fail("MALFORMED_DATA", "Portfolio wealth is numerically exhausted.");
  const endWeights = weights.map(
    (w, i) => (w * (1 + returns[i])) / (1 + portfolioReturn),
  );
  return { portfolioReturn, contributions, endWeights };
}
export function crossesMonth(start: string, end: string): boolean {
  if (!validDate(start) || !validDate(end) || start >= end)
    fail("INVALID_INPUT", "Invalid rebalance interval.");
  return start.slice(0, 7) !== end.slice(0, 7);
}
