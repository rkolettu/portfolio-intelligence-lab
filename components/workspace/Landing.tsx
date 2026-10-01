"use client";
import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { samplePortfolio } from "@/config/samplePortfolio";
import { toDraft } from "@/lib/state/portfolioReducer";
import { fixed } from "@/lib/utils/format";
import { errorState } from "@/lib/ui/quality";
import { Observatory } from "@/components/observatory/Observatory";
import {
  AllocationStrip,
  allocationColor,
} from "@/components/ui/AllocationStrip";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { AnalysisProgress } from "./AnalysisProgress";
import { TickerCombobox } from "./TickerCombobox";
import { useWorkspace } from "./WorkspaceProvider";
import type { Period } from "@/lib/types/portfolio";

const PRESET_BENCHMARKS = ["SPY", "VT", "QQQ", "AGG"];
const focusField = (id: string) => {
  const el = document.getElementById(id);
  el?.scrollIntoView?.({ block: "center" });
  el?.focus();
};

/** Landing page: compact hero and the portfolio builder. Analyze runs the analysis
 * and opens /analysis/overview; the report itself lives on the analysis routes. */
export function Landing() {
  const {
    today,
    draft,
    validated,
    validation,
    total,
    notice,
    edit,
    submit,
    analyzeSample,
    loadCachedSample,
    cachedSampleOffer,
    pending,
    stage,
    woke,
    wakeSlow,
    pendingSample,
    wakeService,
    error,
    result,
    source,
    status,
  } = useWorkspace();
  // Wake a sleeping market-data service as soon as the builder appears, without
  // delaying render: by the time Analyze is clicked it is usually awake.
  useEffect(() => {
    wakeService();
  }, [wakeService]);
  const failedIndex = error?.ticker
    ? draft.holdings.findIndex((h) => h.ticker === error.ticker)
    : -1;
  const failedBenchmark = !!error?.ticker && draft.benchmark === error.ticker;
  const stripHoldings = draft.holdings.map((h) => ({
    ticker: h.ticker.trim().toUpperCase(),
    weight: Number.isFinite(Number(h.weight)) ? Number(h.weight) : 0,
  }));
  const gap = total - 100;
  const balanced = Math.abs(gap) <= 0.0001;
  return (
    <>
      <Observatory
        draft={stripHoldings}
        period={{
          start: draft.requestedStartDate,
          end: draft.endDate,
          label: draft.period,
        }}
        benchmark={draft.benchmark || "—"}
        pending={pending}
        onUseMix={(holdings) => edit({ type: "replace", draft: { ...draft, holdings } })}
        onAnalyze={() => analyzeSample()}
        onBuild={() => focusField("ticker-0")}
      >
      {notice && (
        <StatusNotice tone="info" role="status">
          {notice}
        </StatusNotice>
      )}
      <form
        id="builder"
        aria-label="Portfolio builder"
        onSubmit={(e) => {
          e.preventDefault();
          if (validated) void submit(validated, { navigate: true });
        }}
      >
        <div className="workspace-grid">
          <section className="panel" aria-labelledby="allocation-title">
            <div className="panel-heading">
              <h2 id="allocation-title">Target allocation</h2>
              <span className="muted">
                {draft.holdings.filter((h) => h.ticker !== "CASH").length} / 20
                risky + CASH
              </span>
            </div>
            <AllocationStrip
              holdings={stripHoldings}
              label="Target allocation as proportional segments"
              format={(w) => `${fixed(w, 2)}%`}
            />
            <div className="holding-labels" aria-hidden>
              <span>Security</span>
              <span>Weight %</span>
              <span />
            </div>
            {draft.holdings.map((h, i) => (
              <div className="holding-row" key={i}>
                <label className="sr-only" htmlFor={`ticker-${i}`}>
                  Ticker {i + 1}
                </label>
                <TickerCombobox
                  index={i}
                  value={h.ticker}
                  invalid={i === failedIndex}
                  onChange={(value) =>
                    edit({ type: "holding", index: i, field: "ticker", value })
                  }
                />
                <label className="sr-only" htmlFor={`weight-${i}`}>
                  Weight {i + 1}
                </label>
                <div className="weight-input">
                  <input
                    id={`weight-${i}`}
                    aria-label={`Weight ${i + 1}`}
                    value={h.weight}
                    inputMode="decimal"
                    onChange={(e) =>
                      edit({
                        type: "holding",
                        index: i,
                        field: "weight",
                        value: e.target.value,
                      })
                    }
                  />
                  <span aria-hidden>%</span>
                  <span
                    className="weight-bar"
                    aria-hidden
                    style={
                      {
                        "--w": Math.max(
                          0,
                          Math.min(100, Number(h.weight) || 0),
                        ),
                        "--seg": allocationColor(i, draft.holdings.length),
                      } as CSSProperties
                    }
                  />
                </div>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove holding ${i + 1}`}
                  onClick={() => edit({ type: "remove", index: i })}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="allocation-footer">
              <button
                type="button"
                className="text-action"
                disabled={draft.holdings.length >= 21}
                onClick={() => edit({ type: "add" })}
              >
                + Add holding
              </button>
              <span
                className={`allocation-total${balanced ? "" : " warning"}`}
              >
                Total{" "}
                <strong key={fixed(total, 2)}>{fixed(total, 2)}%</strong>
                <span
                  className="alloc-state"
                  data-state={balanced ? "ok" : "warn"}
                >
                  {balanced ? (
                    <>
                      <svg viewBox="0 0 12 12" aria-hidden focusable="false">
                        <path
                          d="m2.2 6.4 2.5 2.5 5-5.6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Fully allocated
                    </>
                  ) : gap > 0 ? (
                    `${fixed(gap, 2)}% over`
                  ) : (
                    `${fixed(-gap, 2)}% unallocated`
                  )}
                </span>
              </span>
            </div>
            <p className="hint">
              USD U.S.-listed equities and ETFs. CASH earns the Historical
              Risk-Free rate. A 0% holding is a construction candidate and does
              not constrain coverage.
            </p>
          </section>
          <section className="panel controls" aria-labelledby="controls-title">
            <div className="panel-heading">
              <h2 id="controls-title">Analysis settings</h2>
              <span className="tag">Daily adjusted closes</span>
            </div>
            <label htmlFor="benchmark">ETF benchmark</label>
            <select
              id="benchmark"
              value={
                PRESET_BENCHMARKS.includes(draft.benchmark)
                  ? draft.benchmark
                  : "Custom"
              }
              onChange={(e) =>
                edit({
                  type: "field",
                  field: "benchmark",
                  value: e.target.value === "Custom" ? "" : e.target.value,
                })
              }
            >
              {[...PRESET_BENCHMARKS, "Custom"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {!PRESET_BENCHMARKS.includes(draft.benchmark) && (
              <>
                <label htmlFor="custom-benchmark">
                  Custom benchmark ticker
                </label>
                <input
                  id="custom-benchmark"
                  value={draft.benchmark}
                  aria-invalid={failedBenchmark || undefined}
                  onChange={(e) =>
                    edit({
                      type: "field",
                      field: "benchmark",
                      value: e.target.value,
                    })
                  }
                />
              </>
            )}
            <label htmlFor="period">Requested period</label>
            <select
              id="period"
              value={draft.period}
              onChange={(e) =>
                edit({ type: "period", period: e.target.value as Period })
              }
            >
              {["1Y", "3Y", "5Y", "10Y", "MAX", "Custom"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <div className="date-fields">
              <div>
                <label htmlFor="start">Start date</label>
                <input
                  id="start"
                  type="date"
                  value={draft.requestedStartDate}
                  max={today}
                  onChange={(e) =>
                    edit({
                      type: "field",
                      field: "requestedStartDate",
                      value: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor="end">End date</label>
                <input
                  id="end"
                  type="date"
                  value={draft.endDate}
                  max={today}
                  onChange={(e) =>
                    edit({
                      type: "field",
                      field: "endDate",
                      value: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="setting-row">
              <span>Rebalancing</span>
              <strong>Monthly · closing reset</strong>
            </div>
            <div className="setting-row">
              <span>Historical Risk-Free</span>
              <strong>3-month Treasury (DGS3MO)</strong>
            </div>
            <details className="cash-control">
              <summary>CASH outage policy</summary>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.cashPolicy === "zero_explicit"}
                  onChange={(e) =>
                    edit({
                      type: "field",
                      field: "cashPolicy",
                      value: e.target.checked
                        ? "zero_explicit"
                        : "historical_proxy",
                    })
                  }
                />
                If Treasury history is unavailable, explicitly use zero-return
                CASH for the entire run.
              </label>
              <p className="hint">
                This changes CASH methodology. Missing risk-free observations
                remain unavailable.
              </p>
            </details>
            <p className="hint">
              MAX is capped at 50 years. Today’s bar is excluded until the next
              market date. Gross of transaction costs and taxes.
            </p>
          </section>
        </div>
        <div className="submit-bar">
          <div>
            {validation ? (
              <p className="warning" role="status">
                {validation}
              </p>
            ) : (
              <p className="muted">
                Allocation ready. Accepted rounding residuals are normalized to
                100%.
              </p>
            )}
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                edit({
                  type: "replace",
                  draft: toDraft(samplePortfolio(today)),
                })
              }
            >
              Load Sample Portfolio
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!validated}
              aria-busy={pending}
            >
              {pending ? "Restart analysis" : "Analyze portfolio"}{" "}
              <span aria-hidden>↗</span>
            </button>
          </div>
        </div>
      </form>
      {pending &&
        stage &&
        typeof document !== "undefined" &&
        // Portaled above every stacking context (the stage's pucks included).
        createPortal(
        <div className="engine-dock">
        <AnalysisProgress
          stage={stage}
          woke={woke}
          cachedOffer={
            stage === "waking" && wakeSlow && pendingSample
              ? () => void loadCachedSample({ navigate: true })
              : undefined
          }
          detail={
            result
              ? "Your last successful analysis stays available while this request runs."
              : undefined
          }
        />
        </div>,
          document.body,
        )}
      {error && (
        <StatusNotice
          tone={errorState(error.code).tone}
          title={`${error.ticker ? `${error.ticker} · ` : ""}${errorState(error.code).title}${errorState(error.code).detail ? ` · ${errorState(error.code).detail}` : ""}`}
          actions={
            // Retrying or editing holdings cannot fix a disabled provider.
            error.code !== "UNQUALIFIED_PROVIDER" && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={!validated}
                  onClick={() => {
                    if (validated) void submit(validated, { navigate: true });
                  }}
                >
                  Retry analysis
                </button>
                {failedIndex >= 0 && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => focusField(`ticker-${failedIndex}`)}
                    >
                      Edit {error.ticker}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        edit({ type: "remove", index: failedIndex })
                      }
                    >
                      Remove {error.ticker}
                    </button>
                  </>
                )}
                {failedBenchmark && failedIndex < 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => focusField("benchmark")}
                  >
                    Change benchmark
                  </button>
                )}
                {failedIndex < 0 && !failedBenchmark && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => focusField("ticker-0")}
                  >
                    Return to builder ↑
                  </button>
                )}
              </>
            )
          }
        >
          <p>{error.message}</p>
          {error.dates && (
            <p>Missing sessions: {error.dates.slice(0, 8).join(", ")}</p>
          )}
          {cachedSampleOffer && (
            <div className="cached-offer">
              <p>
                Live market data is unavailable. A cached copy of the sample
                analysis is available, clearly labelled with when it was last
                refreshed.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => void loadCachedSample({ navigate: true })}
              >
                View cached sample
              </button>
            </div>
          )}
        </StatusNotice>
      )}
      {result && !pending && (
        <div className="resume">
          <span className="resume-dot" aria-hidden data-state={status} />
          <p>
            {source.kind === "cached-sample"
              ? "Viewing the cached sample analysis."
              : status === "changed"
                ? "An analysis of your previous allocation is open. Your edits have not been analyzed yet."
                : "Your analysis is ready."}
          </p>
          <Link className="secondary" href="/analysis/overview">
            Open analysis <span aria-hidden>→</span>
          </Link>
        </div>
      )}
      </Observatory>
    </>
  );
}
