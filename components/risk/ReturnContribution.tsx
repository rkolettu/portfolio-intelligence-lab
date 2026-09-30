"use client";
import type { RiskAnalytics } from "@/lib/types/analytics";
import { percent, percentagePoints, unsignedPercent } from "@/lib/utils/format";
import { InfoTip } from "@/components/metrics/InfoTip";
import {
  focusHandlers,
  focusState,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";

/** Arithmetic period return contribution from the historical ledger. Separate from
 * risk contribution; uses actual beginning-of-interval (drifted/reset) weights. */
export function ReturnContribution({
  contribution,
  cumulativeReturn,
}: {
  contribution: RiskAnalytics["returnContribution"];
  cumulativeReturn: number | null;
}) {
  const holdingFocus = useHoldingFocus();
  const { focus } = holdingFocus;
  const rows = [...contribution.rows].sort(
    (a, b) => b.periodContribution - a.periodContribution,
  );
  // Display scale only: zero sits where the data needs it, so an almost
  // all-positive set uses the full track instead of half of it.
  const hi = Math.max(0, ...rows.map((r) => r.periodContribution));
  const lo = Math.min(0, ...rows.map((r) => r.periodContribution));
  const span = Math.max(hi - lo, 1e-12);
  const zero = (-lo / span) * 100;
  const { startDate, endDate, returnCount } = contribution.sample;
  return (
    <figure className="chart-figure rc-figure" aria-labelledby="rc-title rc-summary">
      <div className="chart-head">
        <div>
          <h3 id="rc-title">
            Return contribution · daily / period arithmetic
            <InfoTip label="arithmetic return contribution">
              Each holding&rsquo;s share of daily portfolio returns, using the
              weight it actually held that day, summed over the period. Not
              Brinson or linked attribution.
            </InfoTip>
          </h3>
          <p id="rc-summary" className="hint">
            {startDate} → {endDate} · {returnCount.toLocaleString()} daily
            intervals · full backtest sample
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="contribution-table">
          <thead>
            <tr>
              <th>Holding</th>
              <th>Average start weight</th>
              <th>Arithmetic contribution</th>
              <th className="rc-bar-head" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const width = (Math.abs(r.periodContribution) / span) * 100;
              return (
                <tr
                  key={r.ticker}
                  data-focus={focusState(focus, r.ticker)}
                  {...focusHandlers(holdingFocus, [r.ticker])}
                >
                  <td>{r.ticker}</td>
                  <td>{unsignedPercent(r.averageWeight)}</td>
                  <td>{percentagePoints(r.periodContribution)}</td>
                  <td className="rc-bar-cell" aria-hidden>
                    <span className="rc-track">
                      <span className="rc-axis" style={{ left: `${zero}%` }} />
                      <span
                        className={`rc-bar${r.periodContribution < 0 ? " rc-negative" : ""}`}
                        style={
                          r.periodContribution < 0
                            ? { right: `${100 - zero}%`, width: `${width}%` }
                            : { left: `${zero}%`, width: `${width}%` }
                        }
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>100.00%</td>
              <td>{percentagePoints(contribution.sumOfDailyReturns)}</td>
              <td className="hint">sum of daily portfolio returns</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint rc-note">
        Identity check: daily holding contributions equal each day&rsquo;s
        portfolio return (max residual{" "}
        {contribution.maxIdentityResidual.toExponential(1)}).
        {cumulativeReturn !== null &&
          ` The compounded cumulative return over the same period is ${percent(cumulativeReturn)}; the arithmetic total differs because daily returns compound.`}
      </p>
    </figure>
  );
}
