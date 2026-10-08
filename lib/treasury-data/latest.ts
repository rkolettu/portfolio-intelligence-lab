import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  LatestTreasuryYield,
  Provenance,
  TreasuryObservation,
} from "@/lib/types/data";
import { calendarDays } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

/** Calendar days of 1Y history read from a source (the curve's same window). */
export const LATEST_ONE_YEAR_LOOKBACK_DAYS =
  FORWARD_METHODOLOGY.riskFree.retrievalWindowDays;
const MAX_AGE_DAYS = FORWARD_METHODOLOGY.riskFree.maxObservationAgeDays;

export const ONE_YEAR_PROXY_WARNING =
  "Latest available official 1-year constant-maturity Treasury yield (DGS1): a quoted yield used as a 12-month risk-free proxy, not a guaranteed realized holding-period return.";

/** The latest official DGS1 observation dated on or before `today` (New York).
 * Only 1Y observations are ever passed in; no other maturity can substitute, and
 * an empty window is a typed outage rather than an older or different rate. */
export function latestOneYear(
  observations: readonly TreasuryObservation[],
  today: string,
  provenance: Provenance,
  warnings: string[],
): LatestTreasuryYield {
  const latest = observations
    .filter((r) => r.date <= today && Number.isFinite(r.annualYield) && r.annualYield > -1)
    .reduce<TreasuryObservation | null>(
      (best, r) => (!best || r.date > best.date ? r : best),
      null,
    );
  if (!latest)
    fail(
      "TREASURY_UNAVAILABLE",
      `No official 1-year Treasury (DGS1) observation is available from the last ${LATEST_ONE_YEAR_LOOKBACK_DAYS} days.`,
      { retryable: true },
    );
  return {
    series: "DGS1",
    maturity: "1Y",
    observationDate: latest.date,
    annualYield: latest.annualYield,
    provenance: { ...provenance, observationDate: latest.date, warnings },
  };
}

/** Why the newest official 1Y observation cannot serve the forward model on
 * `today` (New York): it is more than seven calendar days old. Null when fresh.
 * Re-evaluated on every read, so a cached reading can become stale over time. */
export function oneYearStaleness(
  observationDate: string,
  today: string,
): string | null {
  const age = calendarDays(observationDate, today);
  return age > MAX_AGE_DAYS
    ? `Latest available 1Y Treasury observation is stale: ${observationDate} is ${age} calendar days before ${today}, and the forward model allows at most ${MAX_AGE_DAYS}. No other maturity is substituted.`
    : null;
}
