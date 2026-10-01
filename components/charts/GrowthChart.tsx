"use client";
import { useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type { BacktestResult } from "@/lib/types/analytics";
import {
  axisTicks,
  sessionTicks,
  downsample,
  growthData,
  monthEndRows,
  type GrowthDatum,
} from "@/lib/charts/series";
import {
  axisDate,
  axisDay,
  axisMoney,
  money,
  shortDate,
  signedMoney,
} from "@/lib/utils/format";
import { ChartTooltip } from "./ChartTooltip";
import { LensCursor } from "./Lens";
import { activeDot, endLabel, ExtremumMark } from "./markers";
import {
  CHART,
  chartMargin,
  useNarrowChart,
  usePrefersReducedMotion,
} from "./theme";

const MAX_POINTS = 640;

function GrowthTooltip({
  active,
  payload,
  label,
  drawdown,
}: TooltipContentProps<TooltipValueType, string | number> & {
  drawdown?: Map<string, number>;
}) {
  if (!active || !payload?.length) return null;
  const [first, second] = payload;
  const dd = drawdown?.get(String(label));
  return (
    <ChartTooltip
      date={shortDate(String(label))}
      rows={[
        ...payload.map((p) => ({
          color: String(p.color),
          label: String(p.name),
          value: money(Number(p.value)),
        })),
        ...(dd !== undefined
          ? [
              {
                color: "transparent",
                label: "Portfolio drawdown",
                value: dd === 0 ? "At peak" : `${(dd * 100).toFixed(2)}%`,
              },
            ]
          : []),
      ]}
      foot={
        second && (
          <div className="tt-foot">
            <span>
              {String(first.name)} − {String(second.name)}
            </span>
            <strong>{signedMoney(Number(first.value) - Number(second.value))}</strong>
          </div>
        )
      }
    />
  );
}

export function GrowthChart({
  result,
  height = 330,
}: {
  result: BacktestResult;
  /** Plot height; the Overview uses a compact chart. */
  height?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrowChart();
  const benchmarkOk = result.benchmark.ok;
  const [compare, setCompare] = useState(benchmarkOk);
  const withBenchmark = compare && benchmarkOk;
  const drawdown = useMemo(
    () => new Map(result.performance.drawdown.map((d) => [d.date, d.drawdown])),
    [result.performance.drawdown],
  );
  const full = growthData(result, withBenchmark);
  const data = downsample<GrowthDatum>(full, MAX_POINTS, (d) =>
    d.benchmark === undefined ? [d.portfolio] : [d.portfolio, d.benchmark],
  );
  const dates = data.map((d) => d.date);
  const short = full.length < 70;
  const { ticks: periodTicks, unit } = axisTicks(dates);
  const ticks = short ? sessionTicks(dates) : periodTicks;
  const first = full[0];
  const last = full.at(-1)!;
  const ticker = result.config.benchmark;
  const shortened = withBenchmark && first.date !== result.initialDate;
  // Display-only extremes of the plotted portfolio path; drawn only when they sit
  // clear of the line's ends, where the start point and end label already speak.
  let high = full[0];
  let low = full[0];
  for (const d of full) {
    if (d.portfolio > high.portfolio) high = d;
    if (d.portfolio < low.portfolio) low = d;
  }
  const clear = (d: GrowthDatum) => {
    const at = full.indexOf(d) / (full.length - 1);
    return at > 0.05 && at < 0.93;
  };
  const showHigh = full.length > 20 && clear(high) && high.portfolio > 10_000;
  const showLow = full.length > 20 && clear(low) && low.portfolio < 10_000;
  const summary = `Growth of $10,000 from ${shortDate(first.date)} to ${shortDate(last.date)}: portfolio ${money(last.portfolio)}${
    last.benchmark !== undefined ? `, ${ticker} ${money(last.benchmark)}` : ""
  }.`;
  return (
    <figure
      className="chart-figure"
      aria-labelledby="growth-title growth-summary"
    >
      <div className="chart-head">
        <div>
          <h3 id="growth-title">Growth of $10,000</h3>
          <p id="growth-summary" className="hint">
            {summary}
          </p>
        </div>
        <div className="chart-legend" role="group" aria-label="Series">
          <span className="legend-item">
            <span
              className="line-key"
              style={{ background: CHART.portfolio }}
              aria-hidden
            />
            Portfolio
          </span>
          <label
            className={`legend-item legend-toggle${benchmarkOk ? "" : " disabled"}`}
            style={{ "--key": CHART.benchmark } as CSSProperties}
          >
            <input
              type="checkbox"
              checked={withBenchmark}
              disabled={!benchmarkOk}
              onChange={(e) => setCompare(e.target.checked)}
            />
            <span
              className="line-key"
              style={{ background: CHART.benchmark }}
              aria-hidden
            />
            {ticker} benchmark
          </label>
        </div>
      </div>
      {shortened && (
        <p className="hint chart-note">
          Comparison window starts {first.date}, the first date of continuous{" "}
          {ticker} coverage; both series are normalized to $10,000 there. Clear
          the benchmark to see the full portfolio history.
        </p>
      )}
      {!benchmarkOk && (
        <p className="hint chart-note">
          Benchmark Data Unavailable: {result.benchmark.error.message}
        </p>
      )}
      <div className="chart-frame" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={chartMargin(narrow)}
          >
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              interval="preserveStartEnd"
              minTickGap={12}
              tickFormatter={(d: string) => short ? axisDay(d) : axisDate(d, unit)}
              tickLine={false}
              axisLine={{ stroke: CHART.axis }}
              tick={{ fill: CHART.tick, fontSize: 11 }}
            />
            <YAxis
              tickFormatter={axisMoney}
              domain={["auto", "auto"]}
              width={60}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHART.tick, fontSize: 11 }}
            />
            <ReferenceLine
              y={10_000}
              stroke={CHART.reference}
              strokeDasharray="3 4"
            />
            {showHigh && (
              <ReferenceDot
                x={high.date}
                y={high.portfolio}
                shape={<ExtremumMark color={CHART.portfolio} />}
                label={{
                  value: `High ${axisMoney(high.portfolio)}`,
                  position: "top",
                  fill: CHART.tick,
                  fontSize: 10,
                }}
              />
            )}
            {showLow && (
              <ReferenceDot
                x={low.date}
                y={low.portfolio}
                shape={<ExtremumMark color={CHART.portfolio} />}
                label={{
                  value: `Low ${axisMoney(low.portfolio)}`,
                  position: "bottom",
                  fill: CHART.tick,
                  fontSize: 10,
                }}
              />
            )}
            <Tooltip
              content={(props) => <GrowthTooltip {...props} drawdown={drawdown} />}
              cursor={<LensCursor />}
              isAnimationActive={false}
            />
            <Line
              name="Portfolio"
              dataKey="portfolio"
              stroke={CHART.portfolio}
              strokeWidth={CHART.line}
              dot={false}
              activeDot={activeDot(CHART.portfolio)}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={
                endLabel(
                      data.length - 1,
                      "Portfolio",
                      CHART.portfolio,
                      withBenchmark
                        ? last.portfolio >= last.benchmark!
                          ? -7
                          : 17
                        : 4,
                    )
              }
            />
            {withBenchmark && (
              <Line
                name={ticker}
                dataKey="benchmark"
                stroke={CHART.benchmark}
                strokeWidth={CHART.lineSecondary}
                dot={false}
                activeDot={activeDot(CHART.benchmark)}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs}
                label={
                  endLabel(
                        data.length - 1,
                        ticker,
                        CHART.benchmark,
                        last.portfolio >= last.benchmark! ? 17 : -7,
                      )
                }
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-table">
        <summary>Data table · month-end values</summary>
        <div className="table-wrap scroll-table">
          <table>
            <caption>Growth of $10,000, last session of each month</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Portfolio</th>
                {withBenchmark && <th>{ticker}</th>}
              </tr>
            </thead>
            <tbody>
              {monthEndRows(full).map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{money(row.portfolio)}</td>
                  {withBenchmark && <td>{money(row.benchmark!)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
