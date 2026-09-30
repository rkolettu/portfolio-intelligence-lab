"use client";
import { RiskSection, RiskSampleSummary } from "@/components/risk/RiskSection";
import { DiversificationSection } from "@/components/risk/DiversificationSection";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";

/** "Where is the portfolio's risk actually coming from?" Risk contribution and
 * diversification share one common sample, so they share one page. */
export const RiskPage = withAnalysis(function RiskPage({ result, status }) {
  return (
    <>
      <section className="results" aria-labelledby="risk-title">
        <SectionHeading
          number={4}
          eyebrow="Risk"
          id="risk-title"
          title="What drives portfolio risk."
          subtitle="Where volatility actually sits, against where capital sits."
          glyph="risk"
          aside={<ResultTag status={status} />}
        />
        <StaleResultNotice status={status} />
        <RiskSection risk={result.riskAnalytics} performance={result.performance} />
      </section>
      <section className="results" aria-labelledby="diversification-title">
        <SectionHeading
          eyebrow="Diversification"
          id="diversification-title"
          title="Concentration and correlation."
          subtitle="How capital is spread and how holdings move together."
          glyph="diversification"
          aside={<span className="tag">Same common sample</span>}
        />
        {!result.riskAnalytics.sample.available && (
          <RiskSampleSummary risk={result.riskAnalytics} />
        )}
        <DiversificationSection risk={result.riskAnalytics} />
      </section>
    </>
  );
});
