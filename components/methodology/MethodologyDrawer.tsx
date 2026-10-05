"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BacktestResult } from "@/lib/types/analytics";
import { count, timestamp } from "@/lib/utils/format";

export const METHODOLOGY_EVENT = "methodology:open";
export type MethodologyTopic =
  | "data"
  | "coverage"
  | "portfolio"
  | "performance"
  | "benchmark"
  | "risk"
  | "stress"
  | "construction"
  | "numerics";

/** Opens the drawer from anywhere (header, section links) without shared state. */
export function openMethodology(topic?: MethodologyTopic) {
  window.dispatchEvent(new CustomEvent(METHODOLOGY_EVENT, { detail: topic }));
}

const TOPICS: { id: MethodologyTopic; title: string }[] = [
  { id: "data", title: "Data" },
  { id: "coverage", title: "Coverage" },
  { id: "portfolio", title: "Portfolio" },
  { id: "performance", title: "Performance" },
  { id: "benchmark", title: "Benchmark" },
  { id: "risk", title: "Risk" },
  { id: "stress", title: "Stress" },
  { id: "construction", title: "Construction" },
  { id: "numerics", title: "Numerics" },
];

function Topic({
  id,
  title,
  children,
}: {
  id: MethodologyTopic;
  title: string;
  children: ReactNode;
}) {
  const [gistOpen, setGistOpen] = useState(true);
  return (
    <section
      className="method-topic"
      aria-labelledby={`method-${id}`}
      data-gist-open={gistOpen ? "true" : "false"}
    >
      <div className="method-topic-head">
        <h3 id={`method-${id}`}>{title}</h3>
        <button
          type="button"
          className="method-gist-toggle"
          aria-expanded={gistOpen}
          onClick={() => setGistOpen((open) => !open)}
        >
          <span className="method-gist-toggle-icon" aria-hidden="true">i</span>
          {gistOpen ? "Hide key idea" : "Show key idea"}
        </button>
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="method-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlainEnglish({ children }: { children: ReactNode }) {
  return (
    <aside className="method-plain" aria-label="Key idea explanation">
      <span className="method-plain-label">
        <span className="method-plain-icon" aria-hidden="true">i</span>
        The Key Idea
      </span>
      <p>{children}</p>
    </aside>
  );
}

/** The single Methodology drawer. The main UI stays concise; formulas, conventions
 * and data lineage live here, organized by topic. Static rules come from
 * docs/METHODOLOGY.md; run-specific facts come from the displayed result only. */
export function MethodologyDrawer({
  result,
}: {
  result: BacktestResult | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const d = dialog.current;
      if (!d) return;
      if (!d.open) {
        // jsdom and very old browsers lack showModal; fall back to a plain open dialog.
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      }
      const topic = (e as CustomEvent<MethodologyTopic | undefined>).detail;
      const target = topic && d.querySelector(`#method-${topic}`);
      if (target instanceof HTMLElement) target.scrollIntoView?.();
      else d.querySelector(".method-body")?.scrollTo?.(0, 0);
    };
    window.addEventListener(METHODOLOGY_EVENT, open);
    return () => window.removeEventListener(METHODOLOGY_EVENT, open);
  }, []);
  const close = () => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  };
  const m = result?.metadata;
  const bench = result?.benchmarkAnalytics.comparison;
  const riskSample = result?.riskAnalytics.sample;
  return (
    <dialog
      ref={dialog}
      className="methodology-drawer"
      aria-labelledby="methodology-title"
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const stops = e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]',
        );
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself) closes the drawer.
        if (e.target === e.currentTarget) close();
      }}
    >
      <style>{`
        .method-topic-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .method-topic-head h3 {
          margin-bottom: 0;
        }
        .method-gist-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 28px;
          padding: 4px 8px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--muted);
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .method-gist-toggle:hover {
          border-color: var(--accent-line);
          color: var(--accent);
          background: var(--accent-soft);
        }
        .method-gist-toggle-icon,
        .method-plain-icon {
          display: inline-grid;
          place-items: center;
          width: 13px;
          height: 13px;
          flex: 0 0 13px;
          border: 1px solid currentColor;
          border-radius: 50%;
          font-family: inherit;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0;
          line-height: 1;
          text-transform: none;
        }
        .method-plain {
          margin: 8px 0 16px;
          padding: 10px 12px 11px;
          border: 1px solid rgba(29, 78, 216, 0.16);
          border-left: 2px solid var(--accent);
          border-radius: 4px;
          background: rgba(29, 78, 216, 0.045);
        }
        .method-topic[data-gist-open="false"] .method-plain {
          display: none;
        }
        .method-plain-label {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
          color: var(--accent);
          font-family: var(--mono);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.1em;
          line-height: 1.2;
          text-transform: uppercase;
        }
        .method-plain p {
          margin: 0;
          color: var(--muted);
          font-size: 12.5px;
          line-height: 1.55;
        }
        .method-topic li > .method-plain {
          margin: 8px 0 12px;
        }
      `}</style>
      <div className="method-head">
        <div>
          <p className="eyebrow">Methodology &amp; data lineage</p>
          <h2 id="methodology-title">How every number is produced.</h2>
        </div>
        <button
          type="button"
          className="secondary method-close"
          onClick={close}
          aria-label="Close methodology"
        >
          Close <span aria-hidden>×</span>
        </button>
      </div>
      <nav className="method-toc" aria-label="Methodology topics">
        {TOPICS.map((t) => (
          <a key={t.id} href={`#method-${t.id}`}>
            {t.title}
          </a>
        ))}
      </nav>
      <div className="method-body" tabIndex={0} role="region" aria-label="Methodology explanations">
        <Topic id="data" title="Data">
          <p>
            Historical prices are daily adjusted closes from the historical
            provider. Adjusted-close ratios incorporate supported splits and
            distributions, so returns are a provider-defined total-return-aware
            proxy; no dividend is added a second time. Portfolio and benchmark
            use the same convention.
          </p>
          <PlainEnglish>
            We use prices that already account for things like stock splits and supported distributions, so the backtest does not count those effects twice.
          </PlainEnglish>
          <p>
            Current quotes come from a separate quote request and are shown only
            in Current Market. Unknown latency is labeled Latest Available; a
            quote is marked stale once a newer market close exists. Quotes never
            enter a historical calculation.
          </p>
          <PlainEnglish>
            The latest quote is just current context. It never goes back and changes the historical performance calculations.
          </PlainEnglish>
          <p>
            The Historical Risk-Free series is FRED DGS3MO (3-month constant
            maturity). A rate is used only when it was modeled as available
            before the interval began: 23:59 ET on the next federal business
            day, with a maximum observation age of seven calendar days. FRED
            exposes revised history, so this conservative timing model does not
            establish historical vintage accuracy. The Current Treasury Reference (3M–10Y) is the latest common
            official observation and is informational only.
          </p>
          <PlainEnglish>
            When the model needs a cash or risk-free return, it uses a Treasury rate that would have been treated as known before that return period began, not today&apos;s rate.
          </PlainEnglish>
          {m ? (
            <Facts
              rows={[
                ["Historical provider", m.historicalProviders.join(", ")],
                ["Historical Risk-Free", m.treasuryProvider ?? "Unavailable"],
                [
                  "Return convention",
                  m.returnConvention === "total_return_aware_adjusted"
                    ? "Total-return-aware adjusted closes"
                    : m.returnConvention.replaceAll("_", " "),
                ],
                ["Generated", timestamp(m.generatedAt)],
                [
                  "Data cutoff",
                  `${m.effectiveEndDate} (last finalized session)`,
                ],
              ]}
            />
          ) : (
            <p className="hint">
              Run an analysis to see this run&rsquo;s providers and timestamps.
            </p>
          )}
        </Topic>
        <Topic id="coverage" title="Coverage">
          <p>
            The analysis starts at the first common session on or after the
            requested start at which every positive-weight holding has valid
            history. Missing interior or terminal sessions fail explicitly;
            prices are never forward-filled, and no history is invented or
            substituted. Today&rsquo;s bar is excluded until the next market
            date.
          </p>
          <PlainEnglish>
            Every holding has to have real data for the dates being used. If there is a hole, the model does not guess a price or quietly fill it in.
          </PlainEnglish>
          <p>
            Benchmark statistics use only intervals where the benchmark has
            closes at both ends. Risk statistics use one common sample across
            all risky holdings: fewer than 60 returns is Insufficient History,
            60–251 is Limited History.
          </p>
          <PlainEnglish>
            Comparisons only use dates where the things being compared actually overlap. Short histories are clearly flagged instead of being treated as equally reliable.
          </PlainEnglish>
          {m && (
            <Facts
              rows={[
                [
                  "Requested period",
                  `${m.requestedStartDate} → ${m.requestedEndDate}`,
                ],
                [
                  "Effective period",
                  `${m.effectiveStartDate} → ${m.effectiveEndDate} · ${count(m.sample.returnCount, "return")}`,
                ],
                [
                  "Limited by",
                  m.limitingHoldings.length
                    ? m.limitingHoldings.join(", ")
                    : "Requested start",
                ],
                [
                  "Benchmark overlap",
                  bench?.available
                    ? `${bench.sample.startDate} → ${bench.sample.endDate} · ${count(bench.sample.returnCount, "aligned return")}`
                    : "Benchmark Data Unavailable",
                ],
                [
                  "Common holding sample",
                  riskSample?.available
                    ? `${riskSample.sample.startDate} → ${riskSample.sample.endDate} · ${count(riskSample.sample.returnCount, "return")}`
                    : (riskSample?.reason ?? "—"),
                ],
              ]}
            />
          )}
        </Topic>
        <Topic id="portfolio" title="Portfolio">
          <p>
            $10,000 is invested at target weights on the first session. Weights
            drift with returns during each month; after the last session of the
            month the portfolio resets to target weights at that closing value,
            before the next return. Results are gross of transaction costs,
            taxes and trading frictions.
          </p>
          <PlainEnglish>
            The model starts with $10,000, lets winners and losers change their weights during the month, then rebalances back to your target mix once a month. It does not subtract taxes or trading costs.
          </PlainEnglish>
          <p>
            CASH earns the prior-known DGS3MO yield as a synthetic accrual, (1 +
            yield)<sup>days/365</sup> − 1 over the actual calendar gap. If
            Treasury history is missing, a CASH run fails unless whole-run
            zero-return CASH is explicitly selected. CASH is treated as locally
            riskless in risk decomposition and never uses one of the 20 risky
            slots.
          </p>
          <PlainEnglish>
            Cash is modeled as earning the historical 3-month Treasury rate. If that Treasury history is unavailable, the app will not invent a cash return unless you explicitly choose zero-return cash.
          </PlainEnglish>
          <p>
            Exposure classification uses stored snapshots, never the return or
            risk engines. Stocks take a sector (Morningstar&apos;s, via Yahoo
            Finance, mapped onto eleven sectors) and a style cell: size by
            market cap (Large ≥ $20B, Mid ≥ $3B, otherwise Small), value or
            growth by the average rank of earnings yield (trailing and forward)
            and book-to-price within that size group, in thirds. Broad ETFs are
            split by rounded fact-sheet profiles; bond, commodity and
            single-sector funds by mandate. Anything outside the snapshots is
            listed as unclassified and never renormalized away.
          </p>
          <PlainEnglish>
            Sectors and the value/growth grid come from a saved snapshot, not live data. A stock counts as &ldquo;value&rdquo; when it is cheap on earnings and book value compared with companies of a similar size. Holdings the snapshot does not cover are named on the page instead of being quietly dropped.
          </PlainEnglish>
        </Topic>
        <Topic id="performance" title="Performance">
          <ul>
            <li>
              <strong>Cumulative return</strong>: ending ÷ starting wealth − 1
              on the compounded daily path.
              <PlainEnglish>
                The total percentage gain or loss from the beginning of the period to the end.
              </PlainEnglish>
            </li>
            <li>
              <strong>CAGR</strong>: (ending ÷ starting)<sup>1/years</sup> − 1,
              years = calendar days ÷ 365.25. Periods under one year are marked
              as annualized from less than one year.
              <PlainEnglish>
                The single yearly growth rate that would turn the starting value into the ending value over the same amount of time. It is not the simple average of each year&apos;s return.
              </PlainEnglish>
            </li>
            <li>
              <strong>Annualized Volatility</strong>: sample standard deviation
              (n − 1) of daily arithmetic returns × √252.
              <PlainEnglish>
                A measure of how much the portfolio&apos;s daily returns bounced around, scaled to a one-year number. More movement means higher volatility.
              </PlainEnglish>
            </li>
            <li>
              <strong>Sharpe</strong>: mean daily excess return ÷ its sample
              standard deviation × √252, excess over each interval&rsquo;s
              Historical Risk-Free accrual.
              <PlainEnglish>
                How much return the portfolio earned above the modeled cash rate for each unit of overall volatility it took on.
              </PlainEnglish>
            </li>
            <li>
              <strong>Sortino</strong>: annualized mean excess return ÷
              annualized downside deviation, where downside deviation is
              √mean(min(excess, 0)²) over every interval, not only losing ones.
              <PlainEnglish>
                Similar to Sharpe, but it focuses the risk penalty on returns that fell below the risk-free benchmark instead of treating upside and downside movement the same.
              </PlainEnglish>
            </li>
            <li>
              <strong>Maximum Drawdown</strong>: min(wealth ÷ running peak − 1)
              on daily closes; the starting value counts as a peak. Recovery is
              searched only through the effective end.
              <PlainEnglish>
                The worst peak-to-bottom loss an investor would have experienced during the period before the portfolio recovered, if it recovered at all.
              </PlainEnglish>
            </li>
            <li>
              <strong>Return Contribution</strong>: each holding&rsquo;s
              beginning-of-day weight × its daily return, summed arithmetically
              over the period. It adds up to the sum of daily portfolio returns,
              not the compounded return, and is not Brinson attribution.
              <PlainEnglish>
                A simple way to see which holdings pushed daily portfolio returns up or down the most. It is not the same thing as a full professional attribution model.
              </PlainEnglish>
            </li>
          </ul>
        </Topic>
        <Topic id="benchmark" title="Benchmark">
          <p>
            The benchmark is an ETF, so its distributions, expenses and tracking
            difference are part of the series. All relative statistics share one
            aligned sample of daily arithmetic returns.
          </p>
          <PlainEnglish>
            The portfolio and benchmark are compared on the exact same dates so neither side gets an unfair advantage from having different data windows.
          </PlainEnglish>
          <ul>
            <li>
              <strong>Beta</strong>: Cov(portfolio, benchmark) ÷ Var(benchmark),
              raw returns.
              <PlainEnglish>
                How sensitive the portfolio has historically been to benchmark moves. Around 1 means similar sensitivity; above 1 means larger moves on average, and below 1 means smaller moves on average.
              </PlainEnglish>
            </li>
            <li>
              <strong>CAPM alpha</strong>: OLS intercept of portfolio excess on
              benchmark excess returns × 252 (linear, never compounded). It
              needs a Historical Risk-Free return on every aligned interval.
              <PlainEnglish>
                The annualized return left over after the model accounts for the risk-free rate and the portfolio&apos;s historical exposure to benchmark movements.
              </PlainEnglish>
            </li>
            <li>
              <strong>Correlation</strong>: Pearson correlation of aligned daily
              returns.
              <PlainEnglish>
                How closely the portfolio and benchmark tended to move together. +1 is very closely together, 0 means little linear relationship, and −1 means opposite directions.
              </PlainEnglish>
            </li>
            <li>
              <strong>Active Return</strong>: mean(portfolio − benchmark) × 252;
              never a difference of CAGRs.
              <PlainEnglish>
                The annualized average amount by which the portfolio&apos;s daily return differed from the benchmark&apos;s daily return.
              </PlainEnglish>
            </li>
            <li>
              <strong>Tracking Error</strong>: sample standard deviation of
              daily active returns × √252.
              <PlainEnglish>
                How inconsistent the portfolio&apos;s performance difference versus the benchmark has been. A larger number means the gap moved around more.
              </PlainEnglish>
            </li>
            <li>
              <strong>Information Ratio</strong>: Active Return ÷ Tracking
              Error; unavailable when tracking error is zero.
              <PlainEnglish>
                Active return relative to how much that active return varied. It puts benchmark-relative return and benchmark-relative variability into one ratio.
              </PlainEnglish>
            </li>
          </ul>
        </Topic>
        <Topic id="risk" title="Risk">
          <p>
            Historical Risk Analysis uses the sample covariance matrix Σ of
            daily returns on the common holding sample, annualized × 252, at
            target weights w. Portfolio volatility σ = √(w′Σw). Marginal
            contribution MRC = (Σw)ᵢ ÷ σ; Risk Contribution CRC = wᵢ × MRC,
            summing to σ; its share PCR = CRC ÷ σ, summing to 100%.
          </p>
          <PlainEnglish>
            Portfolio risk is not just each holding&apos;s risk added together. The model also looks at how the holdings moved with one another, then estimates how much each holding contributes to the portfolio&apos;s total volatility.
          </PlainEnglish>
          <p>
            A hedging holding can have a negative Risk Contribution and another
            can exceed 100%; values are never clamped. This is a model snapshot
            at target weights, distinct from realized volatility of the drifting
            portfolio, and historical covariance is not a forecast.
          </p>
          <PlainEnglish>
            A holding can actually reduce overall portfolio risk if it tends to offset other holdings. That is why one asset can show a negative contribution and another can show more than 100% before the offsets are included.
          </PlainEnglish>
          <p>
            Diversification ratio = Σ wᵢσᵢ ÷ σ (above 1 means correlations below
            +1 reduce risk). Effective holdings = 1 ÷ Σ wᵢ² measures capital
            concentration only, not correlation diversification.
          </p>
          <PlainEnglish>
            The diversification ratio asks whether combining the holdings reduced risk because they do not move perfectly together. Effective holdings only asks how concentrated the dollar weights are; it does not know anything about correlations.
          </PlainEnglish>
        </Topic>
        <Topic id="stress" title="Stress">
          <p>
            Fixed windows between session closes: Global Financial Crisis
            2007-10-09 → 2009-03-09, COVID Crash 2020-02-19 → 2020-03-23, 2022
            Inflation / Rate Shock 2021-12-31 → 2022-12-30. These are documented
            choices, not universal crisis definitions.
          </p>
          <PlainEnglish>
            Stress Lab asks, “What would this same portfolio have done during these specific historical periods?” It is a replay of history, not a forecast of the next crisis.
          </PlainEnglish>
          <p>
            Each event re-initializes the configured portfolio at target weights
            at the start close and applies the same monthly resets. If any
            holding lacks a price at any window session the event reports
            Incomplete Historical Coverage: it is never shortened, bridged or
            proxy-filled. Event Active Return is a simple difference of the two
            window returns, not annualized. A Custom Historical Window uses the
            same rules on dates you choose, up to 10 years.
          </p>
          <PlainEnglish>
            Each stress test starts fresh at your target weights and uses the full chosen window. If a holding is missing required history, the app shows that limitation instead of shortening the event or filling in fake prices.
          </PlainEnglish>
        </Topic>
        <Topic id="construction" title="Construction">
          <p>
            Construction uses Σ<sub>construction</sub> = 252 × [(1 − δ)S + δμI]:
            Ledoit–Wolf shrinkage of the sample covariance toward a scaled
            identity. The Historical Risk Analysis keeps the sample matrix; the
            two are never mixed. No method uses expected returns.
          </p>
          <PlainEnglish>
            Historical relationships between assets can be noisy. For construction, the model slightly stabilizes that covariance estimate before solving so extreme historical relationships have less power to distort the weights. It does not try to predict future returns.
          </PlainEnglish>
          <ul>
            <li>
              <strong>Equal Weight</strong>: the risky budget split equally,
              projected onto the bounds.
              <PlainEnglish>
                Give each risky holding the same allocation as closely as possible while still obeying your minimum and maximum weight limits.
              </PlainEnglish>
            </li>
            <li>
              <strong>Inverse Volatility</strong>: weights ∝ 1 ÷ σᵢ, projected
              onto the bounds. Not risk parity.
              <PlainEnglish>
                Give less weight to holdings that were historically more volatile and more weight to holdings that were historically calmer. It does not account for the full risk-sharing effect of correlations.
              </PlainEnglish>
            </li>
            <li>
              <strong>Minimum Variance</strong>: minimize w′Σw under the budget
              and bounds (projected gradient with an exact polish).
              <PlainEnglish>
                Search for the allowed mix with the lowest modeled portfolio volatility based on the historical covariance estimate.
              </PlainEnglish>
            </li>
            <li>
              <strong>ERC</strong>: minimize Σ(PCRᵢ − 1/N)². When exact parity is not achieved, a certified result is labeled
              Constrained Risk-Balance Approximation (Approximate ERC). Bounds
              are named as the cause only when infeasibility has been proven.
              <PlainEnglish>
                Try to make every risky holding contribute the same share of total portfolio risk. Equal risk contribution is about risk, not equal dollar weights.
              </PlainEnglish>
            </li>
          </ul>
          <p>
            Constraints are long-only fractions of the whole portfolio, checked
            for feasibility before solving. CASH is fixed and never optimized;
            the risky budget is 1 − CASH. Usable results are checked independently for budget and bounds.
            Minimum variance also requires stationarity. ERC requires exact
            parity within tolerance, or stationarity plus an analytic
            second-order check on feasible directions. Local certification
            alone is not a global optimality claim. Estimated One-Way Turnover = ½ Σ |proposed −
            current|. The Current vs Proposed comparison is an In-Sample
            Retrospective Analysis on the same history the weights were
            estimated from.
          </p>
          <PlainEnglish>
            The optimizer cannot break your rules: it stays long-only, keeps CASH fixed, and respects the weight bounds. The “current vs proposed” comparison uses the same history that created the proposed weights, so it describes that historical sample rather than predicting future performance.
          </PlainEnglish>
        </Topic>
        <Topic id="numerics" title="Numerics">
          <ul>
            <li>
              Risk statistics annualize by 252 trading days; cash accrual uses
              calendar days ÷ 365; CAGR uses calendar days ÷ 365.25.
              <PlainEnglish>
                Different calculations use the time convention that matches what they measure: trading days for market-return statistics and calendar days for cash growth and elapsed years.
              </PlainEnglish>
            </li>
            <li>
              Dispersion at or below 1e-12 × the largest observation is treated
              as zero, so roundoff cannot create enormous ratios.
              <PlainEnglish>
                If a value is so tiny that it is effectively computer rounding noise, the app treats it as zero instead of turning it into a misleading giant ratio.
              </PlainEnglish>
            </li>
            <li>
              Undefined statistics (zero variance, missing risk-free data,
              samples that are too short) show N/A with the reason; NaN and
              Infinity are never displayed.
              <PlainEnglish>
                If the math cannot produce a meaningful number, the app tells you why instead of displaying a broken or made-up result.
              </PlainEnglish>
            </li>
            <li>
              Construction tolerances: budget and bounds 1e-10, stationarity and
              KKT 1e-8, ERC parity 1e-6.
              <PlainEnglish>
                Optimization uses very small numerical tolerances because computers cannot represent every decimal perfectly. Those tolerances allow harmless rounding error without accepting a materially wrong solution.
              </PlainEnglish>
            </li>
            <li>
              Display rounding never feeds a calculation. Results replay exactly
              from their snapshot, and each result carries a SHA-256 snapshot
              hash.
              <PlainEnglish>
                The rounded number you see on screen is only for presentation. Calculations use the full stored precision, and the snapshot hash helps identify the exact inputs behind a result.
              </PlainEnglish>
            </li>
          </ul>
          {m && (
            <Facts
              rows={[
                ["Methodology", `${m.version} · ${m.engineVersion}`],
                [
                  "Calendars",
                  `${m.calendarVersion} · ${m.federalCalendarVersion}`,
                ],
                [
                  "Snapshot SHA-256",
                  <span className="hash" key="hash">
                    {m.snapshotHash}
                  </span>,
                ],
              ]}
            />
          )}
        </Topic>
        <p className="hint method-disclaimer">
          For educational and analytical purposes only. Historical results do
          not guarantee future performance and should not be considered
          investment advice.
        </p>
      </div>
    </dialog>
  );
}

/** Header/section trigger. */
export function MethodologyButton({
  topic,
  children = "Methodology",
  className = "text-action",
}: {
  topic?: MethodologyTopic;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      onClick={() => openMethodology(topic)}
    >
      {children}
    </button>
  );
}