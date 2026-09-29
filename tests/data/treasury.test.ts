import { expect, it } from "vitest";
import { accrueCash, priorKnownRate } from "@/lib/treasury-data/alignment";
import type { TreasuryObservation } from "@/lib/types/data";
const rates: TreasuryObservation[] = [
  {
    date: "2024-05-30",
    annualYield: 0.05,
    availableAt: "2024-05-30T20:15:00Z",
    availability: "published",
  },
  {
    date: "2024-05-31",
    annualYield: 0.9,
    availableAt: "2024-05-31T20:15:00Z",
    availability: "published",
  },
];
it("accrues weekends using a prior-known yield and freezes it for the interval", () => {
  const rate = priorKnownRate(rates, {
    date: "2024-05-31",
    close: "2024-05-31T20:00:00Z",
  });
  expect(rate?.date).toBe("2024-05-30");
  expect(accrueCash(rate!.annualYield, 3)).toBeCloseTo(
    0.000401095465251355,
    14,
  );
});
it("does not leak post-close or exactly-at-cutoff releases into an early-close interval", () => {
  const data = [rates[0], { ...rates[1], availableAt: "2024-05-31T17:00:00Z" }];
  expect(
    priorKnownRate(data, { date: "2024-05-31", close: "2024-05-31T17:00:00Z" })
      ?.annualYield,
  ).toBe(0.05);
});
it("permits only prior rates no more than seven calendar days old", () => {
  expect(
    priorKnownRate([rates[0]], {
      date: "2024-06-06",
      close: "2024-06-06T20:00:00Z",
    })?.annualYield,
  ).toBe(0.05);
  expect(
    priorKnownRate(rates, {
      date: "2024-06-10",
      close: "2024-06-10T20:00:00Z",
    }),
  ).toBeNull();
  expect(
    priorKnownRate(rates, {
      date: "2024-05-29",
      close: "2024-05-29T20:00:00Z",
    }),
  ).toBeNull();
});
it("supports modest negative yields and rejects invalid accruals", () => {
  expect(accrueCash(-0.01, 365)).toBeCloseTo(-0.01, 12);
  expect(() => accrueCash(-1, 1)).toThrow();
  expect(() => accrueCash(Infinity, 1)).toThrow();
  expect(() => accrueCash(0.05, 0)).toThrow();
});

import { parseTreasuryCsv } from "@/lib/treasury-data/normalize";
it("converts published percentages, skips unavailable yields, and models conservative availability", () => {
  const rows = parseTreasuryCsv(
    "observation_date,DGS3MO\n2024-05-30,5\n2024-05-31,\n2024-06-03,-0.1\n",
    "DGS3MO",
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].annualYield).toBe(0.05);
  expect(rows[0].availability).toBe("modeled");
  expect(rows[0].availableAt).toBe("2024-06-01T03:59:00.000Z");
  expect(rows[1].annualYield).toBe(-0.001);
});
it("rejects discount-yield substitution and conflicting Treasury observations", () => {
  expect(() =>
    parseTreasuryCsv("observation_date,DTB3\n2024-05-30,5", "DGS3MO"),
  ).toThrow();
  expect(() =>
    parseTreasuryCsv(
      "observation_date,DGS3MO\n2024-05-30,5\n2024-05-30,6",
      "DGS3MO",
    ),
  ).toThrow();
});

it("rejects impossible publication timestamps before the observation's date", () => {
  expect(() => priorKnownRate([{ date: "2024-05-31", annualYield: 0.9,
    availableAt: "2024-05-30T20:15:00Z", availability: "published" }],
    { date: "2024-05-31", close: "2024-05-31T20:00:00Z" })).toThrow();
});

it("fails closed outside federal calendar coverage rather than treating unknown holidays as business days", () => {
  expect(() => parseTreasuryCsv("observation_date,DGS3MO\n2099-01-01,5", "DGS3MO")).toThrow();
});

it("models Friday and holiday releases after the following business day, across DST", () => {
  const rows = parseTreasuryCsv("observation_date,DGS3MO\n2024-05-24,5\n2024-03-08,5\n2024-11-27,5", "DGS3MO");
  expect(rows.map((r) => r.availableAt)).toEqual([
    "2024-03-12T03:59:00.000Z", "2024-05-29T03:59:00.000Z", "2024-11-30T04:59:00.000Z",
  ]);
  const friday = parseTreasuryCsv("observation_date,DGS3MO\n2026-09-25,4.24", "DGS3MO");
  expect(priorKnownRate(friday, { date: "2026-09-28", close: "2026-09-28T20:00:00Z" })).toBeNull();
  expect(priorKnownRate(friday, { date: "2026-09-29", close: "2026-09-29T20:00:00Z" })?.annualYield).toBe(0.0424);
});

import { modeledAvailableAt } from "@/lib/treasury-data/normalize";
it("treats documented federal closures conservatively and fails before calendar coverage", () => {
  // 2025-01-09 national day of mourning: a 2025-01-08 rate is modeled available 2025-01-10.
  expect(modeledAvailableAt("2025-01-08")).toBe("2025-01-11T04:59:00.000Z");
  // Lookback context before the first 1976 session still receives a release time.
  expect(modeledAvailableAt("1975-12-19")).toBe("1975-12-23T04:59:00.000Z");
  expect(() => modeledAvailableAt("1974-12-31")).toThrow();
  expect(() => modeledAvailableAt("2029-12-31")).toThrow(/renew/);
});
it("rejects unparseable availability timestamps instead of silently dropping them", () => {
  expect(() => priorKnownRate([{ ...rates[0], availableAt: "not-a-time" }],
    { date: "2024-05-31", close: "2024-05-31T20:00:00Z" })).toThrow();
});

import { calendarDays } from "@/lib/utils/dates";
import { addDays } from "@/lib/utils/dates";
it("indexed lookup selects exactly what the reference full scan selects", () => {
  // Reference: the original O(sessions x rates) filter-and-sort definition.
  const reference = (all: TreasuryObservation[], s: { date: string; close: string }) =>
    all.filter((r) => r.date <= s.date && Date.parse(r.availableAt) < Date.parse(s.close) &&
      calendarDays(r.date, s.date) <= 7 && Number.isFinite(r.annualYield) && r.annualYield > -1)
      .sort((a, b) => b.date.localeCompare(a.date) || b.availableAt.localeCompare(a.availableAt))[0] ?? null;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 40; trial++) {
    const data: TreasuryObservation[] = [];
    for (let d = 0; d < 60; d++) {
      if (rand() < 0.3) continue; // gaps, including > 7-day runs
      const date = addDays("2024-01-01", d);
      for (let k = rand() < 0.2 ? 2 : 1; k > 0; k--) // duplicate dates, distinct releases
        data.push({ date, annualYield: rand() < 0.05 ? -1 : rand() / 10,
          availableAt: new Date(Date.parse(`${date}T14:00:00Z`) + Math.floor(rand() * 5 * 86400000)).toISOString(),
          availability: "modeled" });
    }
    data.sort(() => rand() - 0.5);
    for (let d = 0; d < 70; d += 3) {
      const date = addDays("2024-01-01", d);
      const session = { date, close: `${date}T${rand() < 0.2 ? "18" : "21"}:00:00Z` };
      expect(priorKnownRate(data, session)).toEqual(reference(data, session));
    }
  }
});
