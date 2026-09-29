"use client";
import { useState } from "react";
import type {
  Metric,
  PerformanceSummary,
  RiskAnalytics,
} from "@/lib/types/analytics";
import { sortHoldings, type RiskSortKey } from "@/lib/charts/riskDisplay";
import { decimal, unsignedPercent } from "@/lib/utils/format";
import { InfoTip } from "@/components/metrics/InfoTip";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { CapitalVsRisk } from "./CapitalVsRisk";
import { CorrelationHeatmap } from "./CorrelationHeatmap";
import { ReturnContribution } from "./ReturnContribution";

const cell = (m: Metric, format: (v: number) => string) =>
  m.available ? format(m.value) : "N/A";
const reasonOf = (m: Metric) => (m.available ? undefined : m.reason);
const SORTS: { value: RiskSortKey; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "risk", label: "Risk contribution" },
  { value: "volatility", label: "Volatility" },
  { value: "beta", label: "Beta" },
];

/** Phase 4 risk section. Every number is precomputed server-side from one
 * canonical holding sample; this component formats and orders only. */
export function RiskSection({
  risk,
  performance,
}: {
  risk: RiskAnalytics;
  performance: PerformanceSummary;
}) {
  const [sort, setSort] = useState<RiskSortKey>("weight");
  const s = risk.sample;
  const p = risk.portfolio;
  const c = risk.concentration;
  const realized = performance.risk.volatility;
  const holdings = sortHoldings(risk.holdings, sort);
  const cumulative = performance.portfolio.cumulativeReturn;
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Decomposition</span>
          <strong>Target weights · CASH riskless</strong>
        </div>
        <div>
          <span>Common sample</span>
          <strong>
            {s.available
              ? `${s.sample.startDate} → ${s.sample.endDate}`
              : "Unavailable"}
          </strong>
        </div>
        <div>
          <span>Common observations</span>
          <strong>
            {(s.available
              ? s.sample.returnCount
              : s.observationCount
            ).toLocaleString()}
            {s.available && s.status === "limited" && " · limited"}
            {!s.available && s.observationCount > 0 && " · insufficient"}
          </strong>
        </div>
        <div>
          <span>Risky holdings</span>
          <strong>
            {s.available
              ? s.tickers.length
              : risk.holdings.filter((h) => !h.riskless).length}
          </strong>
        </div>
      </div>
      {!s.available && (
        <p className="warning" role="status">
          {s.reason}
        </p>
      )}
      {s.available &&
        s.notes.map((n) => (
          <p className="hint" key={n}>
            {n}
          </p>
        ))}
      <h3 className="group-title">Risk overview · {risk.label}</h3>
      <KpiStrip
        label="Risk overview"
        items={[
          {
            label: "Portfolio volatility",
            metric: p.volatility,
            format: unsignedPercent,
            formula:
              "√(w′Σw): annualized sample covariance (252 × daily) of the common risky-holding sample at TARGET weights, CASH riskless. A model snapshot — not the realized volatility of the drifting historical portfolio, and not a forecast.",
            footnote: () =>
              realized.available
                ? `Target weights · realized ${unsignedPercent(realized.value)}`
                : "Target weights",
          },
          {
            label: "Weighted standalone volatility",
            metric: p.weightedAverageVolatility,
            format: unsignedPercent,
            formula:
              "Σ wᵢ × volᵢ, with volᵢ = sample std of daily returns × √252 and CASH at zero.",
            footnote: () => "Before diversification",
          },
          {
            label: "Diversification ratio",
            metric: p.diversificationRatio,
            format: (v) => `${decimal(v)}×`,
            formula:
              "Weighted standalone volatility ÷ portfolio volatility. Above 1 means correlations below +1 reduce risk. It measures risky-asset diversification and is unchanged by moving capital into riskless CASH.",
            footnote: () => "Correlation benefit",
          },
          {
            label: "Effective holdings",
            metric: {
              available: true,
              value: c.effectiveHoldings,
              sample: s.available ? s.sample : risk.returnContribution.sample,
            },
            format: (v) => v.toFixed(1),
            formula:
              "1 ÷ HHI, where HHI = Σ wᵢ² over all capital weights including CASH. Measures capital concentration only — not correlation diversification, and not a complete diversification score.",
            footnote: () => `HHI ${c.hhi.toFixed(3)}`,
          },
          {
            label: "Top-3 concentration",
            metric: {
              available: true,
              value: c.top3.weight,
              sample: s.available ? s.sample : risk.returnContribution.sample,
            },
            format: unsignedPercent,
            formula:
              "Combined capital weight of the three largest positions (ties in portfolio order).",
            footnote: () =>
              `Largest ${c.largest.ticker} ${unsignedPercent(c.largest.weight)}`,
          },
        ]}
      />
      <div className="series-control risk-sort">
        <fieldset className="segmented">
          <legend className="sr-only">Sort holdings by</legend>
          {SORTS.map((o) => (
            <label
              key={o.value}
              className={sort === o.value ? "selected" : undefined}
            >
              <input
                type="radio"
                name="risk-sort"
                value={o.value}
                checked={sort === o.value}
                onChange={() => setSort(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        <span className="hint">
          Sorts the chart and table · descending · N/A last
        </span>
      </div>
      <CapitalVsRisk holdings={holdings} />
      <div className="table-wrap">
        <table className="risk-table">
          <caption>
            Holding risk at target weights{" "}
            <InfoTip label="risk contribution">
              MRC = (Σw)ᵢ ÷ σ, the change in portfolio volatility per unit of
              weight. CRC = wᵢ × MRC, volatility points contributed; they sum to
              σ. PCR = CRC ÷ σ; they sum to 100%. Hedging holdings can have
              negative values and others can exceed 100% — they are never
              clamped. Beta uses the benchmark-aligned sample.
            </InfoTip>
          </caption>
          <thead>
            <tr>
              <th>Holding</th>
              <th>Weight</th>
              <th>Volatility</th>
              <th>Beta</th>
              <th>Marginal (MRC)</th>
              <th>Component (CRC)</th>
              <th>Share (PCR)</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.ticker}>
                <td>
                  {h.ticker}
                  {h.riskless && <span className="cr-tag">riskless</span>}
                </td>
                <td>{unsignedPercent(h.weight)}</td>
                <td title={reasonOf(h.volatility)}>
                  {cell(h.volatility, unsignedPercent)}
                </td>
                <td title={reasonOf(h.beta)}>{cell(h.beta, decimal)}</td>
                <td title={reasonOf(h.marginal)}>
                  {cell(h.marginal, unsignedPercent)}
                </td>
                <td title={reasonOf(h.component)}>
                  {cell(h.component, unsignedPercent)}
                </td>
                <td title={reasonOf(h.percentage)}>
                  <strong>{cell(h.percentage, unsignedPercent)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Portfolio</td>
              <td>100.00%</td>
              <td>{cell(p.weightedAverageVolatility, unsignedPercent)} wtd</td>
              <td />
              <td />
              <td>{cell(p.volatility, unsignedPercent)} = σ</td>
              <td>{p.identityResiduals ? "100.00%" : "N/A"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {risk.correlation.available ? (
        risk.correlation.tickers.length > 1 ? (
          <CorrelationHeatmap
            tickers={risk.correlation.tickers}
            matrix={risk.correlation.matrix}
            highest={risk.correlation.highest}
            lowest={risk.correlation.lowest}
            undefinedTickers={risk.correlation.undefinedTickers}
          />
        ) : (
          <p className="hint">
            A correlation matrix needs at least two risky holdings.
          </p>
        )
      ) : (
        <p className="hint">
          Correlation matrix unavailable: {risk.correlation.reason}
        </p>
      )}
      <ReturnContribution
        contribution={risk.returnContribution}
        cumulativeReturn={cumulative.available ? cumulative.value : null}
      />
      <p className="hint">
        Historical sample covariance describes the chosen window; it is not a
        forecast of future covariance. Target weights are the configured
        allocation, not the average of drifted historical weights.
      </p>
    </>
  );
}
