import { expect, it } from "vitest";
import {
  drawdownEpisodes,
  drawdownSeries,
  maximumDrawdown,
  rankEpisodes,
} from "@/lib/analytics/drawdown";
import type { WealthPoint } from "@/lib/types/analytics";

// Sessions: Thu, Fri, then Mon (weekend gap), Tue, Wed, Thu, Fri, Mon.
const dates = ["2024-05-30", "2024-05-31", "2024-06-03", "2024-06-04", "2024-06-05", "2024-06-06", "2024-06-07", "2024-06-10"];
const path = (w: number[]): WealthPoint[] => w.map((wealth, i) => ({ date: dates[i], wealth }));

it("hand-calculated [100, 110, 99] path: -10% peak-to-trough, unrecovered", () => {
  const p = path([10_000, 11_000, 9_900]);
  expect(drawdownSeries(p).map((d) => d.drawdown)).toEqual([0, 0, 9_900 / 11_000 - 1]);
  expect(maximumDrawdown(drawdownSeries(p))).toBeCloseTo(-0.1, 14);
  expect(drawdownEpisodes(p)).toEqual([{
    peakDate: "2024-05-31", peakWealth: 11_000, troughDate: "2024-06-03", troughWealth: 9_900,
    recoveryDate: null, depth: 9_900 / 11_000 - 1, calendarDaysToRecovery: null,
    tradingDaysToRecovery: null, underwaterCalendarDays: 3, underwaterTradingDays: 1,
  }]);
});

it("includes initial wealth as a peak: an immediate loss is a drawdown from the start", () => {
  const p = path([10_000, 9_500, 9_800]);
  const [e] = drawdownEpisodes(p);
  expect(e).toMatchObject({ peakDate: dates[0], troughDate: dates[1], recoveryDate: null });
  expect(e.depth).toBeCloseTo(-0.05, 14);
});

it("reports no drawdown for a path that never closes below a prior peak", () => {
  const p = path([100, 100, 101, 105]);
  expect(drawdownSeries(p).every((d) => d.drawdown === 0)).toBe(true);
  expect(maximumDrawdown(drawdownSeries(p))).toBe(0);
  expect(drawdownEpisodes(p)).toEqual([]);
});

it("uses the LAST equal high-water mark as peak, the FIRST minimum as trough, and recovery at-or-above peak", () => {
  //           0    1    2    3    4    5    6   7
  const p = path([100, 110, 110, 100, 105, 110, 90, 95]);
  const [first, second] = drawdownEpisodes(p);
  expect(first).toMatchObject({
    peakDate: dates[2], troughDate: dates[3], recoveryDate: dates[5], depth: 100 / 110 - 1,
    // Mon 06-03 → Thu 06-06: 3 calendar days and 3 sessions (5 - 2).
    calendarDaysToRecovery: 3, tradingDaysToRecovery: 3,
  });
  // Recovery exactly at the prior peak (110) starts the next episode's peak there.
  expect(second).toMatchObject({ peakDate: dates[5], troughDate: dates[6], recoveryDate: null, depth: 90 / 110 - 1 });
  expect(maximumDrawdown(drawdownSeries(p))).toBe(second.depth);
  const equalTroughs = drawdownEpisodes(path([100, 90, 95, 90, 100]));
  expect(equalTroughs[0].troughDate).toBe(dates[1]);
});

it("counts calendar and trading days to recovery across a weekend separately", () => {
  // Peak Fri 05-31, recover Tue 06-04: 4 calendar days, 2 sessions.
  const [e] = drawdownEpisodes(path([100, 110, 105, 111]));
  expect(e).toMatchObject({ peakDate: dates[1], recoveryDate: dates[3], calendarDaysToRecovery: 4, tradingDaysToRecovery: 2 });
});

it("never searches past the supplied effective end for a recovery", () => {
  const [e] = drawdownEpisodes(path([100, 110, 100]));
  expect(e.recoveryDate).toBeNull();
  expect(e.underwaterTradingDays).toBe(1);
});

it("ranks deepest first with ties in chronological order", () => {
  const ranked = rankEpisodes(drawdownEpisodes(path([100, 90, 100, 90, 100, 80, 100])));
  expect(ranked.map((e) => e.peakDate)).toEqual([dates[4], dates[0], dates[2]]);
  expect(ranked.map((e) => e.depth)).toEqual([80 / 100 - 1, 90 / 100 - 1, 90 / 100 - 1]);
});

it("rejects invalid or unordered wealth paths", () => {
  expect(() => drawdownSeries([])).toThrow();
  expect(() => drawdownSeries(path([100, 0]))).toThrow();
  expect(() => drawdownSeries([{ date: dates[1], wealth: 1 }, { date: dates[0], wealth: 1 }])).toThrow();
});

it("satisfies drawdown invariants on seeded random wealth paths", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = Date.parse("2020-01-01T00:00:00Z");
  for (let trial = 0; trial < 60; trial++) {
    const n = 2 + Math.floor(rand() * 250);
    let wealth = 10_000;
    const points: WealthPoint[] = [];
    for (let i = 0; i < n; i++) {
      if (i) wealth *= rand() < 0.1 ? 1 : 1 + (rand() - 0.5) * 0.08; // includes flat days (equal peaks)
      points.push({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), wealth });
    }
    const series = drawdownSeries(points);
    const episodes = drawdownEpisodes(points);
    const mdd = maximumDrawdown(series);
    expect(series.every((d) => d.drawdown <= 0)).toBe(true);
    expect(mdd).toBe(Math.min(...series.map((d) => d.drawdown)));
    if (mdd < 0) expect(rankEpisodes(episodes)[0].depth).toBe(mdd);
    else expect(episodes).toEqual([]);
    const index = new Map(points.map((p, i) => [p.date, i]));
    let previousEnd = -1;
    for (const e of episodes) {
      const peak = index.get(e.peakDate)!;
      const trough = index.get(e.troughDate)!;
      const end = e.recoveryDate ? index.get(e.recoveryDate)! : points.length;
      expect(peak).toBeGreaterThanOrEqual(previousEnd); // episodes do not overlap
      const inside = points.slice(peak + 1, end).map((p) => p.wealth);
      // Recovery only after the prior peak is regained; underwater strictly below it.
      expect(inside.every((w) => w < e.peakWealth)).toBe(true);
      if (e.recoveryDate) expect(points[end].wealth).toBeGreaterThanOrEqual(e.peakWealth);
      // Trough is the first minimum of the episode.
      expect(trough).toBe(peak + 1 + inside.indexOf(Math.min(...inside)));
      expect(e.depth).toBeLessThan(0);
      previousEnd = end;
    }
  }
});
