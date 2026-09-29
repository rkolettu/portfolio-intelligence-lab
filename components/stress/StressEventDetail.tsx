"use client";
import type { StressTestResult } from "@/lib/types/analytics";
import { percent, percentagePoints, unsignedPercent } from "@/lib/utils/format";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { StressHoldingBars } from "./StressHoldingBars";
import { StressPathChart } from "./StressPathChart";

const INCOMPLETE =
  "This stress result cannot be calculated accurately because one or more holdings lack sufficient historical data during the selected period.";

/** One event: metrics, path and holding returns, or the reason none are shown. */
export function StressEventDetail({
  event: e,
  benchmark,
  showName = true,
}: {
  event: StressTestResult;
  benchmark: string;
  showName?: boolean;
}) {
  const span =
    e.startDate && e.endDate
      ? `${e.startDate} close → ${e.endDate} close`
      : `${e.requestedStartDate} → ${e.requestedEndDate}`;
  return (
    <div className="stress-detail">
      {showName && <h3 className="stress-name">{e.name}</h3>}
      <p className="hint">
        {e.description} {span}
        {e.status === "complete" &&
          ` · ${e.sample.returnCount.toLocaleString()} daily returns; the first ends ${e.firstReturnDate}.`}
      </p>
      {e.notes.map((n) => (
        <p className="hint" key={n}>
          {n}
        </p>
      ))}
      {e.status === "unavailable" && (
        <p className="status-notice tone-warning" role="status">
          Stress result unavailable: {e.reason}
        </p>
      )}
      {e.status === "incomplete_coverage" && (
        <div
          className="coverage-notice status-notice tone-warning"
          role="status"
        >
          <h4>Incomplete Historical Coverage</h4>
          <p>{INCOMPLETE}</p>
          <ul>
            {e.missing.map((m) => (
              <li key={m.ticker}>
                <strong>{m.ticker}</strong> — {m.reason} (
                {m.missingSessions.toLocaleString()} window{" "}
                {m.missingSessions === 1 ? "session" : "sessions"} without a
                price)
              </li>
            ))}
          </ul>
          <p className="hint">
            No shortened, proxy-filled or partial-portfolio result is shown.
            Remove or replace the holding to test this window, or choose a
            window it covers.
          </p>
        </div>
      )}
      {e.status === "complete" && (
        <>
          <KpiStrip
            label={`${e.name} event metrics`}
            items={[
              {
                label: "Portfolio return",
                metric: e.portfolioReturn,
                format: percent,
                formula:
                  "Compounded return of the target portfolio started fresh at the window's first close. Gross of costs.",
                footnote: (m) => `${m.sample.returnCount} daily returns`,
              },
              {
                label: `${benchmark} return`,
                metric: e.benchmarkReturn,
                format: percent,
                formula:
                  "The benchmark ETF's compounded return over the same sessions.",
                footnote: () => "ETF, same window",
              },
              {
                label: "Active return",
                metric: e.activeReturn,
                format: percentagePoints,
                formula:
                  "Portfolio return minus benchmark return over the window. A simple difference, not annualized.",
                footnote: () => "Portfolio − benchmark",
              },
              {
                label: "Maximum drawdown",
                metric: e.maximumDrawdown,
                format: percent,
                formula:
                  "Largest fall below a running peak within the window; the start close is the first peak.",
                footnote: () =>
                  e.maximumDrawdownEpisode
                    ? `Trough ${e.maximumDrawdownEpisode.troughDate}`
                    : "No decline",
              },
              {
                label: "Portfolio volatility",
                metric: e.portfolioVolatility,
                format: unsignedPercent,
                formula:
                  "Annualized volatility of the event's daily returns. Unstable for short windows.",
                footnote: () => "Annualized",
              },
              {
                label: `${benchmark} volatility`,
                metric: e.benchmarkVolatility,
                format: unsignedPercent,
                formula:
                  "Annualized volatility of the benchmark's daily returns in the window.",
                footnote: () => "Annualized",
              },
            ]}
          />
          <StressPathChart id={e.id} path={e.path} benchmark={benchmark} />
          <StressHoldingBars
            id={e.id}
            holdings={e.holdings}
            best={e.best}
            worst={e.worst}
          />
          <p className="hint">
            {e.rebalances} monthly closing{" "}
            {e.rebalances === 1 ? "reset" : "resets"} inside the window. Weights
            drift between month ends, exactly as in the main backtest.
          </p>
        </>
      )}
    </div>
  );
}
