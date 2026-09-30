"use client";
import type { Stage } from "./WorkspaceProvider";

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "waking", label: "Waking market-data service…" },
  { stage: "loading", label: "Loading historical prices…" },
  { stage: "opening", label: "Opening the overview…" },
];

/** Truthful progress for the Analyze action. The wake step appears only when the
 * market-data service actually had to wake. Loading prices, validating coverage and
 * calculating analytics are one server request, shown as one step rather than a
 * fabricated sequence. For the sample only, a long wake offers the cached copy; it
 * is never substituted automatically. */
export function AnalysisProgress({
  stage,
  woke,
  detail,
  cachedOffer,
}: {
  stage: Stage;
  woke: boolean;
  detail?: string;
  cachedOffer?: () => void;
}) {
  const steps = STEPS.filter((s) => s.stage !== "waking" || woke);
  const at = steps.findIndex((s) => s.stage === stage);
  return (
    <div className="loading progress" role="status" aria-live="polite">
      <ol className="progress-steps">
        {steps.map((s, i) => (
          <li
            key={s.stage}
            data-state={i < at ? "done" : i === at ? "active" : "todo"}
          >
            <span className="progress-mark" aria-hidden />
            {s.label}
          </li>
        ))}
      </ol>
      {stage === "loading" && (
        <p className="hint">
          Coverage validation and portfolio analytics run in the same request.
        </p>
      )}
      {detail && <p className="hint">{detail}</p>}
      {cachedOffer && (
        <div className="cached-offer">
          <p>
            The market-data service is taking a while to wake. You can keep
            waiting, or view a cached copy of the sample analysis, labelled with
            when it was last refreshed.
          </p>
          <button type="button" className="secondary" onClick={cachedOffer}>
            View cached sample
          </button>
        </div>
      )}
      <div className="skeleton" aria-hidden>
        {[92, 75, 58].map((w) => (
          <span key={w} style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
