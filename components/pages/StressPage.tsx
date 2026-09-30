"use client";
import { StressLab } from "@/components/stress/StressLab";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { StaleResultNotice, withAnalysis } from "./shared";

/** "What happened to this portfolio during difficult markets?" The Stress Lab keeps
 * its own on-demand request; its loaded events persist across page changes. */
export const StressPage = withAnalysis(function StressPage({ result, status }) {
  const { today } = useWorkspace();
  return (
    <section className="results" aria-labelledby="stress-title">
      <SectionHeading
        number={6}
        eyebrow="Stress Lab"
        id="stress-title"
        title="Historical stress periods."
        subtitle="Fixed historical windows, restarted at target weights."
        glyph="stress"
        aside={<span className="tag">Fixed windows · re-initialized</span>}
      />
      <StaleResultNotice status={status} />
      <StressLab
        key={result.metadata.snapshotHash}
        config={result.config}
        today={today}
        slot={result.metadata.snapshotHash}
      />
    </section>
  );
});
