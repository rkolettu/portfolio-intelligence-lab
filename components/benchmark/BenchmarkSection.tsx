"use client";
import type { BenchmarkAnalytics, Metric } from "@/lib/types/analytics";
import { decimal, percent, ratio, unsignedPercent } from "@/lib/utils/format";
import { InfoTip } from "@/components/metrics/InfoTip";
import { KpiStrip } from "@/components/metrics/KpiStrip";

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
      <p className="warning" role="status">
        Benchmark-relative analytics unavailable: {comparison.reason} Absolute
        portfolio results above are unaffected.
      </p>
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
          <span>Risk-free coverage</span>
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
              "Cov(Rp, Rb) ÷ Var(Rb): sample covariance of aligned daily portfolio and benchmark returns over the sample variance of the benchmark. Raw returns, no risk-free adjustment.",
            footnote: () => sampleFoot,
          },
          {
            label: "CAPM alpha",
            metric: relative.alpha,
            format: percent,
            formula:
              "Intercept of the OLS regression (Rp − Rf) = α + β(Rb − Rf) + ε on the same aligned sample, using each interval's prior-known DGS3MO accrual. Annualized linearly: α × 252, never compounded. A single-factor intercept against this ETF, not proof of skill.",
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
              "Pearson correlation of aligned daily portfolio and benchmark arithmetic returns.",
            footnote: () => sampleFoot,
          },
          {
            label: "R²",
            metric: relative.rSquared,
            format: decimal,
            formula:
              "Share of daily excess-return variance explained by the CAPM regression (squared correlation of Rp − Rf with Rb − Rf).",
            footnote: () => "CAPM regression fit",
          },
        ]}
      />
      <h3 className="group-title">
        Arithmetic active returns · active = portfolio − benchmark, daily
      </h3>
      <KpiStrip
        label="Arithmetic active returns"
        items={[
          {
            label: "Annualized active return",
            metric: relative.annualizedActiveReturn,
            format: percent,
            formula:
              "mean(active) × 252, where active = portfolio return − benchmark return on each aligned day. Arithmetic, and deliberately not the difference between the two CAGRs below.",
            footnote: () => "mean daily active × 252",
          },
          {
            label: "Tracking error",
            metric: relative.trackingError,
            format: unsignedPercent,
            formula:
              "Sample standard deviation of daily active returns × √252.",
            footnote: () => sampleFoot,
          },
          {
            label: "Information ratio",
            metric: relative.informationRatio,
            format: ratio,
            formula:
              "mean(active) ÷ sampleStdDev(active) × √252 = annualized active return ÷ tracking error. Undefined when tracking error is zero.",
            footnote: () => "Active return ÷ tracking error",
          },
        ]}
      />
      <h3 className="group-title">
        Geometric comparison · compounded over the comparison period
        <InfoTip label="geometric comparison">
          Both wealth paths are rebased to $10,000 at the comparison start (the
          portfolio keeps its drifted weights). Cumulative return = ending ÷
          starting − 1; CAGR annualizes over actual calendar days ÷ 365.25.
          These long-horizon figures are geometric and are not inputs to
          tracking error or the information ratio.
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
