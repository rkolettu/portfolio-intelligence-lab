import { expect, it } from "vitest";
import { sessionsBetween } from "@/lib/backtest/calendar";
it("includes actual sessions across Good Friday and excludes uncompleted sessions", () => {
  expect(
    sessionsBetween("2024-03-28", "2024-04-01", "2024-04-01T19:59:00Z").map(
      (s) => s.date,
    ),
  ).toEqual(["2024-03-28"]);
});
it("includes early closes and DST-correct closing timestamps", () => {
  expect(
    sessionsBetween("2024-11-28", "2024-11-29", "2024-11-30T00:00:00Z"),
  ).toEqual([{ date: "2024-11-29", close: "2024-11-29T18:00:00Z" }]);
  expect(
    sessionsBetween("2024-03-08", "2024-03-11", "2024-03-12T00:00:00Z").map(
      (s) => s.close,
    ),
  ).toEqual(["2024-03-08T21:00:00Z", "2024-03-11T20:00:00Z"]);
});
it("recognizes exceptional closures rather than inventing sessions", () => {
  expect(
    sessionsBetween("2001-09-11", "2001-09-14", "2024-01-01T00:00:00Z"),
  ).toEqual([]);
  expect(
    sessionsBetween("2012-10-29", "2012-10-30", "2024-01-01T00:00:00Z"),
  ).toEqual([]);
  expect(
    sessionsBetween("2025-01-09", "2025-01-09", "2025-01-10T00:00:00Z"),
  ).toEqual([]);
});
it("rejects dates outside the versioned calendar instead of guessing", () =>
  expect(() =>
    sessionsBetween("1975-01-01", "1975-01-10", "2024-01-01T00:00:00Z"),
  ).toThrow());

import sessionsArtifact from "@/config/nyse-sessions.json" with { type: "json" };
import federalArtifact from "@/config/federal-holidays.json" with { type: "json" };
import { nextCloseAfter } from "@/lib/backtest/calendar";
import { checkCalendars } from "@/lib/backtest/calendarIntegrity";

it("matches NYSE's published 2026–2028 holidays and 1 p.m. early closes", () => {
  const all = sessionsBetween("2026-01-01", "2028-12-31", "2100-01-01T00:00:00Z");
  const open = new Set(all.map((s) => s.date));
  const weekdays: string[] = [];
  for (let d = new Date("2026-01-01T12:00:00Z"); d <= new Date("2028-12-31T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() % 6) weekdays.push(d.toISOString().slice(0, 10));
  // Source: nyse.com/trade/hours-calendars, checked 2026-09-28.
  expect(weekdays.filter((d) => !open.has(d))).toEqual([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
  ]);
  expect(all.filter((s) => !s.close.endsWith("T21:00:00Z") && !s.close.endsWith("T20:00:00Z")).map((s) => s.date))
    .toEqual(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
});

it("validates artifact integrity and enforces the renewal horizon", () => {
  expect(checkCalendars(sessionsArtifact, federalArtifact, "2026-09-28")).toEqual({ errors: [], warnings: [] });
  expect(checkCalendars(sessionsArtifact, federalArtifact, "2028-01-15").warnings).toHaveLength(1);
  const late = checkCalendars(sessionsArtifact, federalArtifact, "2028-08-01");
  expect(late.errors.join()).toMatch(/Renew the calendar artifacts/);
  const tampered = { ...sessionsArtifact, sessions: sessionsArtifact.sessions.filter(([d]) => d !== "2026-10-01") };
  expect(checkCalendars(tampered, federalArtifact, "2026-09-28").errors.join()).toMatch(/hash/);
  const shortFederal = { ...federalArtifact, coverage: { ...federalArtifact.coverage, end: "2028-06-30" } };
  expect(checkCalendars(sessionsArtifact, shortFederal, "2026-09-28").errors.join()).toMatch(/Federal calendar must cover/);
});

it("finds the next session close strictly after a timestamp, across weekends and early closes", () => {
  expect(nextCloseAfter("2026-09-25T20:00:00Z")).toBe("2026-09-28T20:00:00Z");
  expect(nextCloseAfter("2026-09-26T15:00:00Z")).toBe("2026-09-28T20:00:00Z");
  expect(nextCloseAfter("2026-11-25T21:00:00Z")).toBe("2026-11-27T18:00:00Z");
  expect(nextCloseAfter("2028-12-29T21:00:00Z")).toBeNull();
});
