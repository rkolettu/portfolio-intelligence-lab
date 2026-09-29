import {
  BENCHMARK_METHODOLOGY,
  PERFORMANCE_METHODOLOGY,
} from "@/config/methodology";
import type {
  BenchmarkAlignment,
  BenchmarkAnalytics,
  BenchmarkPath,
  ComparisonPeriod,
  Metric,
  Sample,
  SeriesDrawdown,
} from "@/lib/types/analytics";
import type { Result } from "@/lib/types/data";
import {
  activeReturns,
  annualizedActiveReturn,
  beta,
  capmRegression,
  correlation,
  informationRatio,
  trackingError,
} from "./benchmark";
import {
  drawdownEpisodes,
  drawdownSeries,
  maximumDrawdown,
  rankEpisodes,
} from "./drawdown";
import { cagr, cumulativeReturn, type Computed } from "./performance";

function metric(result: Computed, sample: Sample): Metric {
  return result.ok
    ? {
        available: true,
        value: result.value,
        sample,
        ...(result.notes.length ? { notes: result.notes } : {}),
      }
    : { available: false, reason: result.reason };
}
const unavailable = (reason: string): Metric => ({ available: false, reason });

/** Benchmark-relative analytics from the canonical alignment and the continuous
 * growth path derived from it. Pure; replayable from the snapshot. */
export function summarizeBenchmark(input: {
  ticker: string;
  alignment: Result<BenchmarkAlignment>;
  path: Result<BenchmarkPath>;
}): BenchmarkAnalytics {
  const { ticker, alignment, path } = input;
  const a = alignment.ok ? alignment.value : null;
  const sample = a?.sample ?? null;
  const noSample = !alignment.ok
    ? alignment.error.message
    : "The benchmark has no return interval overlapping the portfolio sample.";

  const comparison: ComparisonPeriod =
    a && sample
      ? {
          available: true,
          sample,
          continuous: a.missingSessions.length === 0,
          leadingIntervalsExcluded: a.leadingIntervalsExcluded,
          trailingIntervalsExcluded: a.trailingIntervalsExcluded,
          notes: [
            ...(a.leadingIntervalsExcluded
              ? [
                  `Benchmark history begins after the portfolio start; ${a.leadingIntervalsExcluded} earlier portfolio intervals are outside the comparison. Absolute portfolio metrics still use the full history.`,
                ]
              : []),
            ...sample.excludedReasons,
          ],
        }
      : { available: false, reason: noSample };

  const r = a && sample ? a.observations : [];
  const p = r.map((o) => o.portfolioReturn);
  const b = r.map((o) => o.benchmarkReturn);
  const active = sample ? activeReturns(p, b) : [];
  const relativeMetric = (compute: () => Computed): Metric =>
    sample ? metric(compute(), sample) : unavailable(noSample);

  // Alpha must use the SAME comparison sample; incomplete rates make it unavailable
  // rather than silently regressing on a shorter subset.
  const rfComplete = !!a && a.riskFree.complete;
  const regression =
    sample && rfComplete
      ? capmRegression(
          r.map((o) => o.portfolioReturn - o.riskFreeReturn!),
          r.map((o) => o.benchmarkReturn - o.riskFreeReturn!),
        )
      : null;
  const regressionMetric = (
    pick: keyof NonNullable<typeof regression>,
  ): Metric => {
    if (!sample) return unavailable(noSample);
    if (!regression)
      return unavailable(
        `Historical risk-free returns are missing for ${a!.riskFree.required - a!.riskFree.available} of ${a!.riskFree.required} comparison intervals; alpha is not estimated on a shorter sample.`,
      );
    return metric(regression[pick], sample);
  };

  // Geometric comparison and benchmark drawdown need continuous compounded wealth.
  const points = path.ok ? path.value.points : null;
  const geometricReason = path.ok
    ? ""
    : `Geometric comparison unavailable: ${path.error.message}`;
  const geometric = (
    pick: (start: number, end: number) => Computed,
    key: "portfolioWealth" | "benchmarkWealth",
  ): Metric => {
    if (!points || !sample) return unavailable(geometricReason || noSample);
    // A continuous path exists only when the alignment has no interior gaps, so it
    // covers exactly the canonical sample's intervals.
    return metric(pick(points[0][key], points.at(-1)![key]), sample);
  };
  const first = points?.[0]?.date ?? "";
  const last = points?.at(-1)?.date ?? "";
  const cum = (s: number, e: number): Computed => ({
    ok: true,
    value: cumulativeReturn(s, e),
    notes: [],
  });
  const annual = (s: number, e: number): Computed => cagr(s, e, first, last);

  let drawdown: SeriesDrawdown;
  if (!points)
    drawdown = { available: false, reason: geometricReason || noSample };
  else {
    const wealth = points.map((pt) => ({
      date: pt.date,
      wealth: pt.benchmarkWealth,
    }));
    const series = drawdownSeries(wealth);
    const deepest = maximumDrawdown(series);
    const ranked = rankEpisodes(drawdownEpisodes(wealth));
    const current = series.at(-1)!.drawdown;
    drawdown = {
      available: true,
      series,
      maximumDrawdown: metric(
        {
          ok: true,
          value: deepest,
          notes:
            deepest === 0
              ? ["No drawdown: the benchmark never closed below a prior peak."]
              : [],
        },
        sample!,
      ),
      currentDrawdown: metric({ ok: true, value: current, notes: [] }, sample!),
      maximumDrawdownEpisode: deepest < 0 ? ranked[0] : null,
      episodes: ranked.slice(0, PERFORMANCE_METHODOLOGY.episodeLimit),
      episodeCount: ranked.length,
    };
  }

  return {
    methodologyVersion: BENCHMARK_METHODOLOGY.version,
    ticker: a?.ticker ?? ticker,
    comparison,
    relative: {
      beta: relativeMetric(() => beta(p, b)),
      correlation: relativeMetric(() => correlation(p, b)),
      annualizedActiveReturn: relativeMetric(() =>
        annualizedActiveReturn(active),
      ),
      trackingError: relativeMetric(() => trackingError(active)),
      informationRatio: relativeMetric(() => informationRatio(active)),
      alpha: regressionMetric("alpha"),
      regressionBeta: regressionMetric("slope"),
      rSquared: regressionMetric("rSquared"),
    },
    geometric: {
      portfolioCumulativeReturn: geometric(cum, "portfolioWealth"),
      benchmarkCumulativeReturn: geometric(cum, "benchmarkWealth"),
      portfolioCagr: geometric(annual, "portfolioWealth"),
      benchmarkCagr: geometric(annual, "benchmarkWealth"),
    },
    riskFree: a?.riskFree ?? { complete: false, available: 0, required: 0 },
    drawdown,
  };
}
