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
  type LabelProps,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type { BacktestResult } from "@/lib/types/analytics";
import {
  axisTicks,
  downsample,
  growthData,
  monthEndRows,
  type GrowthDatum,
} from "@/lib/charts/series";
import { axisDate, axisMoney, money, shortDate } from "@/lib/utils/format";
import { CHART, usePrefersReducedMotion } from "./theme";

const MAX_POINTS = 640;

function GrowthTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p>{shortDate(String(label))}</p>
      {payload.map((p) => (
        <div className="tooltip-row" key={String(p.dataKey)}>
          <span
            className="line-key"
            style={{ background: p.color }}
            aria-hidden
          />
          <strong>{money(Number(p.value))}</strong>
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}

const endLabel = (lastIndex: number, name: string, color: string) =>
  function EndLabel({ x, y, index, value }: LabelProps) {
    if (index !== lastIndex || x === undefined || y === undefined) return <g />;
    return (
      <g>
        <circle
          cx={Number(x)}
          cy={Number(y)}
          r={4}
          fill={color}
          stroke={CHART.surface}
          strokeWidth={2}
        />
        <text x={Number(x) + 9} y={Number(y) + 4} className="end-label">
          {name} {axisMoney(Number(value))}
        </text>
      </g>
    );
  };

export function GrowthChart({ result }: { result: BacktestResult }) {
  const reduced = usePrefersReducedMotion();
  const benchmarkOk = result.benchmark.ok;
  const [compare, setCompare] = useState(benchmarkOk);
  const withBenchmark = compare && benchmarkOk;
  const full = growthData(result, withBenchmark);
  const data = downsample<GrowthDatum>(full, MAX_POINTS, (d) =>
    d.benchmark === undefined ? [d.portfolio] : [d.portfolio, d.benchmark],
  );
  const { ticks, unit } = axisTicks(data.map((d) => d.date));
  const first = full[0];
  const last = full.at(-1)!;
  const ticker = result.config.benchmark;
  const shortened = withBenchmark && first.date !== result.initialDate;
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
          Benchmark path unavailable: {result.benchmark.error.message}
        </p>
      )}
      <div className="chart-frame" style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 12, right: 112, bottom: 4, left: 4 }}
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
              tickFormatter={axisMoney}
              domain={["auto", "auto"]}
              width={60}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHART.tick, fontSize: 11 }}
            />
            <ReferenceLine y={10_000} stroke={CHART.reference} />
            <Tooltip
              content={GrowthTooltip}
              cursor={{ stroke: CHART.reference, strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              name="Portfolio"
              dataKey="portfolio"
              stroke={CHART.portfolio}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={endLabel(data.length - 1, "Portfolio", CHART.portfolio)}
            />
            {withBenchmark && (
              <Line
                name={ticker}
                dataKey="benchmark"
                stroke={CHART.benchmark}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs}
                label={endLabel(data.length - 1, ticker, CHART.benchmark)}
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
