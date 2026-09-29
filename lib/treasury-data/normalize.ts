import type { TreasuryObservation } from "@/lib/types/data";
import holidays from "@/config/federal-holidays.json" with { type: "json" };
import { addDays, validDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export const FEDERAL_CALENDAR_VERSION = holidays.version;
export const FEDERAL_CALENDAR_COVERAGE = holidays.coverage;
const closed = new Set([...holidays.holidays, ...holidays.supplementalClosures]);
export function federalBusinessDay(date: string): boolean {
  return (
    ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) &&
    !closed.has(date)
  );
}
function newYorkOffset(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
}
/** Next U.S. federal business day at 23:59 New York time. Modeled availability, not
 * vintage proof. Fails closed where the federal calendar cannot classify a day. */
export function modeledAvailableAt(date: string): string {
  const { start, end } = FEDERAL_CALENDAR_COVERAGE;
  if (!validDate(date) || date < start)
    fail("MALFORMED_DATA", "Treasury date precedes the federal calendar coverage.");
  let releaseDay = addDays(date, 1);
  while (!federalBusinessDay(releaseDay)) {
    if (releaseDay > end) break;
    releaseDay = addDays(releaseDay, 1);
  }
  if (releaseDay > end)
    fail(
      "MALFORMED_DATA",
      `Treasury release timing is unknown after ${end}; renew the federal calendar artifact.`,
    );
  return new Date(`${releaseDay}T23:59:00${newYorkOffset(releaseDay)}`).toISOString();
}
export function parseTreasuryCsv(
  csv: string,
  series: string,
): TreasuryObservation[] {
  if (!["DGS3MO", "DGS1", "DGS3", "DGS5", "DGS10"].includes(series))
    fail("MALFORMED_DATA", "Unsupported Treasury series or yield basis.");
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== `observation_date,${series}` && header !== `DATE,${series}`)
    fail("MALFORMED_DATA", "Unexpected Treasury CSV schema.");
  const rows = new Map<string, TreasuryObservation>();
  for (const line of lines) {
    const fields = line.split(",");
    if (fields.length !== 2) fail("MALFORMED_DATA", "Malformed Treasury row.");
    const [date, value] = fields;
    if (!validDate(date)) fail("MALFORMED_DATA", "Invalid Treasury date.");
    if (value === "" || value === ".") continue;
    const annualYield = Number(value) / 100;
    if (!Number.isFinite(annualYield) || annualYield <= -1)
      fail("MALFORMED_DATA", "Invalid Treasury yield.");
    const availableAt = modeledAvailableAt(date);
    if (rows.has(date) && rows.get(date)!.annualYield !== annualYield)
      fail("MALFORMED_DATA", "Conflicting Treasury observations.");
    rows.set(date, { date, annualYield, availableAt, availability: "modeled" });
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
