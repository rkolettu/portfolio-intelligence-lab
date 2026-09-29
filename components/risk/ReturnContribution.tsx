"use client";
import type { RiskAnalytics } from "@/lib/types/analytics";
import { percent, percentagePoints, unsignedPercent } from "@/lib/utils/format";
import { InfoTip } from "@/components/metrics/InfoTip";

/** Arithmetic period return contribution from the historical ledger. Separate from
 * risk contribution; uses actual beginning-of-interval (drifted/reset) weights. */
export function ReturnContribution({
  contribution,
  cumulativeReturn,
}: {
  contribution: RiskAnalytics["returnContribution"];
  cumulativeReturn: number | null;
}) {
  const rows = [...contribution.rows].sort(
    (a, b) => b.periodContribution - a.periodContribution,
  );
  const extent = Math.max(
    ...rows.map((r) => Math.abs(r.periodContribution)),
    1e-12,
  );
  const { startDate, endDate, returnCount } = contribution.sample;
  return (
    <figure className="chart-figure" aria-labelledby="rc-title rc-summary">
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
              const width = (Math.abs(r.periodContribution) / extent) * 50;
              return (
                <tr key={r.ticker}>
                  <td>{r.ticker}</td>
                  <td>{unsignedPercent(r.averageWeight)}</td>
                  <td>{percentagePoints(r.periodContribution)}</td>
                  <td className="rc-bar-cell" aria-hidden>
                    <span className="rc-axis" />
                    <span
                      className={`rc-bar${r.periodContribution < 0 ? " rc-negative" : ""}`}
                      style={
                        r.periodContribution < 0
                          ? { right: "50%", width: `${width}%` }
                          : { left: "50%", width: `${width}%` }
                      }
                    />
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
      <p className="hint">
        Identity check: daily holding contributions equal each day&rsquo;s
        portfolio return (max residual{" "}
        {contribution.maxIdentityResidual.toExponential(1)}).
        {cumulativeReturn !== null &&
          ` The compounded cumulative return over the same period is ${percent(cumulativeReturn)}; the arithmetic total differs because daily returns compound.`}
      </p>
    </figure>
  );
}
