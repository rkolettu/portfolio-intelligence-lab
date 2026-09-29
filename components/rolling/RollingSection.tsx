"use client";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  shortDate,
  unsignedPercent,
} from "@/lib/utils/format";
import { CHART, usePrefersReducedMotion } from "@/components/charts/theme";

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
    active === "volatility" ? axisPercent : (v: number) => v.toFixed(1);
  return (
    <>
      <div className="series-control">
        <fieldset className="segmented">
          <legend className="sr-only">Rolling statistic</legend>
          {metrics.map((o) => (
            <label
              key={o.value}
              className={active === o.value ? "selected" : undefined}
            >
              <input
                type="radio"
                name="rolling-metric"
                value={o.value}
                checked={active === o.value}
                disabled={o.value !== "volatility" && !relativeOk}
                onChange={() => setMetric(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="segmented">
          <legend className="sr-only">Window</legend>
          {rolling.windows.map((n) => (
            <label key={n} className={window === n ? "selected" : undefined}>
              <input
                type="radio"
                name="rolling-window"
                value={n}
                checked={window === n}
                onChange={() => setWindow(n)}
              />
              {n}D
            </label>
          ))}
        </fieldset>
        {!rolling.beta.available && (
          <span className="hint">
            Rolling beta and correlation unavailable: {rolling.beta.reason}
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
              margin={{ top: 12, right: 112, bottom: 4, left: 4 }}
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
              {reference !== null && (
                <ReferenceLine
                  y={reference}
                  stroke={CHART.reference}
                  label={{
                    value: `Full period ${selected.format(reference)}`,
                    position: "right",
                    fill: CHART.tick,
                    fontSize: 11,
                  }}
                />
              )}
              <Tooltip
                content={(
                  props: TooltipContentProps<TooltipValueType, string | number>,
                ) =>
                  props.active && props.payload?.length ? (
                    <div className="chart-tooltip">
                      <p>{shortDate(String(props.label))}</p>
                      <div className="tooltip-row">
                        <span
                          className="line-key"
                          style={{ background: CHART.portfolio }}
                          aria-hidden
                        />
                        <strong>
                          {selected.format(Number(props.payload[0].value))}
                        </strong>
                        <span>{window}-session window ending this close</span>
                      </div>
                    </div>
                  ) : null
                }
                cursor={{ stroke: CHART.reference, strokeWidth: 1 }}
                isAnimationActive={false}
              />
              <Line
                name={title}
                dataKey="value"
                stroke={CHART.portfolio}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
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
