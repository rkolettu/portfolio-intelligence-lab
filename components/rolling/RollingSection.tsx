"use client";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  Metric,
  PerformanceSummary,
  RollingAnalytics,
} from "@/lib/types/analytics";
import { axisTicks, monthEndRows } from "@/lib/charts/series";
import {
  rollingDisplayData,
  rollingDomain,
  rollingGaps,
  type RollingMetricKey,
} from "@/lib/charts/rolling";
import {
  axisDate,
  axisPercent,
  decimal,
  fixed,
  shortDate,
  unsignedPercent,
} from "@/lib/utils/format";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { activeDot, ExtremumMark } from "@/components/charts/markers";
import {
  CHART,
  chartMargin,
  useNarrowChart,
  usePrefersReducedMotion,
} from "@/components/charts/theme";
import { Segmented } from "@/components/ui/Segmented";

const MAX_POINTS = 640;

/** Rolling volatility, beta and correlation: one chart, two segmented controls.
 * Every value is precomputed server-side; this component selects and formats. */
export function RollingSection({
  rolling,
  performance,
  benchmark,
}: {
  rolling: RollingAnalytics;
  performance: PerformanceSummary;
  benchmark: BenchmarkAnalytics;
}) {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrowChart();
  const [hover, setHover] = useState<string | null>(null);
  const ticker = rolling.benchmarkTicker;
  const [metric, setMetric] = useState<RollingMetricKey>("volatility");
  const [window, setWindow] = useState(rolling.defaultWindow);
  const relativeOk = rolling.beta.available && rolling.correlation.available;
  const active: RollingMetricKey = relativeOk ? metric : "volatility";
  const info: Record<
    RollingMetricKey,
    { label: string; reference: Metric; format: (v: number) => string }
  > = {
    volatility: {
      label: "volatility",
      reference: performance.risk.volatility,
      format: unsignedPercent,
    },
    beta: {
      label: `beta vs ${ticker}`,
      reference: benchmark.relative.beta,
      format: decimal,
    },
    correlation: {
      label: `correlation vs ${ticker}`,
      reference: benchmark.relative.correlation,
      format: decimal,
    },
  };
  const selected = info[active];
  const source = rolling[active];
  const k = Math.max(0, rolling.windows.indexOf(window));
  const values = source.available ? source.series[k].values : [];
  const s = source.available ? source.series[k] : null;
  const reference = selected.reference.available
    ? selected.reference.value
    : null;
  const data = rollingDisplayData(rolling.dates, values, MAX_POINTS);
  const { ticks, unit } = axisTicks(data.map((d) => d.date));
  const y = rollingDomain(active, values, reference);
  const gaps = rollingGaps(values);
  const lastIndex = values.findLastIndex((v) => v !== null);
  // Moving-window marker: the hovered close and the window of returns ending on it.
  const hoverIndex = hover === null ? -1 : rolling.dates.indexOf(hover);
  const windowStart =
    hoverIndex >= 0
      ? rolling.dates[Math.max(0, hoverIndex - window + 1)]
      : null;
  const shownStart =
    windowStart === null
      ? null
      : (data.find((d) => d.date >= windowStart)?.date ?? null);
  const title = `${window}-session rolling ${selected.label}`;
  const returnsLabel =
    active === "volatility"
      ? "consecutive session returns"
      : `consecutive session returns with ${ticker} prices at both ends`;
  const summary = [
    s?.firstDate
      ? `No value before ${s.firstDate}: the first ${window} ${returnsLabel} end there.`
      : `No ${window}-session window is complete in this sample (${rolling.dates.length.toLocaleString()} returns).`,
    lastIndex >= 0
      ? `Latest ${selected.format(values[lastIndex]!)} on ${rolling.dates[lastIndex]}.`
      : "",
    reference !== null
      ? `Full period ${selected.format(reference)}${active === "volatility" ? " realized" : " on the aligned sample"}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const metrics: { value: RollingMetricKey; label: string }[] = [
    { value: "volatility", label: "Volatility" },
    { value: "beta", label: `Beta vs ${ticker}` },
    { value: "correlation", label: `Correlation vs ${ticker}` },
  ];
  const format =
    active === "volatility" ? axisPercent : (v: number) => fixed(v, 1);
  return (
    <>
      <div className="series-control">
        <Segmented
          legend="Rolling statistic"
          name="rolling-metric"
          options={metrics.map((o) => ({
            ...o,
            disabled: o.value !== "volatility" && !relativeOk,
          }))}
          value={active}
          onChange={setMetric}
        />
        <Segmented
          legend="Window"
          name="rolling-window"
          options={rolling.windows.map((n) => ({ value: n, label: `${n}D` }))}
          value={window}
          onChange={setWindow}
        />
        {!rolling.beta.available && (
          <span className="hint">
            Benchmark Data Unavailable for rolling beta and correlation:{" "}
            {rolling.beta.reason}
          </span>
        )}
      </div>
      <figure
        className="chart-figure"
        aria-labelledby="rolling-chart-title rolling-chart-summary"
      >
        <div className="chart-head">
          <div>
            <h3 id="rolling-chart-title">{title}</h3>
            <p id="rolling-chart-summary" className="hint">
              {summary}
            </p>
          </div>
        </div>
        {gaps.interior > 0 && s && (
          <p className="hint chart-note">
            {gaps.interior.toLocaleString()} later{" "}
            {gaps.interior === 1 ? "date has" : "dates have"} no value:{" "}
            {s.undefinedCount > 0 ? `${s.undefinedReasons.join(" ")} ` : ""}
            {gaps.interior > s.undefinedCount
              ? `Windows touching a session without a ${ticker} price are left blank, never compressed.`
              : ""}
          </p>
        )}
        <div className="chart-frame" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={chartMargin(narrow, 14)}
              onMouseMove={(state) =>
                setHover(
                  state.isTooltipActive && state.activeLabel !== undefined
                    ? String(state.activeLabel)
                    : null,
                )
              }
              onMouseLeave={() => setHover(null)}
            >
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                interval="preserveStartEnd"
                minTickGap={12}
                tickFormatter={(d: string) => axisDate(d, unit)}
                tickLine={false}
                axisLine={{ stroke: CHART.axis }}
                tick={{ fill: CHART.tick, fontSize: 11 }}
              />
              <YAxis
                domain={y.domain}
                ticks={y.ticks}
                tickFormatter={format}
                width={52}
                tickLine={false}
                axisLine={false}
                tick={{ fill: CHART.tick, fontSize: 11 }}
              />
              {active !== "volatility" && (
                <ReferenceLine y={0} stroke={CHART.axis} />
              )}
              {shownStart && hover && (
                <ReferenceArea
                  x1={shownStart}
                  x2={hover}
                  fill={CHART.portfolio}
                  fillOpacity={0.1}
                  stroke={CHART.portfolio}
                  strokeOpacity={0.35}
                  strokeDasharray="3 3"
                  ifOverflow="hidden"
                />
              )}
              {reference !== null && (
                <ReferenceLine
                  y={reference}
                  stroke={CHART.reference}
                  strokeDasharray="3 4"
                  label={
                    narrow
                      ? undefined
                      : {
                          value: `Full period ${selected.format(reference)}`,
                          position: "right",
                          fill: CHART.tick,
                          fontSize: 11,
                        }
                  }
                />
              )}
              {lastIndex >= 0 && (
                <ReferenceDot
                  x={rolling.dates[lastIndex]}
                  y={values[lastIndex]!}
                  shape={<ExtremumMark color={CHART.portfolio} />}
                />
              )}
              <Tooltip
                content={(
                  props: TooltipContentProps<TooltipValueType, string | number>,
                ) =>
                  props.active && props.payload?.length ? (
                    <ChartTooltip
                      date={shortDate(String(props.label))}
                      rows={[
                        {
                          color: CHART.portfolio,
                          label: `${window}-session ${selected.label}`,
                          sub: "window ending this close",
                          value: selected.format(Number(props.payload[0].value)),
                        },
                      ]}
                    />
                  ) : null
                }
                cursor={{
                  stroke: CHART.reference,
                  strokeWidth: 1,
                  strokeDasharray: "2 3",
                }}
                isAnimationActive={false}
              />
              <Line
                name={title}
                dataKey="value"
                stroke={CHART.portfolio}
                strokeWidth={CHART.line}
                dot={false}
                connectNulls={false}
                activeDot={activeDot(CHART.portfolio)}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="chart-table">
          <summary>Data table · month-end values</summary>
          <div className="table-wrap scroll-table">
            <table>
              <caption>{title}, last session of each month</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {monthEndRows(
                  rolling.dates.map((date, i) => ({ date, value: values[i] })),
                ).map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>
                      {row.value === null ? "—" : selected.format(row.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
      <p className="hint">
        Each point uses the {window} daily returns ending that close ({window} +
        1 closes) and appears only when all {window} are consecutive scheduled
        sessions
        {active === "volatility" ? "" : ` with ${ticker} prices at both ends`}.
        {active === "volatility"
          ? " Realized volatility of the drifting portfolio (CASH accrual included): sample standard deviation × √252."
          : " Beta and correlation use raw daily arithmetic returns on the benchmark-aligned intervals."}{" "}
        Short windows are noisy; they describe the past, not a forecast.
      </p>
    </>
  );
}
