import { createHash } from "node:crypto";
import { addDays, validDate } from "@/lib/utils/dates";

/** Fail the build this close to the end of qualified session coverage. */
export const CALENDAR_RENEWAL_FAIL_DAYS = 180;
/** Warn (without failing) this close to the end of coverage. */
export const CALENDAR_RENEWAL_WARN_DAYS = 365;

type SessionArtifact = {
  version: string;
  coverage: { start: string; end: string };
  sessionsSha256: string;
  sessions: string[][];
};
type FederalArtifact = {
  version: string;
  coverage: { start: string; end: string };
  holidays: string[];
  supplementalClosures: string[];
  sha256: string;
};
export type CalendarCheck = { errors: string[]; warnings: string[] };

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const newYork = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  hourCycle: "h23",
});
function newYorkParts(timestamp: string) {
  const p = Object.fromEntries(
    newYork.formatToParts(new Date(timestamp)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const ascendingUnique = (dates: string[]) =>
  dates.every((d, i) => validDate(d) && (i === 0 || dates[i - 1] < d));

/** Integrity and renewal checks for the checked-in calendar artifacts. */
export function checkCalendars(
  sessions: SessionArtifact,
  federal: FederalArtifact,
  today: string,
): CalendarCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (sha256(sessions.sessions) !== sessions.sessionsSha256)
    errors.push("NYSE sessions do not match their recorded hash; regenerate instead of hand-editing.");
  if (sha256([federal.holidays, federal.supplementalClosures]) !== federal.sha256)
    errors.push("Federal holidays do not match their recorded hash; regenerate instead of hand-editing.");
  const dates = sessions.sessions.map(([date]) => date);
  if (!ascendingUnique(dates)) errors.push("NYSE sessions are not unique ascending dates.");
  for (const [date, close] of sessions.sessions) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const local = newYorkParts(close);
    if (weekday === 0 || weekday === 6 || local.date !== date || local.hour < 12 || local.hour > 16) {
      errors.push(`Implausible NYSE session ${date} closing at ${close}.`);
      break;
    }
  }
  if (dates[0] < sessions.coverage.start || dates.at(-1)! > sessions.coverage.end)
    errors.push("NYSE sessions fall outside their declared coverage.");
  if (!ascendingUnique(federal.holidays) || !ascendingUnique(federal.supplementalClosures))
    errors.push("Federal closures are not unique ascending dates.");
  if (federal.coverage.start > sessions.coverage.start || federal.coverage.end < sessions.coverage.end)
    errors.push("Federal calendar must cover every NYSE session for Treasury release timing.");
  const end = sessions.coverage.end;
  if (end < addDays(today, CALENDAR_RENEWAL_FAIL_DAYS))
    errors.push(
      `NYSE session coverage ends ${end}, within ${CALENDAR_RENEWAL_FAIL_DAYS} days of ${today}. Renew the calendar artifacts (DATA-PROVIDERS.md, Calendar maintenance).`,
    );
  else if (end < addDays(today, CALENDAR_RENEWAL_WARN_DAYS))
    warnings.push(`NYSE session coverage ends ${end}; schedule calendar renewal.`);
  return { errors, warnings };
}
