import { STRESS_METHODOLOGY } from "@/config/methodology";
import type { StressWindowDefinition } from "@/lib/types/analytics";
import { validDate, yearsBefore } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

/** Validate a user-selected Custom Historical Window. Client-safe: calendar coverage
 * is enforced server-side, where the session artifact lives. */
export function customStressWindow(
  startDate: string,
  endDate: string,
  today: string,
): StressWindowDefinition {
  if (!validDate(startDate) || !validDate(endDate) || !validDate(today))
    fail("INVALID_INPUT", "Use a valid YYYY-MM-DD calendar date.");
  if (startDate >= endDate)
    fail("INVALID_INPUT", "The custom window's start must precede its end.");
  if (endDate > today)
    fail("INVALID_INPUT", "The custom window cannot end in the future.");
  const years = STRESS_METHODOLOGY.maxCustomYears;
  if (startDate < yearsBefore(endDate, years))
    fail(
      "INVALID_INPUT",
      `A custom window can span at most ${years} years; use the main analysis period for longer horizons.`,
    );
  return {
    id: "custom",
    name: "Custom Historical Window",
    startDate,
    endDate,
    description:
      "User-selected historical window under the same event rules as the fixed windows; not a hypothetical scenario.",
    kind: "custom",
  };
}
