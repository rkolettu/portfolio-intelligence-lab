# V2 Task Plan: Portfolio Theory and Stock Lab

This document tracks V2 of the Portfolio Intelligence & Construction Lab. V2 adds a
12-month forward model with these parts:

- CAPM prior;
- Street and manual views;
- Black–Litterman expected returns;
- efficient frontier, GMV and tangency;
- Model CAL, Market CML Proxy and SML;
- Stock Lab, which uses the same engine.

**Status legend:** NOT STARTED · IN PROGRESS · BLOCKED — USER DECISION REQUIRED · COMPLETE.
A task is COMPLETE only when all of these hold:

- the implementation is done;
- its tests are done;
- typecheck passes;
- its methodology is documented;
- no issue is unresolved.

Open questions are numbered **Q1–Q26**. The full text of each question is in the plan
review (chat) and summarised in [Open questions](#open-questions) below. A task that
depends on an unanswered question is BLOCKED.

## Baseline (before any V2 code, 2026-10-08, `main` @ 5d0840a)

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest --run` | 53 files, 498 / 498 passed |
| `npm run build` | passes (21 routes) |
| `npm run lint` | **1 pre-existing error**: `components/metrics/InfoTip.tsx:29` (`react-hooks/set-state-in-effect`). It predates V2; see Q26. |
| Playwright | not run in this container (it needs installed Google Chrome per `playwright.config.ts`) |

## Architecture principles (binding for every task)

1. **Three layers.** Each layer lives in its own code.
   - *Historical* (existing `lib/backtest`, `lib/analytics`) is unchanged.
   - *Forward model* is new: `lib/forward/*`.
   - *Decision analysis* is new: `lib/stock-lab/*`. It reuses both of the other layers.
2. **One forward engine.** Portfolio Theory and Stock Lab call the same pure function,
   `runForwardModel(snapshot, assumptions, views)`. Stock Lab never computes its own
   CAPM prior, BL, Σ, β or Rf.
3. **Reuse, do not duplicate.** These functions are reused as they are:
   - `ledoitWolf`, `annualizeCovariance`, `validateCovariance`;
   - `beta`, `sampleCovarianceMatrix`, `correlationMatrix`;
   - `riskContributions`, `modelRisk`, `minimumVariance` (which serves as GMV);
   - `equalWeight`, `inverseVolatility`, `equalRiskContribution`;
   - `simulate`, `runStress`, `portfolioCoverage`, `loadHistories`;
   - `currentTreasury`, `snapshotHash`, `solveLinear`, `kktResidual`, `bindingConstraints`.

   New solver infrastructure is added only where no existing solver covers the
   problem: the frontier and tangency (see Q8).
4. **Fixed horizon.** The outlook is the next 12 months, always. Nothing is
   compounded or extrapolated, and no decay is applied.
5. **No AI and no recommendations.** The app reports measurable facts only. It never
   uses the words Buy, Sell, Undervalued or Overvalued.
6. **Repository boundary.** All V2 financial logic lives in this repository. The
   Street-data adapter is server-only and lives here too. **No change to
   `portfolio-lab-market-data` is planned.**
7. **Versioned methodology.** New constants are *appended* to `config/methodology.ts`
   as `FORWARD_METHODOLOGY` and `STOCK_LAB_METHODOLOGY`. Existing constants are not
   edited, so every existing snapshot hash and replay is unchanged.

---

## TASK 0 — Repository audit and architecture plan
- **STATUS:** IN PROGRESS: plan delivered and awaiting approval.
- **PURPOSE:** Inspect the repository, identify what can be reused, and propose the
  architecture, task plan and questions.
- **DEPENDENCIES:** none.
- **FILES:** `docs/V2-TASKS.md` (this file).
- **TESTS:** baseline recorded above.
- **RESULT:** the plan is submitted. No implementation code has been written.

## TASK 1 — Forward-model contracts, assumptions and methodology constants
- **STATUS:** NOT STARTED.
- **PURPOSE:** Define the types and defaults that every later task builds on:
  - types: `ForwardAssumptions`, `ForwardSnapshot`, `ForwardModelResult`, `View`,
    `ExpectedReturnRow`, `FrontierPoint` and `LineSeries`;
  - `FORWARD_METHODOLOGY`: the version, horizon 12M, risk windows {1Y, 3Y, 5Y}
    (default 3Y), market proxies {VTI, SPY, VT} (default VTI), MRP default 5.00%,
    confidence default 50%, τ, tolerances and the frontier point count;
  - Zod validation of the assumptions;
  - the versioned localStorage schema for the MRP, the proxy, the window and the
    views.
- **DEPENDENCIES:** Task 0 approval.
- **FILES:** `config/methodology.ts` (append only), `lib/types/forward.ts` (new),
  `lib/forward/assumptions.ts` (new), `lib/validation/forward.ts` (new),
  `lib/state/forwardAssumptions.ts` (new).
- **TESTS:**
  - assumptions: defaults, the allowed proxies, rejection of a bond ETF or a custom
    proxy, rejection of a non-finite MRP, and a confidence outside 0–100;
  - persistence: round-trip, fallback when stored data is corrupt, and version
    mismatch;
  - existing snapshot hashes are unchanged (replay tests stay green).
- **METHODOLOGY DECISIONS:**
  - The MRP is labelled *Assumption* and is never presented as market data.
  - Views and assumptions are stored locally only.
- **QUESTIONS:** Q20, Q26.
- **RESULT:** —

## TASK 2 — Forward risk-free rate: 1Y Treasury from the existing curve
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q5).
- **PURPOSE:** Take the 12-month Rf from the 1Y point of the existing
  `currentTreasury()` curve, which already fetches DGS1 through FRED with the
  U.S. Treasury fallback. Expose the yield, the observation date and the source.
  Historical analytics keep DGS3MO, unchanged.
- **DEPENDENCIES:** Task 1.
- **FILES:** `lib/forward/riskFree.ts` (new). It reads the existing cache key
  `fred:current-curve:v1`. No new Treasury provider is added.
- **TESTS:**
  - the 1Y point is selected, with its observation date and provenance;
  - the fallback-provider provenance flows through;
  - curve unavailable → forward model unavailable, with the typed reason and no
    substitution of the 3M rate;
  - the historical engine is untouched (existing treasury tests).
- **METHODOLOGY DECISIONS:** The 1Y yield is a bond-equivalent (CMT) yield. Whether
  to use it as-is or convert it is Q5.
- **RESULT:** —

## TASK 3 — Forward risk model: risk-window sample, Σ, market-proxy β and σ_m
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q1, Q2, Q3, Q4).
- **PURPOSE:** Build the risk window (1Y/3Y/5Y), which is separate from the 12M
  forecast horizon:
  - load the universe plus the market proxy through `loadHistories`;
  - build one common sample with the `portfolioCoverage` rules: no forward-fill,
    no bridging;
  - estimate an annualized Ledoit–Wolf Σ, validated by `validateCovariance`;
  - compute β to the market proxy and the proxy's σ_m;
  - record the sample metadata, hash, δ and conditioning.
- **DEPENDENCIES:** Task 1.
- **FILES:**
  - new: `lib/forward/riskModel.ts`, `lib/forward/sample.ts`;
  - reused: `lib/analytics/shrinkage.ts`, `lib/analytics/covariance.ts`,
    `lib/analytics/benchmark.ts`, `lib/backtest/coverage.ts`.
- **TESTS:**
  - Σ is symmetric and PSD;
  - β equals the closed form;
  - the proxy has β = 1 against itself;
  - portfolio β = wᵀβ equals the β of the target-weight return series;
  - ticker-ordering invariance;
  - limited history: < 60 observations → unavailable, 60–251 → limited;
  - a zero-volatility asset makes the model invalid;
  - a bond-ETF proxy is rejected.
- **METHODOLOGY DECISIONS:**
  - which covariance defines β and σ_m (Q1);
  - window anchoring (Q2);
  - limited-history rule (Q3);
  - whether 0% rows are in the universe (Q4).
- **RESULT:** —

## TASK 4 — CAPM prior
- **STATUS:** BLOCKED (depends on Task 3 / Q1).
- **PURPOSE:**
  - Π_i = Rf + β_i × MRP; CASH earns Rf.
  - Historical CAGR or mean returns are never used as the prior.
- **DEPENDENCIES:** Tasks 2, 3.
- **FILES:** `lib/forward/capm.ts` (new).
- **TESTS:**
  - a hand-computed vector;
  - CASH = Rf;
  - β = 0 → Rf;
  - β = 1 → Rf + MRP;
  - the prior is linear in the MRP;
  - the portfolio prior equals Rf + β_p × MRP.
- **RESULT:** —

## TASK 5 — Views and confidence model
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q7, Q20).
- **PURPOSE:**
  - Each security has No View, Street View or Manual View, plus a confidence from
    0–100% (default 50%). The confidence is never AI-generated.
  - Analyst count, dispersion and freshness are shown as context only and are never
    mapped to confidence.
  - The task builds P (absolute, single-asset views), Q and the confidence-scaled Ω.
- **DEPENDENCIES:** Task 1. The Street values arrive later from Task 14, and manual
  views work without them.
- **FILES:** `lib/forward/views.ts` (new), `lib/state/forwardAssumptions.ts`.
- **TESTS:**
  - c = 0 → the row is removed;
  - c = 1 → Ω_k = 0, with no division by zero;
  - Ω_k = p_k τΣ p_kᵀ (1 − c)/c;
  - an inactive Street view (no data) is never silently replaced by the manual
    value.
- **RESULT:** —

## TASK 6 — Black–Litterman engine
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q6, Q7).
- **PURPOSE:** Compute the posterior with the full matrix formula, not a weighted
  average:
  μ_BL = Π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − PΠ).
- **DEPENDENCIES:** Tasks 4, 5.
- **FILES:** `lib/forward/blackLitterman.ts` (new); reuses `solveLinear`.
- **TESTS (required):**
  - **with no active views, μ_BL equals Π exactly** (bitwise);
  - a single view at confidence c gives μ_k = Π_k + c(q − Π_k);
  - correlated propagation: μ_B − Π_B = (Σ_BA/Σ_AA) × c(q − Π_A);
  - τ-invariance under this Ω convention;
  - ticker-order invariance;
  - 100% confidence on several views;
  - a singular PΣPᵀ fails explicitly.
- **RESULT:** —

## TASK 7 — Forward expected-return table and portfolio forward metrics
- **STATUS:** BLOCKED (depends on Task 6).
- **PURPOSE:**
  - Per security, the table shows: Ticker, β, CAPM Prior (= CAPM Required Return),
    Active View, View Source, Confidence, BL Expected Return and Expected Return Gap
    (BL − CAPM Required).
  - For a portfolio, it computes:
    - E[R_p] = Σwμ_BL + w_cash Rf;
    - β_p = Σwβ;
    - Required_p = Rf + β_p × MRP;
    - Gap_p;
    - model σ_p = √(wᵀΣw);
    - **Forward Model Sharpe** = (E[R_p] − Rf)/σ_p, undefined at σ_p = 0.
- **DEPENDENCIES:** Task 6.
- **FILES:** `lib/forward/expectedReturns.ts` (new); reuses `riskContributions` /
  `modelRisk`.
- **TESTS:**
  - the gap is 0 for every row when there are no views;
  - Gap_p = Σw·gap_i;
  - all-CASH: σ = 0, so Forward Model Sharpe is unavailable;
  - the portfolio expected return and β equal the closed forms.
- **RESULT:** —

## TASK 8 — Efficient-frontier solver
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q8, Q9).
- **PURPOSE:**
  - Solve min wᵀΣw s.t. Σw = 1, wᵀμ_BL = r, w ≥ 0, with risky assets only.
  - Use deterministic target returns from r_GMV to max μ.
  - Each point stores its weights, E[R], σ, status, binding constraints and
    residuals (budget, return, bound, KKT).
  - Points that fail are not plotted.
- **DEPENDENCIES:** Task 6.
- **FILES:** `lib/forward/qp.ts` (new; small dense active-set QP, if Q8 picks it),
  `lib/forward/frontier.ts` (new). Reuses `kktResidual`'s certification philosophy
  and `CONSTRUCTION_METHODOLOGY` tolerances.
- **TESTS:**
  - Σw = 1 and wᵀμ = r within 1e-10;
  - w ≥ 0;
  - σ is monotone along the efficient branch;
  - the KKT residual is ≤ 1e-8;
  - two-asset closed form;
  - unconstrained closed form when no bound binds;
  - an infeasible r is rejected;
  - ticker-order invariance;
  - points are deterministic (identical on repeat runs).
- **RESULT:** —

## TASK 9 — Global Minimum Variance and Constructor consistency
- **STATUS:** BLOCKED (depends on Task 8).
- **PURPOSE:**
  - GMV is the existing `minimumVariance()` on the forward Σ (B = 1, bounds [0,1]).
    It is a single source, not new math.
  - The frontier's low end must agree with it.
- **DEPENDENCIES:** Tasks 3, 8.
- **FILES:** `lib/forward/frontier.ts`.
- **TESTS:**
  - GMV equals the frontier endpoint;
  - with the same window, the same universe, CASH 0 and default bounds, GMV equals
    the Constructor's Minimum-Variance allocation exactly;
  - with CASH c and non-binding caps, Constructor MV = (1 − c) × GMV.
- **RESULT:** —

## TASK 10 — Tangency / Maximum-Sharpe solver
- **STATUS:** BLOCKED (Q8).
- **PURPOSE:**
  - Find the long-only risky portfolio that maximises (wᵀμ_BL − Rf)/σ_p.
  - Use the exact convex reformulation: min yᵀΣy s.t. (μ − Rf)ᵀy = 1, y ≥ 0, then
    w = y/Σy. It is certified by KKT.
  - When no asset has μ_i > Rf, the result is "undefined" with that reason.
- **DEPENDENCIES:** Task 8.
- **FILES:** `lib/forward/tangency.ts` (new).
- **TESTS:**
  - the tangency Sharpe is ≥ the Sharpe of every frontier point and every asset;
  - the tangency lies on the frontier (σ matches at its return);
  - two-asset closed form;
  - the undefined case;
  - ticker-order invariance.
- **RESULT:** —

## TASK 11 — Model CAL, Market CML Proxy and SML line engines
- **STATUS:** BLOCKED (Q1, Q10, Q12).
- **PURPOSE:** Compute the three lines as independent series:
  - **Model CAL:** E = Rf + [(E_t − Rf)/σ_t]σ.
  - **Market CML Proxy:** E = Rf + (MRP/σ_m)σ, with E_m = Rf + MRP.
  - **SML:** E = Rf + β × MRP.
- **DEPENDENCIES:** Tasks 3, 4, 10.
- **FILES:** `lib/forward/lines.ts` (new).
- **TESTS:**
  - the endpoints of each line;
  - the slopes;
  - the CAL passes through the tangency;
  - the CML proxy passes through (σ_m, Rf + MRP);
  - the SML passes through (0, Rf) and (1, Rf + MRP);
  - with no views, every holding lies on the SML;
  - with no views and Q1 = B, the CAL slope is ≤ the CML-proxy slope.
- **RESULT:** —

## TASK 12 — Forward-model orchestration, API route, snapshot and replay
- **STATUS:** BLOCKED (Q19).
- **PURPOSE:**
  - Add a `POST /api/forward-model` route that:
    - validates the config and assumptions;
    - loads the risk-window histories and the proxy;
    - reads the current 1Y Rf and the Street data, if any;
    - runs `runForwardModel`.
  - The result carries a SHA-256 hash over the snapshot, the assumptions and the
    methodology. `runForwardModel({...snapshot, assumptions, views})` reproduces it.
  - The cached-sample mode shows "needs live data", as the Constructor does.
- **DEPENDENCIES:** Tasks 2–11.
- **FILES:** `lib/forward/model.ts` (new), `lib/server/forward.ts` (new),
  `app/api/forward-model/route.ts` (new).
- **TESTS:**
  - injected-provider server tests;
  - replay identity;
  - hash stability;
  - a proxy-fetch failure gives a typed unavailable result;
  - the 1Y curve unavailable;
  - a 22-ticker batch (20 holdings + benchmark + proxy) chunks correctly through
    the existing micro-batcher.
- **RESULT:** —

## TASK 13 — Street-data provider abstraction and first adapter
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q13, Q14, Q18).
- **PURPOSE:**
  - Server-only `StreetDataProvider` with `getConsensus`, `getPriceTargets` and
    `getAnalystEstimates`. The interface is provider-neutral, and records are
    normalized and Zod-validated.
  - The API key is server-side only, from an env var; it is never bundled or logged.
  - Per-instance cache with TTL.
  - A qualification registry, mirroring `config/deployed-providers.ts`, records the
    licence evidence.
  - Candidate: Financial Modeling Prep stable endpoints (see the plan review).
- **DEPENDENCIES:** Task 1.
- **FILES:**
  - new: `lib/street-data/types.ts`, `lib/street-data/normalize.ts`,
    `lib/street-data/providers/<provider>.ts`, `config/street-providers.ts`,
    `lib/server/street.ts`, `app/api/street/route.ts`,
    `scripts/street-smoke.ts`;
  - updated: `.env.example`, `docs/DATA-PROVIDERS.md`, `docs/DEPLOYMENT.md`.
- **TESTS:**
  - schema normalization;
  - missing fields;
  - plan-restricted responses (402/403) → typed `PERMISSION`;
  - ETF → "no analyst coverage";
  - unknown ticker;
  - stale or absent dates;
  - the key never appears in responses or errors.
- **RESULT:** —

## TASK 14 — Street 12M return view
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q14–Q17).
- **PURPOSE:**
  - Street Price Return = Target / Current Price − 1, using the median if it is
    reliably available.
  - Dividend treatment is labelled.
  - The context fields (analyst count, high/low dispersion, freshness) are shown and
    never converted to confidence.
  - The view becomes inactive, with its reason, when the data is missing.
- **DEPENDENCIES:** Tasks 5, 13.
- **FILES:** `lib/forward/streetView.ts` (new).
- **TESTS:**
  - the return arithmetic;
  - the "price-target return — dividends excluded" label;
  - missing median → behaviour per Q14;
  - ETF / OTC / non-USD → no Street view;
  - a missing price → no view.
- **RESULT:** —

## TASK 15 — Shared chart-series toggle and overlay system
- **STATUS:** NOT STARTED. It is built *before* the charts, which depend on it.
- **PURPOSE:**
  - A pure series registry: id, label, visible, style (stroke, dash, marker),
    tooltip metadata and legend behaviour.
  - Controls to toggle a series, Show all, Hide all and Reset. Each chart keeps its
    own defaults.
  - Overlay series are never merged.
  - Built with Recharts, the existing chart library.
- **DEPENDENCIES:** Task 1.
- **FILES:** `lib/charts/seriesToggle.ts` (new), `components/charts/SeriesToggle.tsx`
  (new), `app/analytics.css`.
- **TESTS:**
  - the toggle reducer (toggle, show all, hide all, reset);
  - the keyboard and ARIA states of the legend buttons;
  - series ids are unique per chart.
- **RESULT:** —

## TASK 16 — Risk/Return overlay chart
- **STATUS:** BLOCKED (Q10, Q11, Q25).
- **PURPOSE:**
  - X = annualized model volatility; Y = 12M expected return.
  - Series that can be shown or hidden one by one:
    - `efficient_frontier`, `model_cal`, `market_cml_proxy`;
    - `current_portfolio`, `proposed_portfolio`;
    - `gmv`, `tangency`;
    - `equal_weight`, `inverse_volatility`, `erc`;
    - `holdings`.
  - Each series has its own line or marker treatment, a legend entry, a tooltip and
    a methodology label.
- **DEPENDENCIES:** Tasks 12, 15.
- **FILES:** `components/theory/RiskReturnChart.tsx` (new).
- **TESTS:**
  - every series is independently toggleable;
  - overlays coexist;
  - the tooltips name the line;
  - failed frontier points are absent;
  - the "Model CAL" label is never the bare "CML".
- **RESULT:** —

## TASK 17 — SML chart
- **STATUS:** BLOCKED (Q12).
- **PURPOSE:**
  - A separate chart with X = β and Y = 12M expected return. It never shares an
    axis with the risk/return chart.
  - Series: `security_market_line`, `holdings`, `bl_expected_returns` (with gap
    connectors), `current_portfolio`, `proposed_portfolio` and `market_proxy`.
  - Gap wording is "Positive / Negative Expected Return Gap" only.
- **DEPENDENCIES:** Tasks 11, 15.
- **FILES:** `components/theory/SmlChart.tsx` (new).
- **TESTS:**
  - the toggles;
  - the coordinates equal the engine values;
  - the words "undervalued" and "overvalued" never appear.
- **RESULT:** —

## TASK 18 — Portfolio Theory page (`/analysis/theory`)
- **STATUS:** BLOCKED (Q19, Q20).
- **PURPOSE:**
  - Title: "Portfolio Theory". Subtitle: "Forward-looking portfolio construction
    using explicit 12-month assumptions."
  - The page contains:
    - a top strip showing the Outlook, Risk Model, Risk-Free, Market Proxy, MRP,
      Return Model and Covariance;
    - the assumptions panel (§49) and the views editor;
    - the expected-return table;
    - both charts;
    - the GMV and tangency weight tables;
    - Forward Model Sharpe, labelled distinctly from Historical Sharpe.
  - A navigation link is added.
- **DEPENDENCIES:** Tasks 12, 14, 16, 17.
- **FILES:**
  - new: `app/analysis/theory/page.tsx`, `components/pages/TheoryPage.tsx`,
    `components/theory/{AssumptionsPanel,ViewsEditor,ExpectedReturnTable}.tsx`;
  - updated: `components/layout/SiteHeader.tsx`,
    `components/observatory/WorkspaceSpine.tsx`, `components/ui/SectionGlyph.tsx`,
    `app/analytics.css`.
- **TESTS:**
  - component tests for the strip, the editor, the table and the labels;
  - an e2e route test.
- **RESULT:** —

## TASK 19 — Stock Lab scenario modifier (`createProposedPortfolio`)
- **STATUS:** BLOCKED — USER DECISION REQUIRED (Q21).
- **PURPOSE:**
  - A pure function: the current portfolio plus a scenario (Existing Holding or New
    Stock, and the proposed weight) plus a funding method gives the proposed
    portfolio.
  - Funding methods: pro-rata, from CASH, or from a specific holding. A decrease is
    redistributed pro-rata by default.
  - The function does no analytics, never mutates the saved portfolio, sums to
    100%, and enforces the 20-risky-holding limit.
- **DEPENDENCIES:** Task 1.
- **FILES:** `lib/stock-lab/scenario.ts` (new), `lib/validation/stockLab.ts` (new).
- **TESTS:**
  - the funding methods: pro-rata, cash and specific-holding funding;
  - position changes: increase, decrease, removal to 0% and a new stock;
  - infeasible requests: CASH or the funding holding is too small, or a 21st risky
    holding;
  - CASH is excluded from stock selection;
  - the total stays 100% within 1e-12;
  - the input is never mutated;
  - the output passes `parsePortfolio`.
- **RESULT:** —

## TASK 20 — Stock Lab orchestration, API route and historical impact
- **STATUS:** BLOCKED (Q22, Q23).
- **PURPOSE:** Add `POST /api/stock-lab`. It:
  - builds the proposed portfolio;
  - runs the **same** `runForwardModel` on the union universe;
  - runs the **unchanged** `simulate()` for the current and proposed portfolios on
    a common window;
  - runs the **unchanged** `runStress()` for both portfolios, using the
    Constructor's union-coverage comparison;
  - returns a replayable snapshot with its hash.
- **DEPENDENCIES:** Tasks 12, 19.
- **FILES:**
  - new: `lib/stock-lab/impact.ts`, `lib/server/stockLab.ts`,
    `app/api/stock-lab/route.ts`, `lib/backtest/compare.ts` (shared);
  - updated: `lib/backtest/construction.ts`. Its private `historical()` and
    `compareStress()` move verbatim into the shared module; behaviour and hashes are
    unchanged.
- **TESTS:**
  - current versus proposed historical metrics equal two independent `simulate()`
    runs;
  - limited history for the new stock;
  - a new stock missing in a stress window → Incomplete Historical Coverage, never
    fabricated;
  - Constructor replay and hashes are unchanged after the refactor.
- **RESULT:** —

## TASK 21 — Stock Lab historical impact UI
- **STATUS:** BLOCKED (depends on Task 20).
- **PURPOSE:**
  - Show current versus proposed for: CAGR, Historical Volatility, Historical
    Sharpe, Beta (vs benchmark), Max Drawdown, Tracking Error, Diversification Ratio
    and Effective Holdings.
  - Label these as historical metrics.
- **FILES:** `components/stock-lab/HistoricalImpact.tsx` (new).
- **TESTS:**
  - component values come from the result;
  - the labels separate historical metrics from forward ones.
- **RESULT:** —

## TASK 22 — Stock Lab capital vs risk, correlation and stress impact
- **STATUS:** BLOCKED (Q24).
- **PURPOSE:**
  - **Hero:** capital weight versus PCR, MRC and β; current and proposed model σ;
    incremental σ in percentage points.
  - **Correlation:** to the current portfolio, to the benchmark and to each holding.
  - **Stress:** per-event current, proposed and difference.
  - Colors are neutral: a change is never coloured as good or bad automatically.
- **FILES:** `components/stock-lab/{CapitalRiskHero,CorrelationPanel,StressImpact}.tsx`
  (new). Reuses the patterns of `components/risk/CapitalVsRisk.tsx`.
- **TESTS:**
  - PCR and MRC equal the `riskContributions` output;
  - incremental σ equals the difference of the two model σ values;
  - unavailable events are labelled.
- **RESULT:** —

## TASK 23 — Stock Lab forward model and forward portfolio impact
- **STATUS:** BLOCKED (depends on Task 20).
- **PURPOSE:**
  - Show a progression: MARKET / CAPM PRIOR → STREET OR MANUAL VIEW →
    BLACK–LITTERMAN → PORTFOLIO IMPACT.
  - For the selected stock: β, CAPM Prior, Street View, Confidence, BL Expected
    Return, CAPM Required Return and Gap.
  - A current versus proposed table, with change, for: 12M BL Expected Return, Model
    Volatility, Forward Model Sharpe, Portfolio β, CAPM Required Return and Gap.
- **FILES:** `components/stock-lab/{ForwardProgression,ForwardImpact}.tsx` (new).
- **TESTS:**
  - the values equal Portfolio Theory's engine output for the same inputs;
  - no positive change is coloured green automatically.
- **RESULT:** —

## TASK 24 — Stock Lab Street consensus panel
- **STATUS:** BLOCKED (Tasks 13–14).
- **PURPOSE:**
  - Show the consensus rating, the rating breakdown, the current price, the
    median/average/high/low targets, the implied 12M price return, the analyst
    count, the updated date, and forward EPS and revenue (FY1/FY2) where available.
  - Name the provider; explain missing fields.
- **FILES:** `components/stock-lab/StreetPanel.tsx` (new).
- **TESTS:**
  - missing Street data;
  - an ETF;
  - partial fields;
  - the provider label.
- **RESULT:** —

## TASK 25 — Stock Lab on the Frontier and the SML, and Stock Lab page assembly
- **STATUS:** BLOCKED (Q22).
- **PURPOSE:**
  - Build the `/analysis/stock-lab` page with:
    - the entry modes (Existing Holding / New Stock);
    - the proposed weight and the funding method;
    - all panels.
  - "View on Frontier" and "View on SML" reuse the chart components from Tasks 16
    and 17, with the `proposed_portfolio` series and the selected stock's point.
  - A navigation link is added.
- **FILES:**
  - new: `app/analysis/stock-lab/page.tsx`, `components/pages/StockLabPage.tsx`,
    `components/stock-lab/StockLabControls.tsx`, `lib/state/stockLab.ts`;
  - updated: the navigation files.
- **TESTS:**
  - the frontier coordinates of the current and proposed portfolios equal
    (σ_model, E_BL);
  - the SML coordinates equal (β, E_BL);
  - the scenario never alters the saved builder draft;
  - an e2e flow.
- **RESULT:** —

## TASK 26 — Methodology documentation
- **STATUS:** NOT STARTED. It is written incrementally as each task finishes.
- **PURPOSE:**
  - Add a V2 section to `docs/METHODOLOGY.md`, plus "Forward Model" and "Stock Lab"
    topics in the Methodology Drawer.
  - Cover every item in spec §50, including that VTI is a practical market proxy,
    not the theoretical market portfolio, and that the theoretical CML differs from
    the Market CML Proxy.
- **FILES:** `docs/METHODOLOGY.md`, `components/methodology/MethodologyDrawer.tsx`,
  `README.md`.
- **TESTS:** a drawer component test (topics render and anchors open).
- **RESULT:** —

## TASK 27 — Unit, integration and E2E tests
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Consolidate the deterministic suites listed in spec §51.
  - Add an end-to-end test of the forward model on fixed fixtures.
  - Add Playwright routes for Portfolio Theory and Stock Lab.
- **FILES:** `tests/forward/*`, `tests/stock-lab/*`, `tests/data/street.test.ts`,
  `tests/components/{theory,stockLab}.test.tsx`, `tests/e2e/portfolio.spec.ts`.
- **RESULT:** —

## TASK 28 — Responsive, accessibility and polish
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Layouts at 390, 820, 1024, 1320 and 1920 px.
  - Reduced motion.
  - Keyboard access to the series toggles.
  - Chart table views for non-visual access, as on the existing charts.
  - Contrast of 3:1 or more on series colors.
- **RESULT:** —

## TASK 29 — Regression audit of the existing application
- **STATUS:** NOT STARTED.
- **PURPOSE:** Prove the existing application is unaffected:
  - all pre-V2 tests pass;
  - replay and snapshot hashes for analysis, stress and construction are unchanged;
  - lint, typecheck and build pass;
  - Playwright runs, where Chrome is available;
  - bundle size is checked.
- **RESULT:** —

## TASK 30 — Final financial-methodology audit
- **STATUS:** NOT STARTED.
- **PURPOSE:** Re-derive every V2 formula against its documentation and tests:
  - wording audit: no Buy, Sell, Undervalued or Overvalued; "Sharpe" is never
    unqualified;
  - "CML" is never applied to the Model CAL;
  - historical and forward labels are kept separate.
- **RESULT:** —

---

## Dependency graph

```
T1 ─┬─ T2 ──────────────┐
    ├─ T3 ── T4 ─┐      │
    ├─ T5 ───────┼─ T6 ─ T7
    │            │       └─ T8 ─ T9
    │            │            └─ T10 ─ T11 ─ T12 ─┬─ T16 ─┐
    ├─ T13 ─ T14 ┘ (Street views plug into T5)    ├─ T17 ─┼─ T18
    ├─ T15 ───────────────────────────────────────┘       │
    └─ T19 ──────────────────────────── T20 ─┬─ T21       │
                                             ├─ T22       │
                                             ├─ T23       │
                                     T14 ────┼─ T24       │
                                             └─ T25 ◄─────┘ (T16/T17)
T26 runs alongside each task · T27–T30 close V2
```

## Open questions

The full wording and recommendations are in the plan review.

| # | Topic | Blocks |
| --- | --- | --- |
| Q1 | Which covariance defines β and σ_m (sample β with LW Σ vs one augmented LW matrix vs sample everywhere) | T3, T4, T11 |
| Q2 | Risk window anchored to today's last finalized session, not the analysis end | T3 |
| Q3 | Limited history inside the risk window: shorten and disclose, or refuse | T3, T20 |
| Q4 | Forward universe includes 0% candidate rows | T3 |
| Q5 | 1Y CMT bond-equivalent yield used as-is, or converted | T2 |
| Q6 | τ fixed and recorded (it cancels in μ_BL); optimize on Σ, not Σ + M | T6 |
| Q7 | Confidence mapping conventions and naming; absolute views only | T5, T6 |
| Q8 | Frontier/tangency solver: active-set QP, CLA or FISTA + bisection | T8, T10 |
| Q9 | Frontier constraints: long-only, no caps, CASH excluded, efficient branch only, point count | T8 |
| Q10 | CAL and CML proxy beyond the tangency/market point (borrowing) | T11, T16 |
| Q11 | "Existing Constructor Portfolios": re-solved on forward Σ, or the user's last proposal | T16 |
| Q12 | SML "Individual Holdings" vs "BL Expected Returns" series | T11, T17 |
| Q13 | Street provider, plan and display licence for a public deployment | T13 |
| Q14 | Median availability, analyst count and updated date | T13, T14, T24 |
| Q15 | Dividends: price-only view vs trailing yield | T14 |
| Q16 | Price used for the Street return | T14 |
| Q17 | OTC/ADR and non-USD targets | T14 |
| Q18 | FY1/FY2 definition | T13, T24 |
| Q19 | Where BL and the frontier recompute on edits (server vs isomorphic in the browser) | T12, T18 |
| Q20 | Persistence and sharing of views across pages | T1, T5, T18 |
| Q21 | Funding rules involving CASH; infeasible funding | T19 |
| Q22 | Stock Lab union-universe model and frontier display | T20, T25 |
| Q23 | Stock Lab historical window and beta label | T20, T21 |
| Q24 | Stock Lab risk hero on the forward Σ; correlations from the sample Σ | T22 |
| Q25 | Market-proxy point on the risk/return chart | T16 |
| Q26 | Fix the pre-existing InfoTip lint error inside V2 or separately | T1 |

## External data service changes

None planned. Street consensus is fetched by a server-only adapter in this
repository. The risk-window and proxy histories use the existing market-data
service routes unchanged; the existing micro-batcher splits batches above 21 symbols.
