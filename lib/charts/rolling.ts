// Display-only helpers for rolling charts. Values are taken verbatim from
// RollingAnalytics; nothing here computes a statistic or feeds a calculation.
import { displayIndices } from "./series";

export type RollingMetricKey = "volatility" | "beta" | "correlation";
export type RollingDatum = { date: string; value: number | null };

/** Rows to plot. Each run of values is downsampled in proportion to its length,
 * keeping its first, last and bucket extremes; each run of nulls keeps its first
 * and last row, so the line visibly breaks there and is never drawn across it. */
export function rollingDisplayData(
  dates: readonly string[],
  values: readonly (number | null)[],
  maxPoints: number,
): RollingDatum[] {
  const runs: { start: number; end: number; empty: boolean }[] = [];
  values.forEach((v, i) => {
    const last = runs.at(-1);
    if (last && last.empty === (v === null)) last.end = i;
    else runs.push({ start: i, end: i, empty: v === null });
  });
  const valueCount = values.filter((v) => v !== null).length;
  const row = (i: number): RollingDatum => ({
    date: dates[i],
    value: values[i],
  });
  const out: RollingDatum[] = [];
  for (const run of runs) {
    const length = run.end - run.start + 1;
    if (run.empty) {
      out.push(row(run.start));
      if (length > 1) out.push(row(run.end));
      continue;
    }
    const budget = Math.max(
      2,
      Math.floor((maxPoints * length) / Math.max(1, valueCount)),
    );
    const slice = values.slice(run.start, run.end + 1) as number[];
    for (const k of displayIndices(length, budget, [slice]))
      out.push(row(run.start + k));
  }
  return out;
}

/** Leading nulls (before the first complete window) and nulls after it. */
export function rollingGaps(values: readonly (number | null)[]): {
  leading: number;
  interior: number;
} {
  const first = values.findIndex((v) => v !== null);
  if (first < 0) return { leading: values.length, interior: 0 };
  return {
    leading: first,
    interior: values.slice(first).filter((v) => v === null).length,
  };
}

const clean = (v: number) => Number(v.toPrecision(12));
function stepped(lo: number, hi: number, steps: readonly number[]) {
  const span = Math.max(hi - lo, 1e-9);
  const step = steps.find((s) => span / s <= 5) ?? steps.at(-1)!;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(clean(t));
  return { domain: [clean(min), clean(max)] as [number, number], ticks };
}

/** Y axis per metric: correlation is fixed at [−1, 1]; volatility is anchored at
 * zero; beta always includes zero. The full-period reference is kept in view. */
export function rollingDomain(
  metric: RollingMetricKey,
  values: readonly (number | null)[],
  reference: number | null,
): { domain: [number, number]; ticks: number[] } {
  if (metric === "correlation")
    return { domain: [-1, 1], ticks: [-1, -0.5, 0, 0.5, 1] };
  const shown = [
    ...values.filter((v): v is number => v !== null),
    ...(reference === null ? [] : [reference]),
  ];
  const hi = Math.max(0, ...shown);
  if (metric === "volatility")
    return stepped(0, Math.max(hi, 0.01), [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]);
  return stepped(
    Math.min(0, ...shown),
    Math.max(hi, 0.1),
    [0.1, 0.2, 0.25, 0.5, 1, 2],
  );
}
