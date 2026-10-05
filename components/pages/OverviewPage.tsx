"use client";
import Link from "next/link";
import type { BacktestResult, HoldingRisk } from "@/lib/types/analytics";
import {
  decimal,
  percent,
  shortDate,
  unsignedPercent,
} from "@/lib/utils/format";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice, Unavailable } from "@/components/ui/StatusNotice";
import { BetaMarker, PairTraces } from "@/components/ui/motifs";
import { CurrentMarket } from "@/components/portfolio/CurrentMarket";
import { LineageSection } from "@/components/portfolio/LineageSection";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";
import { TickerChip } from "@/components/observatory/Dossier";

/** Short statements restating metrics the engine already computed; nothing here
 * derives a new statistic. Each links to the page that explains it. */
function insights(r: BacktestResult) {
  const out: { text: string; href: string; label: string }[] = [];
  const top = r.riskAnalytics.holdings
    .filter((h) => h.percentage.available && !h.riskless)
    .reduce<HoldingRisk | null>(
      (best, h) =>
        !best ||
        (h.percentage.available &&
          best.percentage.available &&
          h.percentage.value > best.percentage.value)
          ? h
          : best,
      null,
    );
  if (top && top.percentage.available)
    out.push({
      text: `${top.ticker} is ${unsignedPercent(top.weight)} of capital and ${unsignedPercent(top.percentage.value)} of risk.`,
      href: "/analysis/risk",
      label: "Where risk sits",
    });
  const e = r.performance.maximumDrawdownEpisode;
  out.push(
    e
      ? {
          text: `Deepest decline ${percent(e.depth)}, ${shortDate(e.peakDate)} to ${shortDate(e.troughDate)}; ${e.recoveryDate ? `recovered ${shortDate(e.recoveryDate)}` : "not yet recovered"}.`,
          href: "/analysis/performance",
          label: "Drawdowns",
        }
      : {
          text: "Wealth never closed below a prior peak in this period.",
          href: "/analysis/performance",
          label: "Drawdowns",
        },
  );
  const g = r.benchmarkAnalytics.geometric;
  if (g.portfolioCagr.available && g.benchmarkCagr.available)
    out.push({
      text: `Compounded ${percent(g.portfolioCagr.value)} a year against ${r.benchmarkAnalytics.ticker} ${percent(g.benchmarkCagr.value)} over the aligned period.`,
      href: "/analysis/benchmark",
      label: "Benchmark",
    });
  const d = r.riskAnalytics.portfolio.diversificationRatio;
  out.push({
    text: `${r.riskAnalytics.concentration.effectiveHoldings.toFixed(1)} effective holdings${d.available ? `; diversification ratio ${decimal(d.value)}×` : ""}.`,
    href: "/analysis/risk",
    label: "Diversification",
  });
  return out;
}

const OverviewBody = withAnalysis(function OverviewBody({ result, status }) {
  const rolling = result.rollingAnalytics;
  const rollingVolatility = rolling.volatility.available
    ? rolling.volatility.series[
        Math.max(0, rolling.windows.indexOf(rolling.defaultWindow))
      ].values.filter((v): v is number => v !== null)
    : undefined;
  const traces = result.benchmark.ok
    ? {
        portfolio: result.benchmark.value.points.map((p) => p.portfolioWealth),
        benchmark: result.benchmark.value.points.map((p) => p.benchmarkWealth),
      }
    : undefined;
  const b = result.benchmarkAnalytics;
  return (
    <section className="results" aria-labelledby="overview-title">
      <SectionHeading
        number={1}
        eyebrow="Overview"
        id="overview-title"
        title="Performance overview."
        subtitle="How is this portfolio doing? Headline return and risk over the effective period."
        glyph="overview"
        aside={<ResultTag status={status} />}
      />
      <StaleResultNotice status={status} />
      {result.config.cashPolicy === "zero_explicit" &&
        result.config.holdings.some(
          (h) => h.ticker === "CASH" && h.weight > 0,
        ) && (
          <StatusNotice
            tone="warning"
            role="note"
            label="Zero-return CASH methodology"
            title="Treasury Data Unavailable · zero-return CASH"
          >
            This historical result uses zero-return CASH for the entire run.
            Missing historical risk-free observations remain unavailable.
          </StatusNotice>
        )}
      <div className="summary-grid">
        <div>
          <span>Requested period</span>
          <strong>
            {result.config.requestedStartDate} → {result.config.endDate}
          </strong>
        </div>
        <div>
          <span>Effective period</span>
          <strong>
            {result.initialDate} → {result.metadata.effectiveEndDate}
          </strong>
        </div>
        <div>
          <span>Return observations</span>
          <strong>{result.ledger.length.toLocaleString()}</strong>
        </div>
        <div>
          <span>ETF benchmark</span>
          <strong>{result.config.benchmark}</strong>
        </div>
      </div>
      {result.metadata.limitingHoldings.length > 0 && (
        <StatusNotice tone="warning" title="Partial History">
          Requested {result.config.requestedStartDate}. Analysis begins{" "}
          {result.initialDate} because{" "}
          {result.metadata.limitingHoldings.join(", ")} has no earlier valid
          history.
        </StatusNotice>
      )}
      <MetricStrip
        performance={result.performance}
        rollingVolatility={rollingVolatility}
      />
      <GrowthChart
        key={result.metadata.snapshotHash}
        result={result}
        height={280}
      />
      <div className="overview-grid">
        <OverviewAllocation result={result} />
        <div className="side-panel" aria-labelledby="insight-title">
          <h3 id="insight-title" className="side-title">
            Key observations
          </h3>
          <ul className="insights">
            {insights(result).map((i) => (
              <li key={i.label}>
                <p>{i.text}</p>
                <Link href={i.href}>
                  {i.label} <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h3 className="group-title">
        Benchmark summary · {b.ticker} · aligned daily returns
      </h3>
      {b.comparison.available ? (
        <KpiStrip
          label="Benchmark summary"
          items={[
            {
              label: "Beta",
              metric: b.relative.beta,
              format: decimal,
              formula:
                "Sensitivity of daily portfolio returns to the benchmark: 1.00 moves one-for-one.",
              footnote: () => `vs ${b.ticker}`,
              viz: b.relative.beta.available ? (
                <BetaMarker beta={b.relative.beta.value} />
              ) : undefined,
            },
            {
              label: "Active return",
              metric: b.relative.annualizedActiveReturn,
              format: percent,
              signed: true,
              formula:
                "Average daily portfolio-minus-benchmark return, annualized (arithmetic).",
              footnote: () => "Annualized · arithmetic",
            },
            {
              label: "Correlation",
              metric: b.relative.correlation,
              format: decimal,
              formula:
                "How closely daily portfolio and benchmark returns move together.",
              footnote: () => "Daily returns",
              viz: traces ? (
                <PairTraces a={traces.portfolio} b={traces.benchmark} />
              ) : undefined,
            },
            {
              label: "Tracking error",
              metric: b.relative.trackingError,
              format: unsignedPercent,
              formula:
                "How much the portfolio's return deviates from the benchmark's, annualized.",
              footnote: () => "Annualized",
            },
          ]}
        />
      ) : (
        <Unavailable kind="data" title="Benchmark comparison unavailable">
          {b.comparison.reason}
        </Unavailable>
      )}
    </section>
  );
});

/** Each holding's share of capital beside its share of risk (percentage risk
 * contribution, already computed by the engine). Both bars share one 0–100% scale
 * so the gap between them reads directly; colors match Capital vs Risk. */
function OverviewAllocation({ result }: { result: BacktestResult }) {
  const pcr = new Map(
    result.riskAnalytics.holdings.map((h) => [
      h.ticker,
      h.percentage.available ? h.percentage.value : null,
    ]),
  );
  const holdings = result.config.holdings.filter((h) => h.weight > 0);
  const rows = holdings.map((h) => ({
    ticker: h.ticker,
    weight: h.weight,
    risk: h.ticker === "CASH" ? null : (pcr.get(h.ticker) ?? null),
  }));
  const scale = Math.max(
    ...rows.map((r) => Math.max(r.weight, r.risk ?? 0)),
    0.0001,
  );
  const width = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  return (
    <div className="side-panel" aria-labelledby="alloc-title">
      <h3 id="alloc-title" className="side-title">
        Capital vs risk
      </h3>
      <p className="alloc-legend" aria-hidden>
        <span data-kind="capital">Capital weight</span>
        <span data-kind="risk">Share of risk</span>
      </p>
      <table className="alloc-table">
        <caption className="sr-only">
          Analyzed allocation: capital weight and percentage risk contribution
          per holding
        </caption>
        <thead>
          <tr>
            <th scope="col">Holding</th>
            <th scope="col">
              <span className="sr-only">Bars</span>
            </th>
            <th scope="col">Capital</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker}>
              <th scope="row">
                <TickerChip ticker={r.ticker} />
              </th>
              <td className="alloc-bars" aria-hidden>
                <i data-kind="capital" style={{ width: width(r.weight) }} />
                <i
                  data-kind="risk"
                  style={{ width: r.risk === null ? 0 : width(r.risk) }}
                />
              </td>
              <td>{unsignedPercent(r.weight)}</td>
              <td>{r.risk === null ? "—" : unsignedPercent(r.risk)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Monthly rebalancing, gross of costs. Risk share is each holding&apos;s
        contribution to target-weight volatility; CASH carries none.
      </p>
    </div>
  );
}

/** Current market context and lineage read live workspace state (quotes arrive
 * independently), so they sit outside the memoized report body. */
function OverviewContext() {
  const {
    result,
    status,
    quotes,
    quotesReceived,
    curve,
    horizon,
    pending,
    source,
  } = useWorkspace();
  return (
    <>
      {source.kind === "cached-sample" ? (
        <section className="results" aria-labelledby="context-title">
          <SectionHeading
            eyebrow="Current Market"
            id="context-title"
            title="Current market & Treasury reference."
            subtitle="Context only. Never enters a historical result."
            glyph="market"
          />
          <Unavailable kind="stale" title="Not requested for the cached sample">
            Current quotes and the Treasury curve are fetched only for a live
            analysis.
          </Unavailable>
        </section>
      ) : (
        <CurrentMarket
          quotes={quotes}
          receivedAt={quotesReceived}
          curve={curve}
          horizon={horizon}
          pending={pending}
        />
      )}
      <LineageSection result={result} status={status} />
    </>
  );
}

export function OverviewPage() {
  return (
    <>
      <OverviewBody />
      <OverviewContext />
    </>
  );
}
