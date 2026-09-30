"use client";
import { count } from "@/lib/utils/format";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { ReturnContribution } from "@/components/risk/ReturnContribution";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";

/** "How has the portfolio performed?" Growth, headline statistics, return
 * contribution and the full drawdown analysis. */
export const PerformancePage = withAnalysis(function PerformancePage({ result, status }) {
  const rolling = result.rollingAnalytics;
  const rollingVolatility = rolling.volatility.available
    ? rolling.volatility.series[
        Math.max(0, rolling.windows.indexOf(rolling.defaultWindow))
      ].values.filter((v): v is number => v !== null)
    : undefined;
  return (
    <>
      <section className="results" aria-labelledby="performance-title">
        <SectionHeading
          number={2}
          eyebrow="Performance"
          id="performance-title"
          title="Growth of wealth."
          subtitle="The wealth path, the headline statistics, and which holdings earned it."
          glyph="performance"
          aside={<ResultTag status={status} />}
        />
        <StaleResultNotice status={status} />
        <MetricStrip performance={result.performance} rollingVolatility={rollingVolatility} />
        <GrowthChart key={result.metadata.snapshotHash} result={result} />
        {result.benchmark.ok && (
          <p className="hint">
            Continuous benchmark overlap: {result.benchmark.value.sample.startDate} →{" "}
            {result.benchmark.value.sample.endDate} ·{" "}
            {count(result.benchmark.value.sample.returnCount, "return")}. The portfolio
            path is rebased without resetting weights.
          </p>
        )}
        <ReturnContribution
          contribution={result.riskAnalytics.returnContribution}
          cumulativeReturn={
            result.performance.portfolio.cumulativeReturn.available
              ? result.performance.portfolio.cumulativeReturn.value
              : null
          }
        />
      </section>
      <section className="results" aria-labelledby="drawdowns-title">
        <SectionHeading
          eyebrow="Drawdowns"
          id="drawdowns-title"
          title="Peak-to-trough losses."
          subtitle="How deep, how long, and whether it recovered."
          glyph="drawdowns"
          aside={<span className="tag">Daily-close wealth</span>}
        />
        <DrawdownLab performance={result.performance} benchmark={result.benchmarkAnalytics} />
      </section>
    </>
  );
});
