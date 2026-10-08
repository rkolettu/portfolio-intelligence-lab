# V2 Task Plan: Portfolio Theory and Stock Lab

This document tracks V2 of the Portfolio Intelligence & Construction Lab. V2 adds a
12-month forward model with these parts:

- CAPM prior;
- Street and manual views;
- Black–Litterman expected returns;
- efficient frontier, GMV and tangency;
- Model CAL, Market CML Proxy and SML;
- Stock Lab, which uses the same engine.

**Status legend:**

- NOT STARTED;
- IN PROGRESS;
- BLOCKED — USER DECISION REQUIRED;
- BLOCKED — PROVIDER QUALIFICATION REQUIRED;
- COMPLETE.

A task is COMPLETE only when all of these hold:

- the implementation is done;
- its tests are done;
- typecheck passes;
- its methodology is documented;
- no issue is unresolved.

**Working rule.** If anything about financial methodology, a data definition, a
provider limitation or an architecture decision becomes uncertain, work stops, the
task is marked BLOCKED, and the question goes to the project owner. Nothing is
silently assumed.

The plan was approved on 2026-10-08 with the decisions recorded below.

## Baseline (before any V2 code, 2026-10-08, `main` @ 5d0840a)

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest --run` | 53 files, 498 / 498 passed |
| `npm run build` | passes (21 routes) |
| `npm run lint` | **1 pre-existing error**: `components/metrics/InfoTip.tsx:29` (`react-hooks/set-state-in-effect`). It is fixed as a separate housekeeping task, outside the V2 commits (Q26). |
| Playwright | not run in this container (it needs installed Google Chrome per `playwright.config.ts`) |

## Architecture principles (binding for every task)

1. **Three layers.** Each layer lives in its own code.
   - *Historical* (existing `lib/backtest`, `lib/analytics`) is unchanged.
   - *Forward model* is new: `lib/forward/*`.
   - *Decision analysis* is new: `lib/stock-lab/*`. It reuses both of the other layers.
2. **One forward engine.**
   - Portfolio Theory and Stock Lab call the same pure functions.
   - Stock Lab never computes its own CAPM prior, BL, Σ, β or Rf.
   - The pure functions run on the server, and also in the browser for MRP, view
     and confidence edits only (Q19).
   - There is no duplicate browser-only financial code.
3. **Reuse, do not duplicate.** These functions are reused as they are:
   - `ledoitWolf`, `annualizeCovariance`, `validateCovariance`;
   - `sampleCovarianceMatrix`, `correlationMatrix`;
   - `riskContributions`, `modelRisk`, `minimumVariance` (which serves as GMV);
   - `equalWeight`, `inverseVolatility`, `equalRiskContribution`;
   - `simulate`, `runStress`, `portfolioCoverage`, `loadHistories`;
   - `currentTreasury`, `snapshotHash`, `solveLinear`, `kktResidual`, `bindingConstraints`.

   New solver infrastructure is limited to the deterministic active-set QP for the
   frontier and tangency (Q8).
4. **Fixed horizon.** The outlook is the next 12 months, always. Nothing is
   compounded or extrapolated, and no decay is applied.
5. **No AI and no recommendations.** The app reports measurable facts only. It never
   uses the words Buy, Sell, Undervalued or Overvalued in its own text. Provider
   rating labels are shown only as attributed Street data.
6. **Repository boundary.** All V2 financial logic lives in this repository. The
   Street-data adapter is server-only and lives here too. **No change to
   `portfolio-lab-market-data` is planned.**
7. **Versioned methodology.** New constants are *appended* to
   `config/methodology.ts` as `FORWARD_METHODOLOGY` (and later
   `STOCK_LAB_METHODOLOGY`).
   - Existing constants are not edited, so every existing snapshot hash and replay
     is unchanged.
   - `FORWARD_METHODOLOGY` stays at `forward-v1` while V2 is built: tasks append
     fields. Once V2 ships, any change to it requires a new version.

## Naming rules (approved)

| Concept | Required label | Never |
| --- | --- | --- |
| β_i = Σ_im/Σ_mm from the forward model | **Forward Model Beta** / **Model Beta vs Market Proxy** | bare "Beta" anywhere a historical beta is also shown |
| Phase 3 regression/raw beta vs the analysis benchmark | **Historical Beta vs Benchmark** | bare "Beta" next to the forward beta |
| (E[R_p] − Rf)/σ_p from the forward model | **Forward Model Sharpe** | bare "Sharpe" on Portfolio Theory |
| Phase 2 Sharpe | **Historical Sharpe** | — |
| Line through Rf and the model tangency | **Model Capital Allocation Line** / **Model CAL** | "CML" |
| Line through Rf and the market proxy | **Market CML Proxy** | "CML" without "Proxy" |
| BL − CAPM required | **Expected Return Gap** (Positive / Negative) | "alpha", "undervalued", "overvalued" |
| Stock Lab current-side portfolio on the scenario universe | **Scenario Baseline** | "Current Portfolio" when it could be mistaken for Portfolio Theory's |
| Street price-target return | **12M Price-Target Return · Dividends Excluded** | "expected return" without the qualifier |
| Ratings totals when no target-contributor count exists | **Ratings Counted** | "Analyst Count" |
| Time we fetched Street data, when the provider gives no as-of date | **Retrieved** (timestamp) | "Updated" |

## Approved decisions (2026-10-08)

**Q1 — forward covariance and beta. ACCEPT B.**
- One Ledoit–Wolf covariance over the forward risky universe *plus* the selected
  market proxy.
- Forward Model Beta: β_i = Σ_im/Σ_mm.
- Forward market volatility: σ_m = √Σ_mm.
- This is the internally consistent forward risk model. With no views, the Model CAL
  is never steeper than the Market CML Proxy.
- Historical beta is unchanged.

**Q2 — window end. ACCEPT.** The risk-estimation window ends at the latest finalized
market session, independent of the historical Analysis Period.

**Q3 — short history. ACCEPT, with explicit UI disclosure.**
- Below 60 common observations, the forward model is unavailable.
- 60–251 observations is Limited History; 252 or more is normal.
- When history is shorter than the requested window, the common window starts at the
  latest first trade. The UI shows the **Effective Risk Window** and the reason it
  changed. It is never silently shortened.

**Q4 — forward universe. ACCEPT.**
- Zero-weight risky rows are included as part of the current opportunity set.
- In Stock Lab, the candidate joins the scenario opportunity set.

**Q5 — 1Y Treasury. ACCEPT.**
- The latest available DGS1 / 1Y Treasury yield is the forward 12-month risk-free
  proxy, unconverted.
- It is documented as a quoted Treasury yield proxy, not a guaranteed 12-month
  realized holding-period return.
- The 3M rate is never substituted.

**Q6 — τ. ACCEPT, with one change.**
- τ = 0.05 is fixed internally and is **not** a user setting.
- The documentation says that under the confidence-scaled Ω, τ cancels from the
  posterior mean. It is never presented as economically meaningful.

**Q7 — confidence and Ω. ACCEPT.**
- Ω is "confidence-scaled (Idzorek-style closed form)". It is never described as the
  full iterative Idzorek method.
- Views are absolute and single-security.
- A 0% view is ignored; a 100% view sets Ω_k = 0, the limiting high-confidence view.
- The documentation says that multiple correlated views interact.

**Q8 — frontier solver. ACCEPT A.**
- A deterministic active-set QP, using the existing certification philosophy.
- Every point carries its budget, return, bound and KKT/stationarity residuals and
  its solver status.
- No Monte Carlo.

**Q9 — frontier scope. ACCEPT.**
- Risky assets only, long-only, with a 100% risky budget.
- No Constructor floors or caps.
- Efficient branch only.
- 41 deterministic points to start. The point count is a parameter, so it can change
  without touching the methodology.

**Q10 — CAL and CML extension. ACCEPT.**
- Solid from Rf to the tangency (or to the market-proxy point); dashed beyond it.
- Tooltip: "Requires borrowing/leverage at the assumed risk-free rate and is outside
  the lab's modeled allocation constraints."
- Each line can be shown or hidden on its own.

**Q11 — existing construction portfolios. ACCEPT.**
- EW, IV and ERC are computed with the existing functions on the same forward risk
  model and risky-only universe.
- Their expected-return coordinate is wᵀμ_BL, never a historical return.

**Q12 — SML series. ACCEPT.** Each of these can be shown or hidden on its own:
- the CAPM Security Market Line;
- the CAPM holding points;
- the BL Expected Return points;
- the gap connectors;
- the Current Portfolio;
- the Proposed Portfolio (Stock Lab);
- the Market Proxy.

The chart has Show All, Hide All and Reset.

**Q13 — Street provider and licensing. DO NOT COMMIT TO FMP.**
- Build now:
  - the `StreetDataProvider` interface;
  - the normalized StreetData types;
  - fixtures and mocks;
  - the provider qualification framework;
  - tests.
- Do not architect the financial model around any specific provider.
- Provider-specific production integration stays **BLOCKED — PROVIDER QUALIFICATION
  REQUIRED** until the owner approves a provider. Approval needs:
  - the exact endpoint access;
  - the exact response schema;
  - the plan requirements;
  - the redistribution and display rights.
- S&P Capital IQ Pro is a private QA source only. See
  [Private external validation](#private-external-validation).

**Q14 — missing Street fields. ACCEPT, with strict labelling.**
- Never invent an Analyst Count, an Updated Date or a Median Target.
- Ratings totals are labelled **Ratings Counted**.
- With no provider as-of date, show **Retrieved** plus the retrieval timestamp, and
  never imply that it is the provider's estimate date.
- With no median, there is no automatic Street view. It never falls back to the
  average.

**Q15 — dividends. ACCEPT.**
- The Street view is a price-target return only, labelled "12M Price-Target Return ·
  Dividends Excluded".
- Trailing dividend yield is never presented as a forward yield.

**Q16 — Street reference price. ACCEPT.**
- The implied return uses the provider's quote from the same retrieval snapshot.
- Our market-data price stays available separately for comparison and debugging.

**Q17 — OTC, ADRs and currency. ACCEPT.**
- No Street-return view unless the listing, the share basis and the target currency
  all match the security analyzed.
- No currency or share-ratio conversion is guessed.

**Q18 — FY1 and FY2. ACCEPT.** FY1 is the first fiscal year not yet reported; FY2 is
the year after it.

**Q19 — server versus client. ACCEPT, with safeguards.**
- The server creates the hashed forward risk-model snapshot.
- The same pure functions may run client-side when ONLY the MRP, the views or the
  confidence change.
- Every client result traces to the risk-model snapshot hash plus the assumption
  state plus the view state, and carries a deterministic derived-result hash.
- A change to the risk window, the market proxy, the universe or the market history
  requires a new server snapshot.

**Q20 — persistence. ACCEPT.**
- One shared local assumption state serves both Portfolio Theory and Stock Lab.
- A view on a security that is not held affects Stock Lab only, unless that security
  is added to Portfolio Theory's opportunity set.

**Q21 — Stock Lab funding. ACCEPT.**
- An increase or a new position is funded pro-rata from other *risky* holdings, from
  CASH, or from one specific holding.
- A decrease is redistributed pro-rata to other risky holdings by default, with an
  explicit "to CASH" option.
- An invalid request is never partly satisfied. It is rejected with a useful reason.
- The portfolio stays exactly 100% within tolerance.

**Q22 — Stock Lab combined universe. ACCEPT, with the labelling changed.**
- Both sides are evaluated on the same scenario universe and the same forward
  covariance model.
- They are labelled **Scenario Baseline** and **Proposed Portfolio**.
- The page explains: "Stock Lab evaluates both portfolios using the same scenario
  universe so the comparison is internally consistent."
- Portfolio Theory's current point may appear as a faint, labelled reference. The
  two methodologies are never mixed silently.

**Q23 — Stock Lab historical window. ACCEPT.**
- The selected Analysis Period, with one common comparable start for both sides.
- The two betas are always labelled "Historical Beta vs Benchmark" and "Forward Model
  Beta vs Market Proxy".

**Q24 — risk and correlation. ACCEPT.**
- Capital vs Risk, risk contribution, MRC and forward model volatility use the
  forward Ledoit–Wolf Σ.
- Correlations are historical sample correlations over the effective risk window,
  labelled historical.

**Q25 — market-proxy point. ACCEPT.** (σ_m, Rf + MRP) is shown as part of the Market
CML Proxy series.

**Q26 — existing lint error. ACCEPT.** It is fixed as a separate housekeeping task and
kept out of the V2 financial commits.

## Private external validation

The project owner has access to S&P Capital IQ Pro through school. CapIQ may be used
**manually** as an external fact-check and QA benchmark for:

- market cap;
- security classification;
- consensus estimates;
- price targets;
- EPS and revenue estimates;
- forward multiples;
- beta comparisons.

CapIQ is **not** part of the production architecture, and the deployed application
must not require it. Do not build any of these:

- a CapIQ connector;
- a CapIQ scraper;
- CapIQ credential storage;
- CapIQ runtime fallback logic.

CapIQ data is never exposed publicly.

When production data differs from CapIQ, **investigate why**. Possible causes include:

- timing;
- fiscal-period mapping;
- a listing mismatch;
- consensus methodology;
- a stale quote;
- currency;
- beta lookback or frequency;
- provider coverage.

Fix our methodology or provider where that is appropriate. **Never silently
substitute the CapIQ value.**

---

## TASK 0 — Repository audit and architecture plan
- **STATUS:** COMPLETE (approved 2026-10-08).
- **RESULT:**
  - Plan approved.
  - Decisions Q1–Q26 recorded above.
  - No implementation code was written in this task.

## TASK 1 — Forward-model contracts, assumptions and methodology constants
- **STATUS:** COMPLETE (2026-10-08, after Q27 and Q28 were approved).
- **PURPOSE:** Define the types and defaults that every later task builds on:
  - types: `ForwardAssumptions`, `ViewInput`, `ForwardRiskFree`,
    `EffectiveRiskWindow`, `ForwardRiskModel`, `ExpectedReturnRow`,
    `PortfolioForwardMetrics`, `FrontierPoint` and `CapitalMarketLine`;
  - `FORWARD_METHODOLOGY`, holding:
    - the version, and the 12M horizon;
    - risk windows {1Y, 3Y, 5Y}, default 3Y;
    - market proxies {VTI, SPY, VT}, default VTI;
    - MRP default 5.00%; confidence default 50%;
    - τ = 0.05 (internal);
    - the frontier point count (41) and the observation thresholds;
    - the approved labels;
  - Zod validation of the assumptions and views;
  - the versioned localStorage schema for one shared assumption state.
- **DEPENDENCIES:** Task 0.
- **FILES:** `config/methodology.ts` (append only), `lib/types/forward.ts` (new),
  `lib/forward/assumptions.ts` (new), `lib/validation/forward.ts` (new),
  `lib/state/forwardAssumptions.ts` (new), `tests/forward/assumptions.test.ts` (new).
- **TESTS:**
  - assumptions: defaults, the allowed proxies, rejection of a bond ETF or a custom
    proxy, rejection of a non-finite MRP, and a confidence outside 0–100%;
  - persistence: round-trip, fallback when stored data is corrupt or the storage is
    denied, and version mismatch;
  - existing snapshot hashes are unchanged.
- **METHODOLOGY DECISIONS:**
  - The MRP is labelled *Assumption* and is never market data.
  - Views and assumptions are stored locally only.
  - τ is internal.
- **RESULT (2026-10-08):**
  - **Implemented:**
    - `FORWARD_METHODOLOGY` (`forward-v1`), appended to `config/methodology.ts`;
    - the contracts in `lib/types/forward.ts`;
    - the defaults and the approved `FORWARD_LABELS` in
      `lib/forward/assumptions.ts`;
    - Zod validation in `lib/validation/forward.ts`;
    - a pure reducer and versioned localStorage persistence
      (`portfolio-lab:forward-assumptions:v1`) in `lib/state/forwardAssumptions.ts`;
    - a V2 section started in `docs/METHODOLOGY.md`.
  - **Tests:** 29 new in `tests/forward/assumptions.test.ts`. They include SHA-256
    pins of every pre-V2 methodology constant, which prove that existing snapshot
    identity is unchanged.
  - **Finding:** Zod 4's `z.record` silently drops a `__proto__` key, which would
    lose a view without an error. View keys are therefore validated on the raw input
    before the record parse.
  - **Checks:**
    - typecheck clean;
    - 527 / 527 unit tests (498 pre-existing + 29);
    - build passes;
    - lint shows only the pre-existing InfoTip error (Q26).
  - **Q27 / Q28 applied:**
    - The MRP is bounded to [−10%, +20%] inclusive; negative values are allowed.
    - A Manual View is a "12M Expected Total Return", above −100% and at most +200%.
    - Both ranges are versioned in `FORWARD_METHODOLOGY` and enforced by
      validation: rejected with the range stated, never clamped.
    - This brings Task 1 to 31 tests.

## TASK 2 — Forward risk-free rate: latest available official 1Y Treasury
- **STATUS:** COMPLETE (2026-10-08, after Q30 and Q31 were approved).
- **PURPOSE:**
  - The forward 12-month Rf is the latest available official DGS1 observation.
  - It is read 1Y-only through the existing Treasury-provider architecture (Q29 B).
  - It is not the curve's common-date 1Y point.
- **RESULT (2026-10-08):**
  - **Treasury code reused:**
    - `FredProvider.series()` (the private FRED CSV read) and
      `TreasuryGovProvider.series()` (the private year-file read, with its in-flight
      sharing);
    - `parseTreasuryCsv` / `parseTreasuryGovCsv` (column `"1 Yr"`), unchanged;
    - `FallbackTreasuryProvider.race()`, unchanged;
    - `fetchPublic` (6 h revalidate), `DataCache` and `PROVIDER_POLICY.treasuryTtlMs`.
  - **Added:**
    - `TreasuryProvider.getLatestOneYearYield(now)`, implemented in `FredProvider`,
      `TreasuryGovProvider` and `FallbackTreasuryProvider`;
    - `lib/treasury-data/latest.ts`: 1Y selection, the 21-day lookback and the proxy
      warning;
    - the `LatestTreasuryYield` type (`ForwardRiskFree` is an alias of it);
    - `lib/server/forward.ts`: `forwardRiskFreeReading`, with cache key
      `fred:latest-DGS1:v1`;
    - `lib/forward/riskFree.ts`: the pure `forwardRiskFree`, which validates the
      series, maturity, date ≤ today and yield, and returns typed unavailability
      that never substitutes 3M;
    - labels "Forward Risk-Free Rate", "1Y U.S. Treasury" and "Latest Available".
  - **Unchanged:** `getHistoricalRates`, `getCurrentCurve`, `currentTreasury()`, the
    `fred:current-curve:v1` key and `/api/treasury/current`. A test proves the curve
    still reports the common date while the 1Y read returns DGS1's own later date.
  - **Fetch cache:** the FRED DGS1 request URL is identical to the curve's 1Y leg, so
    both share the same fetch-cache entry.
  - **Tests:** 14 new in `tests/data/forwardRiskFree.test.ts`, plus 1 label test. The
    5 existing Treasury test stubs gained the new method (additive only).
  - **Checks:**
    - typecheck clean;
    - 544 / 544 unit tests;
    - build passes;
    - lint shows only the pre-existing InfoTip error.
  - **Q30 / Q31 applied:**
    - `FallbackTreasuryProvider.getLatestOneYearYield` (the forward path only) reads
      both sources and uses the later official observation, FRED on equal dates.
      Rates are never merged or averaged. The selection, any failure of one source
      and same-date value differences are recorded in provenance.
    - `getCurrentCurve` and `getHistoricalRates` keep the FRED-first race; a test
      proves it.
    - The 7-calendar-day age limit (`FORWARD_METHODOLOGY.riskFree`,
      `oneYearStaleness`) is applied on every server read and again in the pure
      `forwardRiskFree`. A stale reading is a typed `TREASURY_UNAVAILABLE`.
    - The retrieval window stays at 21 days.
    - Final checks: Treasury tests 38 / 38; unit tests 552 / 552; typecheck clean;
      build passes; lint clean on all V2 code (only the pre-existing InfoTip error
      remains).

## TASK 3 — Forward risk model: risk window, augmented Ledoit–Wolf Σ, Forward Model Beta, σ_m
- **STATUS:** COMPLETE (approved by the owner 2026-10-08).
- **PURPOSE:** A clean, certified forward risk model. No CAPM priors are computed
  here.
- **RESULT:**
  - **Implemented:**
    - `lib/forward/sample.ts`: the window end is the latest finalized session (last
      XNYS session before today's New York date); the start is N years earlier.
    - `lib/forward/riskModel.ts` (`buildForwardRiskModel`), which builds one
      common aligned sample over universe ∪ proxy with the unchanged
      `portfolioCoverage` and then:
      - applies the 60/252 thresholds to aligned returns;
      - shortens the window only where the provider reports a later first trade,
        disclosing the Effective Risk Window and the limiting tickers;
      - rejects zero volatility under the existing scale-aware rule (1e-12);
      - estimates the unchanged `ledoitWolf`, annualizes it with
        `annualizeCovariance` and validates it with `validateCovariance` (sample
        and model, 1e-10);
      - computes β_i = Σ_im/Σ_mm and σ_m = √Σ_mm;
      - computes the historical correlations from the same sample;
      - records full audit metadata and a SHA-256 hash.
    - Typed failures: `invalid_inputs`, `history_unavailable`, `coverage_gap`,
      `insufficient_history`, `zero_volatility` and `invalid_covariance`.
    - `lib/server/forward.ts` (`loadForwardRiskModel`): one `loadHistories` batch
      with the shared cache keys. It returns a replayable snapshot, validates the
      inputs before any fetch, and never throws.
    - Labels "Forward Model Beta vs {proxy}", "Historical Correlation" and
      "Requested Risk Window".
    - `ForwardRiskModel` was revised from its Task 1 draft. The risk-free rate is no
      longer embedded: it joins the risk model in the Task 12 snapshot.
  - **Unchanged:** `lib/backtest/*`, `lib/analytics/*`, `lib/server/analyze.ts` and
    `lib/server/history.ts`.
  - **Tests:**
    - `tests/forward/riskModel.test.ts` (21) covers:
      - window dates (after the close, weekends, holidays);
      - exact estimator wiring;
      - β = Σ_im/Σ_mm, and a held proxy with β = 1 exactly;
      - β_p σ_m ≤ σ_p over 206 long-only portfolios;
      - Historical Correlation equals the Pearson value and differs from the shrunk
        matrix;
      - shortened windows with their notes;
      - the 59/60/251/252 thresholds;
      - leading, interior and proxy gaps;
      - zero volatility in a security and in the proxy;
      - all-CASH and single-asset universes;
      - order invariance and hash stability;
      - fetch failures and invalid inputs.
    - `tests/data/forwardRiskModel.test.ts` (6) covers: the loaded tickers and
      window, exact replay, cache reuse, the selected proxy and window, proxy
      failure, no qualified provider, and invalid inputs refused before any fetch.
    - 1 label test.
  - **Checks:**
    - unit tests 579 / 579;
    - typecheck clean;
    - lint clean on all V2 code (only the pre-existing InfoTip error remains);
    - build passes.
  - **Heads-ups for later tasks** (not Task 3 issues):
    - **(a)** Stock Lab "Correlation to Benchmark" needs the analysis benchmark, which
      is not in the forward common sample. This is decided at Task 20/22.
    - **(b)** `snapshotHash` uses `node:crypto`. A browser-side derived-result hash
      (Q19) needs a browser-compatible SHA-256. This is decided at Task 7/12.

## TASK 4 — CAPM prior
- **STATUS:** COMPLETE (approved by the owner 2026-10-08).
- **PURPOSE:**
  - Π_i = Rf + Forward Model Beta_i × MRP, from the certified Task 3 risk model, the
    Task 2 forward Rf and the Task 1 MRP.
  - No historical returns, no Street data, and no Black–Litterman.
- **RESULT:**
  - `lib/forward/capm.ts`:
    - **`capmRequiredReturn(rf, beta, mrp)`:** the only implementation of Rf + β × MRP.
      It throws `INVALID_INPUT` on non-finite input. The prior, CASH, the expected
      market return and (later) the SML all use it.
    - **`expectedMarketReturn(rf, mrp)`:** the β = 1 case, giving the one canonical
      Rf + MRP.
    - **`buildCapmPrior({ riskModel, riskFree, marketRiskPremium })`:** validates its
      inputs:
      - the risk-free rate is DGS1/1Y, finite and above −100%;
      - the MRP passes the Task 1 range schema;
      - there is one finite beta per ticker, in canonical order;
      - a held proxy has β = 1 exactly.

      It returns a `CapmPrior`:
      - shared at parent level: Rf with its date and source, MRP, proxy, window,
        risk-model hash and expected market return;
      - rows of `{ticker, forwardModelBeta, capmPrior}`;
      - CASH as `{β 0, expectedReturn Rf}`.

      Results are never floored or clamped. A prior at or below −100% is
      `invalid_capm_prior`, listing the ticker, β, Rf, MRP and calculated prior.
    - The module has no Node-only, server-only, historical or Street imports (a test
      enforces its import allowlist), so it is browser-safe for Q19.
  - **Types:** `CapmPriorRow`, `CapmPrior`, `InvalidCapmPrior`, `CapmPriorOutcome`.
  - **Tests:** 23 in `tests/forward/capm.test.ts`:
    - the 4% / 9% / 11.5% cases;
    - negative β, negative MRP, and both negative;
    - MRP = 0 gives Rf for every security;
    - a one-for-one Rf shift and a β × ΔMRP shift;
    - CASH = Rf;
    - the canonical expected market return;
    - the proxy identity, including a held proxy with exactly one prior, and refusal
      of β ≠ 1 for a held proxy;
    - betas taken exactly from the risk model;
    - invariance to historical mean returns (cumulative growth ×3.6, same prior);
    - all-CASH;
    - `invalid_capm_prior` with its details, and no upper cap;
    - non-finite and out-of-range inputs;
    - another maturity refused;
    - malformed beta vectors;
    - order invariance and independence from retrieval time;
    - the import boundary.
  - **Checks:**
    - unit tests 602 / 602;
    - typecheck clean;
    - lint clean on all V2 code (only the pre-existing InfoTip error remains);
    - build passes.
  - **Not done here (by design):**
    - the Expected Return Gap;
    - P, Q and Ω;
    - a CAPM-prior hash, which is browser-safe hashing for Task 7/12. The prior
      records the risk-model hash and is fully deterministic.

## TASK 5 — Views, confidence and Black–Litterman inputs (P, Q, Ω)
- **STATUS:** COMPLETE (approved by the owner 2026-10-08).
- **PURPOSE:** Deterministic P, Q and Ω from the saved views and the certified
  forward risk model. No posterior, no Expected Return Gap, no frontier.
- **RESULT:**
  - `lib/forward/views.ts` (`buildBlackLittermanInputs`):
    - **Statuses:**
      - `ACTIVE`;
      - `NO_VIEW`;
      - `OUT_OF_UNIVERSE` (kept as not applicable);
      - `ZERO_CONFIDENCE` (kept, no effect);
      - `STREET_DATA_UNAVAILABLE` (never substituted);
      - `INVALID_VIEW` (unreadable, or any view on CASH).

      Order of checks: no view → unreadable → Street data → zero confidence →
      active.
    - **Street inputs** are the provider-neutral `StreetViewInput`. One qualifies only
      if it is available, for the same ticker, a 12-month `price_return` from the
      **median** target, finite and above −100%.
    - **P** (m × n): selector rows in canonical ticker order, with columns exactly
      the risk model's `tickers`.
    - **Q:** the decimal view returns, in row order.
    - **Ω:** diagonal; Ω_k = (P_k τ Σ P_kᵀ)(1 − c)/c on the certified annual LW Σ,
      exactly 0 at c = 1.
    - **Variance check:** a non-finite or non-positive base variance is
      `invalid_view_variance`, naming the security. No new tolerance is introduced.
    - **No views:** P = 0 × n, Q = [], Ω = 0 × 0.
    - Every view records its basis (`total_return` / `price_return`), label, 12-month
      horizon, confidence fraction, status and reason.
    - The module is browser-safe (an import allowlist test enforces it).
  - **Types:** `ViewReturnBasis`, `StreetViewInput`, `ViewStatus`,
    `ViewClassification`, `ActiveView`, `BlackLittermanInputs`,
    `BlackLittermanInputsOutcome`.
  - **Tests:** 22 in `tests/forward/views.test.ts`:
    - selector row and exact Q;
    - dimensions and canonical row order;
    - creation-order invariance;
    - the empty representation;
    - Ω at 50%, 25%, 75%, 100% and 0%;
    - diagonal multi-view Ω;
    - Σ scaling, and the exact Task 3 Σ;
    - out-of-universe kept;
    - Street unavailable with no substitution;
    - seven disqualified Street inputs (unavailable, average, wrong basis, wrong
      horizon, NaN, −100%, wrong ticker);
    - CASH rejected;
    - unreadable views isolated;
    - one source per security;
    - Street basis and label;
    - confidence as a fraction (50 rejected);
    - invalid covariance or universe;
    - `invalid_view_variance`;
    - the import boundary.
  - **Checks:**
    - unit tests 624 / 624;
    - typecheck clean;
    - lint clean on all V2 code (only the pre-existing InfoTip error remains);
    - build passes.

## TASK 6 — Black–Litterman posterior
- **STATUS:** COMPLETE (2026-10-08). Awaiting the owner's approval before Task 7.
- **PURPOSE:** A certified posterior μ_BL = Π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − PΠ) from the
  Task 4 prior, the Task 3 Σ and the Task 5 P, Q, Ω. No Expected Return Gap,
  portfolio metric or frontier.
- **RESULT:**
  - `lib/forward/blackLitterman.ts`:
    - **`blackLittermanMean` (the τ-parametric core):**
      - no views: an exact copy of Π;
      - otherwise S = τΣPᵀ, A = PS + Ω, b = Q − PΠ, solved jointly with the
        existing `solveLinear`;
      - the Q32 certification η ≤ 1e-12 (infinity norms; a zero denominator passes
        only with a zero residual);
      - then μ = Π + S x.
    - **Typed failures:** `invalid_inputs`, `singular_view_system`,
      `numerical_failure`.
    - **`buildBlackLittermanPosterior`:**
      - checks the same risk-model hash and canonical order across Π, Σ and the
        view inputs, and τ = 0.05;
      - `invalid_posterior` for any μ ≤ −100%, naming the security, its prior and
        posterior, and every active view;
      - preserves each active view's source and basis;
      - keeps CASH at Rf.
    - `vectorInfinityNorm` and `matrixInfinityNorm` follow the Q32 definitions.
    - The module is browser-safe (import allowlist test).
  - **Config:** `FORWARD_METHODOLOGY.blackLitterman` (formula, certification
    measure and tolerance 1e-12).
  - **Types:** `BlackLittermanSolveCertification`, `BlackLittermanRow`,
    `PosteriorViewSummary`, `BlackLittermanPosterior`, `BlackLittermanFailure`,
    `BlackLittermanPosteriorOutcome`.
  - **Tests:** 22 in `tests/forward/blackLitterman.test.ts`:
    - no views is bitwise equal to the prior (three variants);
    - c × (Q − Π) at 50%, 25% and 100%;
    - propagation (Σ_BA/Σ_AA)c(Q − Π_A), negative covariance, and zero
      covariance exactly unchanged;
    - the joint closed form (not a per-asset blend);
    - multiple 100% views;
    - τ invariance over τ ∈ {0.001 … 7};
    - order invariance;
    - risk-model and τ mismatches refused;
    - the singular system with its views listed;
    - certification recorded, a failing certification, and the zero-scale pass;
    - non-finite inputs and overflow;
    - the norm definitions;
    - an `invalid_posterior` via correlation propagation, and no upper cap;
    - CASH;
    - the Street basis preserved;
    - historical-mean invariance;
    - the import boundary.
  - **Observed certification:** η = 0 for one or two views at partial confidence
    and 2.7e-17 for two views at 100%. Identity errors are about 1e-17.
  - **Checks:**
    - unit tests 646 / 646;
    - typecheck clean;
    - lint clean on all V2 code (only the pre-existing InfoTip error remains);
    - build passes.

## TASK 7 — Forward expected-return table and portfolio forward metrics
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Per security, the table shows: Ticker, Forward Model Beta, CAPM Prior (= CAPM
    Required Return), Active View, View Source, Confidence, BL Expected Return and
    Expected Return Gap.
  - For a portfolio, it computes:
    - E[R_p];
    - β_p;
    - CAPM Required Return;
    - the Gap;
    - model σ_p;
    - Forward Model Sharpe.
  - It also derives a deterministic result hash (Q19).
- **DEPENDENCIES:** Task 6.
- **FILES:** `lib/forward/expectedReturns.ts` (new).
- **TESTS:**
  - the gap is 0 for every row when there are no views;
  - Gap_p = Σw·gap_i;
  - all-CASH → Forward Model Sharpe unavailable;
  - the closed forms;
  - hash stability.
- **RESULT:** —

## TASK 8 — Efficient-frontier solver (deterministic active-set QP)
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Solve min wᵀΣw s.t. Σw = 1, wᵀμ_BL = r, w ≥ 0, over risky assets only.
  - Use 41 deterministic target returns from r_GMV to max μ.
  - Each point stores its weights, E[R], σ, status, binding constraints and its
    budget, return, bound and KKT residuals. Points that fail are not plotted.
- **DEPENDENCIES:** Task 6.
- **FILES:** `lib/forward/qp.ts` (new), `lib/forward/frontier.ts` (new).
- **TESTS:**
  - the constraint residuals are within tolerance;
  - σ is monotone along the efficient branch;
  - two-asset and unconstrained closed forms;
  - an infeasible target is rejected;
  - ticker-order invariance;
  - repeat runs are deterministic.
- **RESULT:** —

## TASK 9 — Global Minimum Variance and Constructor consistency
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - GMV is the existing `minimumVariance()` on the forward Σ (B = 1, bounds [0,1]).
  - The frontier's low end must agree with it.
- **DEPENDENCIES:** Tasks 3, 8.
- **FILES:** `lib/forward/frontier.ts`.
- **TESTS:**
  - GMV equals the frontier endpoint;
  - on an identical Σ, GMV equals the Constructor's Minimum Variance allocation;
  - with CASH c and non-binding caps, Constructor MV = (1 − c) × GMV.
- **RESULT:** —

## TASK 10 — Tangency / Maximum-Sharpe solver
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Use the convex reformulation: min yᵀΣy s.t. (μ − Rf)ᵀy = 1, y ≥ 0, then
    w = y/Σy. It is solved by the same QP and certified by KKT.
  - When no asset has μ_i > Rf, the result is "undefined" with that reason.
- **DEPENDENCIES:** Task 8.
- **FILES:** `lib/forward/tangency.ts` (new).
- **TESTS:**
  - the tangency Sharpe is ≥ that of every frontier point and every asset;
  - the tangency lies on the frontier;
  - two-asset closed form;
  - the undefined case;
  - ticker-order invariance.
- **RESULT:** —

## TASK 11 — Model CAL, Market CML Proxy and SML line engines
- **STATUS:** NOT STARTED.
- **PURPOSE:** Compute the three lines as independent series:
  - Model CAL: E = Rf + [(E_t − Rf)/σ_t]σ;
  - Market CML Proxy: E = Rf + (MRP/σ_m)σ, with the proxy point (σ_m, Rf + MRP);
  - SML: E = Rf + β × MRP.

  Each line carries a solid segment and a dashed borrowing extension (Q10).
- **DEPENDENCIES:** Tasks 3, 4, 10.
- **FILES:** `lib/forward/lines.ts` (new).
- **TESTS:**
  - endpoints and slopes;
  - the CAL passes through the tangency;
  - the CML proxy passes through (σ_m, Rf + MRP);
  - the SML passes through (0, Rf) and (1, Rf + MRP);
  - with no views, every holding lies on the SML and the CAL slope is ≤ the CML
    slope;
  - the solid/dashed split falls at the point.
- **RESULT:** —

## TASK 12 — Forward-model orchestration, API route, snapshot and replay
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Add `POST /api/forward-model`, which:
    - validates the config and assumptions;
    - loads the risk-window histories and the proxy;
    - reads the current 1Y Rf;
    - builds the hashed risk-model snapshot;
    - runs the pure engine.
  - Client-side recomputation (Q19) uses the same functions with the snapshot hash,
    the assumption state, the view state and a derived-result hash.
  - The cached-sample mode shows "needs live data".
- **DEPENDENCIES:** Tasks 2–11.
- **FILES:** `lib/forward/model.ts` (new), `lib/server/forward.ts` (new),
  `app/api/forward-model/route.ts` (new).
- **TESTS:**
  - injected-provider server tests;
  - replay identity;
  - hash stability;
  - a proxy-fetch failure;
  - the 1Y curve unavailable;
  - a 22-ticker batch is chunked correctly;
  - server and client paths give identical results.
- **RESULT:** —

## TASK 13a — Street-data provider abstraction, normalized types, qualification framework
- **STATUS:** NOT STARTED. It can proceed: it contains no provider-specific
  production code.
- **PURPOSE:**
  - A server-only `StreetDataProvider` interface: consensus, price targets, analyst
    estimates and the provider quote, with the retrieval snapshot time.
  - Provider-neutral normalized `StreetData` types. Missing fields are explicit
    nulls with reasons, never invented.
  - A provider-qualification registry, mirroring `config/deployed-providers.ts`, that
    requires:
    - endpoint-access evidence;
    - the response schema;
    - the plan;
    - display and redistribution rights;
    - an owner approval date.
  - A provider fixture or mock for tests and development.
  - Server-side key handling (env var, never bundled or logged), a per-instance
    cache, and typed errors.
- **DEPENDENCIES:** Task 1.
- **FILES:**
  - new: `lib/street-data/types.ts`, `lib/street-data/normalize.ts`,
    `lib/street-data/fixture.ts`, `config/street-providers.ts`,
    `lib/server/street.ts`, `tests/data/street.test.ts`;
  - updated: `docs/DATA-PROVIDERS.md`.
- **TESTS:**
  - normalization;
  - missing fields;
  - an unqualified provider is refused at runtime;
  - a plan-restricted response → typed `PERMISSION`;
  - ETF → "no analyst coverage";
  - unknown ticker;
  - the key never appears in responses or errors.
- **RESULT:** —

## TASK 13b — Provider-specific production Street adapter
- **STATUS:** BLOCKED — PROVIDER QUALIFICATION REQUIRED.
- **PURPOSE:** Implement one adapter for an owner-approved provider, after its
  endpoint access, response schema, plan and display/redistribution rights are
  verified.
- **DEPENDENCIES:** Task 13a; owner approval of a provider.
- **RESULT:** —

## TASK 14 — Street 12M price-target view
- **STATUS:** NOT STARTED for the pure mapping on fixtures. Live data is BLOCKED —
  PROVIDER QUALIFICATION REQUIRED (Task 13b).
- **PURPOSE:**
  - Street Price Return = Median Target / Provider Quote − 1, both from the same
    retrieval snapshot (Q16).
  - It is labelled "12M Price-Target Return · Dividends Excluded" (Q15).
  - There is no view when:
    - the median is missing (Q14);
    - the listing, share basis or currency don't match (Q17);
    - the security is an ETF without coverage;
    - the quote is missing.
  - Context (Ratings Counted, high/low, Retrieved) is shown and never converted to
    confidence.
- **DEPENDENCIES:** Tasks 5, 13a.
- **FILES:** `lib/forward/streetView.ts` (new).
- **TESTS:**
  - the arithmetic;
  - the labels;
  - every no-view condition;
  - no fallback to the average.
- **RESULT:** —

## TASK 15 — Shared chart-series toggle and overlay system
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - A pure series registry: id, label, visible, style, tooltip metadata and legend
    behaviour.
  - Controls to toggle a series, Show All, Hide All and Reset, with per-chart
    defaults.
  - Series are overlaid and never merged.
- **DEPENDENCIES:** Task 1.
- **FILES:** `lib/charts/seriesToggle.ts` (new), `components/charts/SeriesToggle.tsx`
  (new), `app/analytics.css`.
- **TESTS:**
  - the toggle reducer;
  - keyboard and ARIA states;
  - unique ids per chart.
- **RESULT:** —

## TASK 16 — Risk/Return overlay chart
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - X = model volatility; Y = 12M BL expected return.
  - Series, each toggled independently:
    - `efficient_frontier`, `model_cal`, `market_cml_proxy` (with the proxy point);
    - `current_portfolio`, `proposed_portfolio`;
    - `gmv`, `tangency`;
    - `equal_weight`, `inverse_volatility`, `erc` (forward Σ, wᵀμ_BL; Q11);
    - `holdings`.
  - Dashed extensions carry the Q10 tooltip.
- **DEPENDENCIES:** Tasks 12, 15.
- **FILES:** `components/theory/RiskReturnChart.tsx` (new).
- **TESTS:**
  - independent toggles;
  - overlays coexist;
  - tooltips name each line;
  - failed points are absent;
  - "Model CAL" is never labelled "CML".
- **RESULT:** —

## TASK 17 — SML chart
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - A separate chart with X = Forward Model Beta and Y = 12M expected return.
  - Series per Q12: the CAPM SML, CAPM holding points, BL Expected Return points, gap
    connectors, Current Portfolio, Proposed Portfolio and Market Proxy. It has Show
    All, Hide All and Reset.
- **DEPENDENCIES:** Tasks 11, 15.
- **FILES:** `components/theory/SmlChart.tsx` (new).
- **TESTS:**
  - the toggles;
  - the coordinates equal the engine values;
  - the gap wording is "Positive / Negative Expected Return Gap" only.
- **RESULT:** —

## TASK 18 — Portfolio Theory page (`/analysis/theory`)
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - The page contains:
    - the title and subtitle;
    - the top strip;
    - the assumptions panel (§49);
    - the views editor (MRP, views and confidence recompute client-side);
    - the expected-return table;
    - both charts;
    - the GMV and tangency weights;
    - Forward Model Sharpe.
  - A navigation link is added.
- **DEPENDENCIES:** Tasks 12, 14 (fixture-backed), 16, 17.
- **FILES:**
  - new: `app/analysis/theory/page.tsx`, `components/pages/TheoryPage.tsx`,
    `components/theory/*`;
  - updated: the navigation files and `app/analytics.css`.
- **TESTS:** component and e2e route tests.
- **RESULT:** —

## TASK 19 — Stock Lab scenario modifier (`createProposedPortfolio`)
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - A pure function: the current portfolio plus a scenario plus a funding method
    gives the proposed portfolio (Q21).
  - It does no analytics, never mutates the saved portfolio, sums to 100% and
    enforces the 20-risky-holding limit.
  - It adds `STOCK_LAB_METHODOLOGY`.
- **DEPENDENCIES:** Task 1.
- **FILES:** `lib/stock-lab/scenario.ts` (new), `lib/validation/stockLab.ts` (new),
  `config/methodology.ts` (append).
- **TESTS:**
  - the funding methods: pro-rata, cash and specific-holding funding, and decrease to
    pro-rata or to CASH;
  - removal to 0% and a new stock;
  - infeasible requests are rejected with reasons;
  - CASH is excluded from selection;
  - the total stays 100%;
  - the input is never mutated;
  - the output passes `parsePortfolio`.
- **RESULT:** —

## TASK 20 — Stock Lab orchestration, API route and historical impact
- **STATUS:** NOT STARTED.
- **PURPOSE:** Add `POST /api/stock-lab`. It:
  - builds the proposed portfolio;
  - runs the **same** forward engine on the scenario universe, giving the Scenario
    Baseline and the Proposed Portfolio (Q22);
  - runs the **unchanged** `simulate()` for both sides on the Analysis Period, with a
    common start (Q23);
  - runs the **unchanged** `runStress()` for both sides;
  - returns a replayable snapshot with its hash.
- **DEPENDENCIES:** Tasks 12, 19.
- **FILES:**
  - new: `lib/stock-lab/impact.ts`, `lib/server/stockLab.ts`,
    `app/api/stock-lab/route.ts`, `lib/backtest/compare.ts`;
  - updated: `lib/backtest/construction.ts`. Its `historical()` and `compareStress()`
    move verbatim; hashes are unchanged.
- **TESTS:**
  - both sides equal independent `simulate()` runs;
  - limited history disclosed as an Effective Risk Window change;
  - missing stress history → Incomplete Coverage;
  - Constructor replay and hashes are unchanged.
- **RESULT:** —

## TASK 21 — Stock Lab historical impact UI
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Show, for both sides: CAGR, Historical Volatility, Historical Sharpe, Historical
    Beta vs Benchmark, Max Drawdown, Tracking Error, Diversification Ratio and
    Effective Holdings.
  - Label these as historical metrics.
- **FILES:** `components/stock-lab/HistoricalImpact.tsx` (new).
- **RESULT:** —

## TASK 22 — Stock Lab capital vs risk, correlation and stress impact
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - **Hero:** on the forward LW Σ — capital weight, PCR, MRC, Forward Model Beta,
    Scenario Baseline and Proposed model σ, and incremental σ.
  - **Correlation:** historical sample correlations over the effective risk window
    (Q24).
  - **Stress:** per-event differences.
  - Colors are neutral.
- **FILES:** `components/stock-lab/{CapitalRiskHero,CorrelationPanel,StressImpact}.tsx`
  (new).
- **RESULT:** —

## TASK 23 — Stock Lab forward model and forward portfolio impact
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - Show a progression: MARKET / CAPM PRIOR → STREET OR MANUAL VIEW →
    BLACK–LITTERMAN → PORTFOLIO IMPACT.
  - A Scenario Baseline versus Proposed table covering:
    - 12M BL Expected Return;
    - Model Volatility;
    - Forward Model Sharpe;
    - Forward Model Beta;
    - CAPM Required Return;
    - Expected Return Gap.
  - No automatic good/bad colouring.
- **FILES:** `components/stock-lab/{ForwardProgression,ForwardImpact}.tsx` (new).
- **RESULT:** —

## TASK 24 — Stock Lab Street consensus panel
- **STATUS:** NOT STARTED against fixtures. Live data is BLOCKED — PROVIDER
  QUALIFICATION REQUIRED (Task 13b).
- **PURPOSE:**
  - The panel shows:
    - the consensus rating and the rating breakdown (attributed);
    - the provider quote;
    - the median, average, high and low targets;
    - the 12M Price-Target Return · Dividends Excluded;
    - Ratings Counted or Analyst Count, only as provided;
    - Updated or Retrieved, only as provided;
    - FY1/FY2 EPS and revenue.
  - Missing fields are explained.
- **FILES:** `components/stock-lab/StreetPanel.tsx` (new).
- **RESULT:** —

## TASK 25 — Stock Lab on the Frontier and the SML, and page assembly
- **STATUS:** NOT STARTED.
- **PURPOSE:**
  - `/analysis/stock-lab` with:
    - the entry modes and the proposed weight;
    - the funding method;
    - all panels.
  - "View on Frontier" and "View on SML" reuse the Task 16 and 17 charts with the
    Scenario Baseline, Proposed and selected-stock points. Portfolio Theory's current
    point may appear as a faint, labelled reference only.
- **FILES:** `app/analysis/stock-lab/page.tsx`, `components/pages/StockLabPage.tsx`,
  `components/stock-lab/StockLabControls.tsx`, `lib/state/stockLab.ts`, plus the
  navigation files.
- **RESULT:** —

## TASK 26 — Methodology documentation
- **STATUS:** NOT STARTED. It is written incrementally as each task finishes.
- **PURPOSE:**
  - Add a V2 section to `docs/METHODOLOGY.md`, plus "Forward Model" and "Stock Lab"
    topics in the Methodology Drawer.
  - Cover every item in spec §50 and every approved decision above.
- **RESULT:** —

## TASK 27 — Unit, integration and E2E tests
- **STATUS:** NOT STARTED.
- **RESULT:** —

## TASK 28 — Responsive, accessibility and polish
- **STATUS:** NOT STARTED.
- **RESULT:** —

## TASK 29 — Regression audit of the existing application
- **STATUS:** NOT STARTED.
- **RESULT:** —

## TASK 30 — Final financial-methodology audit
- **STATUS:** NOT STARTED.
- **RESULT:** —

## HOUSEKEEPING (outside V2) — InfoTip lint error
- **STATUS:** Queued as a separate task (Q26). It is not part of any V2 commit.

---

## Dependency graph

```
T1 ─┬─ T2 ──────────────┐
    ├─ T3 ── T4 ─┐      │
    ├─ T5 ───────┼─ T6 ─ T7
    │            │       └─ T8 ─ T9
    │            │            └─ T10 ─ T11 ─ T12 ─┬─ T16 ─┐
    ├─ T13a ─ T14 ┘ (fixture-backed Street views)  ├─ T17 ─┼─ T18
    │   └─ T13b (BLOCKED — provider qualification) │       │
    ├─ T15 ────────────────────────────────────────┘       │
    └─ T19 ──────────────────────────── T20 ─┬─ T21        │
                                             ├─ T22        │
                                             ├─ T23        │
                                    T14 ─────┼─ T24        │
                                             └─ T25 ◄──────┘ (T16/T17)
T26 runs alongside each task · T27–T30 close V2
```

## Open questions raised during implementation

| # | Raised in | Question | Blocks |
| --- | --- | --- | --- |
| Q27 | Task 1 | **APPROVED (changed):** the MRP is bounded to [−10%, +20%], negative allowed, rejected not clamped; MRP ≤ 0 makes outputs undefined with typed states, never manufactured. | — |
| Q28 | Task 1 | **APPROVED:** Manual View = "12M Expected Total Return", the CAPM/BL basis, > −100% and ≤ +200%, rejected not clamped. Street views stay "12M Price-Target Return · Dividends Excluded". | — |
| Q29 | Task 2 | **APPROVED B:** add a 1Y-only read path to the existing Treasury providers, using the latest available official DGS1 observation (not the common curve date). The full curve is unchanged, and the 3M rate is never substituted. | — |
| Q30 | Task 2 | **APPROVED B:** the forward 1Y read uses the later of FRED's and the Treasury file's latest valid observation, FRED on equal dates, never merged; the selection is recorded. The curve, historical reads and the generic fallback are unchanged. | — |
| Q31 | Task 2 | **APPROVED:** the forward 1Y observation must be ≤ 7 calendar days old (New York date), else `TREASURY_UNAVAILABLE` ("stale"); no substitution. The 21-day retrieval window stays. | — |

## External data service changes

None planned. Street consensus will be fetched by a server-only adapter in this
repository once a provider is qualified. The risk-window and proxy histories use the
existing market-data service routes unchanged; the existing micro-batcher splits
batches above 21 symbols.
