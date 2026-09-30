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
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type { WealthPoint } from "@/lib/types/analytics";
import {
  axisTicks,
  sessionTicks,
  downsample,
  monthEndRows,
} from "@/lib/charts/series";
import {
  axisDate,
  axisDay,
  axisMoney,
  money,
  shortDate,
  signedMoney,
} from "@/lib/utils/format";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { activeDot, endLabel } from "@/components/charts/markers";
import {
  CHART,
  chartMargin,
  useNarrowChart,
  usePrefersReducedMotion,
} from "@/components/charts/theme";

type Row = { date: string; current: number; proposed: number };

function RowTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === "current");
  const proposed = payload.find((p) => p.dataKey === "proposed");
  return (
    <ChartTooltip
      date={shortDate(String(label))}
      rows={payload.map((p) => ({
        color: String(p.color),
        label: String(p.name),
        value: money(Number(p.value)),
      }))}
      foot={
        current &&
        proposed && (
          <div className="tt-foot">
            <span>Proposed − Current</span>
            <strong>
              {signedMoney(Number(proposed.value) - Number(current.value))}
            </strong>
          </div>
        )
      }
    />
  );
}

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
  const narrow = useNarrowChart();
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
          <LineChart data={data} margin={chartMargin(narrow)}>
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
            <ReferenceLine
              y={10_000}
              stroke={CHART.reference}
              strokeDasharray="3 4"
            />
            <Tooltip
              content={RowTooltip}
              cursor={{
                stroke: CHART.reference,
                strokeWidth: 1,
                strokeDasharray: "2 3",
              }}
              isAnimationActive={false}
            />
            <Line
              name="Current"
              dataKey="current"
              stroke={CHART.portfolio}
              strokeWidth={CHART.lineSecondary}
              dot={false}
              activeDot={activeDot(CHART.portfolio)}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={
                endLabel(
                      data.length - 1,
                      "Current",
                      CHART.portfolio,
                      last.current >= last.proposed ? -7 : 17,
                    )
              }
            />
            <Line
              name="Proposed"
              dataKey="proposed"
              stroke={CHART.proposed}
              strokeWidth={CHART.line}
              dot={false}
              activeDot={activeDot(CHART.proposed)}
              isAnimationActive={!reduced}
              animationDuration={CHART.animationMs}
              label={
                endLabel(
                      data.length - 1,
                      "Proposed",
                      CHART.proposed,
                      last.current >= last.proposed ? 17 : -7,
                    )
              }
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
