import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { Session } from "@/lib/types/data";
import type { RiskWindow } from "@/lib/types/forward";
import { addDays, marketDate, yearsBefore } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

const FAR = "2100-01-01T00:00:00Z";

/** Requested dates of the forward risk window. The end is the latest finalized
 * market session: the last XNYS session before today's New York date (the
 * existing rule that excludes the current market day's bar until the next New
 * York date). The start is N years before that session; the sample begins at the
 * first session on or after it. Independent of the historical Analysis Period. */
export function forwardRiskWindowDates(
  riskWindow: RiskWindow,
  now: string,
): { endDate: string; requestedStartDate: string } {
  const eligible = addDays(marketDate(now), -1);
  const endDate = sessionsBetween(addDays(eligible, -14), eligible, now).at(-1)
    ?.date;
  if (!endDate)
    fail("INVALID_INPUT", "No finalized market session precedes this date.");
  return {
    endDate,
    requestedStartDate: yearsBefore(
      endDate,
      FORWARD_METHODOLOGY.riskWindowYears[riskWindow],
    ),
  };
}

/** Every scheduled session from the requested start through the end session. */
export function forwardRiskSessions(
  requestedStartDate: string,
  endDate: string,
): Session[] {
  return sessionsBetween(requestedStartDate, endDate, FAR);
}
