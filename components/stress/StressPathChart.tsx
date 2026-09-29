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
import type { StressPathPoint } from "@/lib/types/analytics";
import { axisTicks, monthEndRows, sessionTicks } from "@/lib/charts/series";
import {
  axisDate,
  axisDay,
  axisMoney,
  money,
  shortDate,
} from "@/lib/utils/format";
import { CHART, usePrefersReducedMotion } from "@/components/charts/theme";

function PathTooltip({
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

/** Wealth from $10,000 at the event start close; every value precomputed. */
export function StressPathChart({
  id,
  path,
  benchmark,
}: {
  id: string;
  path: StressPathPoint[];
  benchmark: string;
}) {
  const reduced = usePrefersReducedMotion();
  const withBenchmark = path[0].benchmark !== null;
  // Short events (e.g. COVID's 24 sessions) get session-spaced day ticks.
  const short = path.length < 70;
  const dates = path.map((p) => p.date);
  const { ticks: periodTicks, unit } = axisTicks(dates);
  const ticks = short ? sessionTicks(dates) : periodTicks;
  const last = path.at(-1)!;
  const rows = path.length > 260 ? monthEndRows(path) : path;
  const summary = `From ${shortDate(path[0].date)} to ${shortDate(last.date)}: portfolio ${money(last.portfolio)}${
    last.benchmark !== null ? `, ${benchmark} ${money(last.benchmark)}` : ""
  }.`;
  return (
    <figure
      className="chart-figure"
      aria-labelledby={`${id}-path-title ${id}-path-summary`}
    >
      <div className="chart-head">
        <div>
          <h3 id={`${id}-path-title`}>Growth of $10,000 through the event</h3>
          <p id={`${id}-path-summary`} className="hint">
            {summary}
          </p>
        </div>
        <div className="chart-legend" aria-label="Series">
          <span className="legend-item">
            <span
              className="line-key"
              style={{ background: CHART.portfolio }}
              aria-hidden
            />
            Portfolio
          </span>
          {withBenchmark && (
            <span className="legend-item">
              <span
                className="line-key"
                style={{ background: CHART.benchmark }}
                aria-hidden
              />
              {benchmark}
            </span>
          )}
        </div>
      </div>
      <div className="chart-frame" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={path}
            margin={{ top: 12, right: 112, bottom: 4, left: 4 }}
          >
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              interval="preserveStartEnd"
              minTickGap={12}
              tickFormatter={(d: string) =>
                short ? axisDay(d) : axisDate(d, unit)
              }
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
              content={PathTooltip}
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
              label={endLabel(path.length - 1, "Portfolio", CHART.portfolio)}
            />
            {withBenchmark && (
              <Line
                name={benchmark}
                dataKey="benchmark"
                stroke={CHART.benchmark}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs}
                label={endLabel(path.length - 1, benchmark, CHART.benchmark)}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-table">
        <summary>
          Data table · {rows === path ? "daily" : "month-end"} values
        </summary>
        <div className="table-wrap scroll-table">
          <table>
            <caption>
              Growth of $10,000 from the event start close
              {rows === path ? "" : ", last session of each month"}
            </caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Portfolio</th>
                {withBenchmark && <th>{benchmark}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
