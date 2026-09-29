import type { RollingSeries } from "@/lib/types/analytics";
import { fail } from "@/lib/utils/errors";
import type { Computed } from "./performance";

/** Rolling statistic over N consecutive return intervals. `observations[k]` is the
 * input for `intervals[k]`, or null when that interval is invalid for this
 * statistic (e.g. the benchmark lacks a price at one endpoint). A window ending at
 * k is complete only when intervals k−N+1..k are all valid AND chain session to
 * session (each starts where the previous ended): a gap resets the count, so a
 * window is never compressed across missing sessions. `statistic` is the same
 * full-sample function used elsewhere, applied to the window unchanged. */
export function rollingSeries<R>(
  intervals: readonly { startDate: string; date: string }[],
  observations: readonly (R | null)[],
  window: number,
  statistic: (window: readonly R[]) => Computed,
): RollingSeries {
  if (!Number.isInteger(window) || window < 2)
    fail("INVALID_INPUT", "A rolling window needs at least two returns.");
  if (observations.length !== intervals.length)
    fail("INVALID_INPUT", "Rolling observations must pair with intervals.");
  const values: (number | null)[] = [];
  const reasons = new Set<string>();
  let run = 0;
  let validCount = 0;
  let undefinedCount = 0;
  let firstDate: string | null = null;
  for (let k = 0; k < intervals.length; k++) {
    const chained = k > 0 && intervals[k].startDate === intervals[k - 1].date;
    run = observations[k] === null ? 0 : chained && run > 0 ? run + 1 : 1;
    if (run < window) {
      values.push(null);
      continue;
    }
    const result = statistic(observations.slice(k - window + 1, k + 1) as R[]);
    if (result.ok) {
      values.push(result.value);
      validCount++;
      firstDate ??= intervals[k].date;
    } else {
      values.push(null);
      undefinedCount++;
      reasons.add(result.reason);
    }
  }
  return {
    window,
    values,
    validCount,
    firstDate,
    undefinedCount,
    undefinedReasons: [...reasons],
  };
}
