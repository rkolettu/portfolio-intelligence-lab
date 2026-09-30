"use client";
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
import type { StressPathPoint } from "@/lib/types/analytics";
import { axisTicks, monthEndRows, sessionTicks } from "@/lib/charts/series";
import {
  axisDate,
  axisDay,
  axisMoney,
  money,
  shortDate,
  signedMoney,
} from "@/lib/utils/format";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { activeDot, endLabel, ExtremumMark } from "@/components/charts/markers";
import {
  CHART,
  chartMargin,
  useNarrowChart,
  usePrefersReducedMotion,
} from "@/components/charts/theme";

function PathTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  const [first, second] = payload;
  return (
    <ChartTooltip
      date={shortDate(String(label))}
      rows={payload.map((p) => ({
        color: String(p.color),
        label: String(p.name),
        value: money(Number(p.value)),
      }))}
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
  const narrow = useNarrowChart();
  const withBenchmark = path[0].benchmark !== null;
  // Short events (e.g. COVID's 24 sessions) get session-spaced day ticks.
  const short = path.length < 70;
  const dates = path.map((p) => p.date);
  const { ticks: periodTicks, unit } = axisTicks(dates);
  const ticks = short ? sessionTicks(dates) : periodTicks;
  const last = path.at(-1)!;
  // Display-only: the deepest close of the portfolio path inside the event.
  const trough = path.reduce((lo, p) => (p.portfolio < lo.portfolio ? p : lo));
  const showTrough =
    trough.portfolio < 10_000 && trough !== path[0] && trough !== last;
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
            margin={chartMargin(narrow)}
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
            <ReferenceLine
              y={10_000}
              stroke={CHART.reference}
              strokeDasharray="3 4"
            />
            {showTrough && (
              <ReferenceDot
                x={trough.date}
                y={trough.portfolio}
                shape={<ExtremumMark color={CHART.negative} />}
                label={{
                  value: `Trough ${axisMoney(trough.portfolio)}`,
                  position: "bottom",
                  fill: CHART.negative,
                  fontSize: 10,
                }}
              />
            )}
            <Tooltip
              content={PathTooltip}
              cursor={{
                stroke: CHART.reference,
                strokeWidth: 1,
                strokeDasharray: "2 3",
              }}
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
              animationDuration={CHART.animationMs + 160}
              label={
                endLabel(
                      path.length - 1,
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
                name={benchmark}
                dataKey="benchmark"
                stroke={CHART.benchmark}
                strokeWidth={CHART.lineSecondary}
                dot={false}
                activeDot={activeDot(CHART.benchmark)}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs + 160}
                label={
                  endLabel(
                        path.length - 1,
                        benchmark,
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
