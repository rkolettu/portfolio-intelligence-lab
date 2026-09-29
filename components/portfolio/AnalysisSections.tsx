"use client";
import { memo } from "react";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { BenchmarkSection } from "@/components/benchmark/BenchmarkSection";
import { RiskSection, RiskSampleSummary } from "@/components/risk/RiskSection";
import { DiversificationSection } from "@/components/risk/DiversificationSection";
import { ReturnContribution } from "@/components/risk/ReturnContribution";
import { RollingSection } from "@/components/rolling/RollingSection";
import { StressLab } from "@/components/stress/StressLab";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { count, unsignedPercent } from "@/lib/utils/format";
import type { BacktestResult } from "@/lib/types/analytics";

export type ResultStatus = "current" | "changed" | "pending";

export function ResultTag({ status }: { status: ResultStatus }) {
  return (
    <span className="tag">
      {status === "current" ? "Historical data" : "Last successful analysis"}
    </span>
  );
}

/** Sections 01–08. Memoized: they depend only on the displayed result, so typing
 * in the builder or ageing current quotes never re-renders these charts. */
export const AnalysisSections = memo(function AnalysisSections({
  result,
  today,
  status,
}: {
  result: BacktestResult;
  today: string;
  status: ResultStatus;
}) {
  const stateTag = <ResultTag status={status} />;
  return (
    <>
      <section className="results" aria-labelledby="overview-title">
        <SectionHeading
          number={1}
          eyebrow="Overview"
          id="overview-title"
          title="Performance overview."
          aside={stateTag}
        />
        {status !== "current" && (
          <StatusNotice tone="info" role="status">
            These results belong to the last submitted allocation.{" "}
            {status === "changed"
              ? "Your edited draft has not been analyzed."
              : "A new analysis is pending."}
          </StatusNotice>
        )}
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
        <MetricStrip performance={result.performance} />
        <p className="hint">
          Analyzed allocation:{" "}
          {result.config.holdings
            .map((h) => `${h.ticker} ${unsignedPercent(h.weight)}`)
            .join(" · ")}
          . Monthly rebalancing, gross of costs.
        </p>
      </section>
      <section className="results" aria-labelledby="performance-title">
        <SectionHeading
          number={2}
          eyebrow="Performance"
          id="performance-title"
          title="Growth of wealth."
          aside={<span className="tag">Daily closes · compounded</span>}
        />
        <GrowthChart key={result.metadata.snapshotHash} result={result} />
        {result.benchmark.ok && (
          <p className="hint">
            Continuous benchmark overlap:{" "}
            {result.benchmark.value.sample.startDate} →{" "}
            {result.benchmark.value.sample.endDate} ·{" "}
            {count(result.benchmark.value.sample.returnCount, "return")}. The
            portfolio path is rebased without resetting weights.
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
      <section className="results" aria-labelledby="benchmark-title">
        <SectionHeading
          number={3}
          eyebrow="Benchmark"
          id="benchmark-title"
          title={`Relative to ${result.benchmarkAnalytics.ticker}.`}
          aside={<span className="tag">One aligned sample</span>}
        />
        <BenchmarkSection analytics={result.benchmarkAnalytics} />
      </section>
      <section className="results" aria-labelledby="drawdowns-title">
        <SectionHeading
          number={4}
          eyebrow="Drawdowns"
          id="drawdowns-title"
          title="Peak-to-trough losses."
          aside={<span className="tag">Daily-close wealth</span>}
        />
        <DrawdownLab
          performance={result.performance}
          benchmark={result.benchmarkAnalytics}
        />
      </section>
      <section className="results" aria-labelledby="risk-title">
        <SectionHeading
          number={5}
          eyebrow="Risk"
          id="risk-title"
          title="What drives portfolio risk."
          aside={<span className="tag">Target weights · sample Σ</span>}
        />
        <RiskSection
          risk={result.riskAnalytics}
          performance={result.performance}
        />
      </section>
      <section className="results" aria-labelledby="diversification-title">
        <SectionHeading
          number={6}
          eyebrow="Diversification"
          id="diversification-title"
          title="Concentration and correlation."
          aside={<span className="tag">Same common sample</span>}
        />
        {!result.riskAnalytics.sample.available && (
          <RiskSampleSummary risk={result.riskAnalytics} />
        )}
        <DiversificationSection risk={result.riskAnalytics} />
      </section>
      <section className="results" aria-labelledby="rolling-title">
        <SectionHeading
          number={7}
          eyebrow="Rolling analytics"
          id="rolling-title"
          title="Risk through time."
          aside={<span className="tag">Full windows only</span>}
        />
        <RollingSection
          key={result.metadata.snapshotHash}
          rolling={result.rollingAnalytics}
          performance={result.performance}
          benchmark={result.benchmarkAnalytics}
        />
      </section>
      <section className="results" aria-labelledby="stress-title">
        <SectionHeading
          number={8}
          eyebrow="Stress Lab"
          id="stress-title"
          title="Historical stress periods."
          aside={<span className="tag">Fixed windows · re-initialized</span>}
        />
        <StressLab
          key={result.metadata.snapshotHash}
          config={result.config}
          today={today}
        />
      </section>
    </>
  );
});
