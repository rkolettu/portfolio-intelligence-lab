import calendar from "@/config/nyse-sessions.json" with { type: "json" };
import type { Session } from "@/lib/types/data";
import { validDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export const CALENDAR_VERSION = calendar.version;
export const CALENDAR_COVERAGE = calendar.coverage;
const sessions: Session[] = calendar.sessions.map(([date, close]) => ({
  date,
  close,
}));
export function sessionsBetween(
  start: string,
  end: string,
  now: string,
): Session[] {
  const { start: first, end: last } = CALENDAR_COVERAGE;
  if (
    !validDate(start) ||
    !validDate(end) ||
    start > end ||
    start < first ||
    end > last ||
    !Number.isFinite(Date.parse(now))
  )
    fail(
      "INVALID_INPUT",
      `Requested dates exceed the qualified ${first}–${last} calendar or are invalid.`,
    );
  return sessions.filter(
    (s) =>
      s.date >= start && s.date <= end && Date.parse(s.close) < Date.parse(now),
  );
}
/** Close of the first session strictly after `timestamp`, or null beyond coverage. */
export function nextCloseAfter(timestamp: string): string | null {
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) fail("INVALID_INPUT", "Invalid timestamp.");
  return sessions.find((s) => Date.parse(s.close) > at)?.close ?? null;
}
