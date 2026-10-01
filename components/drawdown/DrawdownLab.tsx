"use client";
import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type {
  BenchmarkAnalytics,
  DrawdownEpisode,
  DrawdownPoint,
  Metric,
  PerformanceSummary,
} from "@/lib/types/analytics";
import {
  axisTicks,
  downsample,
  drawdownTicks,
  monthEndRows,
} from "@/lib/charts/series";
import { axisDate, axisPercent, percent, shortDate } from "@/lib/utils/format";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { activeDot, ExtremumMark } from "@/components/charts/markers";
import {
  CHART,
  chartMargin,
  useNarrowChart,
  usePrefersReducedMotion,
} from "@/components/charts/theme";
import { InfoTip } from "@/components/metrics/InfoTip";
import { Segmented } from "@/components/ui/Segmented";

const MAX_POINTS = 640;
type Mode = "portfolio" | "benchmark" | "both";
type View = {
  key: "portfolio" | "benchmark";
  name: string;
  color: string;
  series: DrawdownPoint[];
  maximumDrawdown: Metric;
  currentDrawdown: Metric;
  episode: DrawdownEpisode | null;
  episodes: DrawdownEpisode[];
  episodeCount: number;
};
type Row = { date: string; portfolio?: number; benchmark?: number };

function DrawdownTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltip
      date={shortDate(String(label))}
      rows={payload.map((p) => ({
        color: String(p.color),
        label: String(p.name),
        sub: "below running peak",
        value: percent(Number(p.value)),
      }))}
    />
  );
}

const days = (n: number | null) => (n === null ? "—" : n.toLocaleString());
const pct = (m: Metric) => (m.available ? percent(m.value) : "N/A");

function DrawdownStats({ view, heading }: { view: View; heading: boolean }) {
  const { episode, currentDrawdown: current } = view;
  const last = view.series.at(-1)!;
  const stats: { label: string; value: string; tip: string }[] = [
    {
      label: "Maximum drawdown",
      value: pct(view.maximumDrawdown),
      tip: "Largest fall in daily-close wealth below its running peak; the starting $10,000 counts as a peak.",
    },
    {
      label: "Peak date",
      value: episode?.peakDate ?? "—",
      tip: "Last close at the high-water mark before wealth fell below it.",
    },
    {
      label: "Trough date",
      value: episode?.troughDate ?? "—",
      tip: "First close at the episode's minimum wealth.",
    },
    {
      label: "Recovery date",
      value: episode ? (episode.recoveryDate ?? "Not recovered") : "—",
      tip: "First close back at or above the peak, searched only through the effective end date.",
    },
    {
      label: "Calendar days to recovery",
      value: episode ? days(episode.calendarDaysToRecovery) : "—",
      tip: "Peak → recovery in calendar days.",
    },
    {
      label: "Trading days to recovery",
      value: episode ? days(episode.tradingDaysToRecovery) : "—",
      tip: "Peak → recovery in completed trading sessions.",
    },
    {
      label: "Current drawdown",
      value: current.available
        ? current.value === 0
          ? "At peak"
          : percent(current.value)
        : "N/A",
      tip: `Drawdown at the effective end date (${last.date}).`,
    },
  ];
  return (
    <>
      {heading && (
        <p className="stats-label">
          <span
            className="line-key"
            style={{ background: view.color }}
            aria-hidden
          />
          {view.name}
        </p>
      )}
      <dl
        className="drawdown-stats"
        aria-label={`${view.name} drawdown statistics`}
      >
        {stats.map((s) => (
          <div key={s.label}>
            <dt>
              {s.label}
              <InfoTip label={`${view.name} ${s.label.toLowerCase()}`}>
                {s.tip}
              </InfoTip>
            </dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      {episode && episode.recoveryDate === null && (
        <p className="hint">
          {view.name} still underwater from the {episode.peakDate} peak:{" "}
          {episode.underwaterCalendarDays.toLocaleString()} calendar days and{" "}
          {episode.underwaterTradingDays.toLocaleString()} sessions through{" "}
          {last.date}. Recovery after the effective end is not reported.
        </p>
      )}
    </>
  );
}

const describe = (v: View) =>
  v.episode
    ? `${v.name}: deepest decline ${percent(v.episode.depth)} from ${shortDate(v.episode.peakDate)} to ${shortDate(v.episode.troughDate)}; ${
        v.episode.recoveryDate
          ? `recovered ${shortDate(v.episode.recoveryDate)}`
          : "not recovered"
      }.`
    : `${v.name}: no drawdown; wealth never closed below a prior peak.`;

export function DrawdownLab({
  performance,
  benchmark,
  initialMode = "portfolio",
}: {
  performance: PerformanceSummary;
  benchmark?: BenchmarkAnalytics;
  /** The Benchmark page opens on the side-by-side comparison. */
  initialMode?: Mode;
}) {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrowChart();
  const [mode, setMode] = useState<Mode>(initialMode);
  const portfolio: View = {
    key: "portfolio",
    name: "Portfolio",
    color: CHART.portfolio,
    series: performance.drawdown,
    maximumDrawdown: performance.risk.maximumDrawdown,
    currentDrawdown: performance.currentDrawdown,
    episode: performance.maximumDrawdownEpisode,
    episodes: performance.episodes,
    episodeCount: performance.episodeCount,
  };
  const bd = benchmark?.drawdown;
  const bench: View | null =
    benchmark && bd?.available
      ? {
          key: "benchmark",
          name: benchmark.ticker,
          color: CHART.benchmark,
          series: bd.series,
          maximumDrawdown: bd.maximumDrawdown,
          currentDrawdown: bd.currentDrawdown,
          episode: bd.maximumDrawdownEpisode,
          episodes: bd.episodes,
          episodeCount: bd.episodeCount,
        }
      : null;
  const active: Mode = bench ? mode : "portfolio";
  const views =
    active === "both"
      ? [portfolio, bench!]
      : [active === "benchmark" ? bench! : portfolio];
  // Annotations (shaded episode, trough marker) and the episode table follow one series.
  const primary = views[0];
  const episode = primary.episode;

  // Merge visible series by date. Portfolio sessions contain every benchmark date;
  // the benchmark starts at its comparison start and is simply absent before it.
  const byDate = new Map<string, Row>();
  for (const v of views)
    for (const p of v.series)
      byDate.set(p.date, {
        ...(byDate.get(p.date) ?? { date: p.date }),
        [v.key]: p.drawdown,
      });
  const merged = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const annotated = new Set(
    episode
      ? [episode.peakDate, episode.troughDate, episode.recoveryDate].filter(
          Boolean,
        )
      : [],
  );
  const data = downsample<Row>(
    merged,
    MAX_POINTS,
    (r) => views.map((v) => r[v.key] ?? 0),
    (r) => annotated.has(r.date),
  );
  const { ticks, unit } = axisTicks(data.map((d) => d.date));
  const deepest = Math.min(
    ...views.map((v) =>
      v.maximumDrawdown.available ? v.maximumDrawdown.value : 0,
    ),
  );
  const yTicks = drawdownTicks(deepest);
  const lastDate = merged.at(-1)!.date;
  const comparison = benchmark?.comparison;
  const lateBenchmark =
    !!bench &&
    active !== "portfolio" &&
    comparison?.available &&
    comparison.leadingIntervalsExcluded > 0;
  const title =
    active === "both"
      ? `Portfolio vs ${bench!.name} drawdown`
      : `${primary.name} drawdown`;
  const options: { value: Mode; label: string }[] = [
    { value: "portfolio", label: "Portfolio" },
    { value: "benchmark", label: benchmark?.ticker ?? "Benchmark" },
    { value: "both", label: "Both" },
  ];

  return (
    <>
      <div className="series-control">
        <Segmented
          legend="Drawdown series"
          name="drawdown-series"
          options={options.map((o) => ({
            ...o,
            disabled: o.value !== "portfolio" && !bench,
          }))}
          value={active}
          onChange={setMode}
          describedBy={bench ? undefined : "dd-bench-reason"}
        />
        {!bench && benchmark && (
          <span className="hint" id="dd-bench-reason">
            Benchmark Data Unavailable:{" "}
            {bd && !bd.available ? bd.reason : "no benchmark path."}
          </span>
        )}
      </div>
      {views.map((v) => (
        <DrawdownStats key={v.key} view={v} heading={views.length > 1} />
      ))}
      {lateBenchmark && (
        <p className="hint">
          {bench!.name} drawdown begins {bench!.series[0].date}, the start of
          continuous benchmark coverage, and its running peak starts there. The
          portfolio drawdown keeps its full-history running peak.
        </p>
      )}
      <figure
        className="chart-figure"
        aria-labelledby="drawdown-chart-title drawdown-chart-summary"
      >
        <div className="chart-head">
          <div>
            <h3 id="drawdown-chart-title">{title}</h3>
            <p id="drawdown-chart-summary" className="hint">
              {views.map(describe).join(" ")}
              {episode &&
                ` Shaded: ${primary.name} peak to ${episode.recoveryDate ? "recovery" : "effective end"}.`}
            </p>
          </div>
          {views.length > 1 && (
            <div className="chart-legend" aria-label="Series">
              {views.map((v) => (
                <span className="legend-item" key={v.key}>
                  <span
                    className="line-key"
                    style={{ background: v.color }}
                    aria-hidden
                  />
                  {v.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="chart-frame" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ ...chartMargin(narrow, 14), right: narrow ? 12 : 28 }}
            >
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                interval={0}
                tickFormatter={(d: string) => axisDate(d, unit)}
                tickLine={false}
                axisLine={{ stroke: CHART.axis }}
                tick={{ fill: CHART.tick, fontSize: 11 }}
              />
              <YAxis
                tickFormatter={axisPercent}
                domain={[yTicks.at(-1)!, 0]}
                ticks={yTicks}
                width={52}
                tickLine={false}
                axisLine={false}
                tick={{ fill: CHART.tick, fontSize: 11 }}
              />
              {episode && (
                <ReferenceArea
                  x1={episode.peakDate}
                  x2={episode.recoveryDate ?? lastDate}
                  fill="#1d4ed8"
                  fillOpacity={0.055}
                  stroke="none"
                />
              )}
              <ReferenceLine y={0} stroke={CHART.reference} />
              <Tooltip
                content={DrawdownTooltip}
                cursor={{
                  stroke: CHART.reference,
                  strokeWidth: 1,
                  strokeDasharray: "2 3",
                }}
                isAnimationActive={false}
              />
              {views.map((v) =>
                v === primary ? (
                  <Area
                    key={v.key}
                    dataKey={v.key}
                    name={v.name}
                    type="linear"
                    stroke={v.color}
                    strokeWidth={CHART.line}
                    fill={v.color}
                    fillOpacity={0.12}
                    baseValue={0}
                    activeDot={activeDot(v.color)}
                    isAnimationActive={!reduced}
                    animationDuration={CHART.animationMs}
                  />
                ) : (
                  <Line
                    key={v.key}
                    dataKey={v.key}
                    name={v.name}
                    type="linear"
                    stroke={v.color}
                    strokeWidth={CHART.lineSecondary}
                    dot={false}
                    activeDot={activeDot(v.color)}
                    isAnimationActive={!reduced}
                    animationDuration={CHART.animationMs}
                  />
                ),
              )}
              {episode && (
                <ReferenceDot
                  x={episode.peakDate}
                  y={0}
                  shape={<ExtremumMark color={CHART.tick} />}
                  label={
                    views.length === 1 && !narrow
                      ? {
                          value: "Peak",
                          position: "top",
                          fill: CHART.tick,
                          fontSize: 10,
                        }
                      : undefined
                  }
                />
              )}
              {episode && episode.recoveryDate && (
                <ReferenceDot
                  x={episode.recoveryDate}
                  y={0}
                  shape={<ExtremumMark color={CHART.positive} />}
                  label={
                    views.length === 1 && !narrow
                      ? {
                          value: "Recovered",
                          position: "top",
                          fill: CHART.positive,
                          fontSize: 10,
                        }
                      : undefined
                  }
                />
              )}
              {episode && (
                <ReferenceDot
                  x={episode.troughDate}
                  y={episode.depth}
                  r={4}
                  fill={primary.color}
                  stroke={CHART.surface}
                  strokeWidth={2}
                  label={
                    views.length === 1
                      ? {
                          value: `Max ${percent(episode.depth)}`,
                          position: "bottom",
                          fill: "#171717",
                          fontSize: 11,
                        }
                      : undefined
                  }
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <details className="chart-table">
          <summary>Data table · month-end drawdown</summary>
          <div className="table-wrap scroll-table">
            <table>
              <caption>
                Drawdown from running peak, last session of each month
              </caption>
              <thead>
                <tr>
                  <th>Date</th>
                  {views.map((v) => (
                    <th key={v.key}>
                      {views.length > 1 ? v.name : "Drawdown"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthEndRows(merged).map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    {views.map((v) => {
                      const x = row[v.key];
                      return (
                        <td key={v.key}>
                          {x === undefined
                            ? "—"
                            : x === 0
                              ? "0.00%"
                              : percent(x)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
      {primary.episodes.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>
              {primary.name} · deepest drawdown episodes ·{" "}
              {Math.min(5, primary.episodes.length)} of{" "}
              {primary.episodeCount.toLocaleString()} peak-to-recovery episodes
            </caption>
            <thead>
              <tr>
                <th>Depth</th>
                <th>Peak</th>
                <th>Trough</th>
                <th>Recovery</th>
                <th>Calendar days</th>
                <th>Trading days</th>
              </tr>
            </thead>
            <tbody>
              {primary.episodes.slice(0, 5).map((e) => (
                <tr key={e.peakDate}>
                  <td>{percent(e.depth)}</td>
                  <td>{e.peakDate}</td>
                  <td>{e.troughDate}</td>
                  <td>{e.recoveryDate ?? "Not recovered"}</td>
                  <td>
                    {e.recoveryDate
                      ? days(e.calendarDaysToRecovery)
                      : `${days(e.underwaterCalendarDays)}+`}
                  </td>
                  <td>
                    {e.recoveryDate
                      ? days(e.tradingDaysToRecovery)
                      : `${days(e.underwaterTradingDays)}+`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
