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
  const window =
    e.startDate && e.endDate
      ? `${e.startDate} close → ${e.endDate} close`
      : `${e.requestedStartDate} → ${e.requestedEndDate}`;
  return (
    <div className="stress-detail">
      {showName && <h3 className="stress-name">{e.name}</h3>}
      <p className="hint">
        {e.description} {window}
        {e.status === "complete" &&
          ` · ${e.sample.returnCount.toLocaleString()} daily returns; the first ends ${e.firstReturnDate}.`}
      </p>
      {e.notes.map((n) => (
        <p className="hint" key={n}>
          {n}
        </p>
      ))}
      {e.status === "unavailable" && (
        <p className="warning" role="status">
          Stress result unavailable: {e.reason}
        </p>
      )}
      {e.status === "incomplete_coverage" && (
        <div className="coverage-notice">
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
                  "Ending ÷ starting wealth − 1 for the target portfolio initialized at the start close, compounded daily with monthly closing resets. Gross of costs.",
                footnote: (m) => `${m.sample.returnCount} daily returns`,
              },
              {
                label: `${benchmark} return`,
                metric: e.benchmarkReturn,
                format: percent,
                formula:
                  "The benchmark ETF's cumulative adjusted-price return over the same sessions. Requires a price at every window session.",
                footnote: () => "ETF, same window",
              },
              {
                label: "Active return",
                metric: e.activeReturn,
                format: percentagePoints,
                formula:
                  "Portfolio event return − benchmark event return. A simple difference over the window, not the annualized arithmetic active return of the benchmark section.",
                footnote: () => "Portfolio − benchmark",
              },
              {
                label: "Max drawdown",
                metric: e.maximumDrawdown,
                format: percent,
                formula:
                  "Deepest close-to-close decline within the window; the start close is the first peak. Intraday losses can be larger.",
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
                  "Sample standard deviation of the event's daily returns × √252. Short windows give unstable annualized figures.",
                footnote: () => "Annualized",
              },
              {
                label: `${benchmark} volatility`,
                metric: e.benchmarkVolatility,
                format: unsignedPercent,
                formula:
                  "Sample standard deviation of the benchmark's daily returns in the window × √252.",
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
