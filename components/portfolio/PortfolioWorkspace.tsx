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
import { errorResult } from "@/lib/utils/errors";
import { quoteAfterElapsed } from "@/lib/market-data/quotes";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { BenchmarkSection } from "@/components/benchmark/BenchmarkSection";
import { RiskSection } from "@/components/risk/RiskSection";
import { RollingSection } from "@/components/rolling/RollingSection";
import { StressLab } from "@/components/stress/StressLab";
import { money, percent, timestamp } from "@/lib/utils/format";
import type { BacktestResult } from "@/lib/types/analytics";
import type {
  CurrentQuote,
  DataError,
  Result,
  TreasuryCurve,
} from "@/lib/types/data";
import type { Period, PortfolioConfig } from "@/lib/types/portfolio";

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
  // Displayed quotes age in place: live/delayed claims lapse and closes go stale.
  const [quoteClock, setQuoteClock] = useState<{
    received: number;
    now: number;
  } | null>(null);
  const quoteReceived = quoteClock?.received;
  useEffect(() => {
    if (quoteReceived === undefined) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setQuoteClock((c) => (c ? { ...c, now: Date.now() } : c));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [quoteReceived]);
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
    setQuoteClock(null);
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
    setQuoteClock(null);
    setCurve(null);
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
          setQuoteClock({ received, now: received });
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
              message: "Current Treasury reference unavailable.",
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
  return (
    <>
      <div className="intro">
        <div>
          <p className="eyebrow">01 / Portfolio workspace</p>
          <h1>
            Portfolio Risk
            <br className="desktop-break" /> &amp; Analytics Lab
            <span className="title-dot">.</span>
          </h1>
        </div>
        <div className="intro-copy">
          <p>See what actually drives your portfolio.</p>
          <p className="muted">
            Start with a reproducible historical simulation. Define your
            allocation, verify its coverage, and inspect the underlying return
            ledger.
          </p>
          <button
            className="text-action"
            onClick={() => {
              const sample = samplePortfolio(today);
              edit({ type: "replace", draft: toDraft(sample) });
              void submit(sample);
            }}
          >
            Analyze Sample Portfolio <span aria-hidden>↗</span>
          </button>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        id="builder"
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
                {draft.holdings.length} / 20 holdings
              </span>
            </div>
            <div className="holding-labels">
              <span>Security</span>
              <span>Weight %</span>
              <span className="sr-only">Actions</span>
            </div>
            {draft.holdings.map((h, i) => (
              <div className="holding-row" key={i}>
                <label className="sr-only" htmlFor={`ticker-${i}`}>
                  Ticker {i + 1}
                </label>
                <input
                  id={`ticker-${i}`}
                  aria-label={`Ticker ${i + 1}`}
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
                disabled={draft.holdings.length >= 20}
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
                Total <strong>{total.toFixed(2)}%</strong>
              </span>
            </div>
            <p className="hint">
              USD U.S.-listed equities and ETFs. CASH earns a historical 3-month
              Treasury proxy. Zero-weight holdings do not constrain coverage.
            </p>
          </section>
          <section className="panel controls" aria-labelledby="controls-title">
            <div className="panel-heading">
              <h2 id="controls-title">Analysis settings</h2>
              <span className="tag">Daily adjusted</span>
            </div>
            <label htmlFor="benchmark">ETF benchmark</label>
            <select
              id="benchmark"
              value={
                ["SPY", "VT", "QQQ", "AGG"].includes(draft.benchmark)
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
              {["SPY", "VT", "QQQ", "AGG", "Custom"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {!["SPY", "VT", "QQQ", "AGG"].includes(draft.benchmark) && (
              <>
                <label htmlFor="custom-benchmark">
                  Custom benchmark ticker
                </label>
                <input
                  id="custom-benchmark"
                  value={draft.benchmark}
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
              <span>Historical risk-free proxy</span>
              <strong>DGS3MO</strong>
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
              market date. No transaction costs or taxes are modeled.
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
        <div className="loading" role="status">
          <span className="loading-line" />
          <p>Loading and validating historical data…</p>
          <p className="hint">
            Your last successful analysis remains below while this request runs.
          </p>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <strong>
            {error.ticker ? `${error.ticker} · ` : ""}
            {error.code.replaceAll("_", " ")}
          </strong>
          <p>{error.message}</p>
          {error.dates && (
            <p>Missing sessions: {error.dates.slice(0, 8).join(", ")}</p>
          )}
          {/* Retrying or editing holdings cannot fix a disabled provider. */}
          {error.code !== "UNQUALIFIED_PROVIDER" && (
            <div className="actions">
              <button
                className="secondary"
                disabled={!validated}
                onClick={() => {
                  if (validated) void submit(validated);
                }}
              >
                Retry analysis
              </button>
              <a href="#builder">Edit ticker or remove holding ↑</a>
            </div>
          )}
        </div>
      )}
      {result && (
        <>
          <section className="results" aria-labelledby="overview-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / Overview</p>
                <h2 id="overview-title">Performance overview.</h2>
              </div>
              <span className="tag">
                {changed || pending
                  ? "Last successful analysis"
                  : "Historical data"}
              </span>
            </div>
            {(changed || pending) && (
              <p className="notice">
                These results belong to the last submitted allocation.{" "}
                {changed
                  ? "Your edited draft has not been analyzed."
                  : "A new analysis is pending."}
              </p>
            )}
            {result.config.cashPolicy === "zero_explicit" &&
              result.config.holdings.some(
                (h) => h.ticker === "CASH" && h.weight > 0,
              ) && (
                <p
                  className="notice"
                  role="note"
                  aria-label="Zero-return CASH methodology"
                >
                  This historical result uses zero-return CASH for the entire
                  run. Missing historical risk-free observations remain
                  unavailable.
                </p>
              )}
            <div className="summary-grid">
              <div>
                <span>Requested</span>
                <strong>
                  {result.config.requestedStartDate} → {result.config.endDate}
                </strong>
              </div>
              <div>
                <span>Effective daily sample</span>
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
            <MetricStrip performance={result.performance} />
            <p className="hint">
              Submitted allocation:{" "}
              {result.config.holdings
                .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(2)}%`)
                .join(" · ")}
            </p>
            {result.metadata.limitingHoldings.length > 0 && (
              <p className="warning">
                Analysis begins {result.initialDate} because{" "}
                {result.metadata.limitingHoldings.join(", ")} lacks earlier
                valid history.
              </p>
            )}
          </section>
          <section className="results" aria-labelledby="performance-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">03 / Performance</p>
                <h2 id="performance-title">Growth of wealth.</h2>
              </div>
              <span className="tag">Daily closes · compounded</span>
            </div>
            <GrowthChart key={result.metadata.snapshotHash} result={result} />
            {!result.benchmark.ok ? (
              <p className="warning">
                Benchmark comparison unavailable:{" "}
                {result.benchmark.error.message}
              </p>
            ) : (
              <p className="hint">
                Continuous benchmark overlap:{" "}
                {result.benchmark.value.sample.startDate} →{" "}
                {result.benchmark.value.sample.endDate} ·{" "}
                {result.benchmark.value.sample.returnCount} returns. Portfolio
                path rebased without resetting weights.
              </p>
            )}
          </section>
          <section className="results" aria-labelledby="risk-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">04 / Risk</p>
                <h2 id="risk-title">What drives portfolio risk.</h2>
              </div>
              <span className="tag">Target weights · common sample</span>
            </div>
            <RiskSection
              risk={result.riskAnalytics}
              performance={result.performance}
            />
          </section>
          <section className="results" aria-labelledby="benchmark-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">05 / Benchmark</p>
                <h2 id="benchmark-title">
                  Relative to {result.benchmarkAnalytics.ticker}.
                </h2>
              </div>
              <span className="tag">One aligned comparison sample</span>
            </div>
            <BenchmarkSection analytics={result.benchmarkAnalytics} />
          </section>
          <section className="results" aria-labelledby="drawdowns-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">06 / Drawdowns</p>
                <h2 id="drawdowns-title">Peak-to-trough losses.</h2>
              </div>
              <span className="tag">From compounded wealth</span>
            </div>
            <DrawdownLab
              performance={result.performance}
              benchmark={result.benchmarkAnalytics}
            />
          </section>
          <section className="results" aria-labelledby="rolling-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">07 / Rolling</p>
                <h2 id="rolling-title">Risk through time.</h2>
              </div>
              <span className="tag">Full windows only</span>
            </div>
            <RollingSection
              key={result.metadata.snapshotHash}
              rolling={result.rollingAnalytics}
              performance={result.performance}
              benchmark={result.benchmarkAnalytics}
            />
          </section>
          <section className="results" aria-labelledby="stress-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">08 / Stress Lab</p>
                <h2 id="stress-title">Historical stress periods.</h2>
              </div>
              <span className="tag">Fixed windows · re-initialized</span>
            </div>
            <StressLab
              key={result.metadata.snapshotHash}
              config={result.config}
              today={today}
            />
          </section>
          <section className="results" aria-labelledby="results-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">09 / Historical ledger</p>
                <h2 id="results-title">A traceable return ledger.</h2>
              </div>
              <span className="tag">
                {changed || pending
                  ? "Last successful analysis"
                  : "Historical data"}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <caption>
                  Latest 10 historical ledger observations · indexed starting
                  wealth $10,000
                </caption>
                <thead>
                  <tr>
                    <th>Interval</th>
                    <th>Daily return</th>
                    <th>Indexed wealth</th>
                    <th>After close</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ledger.slice(-10).map((row) => (
                    <tr key={row.date}>
                      <td>
                        {row.startDate} → {row.date}
                      </td>
                      <td>{percent(row.return)}</td>
                      <td>{money(row.wealth)}</td>
                      <td>
                        {row.rebalanced ? "Reset to targets" : "Weights drift"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="methodology" id="methodology">
              <summary>
                Methodology &amp; data lineage <span aria-hidden>+</span>
              </summary>
              <p>
                Arithmetic adjusted-close returns compound geometrically.
                Holdings drift during each month; fixed targets reset at
                month-end closing value before the next session’s return.
                Distributions are already embedded in adjusted prices.{" "}
                {result.config.cashPolicy === "zero_explicit"
                  ? "Explicit outage fallback: CASH earns zero over this entire run; missing risk-free returns remain unavailable."
                  : "CASH uses prior-known DGS3MO with actual calendar days / 365."}
              </p>
              <p>
                Performance ({result.performance.methodologyVersion}):
                cumulative return, CAGR and drawdowns use the compounded wealth
                path; CAGR annualizes over actual calendar days ÷ 365.25.
                Volatility, Sharpe and Sortino use daily arithmetic returns
                annualized by 252. Sharpe and Sortino use each interval&rsquo;s
                prior-known DGS3MO accrual (actual days ÷ 365) as the risk-free
                return and are unavailable unless every interval has one.
                Sortino&rsquo;s downside deviation spans the full sample.
                Drawdowns are daily closes; recovery is searched only through
                the effective end. Undefined statistics show N/A with a reason,
                never NaN or infinity.
              </p>
              <p>
                Benchmark ({result.benchmarkAnalytics.methodologyVersion}): one
                canonical sample pairs each portfolio interval with a benchmark
                return only when the ETF has adjusted closes at both interval
                endpoints; missing sessions are excluded, never filled. Beta,
                correlation, active return, tracking error, information ratio
                and CAPM alpha all use that sample; alpha additionally requires
                every interval&rsquo;s prior-known DGS3MO accrual and is
                otherwise unavailable. Alpha is the OLS intercept of excess
                returns, annualized × 252. Geometric CAGR and cumulative
                comparisons and benchmark drawdown require continuous coverage.
              </p>
              <p>
                Risk ({result.riskAnalytics.methodologyVersion}): one common
                sample of daily adjusted-price returns across all risky holdings
                feeds a sample covariance matrix (annualized × 252),
                correlations, standalone volatilities and the Euler
                decomposition of √(w′Σw) at target weights. CASH is outside the
                matrix and treated as locally riskless. Fewer than 60 common
                observations make covariance-based risk unavailable; 60–251 are
                flagged as limited. Return contribution uses each
                interval&rsquo;s actual beginning weight and is arithmetic, not
                linked attribution.
              </p>
              <p>
                Rolling ({result.rollingAnalytics.methodologyVersion}): 20-, 60-
                and 120-session volatility, beta and correlation use the same
                formulas as the full-period statistics on the N daily returns
                ending at each close. A value appears only when all N are
                consecutive scheduled sessions; beta and correlation also need
                benchmark prices at both ends of every interval, so a window
                touching a missing benchmark session stays blank rather than
                being compressed.
              </p>
              <p>
                Stress Lab (stress-v1, separate request and snapshot hash):
                fixed windows GFC 2007-10-09 → 2009-03-09, COVID 2020-02-19 →
                2020-03-23 and 2022 2021-12-31 → 2022-12-30, between session
                closes. Each event re-initializes the target portfolio at its
                start close, earns its first return at the next session and
                applies the same monthly closing resets. Every holding needs a
                price at every window session; otherwise the event reports
                Incomplete Historical Coverage and is never shortened or
                proxy-filled. Event active return is portfolio minus benchmark
                cumulative return; holding returns are standalone.
              </p>
              <ul>
                {result.metadata.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p>
                Methodology {result.metadata.version} ·{" "}
                {result.metadata.calendarVersion}
                {result.metadata.federalCalendarVersion &&
                  ` · ${result.metadata.federalCalendarVersion}`}
              </p>
              <p className="hash">
                Snapshot SHA-256: {result.metadata.snapshotHash}
              </p>
              <p>
                Generated {timestamp(result.metadata.generatedAt)}. Historical
                sources: {result.metadata.historicalProviders.join(", ")}.
                Treasury: {result.metadata.treasuryProvider ?? "Unavailable"}.
              </p>
              <div className="table-wrap">
                <table>
                  <caption>Data coverage and fetch provenance</caption>
                  <thead>
                    <tr>
                      <th>Security</th>
                      <th>First fetched date</th>
                      <th>Last date</th>
                      <th>Rows in requested range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.coverage.map((c) => (
                      <tr key={c.ticker}>
                        <td>{c.ticker}</td>
                        <td>{c.firstAvailableDate}</td>
                        <td>{c.lastAvailableDate}</td>
                        <td>{c.observationCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.snapshot.prices.map((s) => (
                <p className="hint" key={s.ticker}>
                  {s.ticker}: {s.provenance.provider}; fetched{" "}
                  {timestamp(s.provenance.fetchedAt)}; cache age{" "}
                  {Math.round(s.provenance.cacheAgeSeconds)}s;{" "}
                  {s.provenance.fallbackUsed
                    ? "fallback used"
                    : "primary source"}
                  .
                </p>
              ))}
            </details>
          </section>
        </>
      )}
      <section className="current-context" aria-labelledby="context-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">10 / Separate current context</p>
            <h2 id="context-title">Latest observations.</h2>
          </div>
          <span className="muted">Excluded from the historical engine</span>
        </div>
        {!quotes && !curve && (
          <p className="muted">
            Run an analysis to request current quotes and the latest official
            Treasury reference independently.
          </p>
        )}
        {quotes && (
          <div className="table-wrap">
            <table>
              <caption>
                Current market snapshot · latency is not guaranteed
              </caption>
              <thead>
                <tr>
                  <th>Security</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Market timestamp</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, i) => {
                  if (!q.ok)
                    return (
                      <tr key={i}>
                        <td>{q.error.ticker ?? "Quotes"}</td>
                        <td colSpan={4}>{q.error.message}</td>
                      </tr>
                    );
                  const v = quoteClock
                    ? quoteAfterElapsed(
                        q.value,
                        quoteClock.now - quoteClock.received,
                      )
                    : q.value;
                  return (
                    <tr key={v.ticker}>
                      <td>{v.ticker}</td>
                      <td>{money(v.price)}</td>
                      <td>
                        {v.status.replaceAll("_", " ")}
                        {v.stale && <span className="warning"> · stale</span>}
                      </td>
                      <td>{timestamp(v.marketTimestamp)}</td>
                      <td className="hint">
                        {v.provider}
                        <br />
                        Observation age {Math.round(v.observationAgeSeconds)}s ·
                        cache age at fetch{" "}
                        {Math.round(v.provenance.cacheAgeSeconds)}s<br />
                        Last refresh{" "}
                        {timestamp(v.provenance.lastSuccessfulRefresh)}
                        {v.stale && (
                          <>
                            <br />A newer market close exists; refresh for a
                            current observation.
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {curve &&
          (curve.ok ? (
            <div className="treasury">
              <p className="eyebrow">
                Treasury curve reference · latest official ·{" "}
                {curve.value.provenance.observationDate}
              </p>
              <div className="curve-points">
                {curve.value.points.map((p) => (
                  <div key={p.maturity}>
                    <span>{p.maturity}</span>
                    <strong>{(p.annualYield * 100).toFixed(2)}%</strong>
                  </div>
                ))}
              </div>
              <p className="hint">
                {curve.value.provenance.provider} · Last refresh{" "}
                {timestamp(curve.value.provenance.lastSuccessfulRefresh)} ·
                Cache age {Math.round(curve.value.provenance.cacheAgeSeconds)}s.
                Informational context only; these current yields never enter
                historical returns.
              </p>
            </div>
          ) : (
            <p className="muted">{curve.error.message}</p>
          ))}
      </section>
    </>
  );
}
