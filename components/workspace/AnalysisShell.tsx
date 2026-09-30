"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { errorState } from "@/lib/ui/quality";
import { timestamp, unsignedPercent } from "@/lib/utils/format";
import { HoldingFocusProvider } from "@/components/ui/HoldingFocus";
import { AllocationStrip } from "@/components/ui/AllocationStrip";
import { StatusNotice, Unavailable } from "@/components/ui/StatusNotice";
import { AnalysisProgress } from "./AnalysisProgress";
import { useWorkspace } from "./WorkspaceProvider";

/** Compact identity of the analysis on screen: allocation, period, benchmark and
 * where the data came from, plus the way back to the builder. */
function PortfolioBar() {
  const { result, source, status, reanalyze, validated, pending } = useWorkspace();
  if (!result) return null;
  const c = result.config;
  const live = source.kind === "live";
  return (
    <div className="portfolio-bar" aria-label="Analyzed portfolio">
      <div className="pb-identity">
        <span className="micro">Analyzed portfolio</span>
        <AllocationStrip
          label="Analyzed allocation"
          holdings={c.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight * 100 }))}
          format={(w) => unsignedPercent(w / 100)}
        />
        <p className="pb-holdings">
          {c.holdings
            .filter((h) => h.weight > 0)
            .map((h) => `${h.ticker} ${unsignedPercent(h.weight)}`)
            .join(" · ")}
        </p>
      </div>
      <dl className="pb-facts">
        <div>
          <dt>Period</dt>
          <dd>
            {result.initialDate} → {result.metadata.effectiveEndDate}
          </dd>
        </div>
        <div>
          <dt>Benchmark</dt>
          <dd>{c.benchmark}</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd>
            {live ? (
              <span className="data-chip" data-tone="ok">
                {result.metadata.historicalProviders.join(", ")} ·{" "}
                {timestamp(result.metadata.generatedAt)}
              </span>
            ) : (
              <span className="data-chip" data-tone="warning">
                Cached sample · Last refreshed {timestamp(source.refreshedAt)}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="pb-actions">
        {status === "changed" && (
          <button
            type="button"
            className="primary"
            disabled={!validated || pending}
            onClick={reanalyze}
          >
            Re-analyze edited portfolio
          </button>
        )}
        <Link className="secondary" href="/#builder">
          Edit portfolio
        </Link>
      </div>
    </div>
  );
}

/** Analysis routes share this shell. Pages render only with an analysis in memory;
 * otherwise the shell shows the (truthful) loading stages, the failure, or guidance
 * back to the builder. A route failure inside a page never clears this state. */
export function AnalysisShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    result,
    pending,
    recovering,
    stage,
    woke,
    wakeSlow,
    pendingSample,
    error,
    analyzeSample,
    loadCachedSample,
    cachedSampleOffer,
  } = useWorkspace();
  useEffect(() => {
    // When a page opens without a focused control (Analyze's button is gone, or a
    // reload), move focus to the page heading so keyboard and screen-reader users
    // start at the content. A nav link that stays focused keeps focus.
    if (!result) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const heading = document.querySelector<HTMLElement>("main .page h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pathname, result]);
  let body: ReactNode;
  if (result)
    body = (
      <div className="page" key={pathname}>
        {children}
      </div>
    );
  else if (pending)
    body = (
      <div className="page-state">
        <AnalysisProgress
          stage={stage ?? "loading"}
          woke={woke}
          cachedOffer={
            stage === "waking" && wakeSlow && pendingSample
              ? () => void loadCachedSample({ navigate: false })
              : undefined
          }
          detail={
            recovering
              ? "Restoring the analysis you had open in this tab. The page returns here when it is ready."
              : undefined
          }
        />
      </div>
    );
  else if (error)
    body = (
      <div className="page-state">
        <StatusNotice
          tone={errorState(error.code).tone}
          title={`Analysis unavailable · ${errorState(error.code).title}`}
          actions={
            <>
              <Link className="secondary" href="/#builder">
                Return to the builder
              </Link>
              {cachedSampleOffer && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void loadCachedSample({ navigate: false })}
                >
                  View cached sample
                </button>
              )}
            </>
          }
        >
          <p>{error.message}</p>
        </StatusNotice>
      </div>
    );
  else
    body = (
      <div className="page-state">
        <Unavailable kind="data" title="No active analysis">
          Analysis pages show the portfolio you analyze in the builder. Nothing is
          stored in the link itself, so open the builder or run the sample.
        </Unavailable>
        <div className="actions">
          <Link className="primary" href="/#builder">
            Build or analyze a portfolio <span aria-hidden>↗</span>
          </Link>
          <button
            type="button"
            className="secondary"
            onClick={() => analyzeSample({ navigate: false })}
          >
            Analyze sample portfolio here
          </button>
        </div>
      </div>
    );
  return (
    <HoldingFocusProvider>
      <PortfolioBar />
      {body}
    </HoldingFocusProvider>
  );
}
