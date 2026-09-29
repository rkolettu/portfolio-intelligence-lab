import type { PriceObservation } from "@/lib/types/data";
import { validDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export function normalizePrices(
  prices: PriceObservation[],
): PriceObservation[] {
  const dates = new Map<string, number>();
  for (const p of prices) {
    if (
      !validDate(p.date) ||
      !Number.isFinite(p.adjustedClose) ||
      p.adjustedClose <= 0
    )
      fail("MALFORMED_DATA", "Invalid adjusted price or date.");
    if (dates.has(p.date) && dates.get(p.date) !== p.adjustedClose)
      fail(
        "MALFORMED_DATA",
        "Conflicting duplicate prices; adjustment snapshots cannot be spliced.",
      );
    dates.set(p.date, p.adjustedClose);
  }
  return [...dates]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, adjustedClose]) => ({ date, adjustedClose }));
}
