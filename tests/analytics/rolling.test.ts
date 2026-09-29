import { describe, expect, it } from "vitest";
import { rollingSeries } from "@/lib/analytics/rolling";
import { annualizedVolatility } from "@/lib/analytics/risk";
import { beta } from "@/lib/analytics/benchmark";

const dates = [
  "2024-01-02",
  "2024-01-03",
  "2024-01-04",
  "2024-01-05",
  "2024-01-08",
  "2024-01-09",
  "2024-01-10",
];
/** Consecutive close-to-close intervals over `dates`. */
const chain = (ds: string[]) =>
  ds.slice(1).map((date, i) => ({ startDate: ds[i], date }));
const vol = (w: readonly number[]) => annualizedVolatility(w);

describe("rollingSeries", () => {
  it("shows nothing until N consecutive intervals exist, then the exact full-window statistic", () => {
    const intervals = chain(dates);
    const r = [0.01, -0.02, 0.015, 0.003, -0.007, 0.012];
    const s = rollingSeries(intervals, r, 3, vol);
    expect(s.window).toBe(3);
    expect(s.values.slice(0, 2)).toEqual([null, null]);
    for (let i = 2; i < r.length; i++) {
      const expected = annualizedVolatility(r.slice(i - 2, i + 1));
      expect(expected.ok).toBe(true);
      if (expected.ok) expect(s.values[i]).toBe(expected.value);
    }
    expect(s.firstDate).toBe(intervals[2].date);
    expect(s.validCount).toBe(4);
    expect(s.undefinedCount).toBe(0);
  });

  it("never compresses a window across a missing benchmark session (sessions 0,1,3,4)", () => {
    // Ledger intervals 0→1, 1→2, 2→3, 3→4, 4→5; the benchmark lacks session 2, so
    // only 0→1, 3→4 and 4→5 carry a valid pair. Neither 1→3 nor a window made of
    // 0→1 and 3→4 may be used.
    const intervals = chain(dates.slice(0, 6));
    const pairs = [
      { p: 0.01, b: 0.02 },
      null,
      null,
      { p: -0.01, b: -0.015 },
      { p: 0.02, b: 0.01 },
    ];
    const stat = (w: readonly { p: number; b: number }[]) =>
      beta(
        w.map((x) => x.p),
        w.map((x) => x.b),
      );
    const s = rollingSeries(intervals, pairs, 2, stat);
    expect(s.values.slice(0, 4)).toEqual([null, null, null, null]);
    const expected = beta([-0.01, 0.02], [-0.015, 0.01]);
    expect(expected.ok && s.values[4]).toBe(expected.ok && expected.value);
    expect(s.firstDate).toBe(intervals[4].date);
    expect(s.validCount).toBe(1);
  });

  it("treats intervals that do not chain session to session as a break", () => {
    // Valid observations on 0→1 and 3→4, but 1→3 is absent from the list: the
    // second interval does not start where the first ended.
    const intervals = [
      { startDate: dates[0], date: dates[1] },
      { startDate: dates[3], date: dates[4] },
      { startDate: dates[4], date: dates[5] },
    ];
    const s = rollingSeries(intervals, [0.01, 0.02, -0.01], 2, vol);
    expect(s.values).toEqual([null, null, expect.any(Number)]);
  });

  it("keeps complete windows with an undefined statistic as null and counts them", () => {
    const intervals = chain(dates.slice(0, 5));
    const pairs = [
      { p: 0.01, b: 0.004 },
      { p: -0.02, b: 0.004 },
      { p: 0.03, b: 0.004 },
      { p: 0.01, b: -0.01 },
    ];
    const stat = (w: readonly { p: number; b: number }[]) =>
      beta(
        w.map((x) => x.p),
        w.map((x) => x.b),
      );
    const s = rollingSeries(intervals, pairs, 2, stat);
    expect(s.values.slice(0, 3)).toEqual([null, null, null]);
    expect(typeof s.values[3]).toBe("number");
    expect(s.undefinedCount).toBe(2);
    expect(s.undefinedReasons).toEqual([
      "Benchmark returns have zero variance over the comparison sample, so beta is undefined.",
    ]);
    expect(s.validCount).toBe(1);
  });

  it("rejects a window shorter than two returns or mismatched inputs", () => {
    const intervals = chain(dates.slice(0, 3));
    expect(() => rollingSeries(intervals, [0.01, 0.02], 1, vol)).toThrow(
      /window/i,
    );
    expect(() => rollingSeries(intervals, [0.01], 2, vol)).toThrow(/pair/i);
  });
});
