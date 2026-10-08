import type { LatestTreasuryYield, Result } from "@/lib/types/data";
import type { ForwardRiskFree } from "@/lib/types/forward";
import { oneYearStaleness } from "@/lib/treasury-data/latest";
import { validDate } from "@/lib/utils/dates";

export type ForwardRiskFreeOutcome =
  | { available: true; value: ForwardRiskFree }
  | { available: false; reason: string };

const NO_SUBSTITUTE =
  "The forward model is unavailable without it; the 3-month rate is never substituted.";

/** The forward 12-month risk-free proxy: the latest available official 1Y Treasury
 * yield (DGS1), used unconverted. Anything else — another maturity, a date after
 * `today` (New York), an observation more than seven calendar days old, a
 * non-finite yield or a failed read — leaves the forward model unavailable with
 * the reason, never a substitute rate. Pure, so a replayed snapshot is checked by
 * the same rule as a fresh read. */
export function forwardRiskFree(
  reading: Result<LatestTreasuryYield>,
  today: string,
): ForwardRiskFreeOutcome {
  if (!reading.ok)
    return {
      available: false,
      reason: `The 1-year Treasury yield could not be read: ${reading.error.message} ${NO_SUBSTITUTE}`,
    };
  const r = reading.value;
  if (r.series !== "DGS1" || r.maturity !== "1Y")
    return {
      available: false,
      reason: `Only the 1-year Treasury yield (DGS1) can serve as the forward risk-free rate. ${NO_SUBSTITUTE}`,
    };
  if (!validDate(r.observationDate) || !validDate(today) || r.observationDate > today)
    return {
      available: false,
      reason: `The 1-year Treasury observation date ${r.observationDate} is invalid or after ${today}. ${NO_SUBSTITUTE}`,
    };
  const stale = oneYearStaleness(r.observationDate, today);
  if (stale) return { available: false, reason: stale };
  if (!Number.isFinite(r.annualYield) || r.annualYield <= -1)
    return {
      available: false,
      reason: `The 1-year Treasury yield is not a valid rate. ${NO_SUBSTITUTE}`,
    };
  return { available: true, value: r };
}
