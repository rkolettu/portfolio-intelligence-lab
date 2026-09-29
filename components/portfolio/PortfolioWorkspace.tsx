"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { samplePortfolio } from "@/config/samplePortfolio";
import {
  draftConfig,
  portfolioReducer,
  toDraft,
  type DraftAction,
} from "@/lib/state/portfolioReducer";
import { persistDraft, restoreDraft } from "@/lib/state/persistence";
import { fixed } from "@/lib/utils/format";
import { errorResult } from "@/lib/utils/errors";
import { referenceMaturity } from "@/lib/treasury-data/reference";
import { errorState } from "@/lib/ui/quality";
import { ConstructionSection } from "@/components/construction/ConstructionSection";
import { MethodologyDrawer } from "@/components/methodology/MethodologyDrawer";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { LoadingState } from "@/components/ui/LoadingState";
import { AnalysisSections, type ResultStatus } from "./AnalysisSections";
import { CurrentMarket } from "./CurrentMarket";
import { LineageSection } from "./LineageSection";
import type { BacktestResult } from "@/lib/types/analytics";
import type {
  CurrentQuote,
  DataError,
  Result,
  TreasuryCurve,
  TreasuryMaturity,
} from "@/lib/types/data";
import type { Period, PortfolioConfig } from "@/lib/types/portfolio";

const PRESET_BENCHMARKS = ["SPY", "VT", "QQQ", "AGG"];
const focusField = (id: string) => {
  const el = document.getElementById(id);
  el?.scrollIntoView?.({ block: "center" });
  el?.focus();
};

export function PortfolioWorkspace({ today }: { today: string }) {
  const [draft, dispatch] = useReducer(
    portfolioReducer,
    toDraft(samplePortfolio(today)),
  );
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [pending, setPending] = useState(false);
  const [quotes, setQuotes] = useState<Result<CurrentQuote>[] | null>(null);
  const [curve, setCurve] = useState<Result<TreasuryCurve> | null>(null);
  // Maturity matching the submitted horizon; highlighted on the current curve.
  const [horizon, setHorizon] = useState<TreasuryMaturity | null>(null);
  // The current-market section owns its clock, isolating quote ageing from charts.
  const [quotesReceived, setQuotesReceived] = useState<number | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    // Storage is intentionally read only after hydration; SSR never accesses browser state.
    let restored;
    try {
      restored = restoreDraft(
        window.localStorage,
        toDraft(samplePortfolio(today)),
        today,
      );
    } catch {
      restored = {
        draft: toDraft(samplePortfolio(today)),
        notice: "Local storage is disabled; preferences will not persist.",
      };
    }
    dispatch({ type: "replace", draft: restored.draft });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate validated browser preferences
    setNotice(restored.notice);
    setReady(true);
    return () => {
      controller.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- request counter, not a DOM ref; invalidate pending callbacks
      sequence.current++;
    };
  }, [today]);

  let validated: PortfolioConfig | null = null;
  let validation = "";
  try {
    validated = draftConfig(draft, today);
  } catch (e) {
    validation = e instanceof Error ? e.message : "Invalid portfolio.";
  }
  const total = draft.holdings.reduce(
    (sum, h) =>
      sum + (Number.isFinite(Number(h.weight)) ? Number(h.weight) : 0),
    0,
  );
  const changed =
    !!result && JSON.stringify(validated) !== JSON.stringify(result.config);
  function edit(action: DraftAction) {
    if (ready) {
      try {
        if (!persistDraft(window.localStorage, portfolioReducer(draft, action)))
          setNotice("Local storage is disabled; preferences will not persist.");
      } catch {
        setNotice("Local storage is disabled; preferences will not persist.");
      }
    }
    sequence.current++;
    controller.current?.abort();
    setPending(false);
    setError(null);
    setQuotes(null);
    setQuotesReceived(null);
    setCurve(null);
    dispatch(action);
  }
  async function submit(config: PortfolioConfig) {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const id = ++sequence.current;
    setPending(true);
    setError(null);
    setQuotes(null);
    setQuotesReceived(null);
    setCurve(null);
    setHorizon(referenceMaturity(config.requestedStartDate, config.endDate));
    const request = async <T,>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: active.signal,
      });
      return response.json() as Promise<T>;
    };
    // Independent requests: current context never gates historical success.
    void request<Result<CurrentQuote>[] | Result<never>>("/api/quotes", [
      ...config.holdings.filter((h) => h.weight > 0).map((h) => h.ticker),
      config.benchmark,
    ])
      .then((q) => {
        if (sequence.current === id) {
          const received = Date.now();
          setQuotes(Array.isArray(q) ? q : [q]);
          setQuotesReceived(received);
        }
      })
      .catch(() => {
        if (sequence.current === id)
          setQuotes([
            {
              ok: false,
              error: {
                code: "PROVIDER_ERROR",
                message:
                  "Current quotes unavailable; historical analysis is unaffected.",
                retryable: true,
              },
            },
          ]);
      });
    void request<Result<TreasuryCurve>>("/api/treasury/current", {})
      .then((q) => {
        if (sequence.current === id) setCurve(q);
      })
      .catch(() => {
        if (sequence.current === id)
          setCurve({
            ok: false,
            error: {
              code: "TREASURY_UNAVAILABLE",
              message: "Current Treasury Reference unavailable.",
              retryable: true,
            },
          });
      });
    try {
      const response = await request<Result<BacktestResult>>(
        "/api/analysis",
        config,
      );
      if (sequence.current !== id) return;
      if (response.ok) setResult(response.value);
      else setError(response.error);
    } catch (e) {
      if (sequence.current === id) {
        const failure = errorResult(e);
        if (!failure.ok) setError(failure.error);
      }
    } finally {
      if (sequence.current === id) setPending(false);
    }
  }
  const analyzeSample = () => {
    const sample = samplePortfolio(today);
    edit({ type: "replace", draft: toDraft(sample) });
    void submit(sample);
  };
  const failedIndex = error?.ticker
    ? draft.holdings.findIndex((h) => h.ticker === error.ticker)
    : -1;
  const failedBenchmark = !!error?.ticker && draft.benchmark === error.ticker;
  const status: ResultStatus = pending ? "pending" : changed ? "changed" : "current";
  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">Portfolio analytics · construction</p>
          <h1>
            Portfolio Intelligence
            <br className="desktop-break" /> &amp; Construction Lab
            <span className="title-dot">.</span>
          </h1>
        </div>
        <div className="intro-copy">
          <p>See what actually drives your portfolio.</p>
          <p className="muted">
            Analyze performance, risk concentration, diversification, benchmark
            behavior, historical stress periods and alternative allocations on
            reproducible daily data.
          </p>
          <div className="actions hero-actions">
            <button type="button" className="primary" onClick={analyzeSample}>
              Analyze Sample Portfolio <span aria-hidden>↗</span>
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => focusField("ticker-0")}
            >
              Build Portfolio
            </button>
          </div>
        </div>
      </div>
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
          if (validated) void submit(validated);
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
                <input
                  id={`ticker-${i}`}
                  aria-label={`Ticker ${i + 1}`}
                  aria-invalid={i === failedIndex || undefined}
                  value={h.ticker}
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) =>
                    edit({
                      type: "holding",
                      index: i,
                      field: "ticker",
                      value: e.target.value,
                    })
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
                className={
                  Math.abs(total - 100) > 0.0001
                    ? "warning"
                    : "allocation-total"
                }
              >
                Total <strong>{fixed(total, 2)}%</strong>
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
      {pending && (
        <LoadingState
          label="Loading market history, validating coverage and calculating analytics…"
          detail={
            result
              ? "Your last successful analysis remains below while this request runs."
              : undefined
          }
        />
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
                    if (validated) void submit(validated);
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
        </StatusNotice>
      )}
      {result && (
        <>
          <AnalysisSections result={result} today={today} status={status} />
          <section className="results" aria-labelledby="constructor-title">
            <SectionHeading
              number={9}
              eyebrow="Portfolio Constructor"
              id="constructor-title"
              title="Mathematical alternative allocations."
              aside={<span className="tag">Not a recommendation</span>}
            />
            <ConstructionSection
              key={result.metadata.snapshotHash}
              config={result.config}
              analysisHash={result.metadata.snapshotHash}
              today={today}
              builder={draft}
              onApply={(next) => edit({ type: "replace", draft: next })}
            />
          </section>
        </>
      )}
      <CurrentMarket
        quotes={quotes}
        receivedAt={quotesReceived}
        curve={curve}
        horizon={horizon}
        pending={pending}
      />
      <LineageSection result={result} status={status} />
      <MethodologyDrawer result={result} />
    </>
  );
}
