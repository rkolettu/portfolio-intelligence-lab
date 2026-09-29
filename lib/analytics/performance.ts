import { PERFORMANCE_METHODOLOGY } from "@/config/methodology";
import { calendarDays } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

/** A calculation outcome before sample metadata is attached. */
export type Computed =
  { ok: true; value: number; notes: string[] } | { ok: false; reason: string };

function assertWealth(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    fail("MALFORMED_DATA", `${label} must be positive and finite.`);
}

/** endingValue / startingValue - 1 (geometric, from the compounded wealth path). */
export function cumulativeReturn(
  startingValue: number,
  endingValue: number,
): number {
  assertWealth(startingValue, "Starting value");
  assertWealth(endingValue, "Ending value");
  return endingValue / startingValue - 1;
}

/** Actual elapsed calendar time in years: calendar days / 365.25. */
export function elapsedYears(startDate: string, endDate: string): number {
  return (
    calendarDays(startDate, endDate) / PERFORMANCE_METHODOLOGY.cagrDayBasis
  );
}

/** (endingValue / startingValue)^(1 / elapsedYears) - 1 over actual calendar time. */
export function cagr(
  startingValue: number,
  endingValue: number,
  startDate: string,
  endDate: string,
): Computed {
  assertWealth(startingValue, "Starting value");
  assertWealth(endingValue, "Ending value");
  const days = calendarDays(startDate, endDate);
  if (days <= 0)
    return {
      ok: false,
      reason: "CAGR requires positive elapsed calendar time.",
    };
  const years = days / PERFORMANCE_METHODOLOGY.cagrDayBasis;
  // expm1/log keeps precision for small growth; identical to the power form.
  const value = Math.expm1(Math.log(endingValue / startingValue) / years);
  if (!Number.isFinite(value))
    return {
      ok: false,
      reason:
        "Annualizing this return over so short a period exceeds the numerical range.",
    };
  return {
    ok: true,
    value,
    notes:
      years < 1
        ? [
            `Annualized from less than one year (${days} calendar days); not a return earned over a full year. Compare with cumulative return.`,
          ]
        : [],
  };
}
