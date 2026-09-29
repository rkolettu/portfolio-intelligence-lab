import type { Session, TreasuryObservation } from "@/lib/types/data";
import { calendarDays, marketDate, validDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
import { METHODOLOGY } from "@/config/methodology";
/** Synthetic ACT/365 proxy convention, not a bill's realized holding-period return. */
export function accrueCash(annualYield: number, days: number): number {
  if (
    !Number.isFinite(annualYield) ||
    annualYield <= -1 ||
    !Number.isInteger(days) ||
    days <= 0
  )
    fail("MALFORMED_DATA", "Invalid synthetic cash yield or accrual interval.");
  const result = Math.expm1(
    (Math.log1p(annualYield) * days) / METHODOLOGY.cashDayBasis,
  );
  if (!Number.isFinite(result))
    fail("MALFORMED_DATA", "Cash accrual exceeds numerical range.");
  return result;
}
// Rate arrays are immutable per analysis: validate and index each once, not once per
// session. A per-session scan was O(sessions x rates) and dominated long runs.
const indexed = new WeakMap<TreasuryObservation[], TreasuryObservation[]>();
function availabilityIndex(rates: TreasuryObservation[]): TreasuryObservation[] {
  const cached = indexed.get(rates);
  if (cached) return cached;
  // A rate cannot be known before its own observation date; such a timestamp is
  // corrupt lineage, and silently dropping it would hide look-ahead defects.
  for (const r of rates) {
    if (!validDate(r.date)) fail("MALFORMED_DATA", "Invalid Treasury date.");
    if (
      !Number.isFinite(Date.parse(r.availableAt)) ||
      marketDate(r.availableAt) < r.date
    )
      fail(
        "MALFORMED_DATA",
        `Treasury availability for ${r.date} precedes its observation date.`,
      );
  }
  // Ascending by date, then availability; scanning backwards yields the preferred
  // candidate first (latest observation, then latest known release).
  const sorted = rates
    .filter((r) => Number.isFinite(r.annualYield) && r.annualYield > -1)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.availableAt.localeCompare(b.availableAt),
    );
  indexed.set(rates, sorted);
  return sorted;
}
export function priorKnownRate(
  rates: TreasuryObservation[],
  start: Session,
): TreasuryObservation | null {
  const cutoff = Date.parse(start.close);
  if (!Number.isFinite(cutoff) || !validDate(start.date))
    fail("INVALID_INPUT", "Invalid session cutoff.");
  const sorted = availabilityIndex(rates);
  // Last index whose observation date is on or before the interval start.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].date <= start.date) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const r = sorted[i];
    if (calendarDays(r.date, start.date) > METHODOLOGY.maxRateAgeDays) break;
    if (Date.parse(r.availableAt) < cutoff) return r;
  }
  return null;
}
