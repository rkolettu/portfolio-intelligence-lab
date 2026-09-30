"use client";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { BenchmarkSection } from "@/components/benchmark/BenchmarkSection";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";

/** "How does the portfolio behave relative to the benchmark?" */
export const BenchmarkPage = withAnalysis(function BenchmarkPage({ result, status }) {
  const ticker = result.benchmarkAnalytics.ticker;
  const traces = result.benchmark.ok
    ? {
        portfolio: result.benchmark.value.points.map((p) => p.portfolioWealth),
        benchmark: result.benchmark.value.points.map((p) => p.benchmarkWealth),
      }
    : undefined;
  return (
    <>
      <section className="results" aria-labelledby="benchmark-title">
        <SectionHeading
          number={3}
          eyebrow="Benchmark"
          id="benchmark-title"
          title={`Relative to ${ticker}.`}
          subtitle="Regression, active return and compounded comparison on one aligned sample."
          glyph="benchmark"
          aside={<ResultTag status={status} />}
        />
        <StaleResultNotice status={status} />
        <GrowthChart key={result.metadata.snapshotHash} result={result} height={280} />
        <BenchmarkSection analytics={result.benchmarkAnalytics} traces={traces} />
      </section>
      <section className="results" aria-labelledby="benchmark-drawdown-title">
        <SectionHeading
          eyebrow="Drawdown comparison"
          id="benchmark-drawdown-title"
          title={`Drawdowns against ${ticker}.`}
          subtitle="Each series measured from its own running peak."
          glyph="drawdowns"
          aside={<span className="tag">Daily-close wealth</span>}
        />
        <DrawdownLab
          performance={result.performance}
          benchmark={result.benchmarkAnalytics}
          initialMode={result.benchmarkAnalytics.drawdown.available ? "both" : "portfolio"}
        />
      </section>
    </>
  );
});
