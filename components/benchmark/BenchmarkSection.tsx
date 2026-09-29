"use client";
import type { BenchmarkAnalytics, Metric } from "@/lib/types/analytics";
import { decimal, percent, ratio, unsignedPercent } from "@/lib/utils/format";
import { InfoTip } from "@/components/metrics/InfoTip";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { StatusNotice } from "@/components/ui/StatusNotice";

const cell = (m: Metric, format: (v: number) => string) =>
  m.available ? format(m.value) : "N/A";

/** Benchmark-relative presentation. Every number is precomputed server-side from
 * one canonical aligned sample; this component only formats. */
export function BenchmarkSection({
  analytics,
}: {
  analytics: BenchmarkAnalytics;
}) {
  const { comparison, relative, geometric, riskFree, ticker } = analytics;
  if (!comparison.available)
    return (
      <StatusNotice tone="warning" title="Benchmark Data Unavailable">
        {comparison.reason} Absolute portfolio results are unaffected.
      </StatusNotice>
    );
  const s = comparison.sample;
  const n = s.returnCount.toLocaleString();
  const sampleFoot = `n = ${n} aligned`;
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Benchmark</span>
          <strong>{ticker} · ETF</strong>
        </div>
        <div>
          <span>Comparison period</span>
          <strong>
            {s.startDate} → {s.endDate}
          </strong>
        </div>
        <div>
          <span>Aligned observations</span>
          <strong>
            {n}
            {s.excludedIntervalCount > 0 &&
              ` · ${s.excludedIntervalCount.toLocaleString()} excluded`}
          </strong>
        </div>
        <div>
          <span>Historical Risk-Free coverage</span>
          <strong>
            {riskFree.complete
              ? "Complete"
              : `${riskFree.available.toLocaleString()} / ${riskFree.required.toLocaleString()}`}
          </strong>
        </div>
      </div>
      {comparison.notes.map((note) => (
        <p className="hint" key={note}>
          {note}
        </p>
      ))}
      <h3 className="group-title">
        Regression &amp; co-movement · aligned daily arithmetic returns
      </h3>
      <KpiStrip
        label="Regression and co-movement"
        items={[
          {
            label: "Beta",
            metric: relative.beta,
            format: decimal,
            formula:
              "Sensitivity of daily portfolio returns to the benchmark: 1.00 moves one-for-one, 0.50 half as much.",
            footnote: () => sampleFoot,
          },
          {
            label: "CAPM alpha",
            metric: relative.alpha,
            format: percent,
            formula:
              "Annualized return not explained by benchmark exposure in a one-factor regression. A description of the past, not proof of skill.",
            footnote: () =>
              relative.regressionBeta.available
                ? `Regression β ${decimal(relative.regressionBeta.value)} · annualized`
                : "Annualized × 252",
          },
          {
            label: "Correlation",
            metric: relative.correlation,
            format: decimal,
            formula:
              "How closely daily portfolio and benchmark returns move together, from −1 to +1.",
            footnote: () => sampleFoot,
          },
          {
            label: "R²",
            metric: relative.rSquared,
            format: decimal,
            formula:
              "Share of daily excess-return variation the benchmark explains in the CAPM regression.",
            footnote: () => "CAPM regression fit",
          },
        ]}
      />
      <h3 className="group-title">
        Active return · portfolio − benchmark, daily arithmetic
      </h3>
      <KpiStrip
        label="Arithmetic active returns"
        items={[
          {
            label: "Active return",
            metric: relative.annualizedActiveReturn,
            format: percent,
            formula:
              "Average daily portfolio-minus-benchmark return, annualized. Arithmetic, so it is not the difference between the two CAGRs below.",
            footnote: () => "Annualized · arithmetic",
          },
          {
            label: "Tracking error",
            metric: relative.trackingError,
            format: unsignedPercent,
            formula:
              "How much the portfolio's return deviates from the benchmark's, annualized.",
            footnote: () => sampleFoot,
          },
          {
            label: "Information ratio",
            metric: relative.informationRatio,
            format: ratio,
            formula:
              "Active return per unit of tracking error. Undefined when tracking error is zero.",
            footnote: () => "Active return ÷ tracking error",
          },
        ]}
      />
      <h3 className="group-title">
        Geometric comparison · compounded over the comparison period
        <InfoTip label="geometric comparison">
          Compounded returns of both series over the same comparison period,
          each rebased to $10,000 at its start.
        </InfoTip>
      </h3>
      <div className="table-wrap">
        <table className="comparison-table">
          <caption className="sr-only">
            Portfolio versus {ticker}, {s.startDate} to {s.endDate}
          </caption>
          <thead>
            <tr>
              <th>Measure</th>
              <th>Portfolio</th>
              <th>{ticker}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cumulative return</td>
              <td>{cell(geometric.portfolioCumulativeReturn, percent)}</td>
              <td>{cell(geometric.benchmarkCumulativeReturn, percent)}</td>
            </tr>
            <tr>
              <td>CAGR</td>
              <td>{cell(geometric.portfolioCagr, percent)}</td>
              <td>{cell(geometric.benchmarkCagr, percent)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!geometric.portfolioCagr.available && (
        <p className="hint">{geometric.portfolioCagr.reason}</p>
      )}
      {geometric.portfolioCagr.available &&
        geometric.portfolioCagr.notes?.map((note) => (
          <p className="hint" key={note}>
            {note}
          </p>
        ))}
      <p className="hint">
        ETF benchmark: fund distributions, expenses and tracking differences are
        part of the observed series. Results are historical and in-sample.
      </p>
    </>
  );
}
