"use client";
import { useState } from "react";
import type {
  Metric,
  PerformanceSummary,
  RiskAnalytics,
} from "@/lib/types/analytics";
import { sortHoldings, type RiskSortKey } from "@/lib/charts/riskDisplay";
import { count, decimal, unsignedPercent } from "@/lib/utils/format";
import { sampleState } from "@/lib/ui/quality";
import { InfoTip } from "@/components/metrics/InfoTip";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { StateBadge } from "@/components/ui/StateBadge";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { CapitalVsRisk } from "./CapitalVsRisk";

const cell = (m: Metric, format: (v: number) => string) =>
  m.available ? format(m.value) : "N/A";
const reasonOf = (m: Metric) => (m.available ? undefined : m.reason);
const SORTS: { value: RiskSortKey; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "risk", label: "Risk contribution" },
  { value: "volatility", label: "Volatility" },
  { value: "beta", label: "Beta" },
];

/** Shared sample header for the Risk and Diversification sections. */
export function RiskSampleSummary({ risk }: { risk: RiskAnalytics }) {
  const s = risk.sample;
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Model</span>
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
          </strong>
        </div>
        <div>
          <span>Data quality</span>
          <strong>
            <StateBadge
              state={sampleState(s.available ? s.status : "insufficient")}
            />
          </strong>
        </div>
      </div>
      {!s.available && (
        <StatusNotice tone="warning" title="Insufficient History">
          {s.reason}
        </StatusNotice>
      )}
      {s.available &&
        s.notes.map((n) => (
          <p className="hint" key={n}>
            {n}
          </p>
        ))}
    </>
  );
}

/** Historical Risk Analysis: what drives portfolio volatility at target weights.
 * Every number is precomputed server-side; this component formats and orders. */
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
  const realized = performance.risk.volatility;
  const holdings = sortHoldings(risk.holdings, sort);
  // Display selection only: the holding with the largest precomputed PCR.
  const top = risk.holdings
    .filter((h) => h.percentage.available)
    .reduce<(typeof risk.holdings)[number] | null>(
      (best, h) =>
        best &&
        best.percentage.available &&
        h.percentage.available &&
        best.percentage.value >= h.percentage.value
          ? best
          : h,
      null,
    );
  const riskySample = s.available ? s.sample : risk.returnContribution.sample;
  return (
    <>
      <RiskSampleSummary risk={risk} />
      <h3 className="group-title">Historical Risk Analysis · {risk.label}</h3>
      <KpiStrip
        label="Risk overview"
        items={[
          {
            label: "Portfolio volatility",
            metric: p.volatility,
            format: unsignedPercent,
            formula:
              "Annualized volatility the covariance model implies for the target weights. A snapshot of the allocation, not the realized path and not a forecast.",
            footnote: () => "Target weights · sample Σ",
          },
          {
            label: "Realized volatility",
            metric: realized,
            format: unsignedPercent,
            formula:
              "Annualized volatility the drifting historical portfolio actually had, CASH accrual included. Same figure as the Overview.",
            footnote: (m) => count(m.sample.returnCount, "daily return"),
          },
          {
            label: "Largest risk contribution",
            metric: top?.percentage ?? {
              available: false,
              reason: "No risk contribution is defined for this portfolio.",
            },
            format: unsignedPercent,
            formula:
              "The single holding with the largest share of portfolio volatility at target weights.",
            footnote: () =>
              top
                ? `${top.ticker} · ${unsignedPercent(top.weight)} of capital`
                : "",
          },
          {
            label: "Risky holdings",
            metric: {
              available: true,
              value: risk.holdings.filter((h) => !h.riskless).length,
              sample: riskySample,
            },
            format: (v) => String(v),
            formula:
              "Holdings inside the covariance matrix. CASH sits outside it with zero risk.",
            footnote: () => "In the covariance matrix",
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
        <span className="hint">Sorts the chart and table · N/A last</span>
      </div>
      <CapitalVsRisk holdings={holdings} />
      <div className="table-wrap">
        <table className="risk-table">
          <caption>
            Holding risk at target weights{" "}
            <InfoTip label="risk contribution">
              How much each holding adds to portfolio volatility. Shares sum to
              100%; a hedge can be negative and is never clamped.
            </InfoTip>
          </caption>
          <thead>
            <tr>
              <th scope="col">Holding</th>
              <th scope="col">Weight</th>
              <th scope="col">Volatility</th>
              <th scope="col">Beta</th>
              <th scope="col">Marginal (MRC)</th>
              <th scope="col">Risk contribution (CRC)</th>
              <th scope="col">Share (PCR)</th>
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
      <p className="hint">
        Beta uses the benchmark-aligned sample. Historical covariance describes
        the chosen window, not future covariance; target weights are the
        configured allocation, not the average drifted weights.
      </p>
    </>
  );
}
