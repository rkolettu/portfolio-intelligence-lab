import type {
  LatestTreasuryYield,
  Provenance,
  TreasuryObservation,
} from "@/lib/types/data";
import { fail } from "@/lib/utils/errors";

/** Calendar days of 1Y history read for the latest observation: the same lookback
 * the current curve reads for every maturity. */
export const LATEST_ONE_YEAR_LOOKBACK_DAYS = 21;

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
