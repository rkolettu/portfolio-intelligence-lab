import { fail } from "./errors";
const DAY = 86_400_000;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function calendarDays(start: string, end: string): number {
  if (!validDate(start) || !validDate(end))
    fail("INVALID_INPUT", "Use valid ISO calendar dates.");
  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY
  );
}
export function addDays(date: string, days: number): string {
  if (!validDate(date) || !Number.isInteger(days))
    fail("INVALID_INPUT", "Invalid calendar-day offset.");
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}
// Constructing Intl formatters is expensive; marketDate runs on per-observation paths.
const newYorkDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function marketDate(timestamp: string): string {
  if (!Number.isFinite(Date.parse(timestamp)))
    fail("INVALID_INPUT", "Invalid observation timestamp.");
  return newYorkDate.format(new Date(timestamp));
}
export function yearsBefore(date: string, years: number): string {
  if (!validDate(date) || !Number.isInteger(years) || years < 0)
    fail("INVALID_INPUT", "Invalid horizon.");
  const year = Number(date.slice(0, 4)) - years;
  const candidate = `${year}${date.slice(4)}`;
  return validDate(candidate) ? candidate : `${year}-02-28`;
}
