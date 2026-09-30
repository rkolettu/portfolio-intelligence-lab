"use client";
import { RollingSection } from "@/components/rolling/RollingSection";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";

/** "How has portfolio behavior changed through time?" */
export const RollingPage = withAnalysis(function RollingPage({ result, status }) {
  return (
    <section className="results" aria-labelledby="rolling-title">
      <SectionHeading
        number={5}
        eyebrow="Rolling analytics"
        id="rolling-title"
        title="Risk through time."
        subtitle="Volatility, beta and correlation over 20, 60 and 120-session windows."
        glyph="rolling"
        aside={<ResultTag status={status} />}
      />
      <StaleResultNotice status={status} />
      <RollingSection
        key={result.metadata.snapshotHash}
        rolling={result.rollingAnalytics}
        performance={result.performance}
        benchmark={result.benchmarkAnalytics}
      />
    </section>
  );
});
