"use client";
import { useEffect, useRef, useState } from "react";
import type { Stage } from "./WorkspaceProvider";

const STEPS: { stage: Stage; key: string; label: string; detail: string }[] = [
  {
    stage: "waking",
    key: "Service",
    label: "Waking market-data service…",
    detail: "Free instance resuming from sleep",
  },
  {
    stage: "loading",
    key: "Request",
    label: "Loading historical prices…",
    detail: "History · coverage · analytics, one server pass",
  },
  {
    stage: "opening",
    key: "Open",
    label: "Opening the overview…",
    detail: "Rendering the workspace",
  },
];

/** Elapsed time since this progress panel appeared: a true measurement. */
function useElapsed() {
  const [ms, setMs] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      start.current ??= performance.now();
      setMs(performance.now() - start.current);
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  return ms;
}

/** Truthful progress for the Analyze action, drawn as the market-data engine's
 * status panel. The wake step appears only when the market-data service actually
 * had to wake. Loading prices, validating coverage and calculating analytics are
 * one server request, shown as one step rather than a fabricated sequence; a step
 * shows complete only once the application knows it is. The rail's moving mark is
 * an activity indicator while a response is awaited, never a percentage. For the
 * sample only, a long wake offers the cached copy; it is never substituted
 * automatically. */
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
  const elapsed = useElapsed();
  const secs = (elapsed / 1000).toFixed(1).padStart(4, "0");
  return (
    <div className="loading progress engine" role="status" aria-live="polite">
      <div className="engine-head">
        <span>Market data engine</span>
        <span className="engine-clock" aria-hidden>
          T+{secs}s
        </span>
      </div>
      <ol className="progress-steps">
        {steps.map((s, i) => (
          <li
            key={s.stage}
            data-state={i < at ? "done" : i === at ? "active" : "todo"}
          >
            <span className="progress-mark" aria-hidden />
            <span className="engine-key" aria-hidden>
              {s.key}
            </span>
            <span className="engine-label">{s.label}</span>
            <span className="engine-detail" aria-hidden>
              {i < at ? "Complete" : i === at ? s.detail : "Waiting"}
            </span>
          </li>
        ))}
      </ol>
      <div className="engine-rail" aria-hidden>
        <i />
      </div>
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
    </div>
  );
}
