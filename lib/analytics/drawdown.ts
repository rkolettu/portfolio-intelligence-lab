import type {
  DrawdownEpisode,
  DrawdownPoint,
  WealthPoint,
} from "@/lib/types/analytics";
import { calendarDays } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

function assertPath(points: readonly WealthPoint[]) {
  if (!points.length) fail("INVALID_INPUT", "Drawdown requires a wealth path.");
  for (let i = 0; i < points.length; i++) {
    const { date, wealth } = points[i];
    if (!Number.isFinite(wealth) || wealth <= 0)
      fail("MALFORMED_DATA", "Wealth must be positive and finite.");
    if (i && points[i - 1].date >= date)
      fail("MALFORMED_DATA", "Wealth dates must be strictly increasing.");
  }
}

/** drawdown_t = wealth_t / max(wealth_0 … wealth_t) - 1; the initial wealth is a peak. */
export function drawdownSeries(
  points: readonly WealthPoint[],
): DrawdownPoint[] {
  assertPath(points);
  let peak = points[0].wealth;
  return points.map(({ date, wealth }) => {
    if (wealth > peak) peak = wealth;
    return { date, drawdown: wealth / peak - 1 };
  });
}

/** Minimum of the drawdown series (0 when wealth never falls below a prior peak). */
export function maximumDrawdown(series: readonly DrawdownPoint[]): number {
  if (!series.length) fail("INVALID_INPUT", "Drawdown requires observations.");
  let minimum = 0;
  for (const p of series) minimum = Math.min(minimum, p.drawdown);
  return minimum;
}

/** Chronological episodes. Peak = last date at the high-water mark before falling
 * below it; trough = first date of the episode minimum; recovery = first date back
 * to or above the peak. The search never extends beyond the supplied path. */
export function drawdownEpisodes(
  points: readonly WealthPoint[],
): DrawdownEpisode[] {
  assertPath(points);
  const last = points.length - 1;
  const episodes: DrawdownEpisode[] = [];
  let peakIndex = 0;
  let open: { peak: number; trough: number } | null = null;
  const close = (peak: number, trough: number, recovery: number | null) => {
    const end = recovery ?? last;
    episodes.push({
      peakDate: points[peak].date,
      peakWealth: points[peak].wealth,
      troughDate: points[trough].date,
      troughWealth: points[trough].wealth,
      recoveryDate: recovery === null ? null : points[recovery].date,
      depth: points[trough].wealth / points[peak].wealth - 1,
      calendarDaysToRecovery:
        recovery === null
          ? null
          : calendarDays(points[peak].date, points[recovery].date),
      tradingDaysToRecovery: recovery === null ? null : recovery - peak,
      underwaterCalendarDays: calendarDays(points[peak].date, points[end].date),
      underwaterTradingDays: end - peak,
    });
  };
  for (let i = 1; i <= last; i++) {
    const wealth = points[i].wealth;
    if (!open) {
      if (wealth >= points[peakIndex].wealth) peakIndex = i;
      else open = { peak: peakIndex, trough: i };
    } else if (wealth >= points[open.peak].wealth) {
      close(open.peak, open.trough, i);
      open = null;
      peakIndex = i;
    } else if (wealth < points[open.trough].wealth) {
      open.trough = i;
    }
  }
  if (open) close(open.peak, open.trough, null);
  return episodes;
}

/** Deepest first; ties keep chronological order (earliest first). */
export function rankEpisodes(
  episodes: readonly DrawdownEpisode[],
): DrawdownEpisode[] {
  return episodes
    .map((episode, order) => ({ episode, order }))
    .sort((a, b) => a.episode.depth - b.episode.depth || a.order - b.order)
    .map(({ episode }) => episode);
}
