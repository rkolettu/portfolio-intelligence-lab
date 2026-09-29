"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import type { DrawdownPoint, PerformanceSummary } from "@/lib/types/analytics";
import {
  axisTicks,
  downsample,
  drawdownTicks,
  monthEndRows,
} from "@/lib/charts/series";
import { axisDate, axisPercent, percent, shortDate } from "@/lib/utils/format";
import { CHART, usePrefersReducedMotion } from "@/components/charts/theme";
import { InfoTip } from "@/components/metrics/InfoTip";

const MAX_POINTS = 640;

function DrawdownTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p>{shortDate(String(label))}</p>
      <div className="tooltip-row">
        <span
          className="line-key"
          style={{ background: CHART.portfolio }}
          aria-hidden
        />
        <strong>{percent(Number(payload[0].value))}</strong>
        <span>below running peak</span>
      </div>
    </div>
  );
}

const days = (n: number | null) => (n === null ? "—" : n.toLocaleString());

export function DrawdownLab({
  performance,
}: {
  performance: PerformanceSummary;
}) {
  const reduced = usePrefersReducedMotion();
  const episode = performance.maximumDrawdownEpisode;
  const annotated = new Set(
    episode
      ? [episode.peakDate, episode.troughDate, episode.recoveryDate].filter(
          Boolean,
        )
      : [],
  );
  const data = downsample<DrawdownPoint>(
    performance.drawdown,
    MAX_POINTS,
    (d) => [d.drawdown],
    (d) => annotated.has(d.date),
  );
  const { ticks, unit } = axisTicks(data.map((d) => d.date));
  const last = performance.drawdown.at(-1)!;
  const mdd = performance.risk.maximumDrawdown;
  const current = performance.currentDrawdown;
  const yTicks = drawdownTicks(mdd.available ? mdd.value : 0);
  const stats: { label: string; value: string; tip?: string }[] = [
    {
      label: "Maximum drawdown",
      value: mdd.available ? percent(mdd.value) : "N/A",
      tip: "min over dates of wealth ÷ running peak − 1, on compounded daily-close wealth (initial $10,000 counts as a peak). Intraday losses can be larger.",
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
      tip: "Peak → recovery in completed NYSE sessions.",
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
      <dl className="drawdown-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>
              {s.label}
              {s.tip && <InfoTip label={s.label}>{s.tip}</InfoTip>}
            </dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      {episode && episode.recoveryDate === null && (
        <p className="hint">
          Still underwater from the {episode.peakDate} peak:{" "}
          {episode.underwaterCalendarDays.toLocaleString()} calendar days and{" "}
          {episode.underwaterTradingDays.toLocaleString()} sessions through{" "}
          {last.date}. Recovery after the effective end is not reported.
        </p>
      )}
      <figure
        className="chart-figure"
        aria-labelledby="drawdown-chart-title drawdown-chart-summary"
      >
        <div className="chart-head">
          <div>
            <h3 id="drawdown-chart-title">Portfolio drawdown</h3>
            <p id="drawdown-chart-summary" className="hint">
              {episode
                ? `Deepest decline ${percent(episode.depth)} from ${shortDate(episode.peakDate)} to ${shortDate(episode.troughDate)}; ${
                    episode.recoveryDate
                      ? `recovered ${shortDate(episode.recoveryDate)}`
                      : "not recovered"
                  }. Shaded: peak to ${episode.recoveryDate ? "recovery" : "effective end"}.`
                : "No drawdown: wealth never closed below a prior peak."}
            </p>
          </div>
        </div>
        <div className="chart-frame" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 24, bottom: 4, left: 4 }}
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
                  x2={episode.recoveryDate ?? last.date}
                  fill={CHART.reference}
                  fillOpacity={0.12}
                  stroke="none"
                />
              )}
              <ReferenceLine y={0} stroke={CHART.axis} />
              <Tooltip
                content={DrawdownTooltip}
                cursor={{ stroke: CHART.reference, strokeWidth: 1 }}
                isAnimationActive={false}
              />
              <Area
                dataKey="drawdown"
                name="Drawdown"
                type="linear"
                stroke={CHART.portfolio}
                strokeWidth={2}
                fill={CHART.portfolio}
                fillOpacity={0.1}
                baseValue={0}
                activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                isAnimationActive={!reduced}
                animationDuration={CHART.animationMs}
              />
              {episode && (
                <ReferenceDot
                  x={episode.troughDate}
                  y={episode.depth}
                  r={4}
                  fill={CHART.portfolio}
                  stroke={CHART.surface}
                  strokeWidth={2}
                  label={{
                    value: `Max ${percent(episode.depth)}`,
                    position: "bottom",
                    fill: "#f4f1ea",
                    fontSize: 11,
                  }}
                />
              )}
            </AreaChart>
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
                  <th>Drawdown</th>
                </tr>
              </thead>
              <tbody>
                {monthEndRows(performance.drawdown).map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>
                      {row.drawdown === 0 ? "0.00%" : percent(row.drawdown)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
      {performance.episodes.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>
              Deepest drawdown episodes ·{" "}
              {Math.min(5, performance.episodes.length)} of{" "}
              {performance.episodeCount.toLocaleString()} peak-to-recovery
              episodes
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
              {performance.episodes.slice(0, 5).map((e) => (
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
