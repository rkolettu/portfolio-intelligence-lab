// Display-only data selection for charts. No financial formulas: every value is
// taken verbatim from the computed result; downsampling never feeds calculations.
import type { BacktestResult, WealthPoint } from "@/lib/types/analytics";

/** Indices to plot: first, last, and each bucket's min and max for every series,
 * so extremes (a drawdown trough, a wealth peak) always survive downsampling. */
export function displayIndices(
  length: number,
  maxPoints: number,
  series: readonly (readonly number[])[],
): number[] {
  if (length <= maxPoints) return Array.from({ length }, (_, i) => i);
  const perBucket = 2 * Math.max(1, series.length);
  const buckets = Math.max(1, Math.floor((maxPoints - 2) / perBucket));
  const keep = new Set([0, length - 1]);
  const size = length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(length, Math.floor((b + 1) * size));
    for (const values of series) {
      let lo = from;
      let hi = from;
      for (let i = from; i < to; i++) {
        if (values[i] < values[lo]) lo = i;
        if (values[i] > values[hi]) hi = i;
      }
      keep.add(lo).add(hi);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

export type GrowthDatum = {
  date: string;
  portfolio: number;
  benchmark?: number;
};

/** Growth of $10,000. With the benchmark, both series are the Phase 1 continuous
 * overlap path, each normalized to $10,000 at the overlap start. */
export function growthData(
  result: Pick<BacktestResult, "performance" | "benchmark">,
  withBenchmark: boolean,
): GrowthDatum[] {
  if (withBenchmark && result.benchmark.ok)
    return result.benchmark.value.points.map((p) => ({
      date: p.date,
      portfolio: p.portfolioWealth,
      benchmark: p.benchmarkWealth,
    }));
  return result.performance.growth.map((p: WealthPoint) => ({
    date: p.date,
    portfolio: p.wealth,
  }));
}

/** Downsample rows for display; `mustKeep` rows (e.g. episode dates that carry
 * chart annotations) are always retained. */
export function downsample<T>(
  data: readonly T[],
  maxPoints: number,
  pick: (row: T) => readonly number[],
  mustKeep: (row: T) => boolean = () => false,
): T[] {
  const columns = data.length
    ? pick(data[0]).map((_, c) => data.map((row) => pick(row)[c]))
    : [];
  const keep = new Set(displayIndices(data.length, maxPoints, columns));
  data.forEach((row, i) => {
    if (mustKeep(row)) keep.add(i);
  });
  return [...keep].sort((a, b) => a - b).map((i) => data[i]);
}

/** Last observation of each calendar month (plus the final one), for table views. */
export function monthEndRows<T extends { date: string }>(
  data: readonly T[],
): T[] {
  return data.filter(
    (row, i) =>
      i === data.length - 1 ||
      data[i + 1].date.slice(0, 7) !== row.date.slice(0, 7),
  );
}

/** X-axis ticks: the first plotted date of each year (spans over ~3 years) or each
 * month, thinned to at most `maxTicks`, so labels never repeat. */
export function axisTicks(
  dates: readonly string[],
  maxTicks = 8,
): { ticks: string[]; unit: "year" | "month" } {
  if (!dates.length) return { ticks: [], unit: "month" };
  const spanDays =
    (Date.parse(`${dates.at(-1)}T00:00:00Z`) -
      Date.parse(`${dates[0]}T00:00:00Z`)) /
    86_400_000;
  const unit = spanDays > 3 * 365 ? "year" : "month";
  const key = (d: string) => (unit === "year" ? d.slice(0, 4) : d.slice(0, 7));
  const starts = dates.filter((d, i) => i > 0 && key(d) !== key(dates[i - 1]));
  const step = Math.max(1, Math.ceil(starts.length / maxTicks));
  return { ticks: starts.filter((_, i) => i % step === 0), unit };
}

/** Evenly stepped percentage ticks from 0 down past `minimum` (a negative drawdown),
 * using 1/2/5 × 10^k steps so labels read cleanly (e.g. 0%, -5%, …, -25%). */
export function drawdownTicks(minimum: number, maxTicks = 6): number[] {
  const depth = Math.max(Math.abs(minimum), 0.01);
  const raw = depth / (maxTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const count = Math.ceil(depth / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) =>
    i === 0 ? 0 : -Number((i * step).toPrecision(12)),
  );
}

/** Every k-th session date (first included), at most `maxTicks`, for windows too
 * short for month or year ticks. */
export function sessionTicks(dates: readonly string[], maxTicks = 6): string[] {
  const step = Math.max(1, Math.ceil(dates.length / maxTicks));
  return dates.filter((_, i) => i % step === 0);
}
