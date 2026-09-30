"use client";
import { ConstructionSection } from "@/components/construction/ConstructionSection";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Unavailable } from "@/components/ui/StatusNotice";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { StaleResultNotice } from "./shared";

/** "How would different mathematical construction approaches change this
 * portfolio?" Apply replaces the shared builder draft, exactly as before. */
export function ConstructorPage() {
  const { result, status, today, draft, edit, source } = useWorkspace();
  if (!result) return null;
  return (
    <section className="results" aria-labelledby="constructor-title">
      <SectionHeading
        number={7}
        eyebrow="Portfolio Constructor"
        id="constructor-title"
        title="Mathematical alternative allocations."
        subtitle="Four methods, explicit constraints, judged against your current portfolio."
        glyph="constructor"
        aside={<span className="tag">Not a recommendation</span>}
      />
      <StaleResultNotice status={status} />
      {source.kind === "cached-sample" ? (
        <Unavailable kind="solver" title="Constructor needs live market data">
          The cached sample is read-only. Construction estimates covariance from
          live history, so run a live analysis to use it.
        </Unavailable>
      ) : (
        <ConstructionSection
          key={result.metadata.snapshotHash}
          config={result.config}
          analysisHash={result.metadata.snapshotHash}
          today={today}
          builder={draft}
          onApply={(next) => edit({ type: "replace", draft: next })}
        />
      )}
    </section>
  );
}
