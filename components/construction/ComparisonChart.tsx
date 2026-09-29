"use client";
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
import type { WealthPoint } from "@/lib/types/analytics";
import { axisTicks, sessionTicks, downsample, monthEndRows } from "@/lib/charts/series";
import { axisDate, axisDay, axisMoney, money, shortDate } from "@/lib/utils/format";
import { CHART, usePrefersReducedMotion } from "@/components/charts/theme";

type Row = { date: string; current: number; proposed: number };

function RowTooltip({
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

const endLabel = (last: number, name: string, color: string, dy = 4) =>
  function EndLabel({ x, y, index, value }: LabelProps) {
    if (index !== last || x === undefined || y === undefined) return <g />;
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
        <text x={Number(x) + 9} y={Number(y) + dy} className="end-label">
          {name} {axisMoney(Number(value))}
        </text>
      </g>
    );
  };

/** Growth of $10,000 for Current and Proposed targets, both re-initialized on the
 * same start. Values are precomputed by the unchanged simulation engine. */
export function ComparisonChart({
  current,
  proposed,
  label,
}: {
  current: WealthPoint[];
  proposed: WealthPoint[];
  label: string;
}) {
  const reduced = usePrefersReducedMotion();
  const full: Row[] = current.map((c, i) => ({
    date: c.date,
    current: c.wealth,
    proposed: proposed[i].wealth,
  }));
  const data = downsample(full, 640, (r) => [r.current, r.proposed]);
  const dates = data.map((d) => d.date);
  const short = full.length < 70;
  const { ticks: periodTicks, unit } = axisTicks(dates);
  const ticks = short ? sessionTicks(dates) : periodTicks;
  const last = full.at(-1)!;
  return (
    <figure
      className="chart-figure"
      aria-labelledby="construction-chart-title construction-chart-summary"
    >
      <div className="chart-head">
        <div>
          <h3 id="construction-chart-title">
            Growth of $10,000 · Current vs Proposed
          </h3>
          <p id="construction-chart-summary" className="hint">
            From {shortDate(full[0].date)} to {shortDate(last.date)}: current{" "}
            {money(last.current)}, proposed ({label}) {money(last.proposed)}.
            Both start at target weights on the same date.
          </p>
        </div>
        <div className="chart-legend" aria-label="Series">
          <span className="legend-item">
            <span
              className="line-key"
              style={{ background: CHART.portfolio }}
              aria-hidden
            />
            Current
          </span>
          <span className="legend-item">
            <span
              className="line-key"
              style={{ background: CHART.proposed }}
              aria-hidden
            />
            Proposed
          </span>
        </div>
      </div>
      <div className="chart-frame" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 24, right: 112, bottom: 4, left: 4 }}
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
            <ReferenceLine y={10_000} stroke={CHART.reference} />
            <Tooltip
              content={RowTooltip}
              cursor={{ stroke: CHART.reference, strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              name="Current"
              dataKey="current"
              stroke={CHART.portfolio}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={endLabel(data.length - 1, "Current", CHART.portfolio, last.current >= last.proposed ? -7 : 17)}
            />
            <Line
              name="Proposed"
              dataKey="proposed"
              stroke={CHART.proposed}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={endLabel(data.length - 1, "Proposed", CHART.proposed, last.current >= last.proposed ? 17 : -7)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-table">
        <summary>Data table · month-end values</summary>
        <div className="table-wrap scroll-table">
          <table>
            <caption>
              Growth of $10,000, current vs proposed, last session of each month
            </caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Current</th>
                <th>Proposed</th>
              </tr>
            </thead>
            <tbody>
              {monthEndRows(full).map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{money(r.current)}</td>
                  <td>{money(r.proposed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
