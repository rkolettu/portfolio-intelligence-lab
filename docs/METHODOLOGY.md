# Methodology — Portfolio Intelligence & Construction Lab

Scope: the Phase 1 engine (`phase1-v1`: normalized data, validation, coverage, arithmetic daily returns, synthetic wealth, drift, monthly resets, CASH/risk-free alignment, continuous benchmark wealth and reproducibility) and every layer built on it. The layers are performance (Phase 2), benchmark-relative (Phase 3), portfolio risk (Phase 4), rolling and stress (Phase 5) and portfolio construction (Phase 6). Each layer carries its own methodology version and reuses the engine unchanged. No expected-return optimization or AI layer exists.

## Inputs and units

USD U.S.-traded equities/ETFs and CASH, long only, unique normalized symbols: at most 20 risky holdings plus CASH, which is the special asset and never uses a risky slot (the builder holds up to 21 rows; the quotes route accepts 22 tickers including CASH and the benchmark). This one rule applies to analysis, stress, construction and Apply. Display weights are percentages; all domain weights, returns, and annual yields are decimals. Total weights must be within 1e-6 of one; accepted residuals are explicitly normalized, once. A total that differs from 1 only by floating-point noise (≤ 1e-13, e.g. 0.6 + 0.3 + 0.1 = 0.9999999999999999) is left as entered, so parsing a parsed configuration is idempotent and replay is exact. Zero-weight rows stay editable but do not affect coverage. Requested dates are ISO date-only strings, not UTC timestamps. Dates must be real, ordered, nonfuture and within a 50-year span. The versioned session artifact supports 1976–2028; ranges outside it fail explicitly.

U.S.-traded means listed on NYSE, Nasdaq, NYSE American, NYSE Arca or Cboe, or quoted on an OTC Markets tier (OTCQX, OTCQB, Pink, OTC ID), where large foreign issuers such as Nestlé (`NSRGY`) and Roche (`RHHBY`) trade in the U.S. OTC prices are only as good as their trading: Yahoo repeats the last price on a session with no trades, which would understate volatility and correlation. An OTC security is therefore refused (`UNSUPPORTED_ASSET`) for any requested window in which more than 10% of its sessions, and more than five, had zero volume. The rule is applied identically by the market-data service and the local research adapter.

## Historical data and coverage

Whole provider adjustment snapshots are used. Adjusted-close ratios incorporate supported splits/distributions; no separate dividend cash flow is added. This is a provider-defined total-return-aware proxy, not a certified gross total-return index or executable share ledger. Portfolio and benchmark share the same convention. Embedded fund expenses remain in the data.

The XNYS calendar is generated from exchange_calendars 4.13.2 and records UTC regular-session closes including DST, early closes and known exceptional closures. Selected holidays/early closes were cross-checked against NYSE's official calendar; tests cover Good Friday, Thanksgiving, 9/11, Hurricane Sandy and the 2025 mourning closure. This is not a claim of an exhaustive independent audit of every historical session. The artifact carries version, generator pins, coverage and a content hash; the build fails on tampering or within 180 days of coverage end (DATA-PROVIDERS.md, Calendar maintenance). Update it for new exceptional closures; never substitute a weekday calendar.

Current-market-day Yahoo daily bars are excluded conservatively until the next New York date. The user's requested end remains visible alongside the last eligible scheduled session. This can intentionally be one session behind the most recently closed market. It is not described as today's final official close. Data missing at any expected eligible terminal session blocks a result, just as interior gaps do.

Initialization is the first common scheduled observation on/after requested start and the latest first available active holding date. Later starts must match the provider's first-trade metadata; this is **provider-reported**, not independently verified inception. Unexplained leading gaps, missing interior/terminal bars, conflicting duplicate prices, zero/negative/nonfinite prices and unsupported terminal events fail explicitly. We never invent prehistory, drop loss-bearing intervals, forward-fill asset prices, or substitute securities/CASH.

## Synthetic return ledger

Start with $10,000 at target weights on the initialization close. For consecutive sessions, `r = adjustedClose_current / adjustedClose_previous - 1`. Daily holding contribution is `startWeight * r`. Contributions sum to portfolio return. Wealth compounds as `priorWealth * (1 + portfolioReturn)`; end weights are `startWeight * (1 + holdingReturn) / (1 + portfolioReturn)`.

Earn the month-end session's return at the previous drifted weights. At that closing value, reset to preset target weights before the next session return. The schedule uses the next actual session, so holidays/weekends are handled. No look-ahead prices enter a reset. This frictionless closing-value model is not a claim that orders sized using a just-published close can execute at that close. Adjusted units are not actual shares; current raw quotes never revalue this ledger.

Results are gross of transaction costs, taxes, and trading frictions. Configured assets/weights are retrospective assumptions and may carry selection/survivorship bias. Daily contributions are not geometrically linked multi-period attribution.

## Historical Treasury and CASH

Official DGS3MO is a constant-maturity investment-basis **yield**, not a deposit effective yield or bill total-return index. The required `(1 + annualYield)^(calendarDays / 365) - 1` is used as a disclosed **synthetic cash accrual convention**. Negative finite yields above -100% are valid. No discount-basis DTB3 substitution is allowed.

The H.15 release is currently scheduled at 16:15 ET, after a normal equity close. FRED CSV does not supply historical publication timestamps/vintages. Availability is therefore modeled conservatively at **23:59 ET on the next U.S. federal business day** after observation, skipping weekends, federal holidays and documented executive-order/national-mourning closures (extra closed days only delay availability). The versioned federal calendar enters result metadata and the snapshot hash; dates outside its coverage fail rather than being assumed business days. A rate whose availability precedes its own observation date is rejected as corrupt lineage. This accommodates normal release/ingestion lag, but it is not proof of historical release availability and cannot eliminate later revisions. Tests with explicit publication timestamps reject a release at/after the interval-start close, including early closes.

For each close-to-close interval, select the latest observation available strictly before its starting close, no more than seven calendar days old. Freeze that rate for the entire interval; weekend accrual uses the real calendar gap. Do not use future or current-curve observations. A long gap leaves the risk-free return null.

Without CASH, missing rates leave absolute wealth available. With CASH, missing required rates block the default run. An explicit zero-return fallback applies to the **entire run**, has distinct metadata/hash, is allowed only during a rate outage, and never fills missing risk-free observations with zero. All-cash portfolios use the session calendar independent of benchmark history.

## Benchmark and current context

Basic benchmark wealth uses a continuous common sample, identical interval endpoints and adjusted convention. An interior benchmark gap disables continuous comparison without erasing absolute history. Existing portfolio wealth is sliced/rebased, never restarted at target weights. Benchmark ETFs are fund proxies, not their underlying indexes. Benchmark-relative statistics are defined in the Phase 3 section below.

Quotes and current Treasury data use independent routes and failure states. Unknown latency is Latest Available; an old quote cannot replace a newer finalized raw close. Freshness is re-derived on every cache read and while displayed: live/delayed claims lapse by elapsed time (never upgraded), and a quote is marked stale once the next session close after its market timestamp has passed. No aggregate day-price estimate or current portfolio value is offered without qualified synchronized quotes/valuation inputs. This also avoids mixing pre/post-market sessions, dates, split bases or incomplete holdings. Current curve observations use a common official date. None enters historical simulation.

## Performance metrics (Phase 2, `performance-v1`)

Computed once in `simulate()` by pure modules (`lib/analytics/{performance,risk,drawdown,summary}.ts`) from the Phase 1 ledger, so they ship with the result and replay from the snapshot. Constants live in `PERFORMANCE_METHODOLOGY`, separate from the Phase 1 `METHODOLOGY` object, so Phase 1 snapshot identity is unchanged. Components only format precomputed values.

Let `W_0 = $10,000` on the effective start date, `r_t` the ledger's daily arithmetic portfolio return for interval `t` (prior session close → session close), `W_t = W_(t-1)(1 + r_t)` the compounded wealth and `n` the number of intervals.

| Metric | Definition |
| --- | --- |
| Ending value | `W_n` |
| Cumulative return | `W_n / W_0 − 1` |
| CAGR | `(W_n / W_0)^(1 / years) − 1`, years = actual calendar days (effective start → effective end) / 365.25; computed as `expm1(ln(W_n/W_0) / years)` |
| Annualized volatility | `sampleStdDev(r_t) × √252` (n − 1 denominator) |
| Excess return | `excess_t = r_t − rf_t`, where `rf_t` is the interval's prior-known DGS3MO accrual already in the ledger (`(1 + y)^(calendarDays/365) − 1`, rate available strictly before the starting close) |
| Sharpe | `mean(excess_t) / sampleStdDev(excess_t) × √252` |
| Sortino | `(mean(excess_t) × 252) / (√mean(min(excess_t, 0)²) × √252)`; the downside mean runs over **all** n intervals, not only negative ones |
| Drawdown | `dd_t = W_t / max(W_0 … W_t) − 1` (initial wealth is a peak); maximum drawdown = `min(dd_t)`; current drawdown = `dd_n` |

Arithmetic daily returns feed only the dispersion statistics; wealth, cumulative return, CAGR and drawdown use the compounded path. Weekend and holiday gaps remain one return observation for volatility (the spec's per-interval convention) while CAGR and cash accrual use calendar days. Cash accrual keeps ACT/365; CAGR uses 365.25; these are separate, documented conventions.

**Drawdown episodes.** An episode starts when wealth first closes below the high-water mark. Peak = the *last* date at that high-water mark before the decline (equal highs move the peak later); trough = the *first* date of the episode's minimum; recovery = the first date wealth closes at or above the peak. Recovery is never searched past the effective end; an open episode reports "Not recovered" plus underwater calendar days and sessions to the effective end. Calendar days to recovery = peak → recovery calendar days; trading days to recovery = completed sessions from peak to recovery. The maximum drawdown episode is the deepest (ties: earliest). Drawdowns are daily-close measures and can understate intraday losses.

**Undefined and short samples.** Metrics carry `{available: false, reason}` rather than NaN or Infinity; the UI shows N/A with the reason in a tooltip.
- Volatility, Sharpe and Sortino require at least 2 returns. Below 252 returns they carry a short-sample note.
- A constant return series has volatility 0. Dispersion at or below 1e-12 × the largest absolute observation is treated as zero, so floating-point roundoff cannot create enormous ratios.
- Sharpe is undefined when excess-return volatility is zero. Sortino is undefined when there are no negative excess returns.
- An all-cash portfolio earning exactly the risk-free proxy has identically zero excess returns: Sharpe and Sortino are undefined even though calendar gaps give its raw returns positive volatility.
- If any interval lacks a prior-known risk-free return, Sharpe and Sortino are unavailable. They are never computed on a favorable subset. This includes whole-run zero-return CASH mode, which exists only during rate outages.
- CAGR over less than one year is shown with an "annualized from less than one year" label. CAGR that overflows the numerical range is unavailable.

**Growth of $10,000.** Portfolio series: `W_0 … W_n`. With the benchmark toggle, both series come from the Phase 1 continuous-overlap path, each normalized to $10,000 at the overlap start. If the benchmark starts later, the chart shows that window and says so; clearing the toggle shows full portfolio history. No benchmark statistics (beta, alpha, tracking error and so on) are computed in Phase 2.

**Charts.** Display points are downsampled (at most about 640) by keeping the first, last, and each bucket's minimum and maximum, plus annotated episode dates. The trough and extremes therefore always appear. Calculations always use the full series. Month-end table views give non-visual access to the plotted values.

## Benchmark-relative metrics (Phase 3, `benchmark-v1`)

**Canonical alignment.** `alignBenchmark` (`lib/backtest/alignment.ts`) is the only code that pairs portfolio and benchmark data. For each ledger interval (prior session close → session close), the benchmark return is valid only when the ETF has an adjusted close at **both** endpoints. A missing session invalidates the two intervals touching it; nothing is forward-filled or bridged. Each aligned row carries the ledger's portfolio return, the benchmark price-ratio return, and the ledger's prior-known risk-free accrual (the no-look-ahead Treasury engine; never the current curve). The alignment records:

- the comparison period: first aligned interval start → last aligned interval end;
- the aligned observation count and an interval-set hash (constructed exactly like Phase 1 sample identities);
- interior intervals excluded, and portfolio intervals before/after the comparison;
- risk-free coverage.

Absolute portfolio analytics never shorten to the benchmark. A later-starting benchmark starts only the comparison later; a later-starting portfolio starts the comparison at the portfolio's effective start. The Phase 1 growth path is derived from the same alignment; a randomized test confirms it is identical to the original implementation.

Let `p_t`, `b_t`, `rf_t` be the aligned values, `active_t = p_t − b_t`, `pe_t = p_t − rf_t`, `be_t = b_t − rf_t`. Sample moments use `n − 1`.

| Metric | Definition | Guard |
| --- | --- | --- |
| Beta | `Cov(p, b) / Var(b)` on raw returns | unavailable if `b` has effectively zero variance |
| Correlation | `Cov(p, b) / (sd(p) sd(b))`, roundoff clamped to [−1, 1] | unavailable if either series has zero variance |
| Annualized active return | `mean(active) × 252` | never a CAGR difference |
| Tracking error | `sd(active) × √252` | 0 when active returns are constant |
| Information ratio | `mean(active) / sd(active) × √252` | unavailable when tracking error is zero |
| CAPM alpha | OLS `pe = α + β·be + ε`; annualized `α × 252` (linear, never compounded) | needs ≥ 3 rows, a risk-free return for **every** aligned interval, and non-zero **excess**-benchmark variance |
| Regression beta, R² | OLS slope; `R² = corr(pe, be)²` | same as alpha; R² also needs non-zero `pe` variance |

Beta, correlation, active return, tracking error and IR need at least 2 aligned returns, and carry a short-sample note below 252. Zero variance uses the Phase 2 scale-aware tolerance (≤ 1e-12 × the largest absolute observation).

- The raw-return beta and the regression slope are different statistics and can differ when rates vary. Alpha is never computed as `mean(pe) − rawβ·mean(be)`.
- If any aligned interval lacks a risk-free return, alpha, regression beta and R² are unavailable. They are never re-estimated on a shorter hidden sample.
- Every relative metric carries the identical `Sample` object.

**Geometric comparison.** Portfolio and benchmark cumulative return and CAGR are computed over the comparison period from wealth paths rebased to $10,000 at its start. The portfolio keeps its drifted weights. CAGR uses calendar days / 365.25, as in Phase 2. These require continuous coverage and are unavailable across interior benchmark gaps. They are presented separately from the arithmetic active-return statistics.

**Benchmark drawdown.** Computed on the rebased benchmark wealth path with the unchanged Phase 2 functions: `dd_t = W_t / max(W_0 … W_t) − 1`, with the same episode rules. It needs continuous coverage. When the benchmark starts later, its running peak starts at the comparison start, while portfolio drawdown keeps its full-history peak; the UI says so.

CAPM alpha against a chosen ETF is a single-factor excess-return intercept relative to that proxy, not evidence of skill. No significance tests are reported.

## Portfolio risk, diversification and contribution (Phase 4, `risk-v1`)

**Common-date asset alignment.** `alignHoldings` (`lib/backtest/alignment.ts`) builds one canonical sample of daily arithmetic returns for every positive-weight risky holding. The returns are the ledger's adjusted-price ratios on consecutive covered sessions. An interval is kept only when every risky holding has a valid return on it, so each covariance cell, correlation, standalone volatility and risk contribution uses the same observations. There are no pairwise samples, no forward-fill and no returns across missing sessions. Phase 1 coverage already rejects interior gaps, so for a valid backtest this sample equals the full ledger from the latest risky holding's effective start. The sample records start, end, count, tickers (portfolio order) and an interval-set hash.

**Thresholds.** Fewer than 60 common observations makes covariance-based risk unavailable: covariance, correlation, standalone and target volatility, MRC/CRC/PCR, weighted volatility and diversification ratio. 60–251 is shown as limited history; 252+ is normal. Capital concentration and return contribution do not depend on this sample.

**Covariance and annualization.** `Σ_daily` is the sample (n − 1) covariance matrix, computed once per upper-triangle cell and mirrored, so it is exactly symmetric. `Σ_annual = 252 × Σ_daily`. Diagonals equal each holding's sample variance. Eigenvalues (cyclic Jacobi) confirm positive semidefiniteness. Since Phase 6 the shared validator (`lib/analytics/matrix.ts`) also rejects non-square and non-finite matrices, eigensolver non-convergence and non-finite intermediate arithmetic. Before any convergence arithmetic, Jacobi normalizes the matrix by an exact power of two (2^⌊log₂ max|a_ij|⌋) and stops relative to the normalized Frobenius norm, rescaling eigenvalues on return. The same matrix therefore gets the same PSD verdict at any finite scale (tested from 1e-300 to 1e300). Power-of-two scaling is exact, so outputs for normal-scale matrices are unchanged (bitwise, by replay). Roundoff-sized negative eigenvalues (≥ −1e-10 × the largest) are tolerated; larger ones make the covariance family unavailable with the reason and are never repaired. A rank-deficient matrix (duplicate, perfectly correlated or constant holdings) is disclosed as singular; target-weight risk remains defined. Historical sample covariance describes the window; it is not a forecast.

**Target-weight risk contribution ("Risk Contribution at Target Weights — CASH treated as locally riskless").** `w` is the configured target weight of each risky holding, not renormalized to the risky sleeve.

- `σ_p = √(w′Σ_annual w)`
- `MRC_i = (Σ_annual w)_i / σ_p`
- `CRC_i = w_i · MRC_i`
- `PCR_i = CRC_i / σ_p`
- Identities: `Σ CRC = σ_p` and `Σ PCR = 1`. The residuals are recorded; a PCR residual above 1e-9 is an error.
- MRC, CRC and PCR may be negative (hedges) or exceed 100%. They are never clamped.
- CASH sits outside Σ with zero volatility and covariance, so its MRC, CRC and PCR are exactly 0. Moving capital into CASH scales `σ_p` but leaves risky PCR and the diversification ratio unchanged.
- Roundoff: `w′Σw` within ±1e-12 × (Σ|w_i|σ_i)² is zero volatility, and a materially negative value is reported as invalid.
- At zero target volatility (all CASH, a perfect hedge, or constant assets), MRC, PCR and the diversification ratio are unavailable.

This is a model snapshot at target weights. It is not the average risk of the drifting historical portfolio, and it differs from Phase 2 realized volatility, which uses drifted weights and CASH's actual accrual.

**Standalone volatility and correlation.** `vol_i = sampleStdDev(r_i) × √252`, equal to √diag(Σ_annual). Pearson correlation is derived from the same Σ with an exact diagonal of 1. A holding whose daily dispersion is ≤ 1e-12 × its largest absolute return (the Phase 2 rule) is constant: volatility 0, and its row and column undefined rather than forced to 1. Roundoff past ±1 is clamped; anything larger is an error. The highest and lowest pairs exclude self-pairs and undefined cells, with ties broken by portfolio order. Holding beta reuses Phase 3's beta on the Phase 3 benchmark-aligned sample, which is disclosed and may differ from the covariance sample.

**Diversification and concentration.**

- `WA Vol = Σ w_i · vol_i` (CASH vol 0).
- `DR = WA Vol / σ_p`: the benefit from correlations below +1 among risky assets.
- `HHI = Σ w_i²` over all capital weights including CASH; effective holdings = `1 / HHI`.
- Largest position; top-3 concentration (ties by portfolio order).

Effective holdings measures capital concentration, not correlation diversification, and is not a complete diversification score.

**Return contribution.** `contribution_(i,t) = w_(i,t−1) · r_(i,t)` uses the ledger's actual beginning-of-interval weight: drifted within a month, and reset to targets after a month-end close. It never uses static targets. CASH contributes its weight × prior-known accrual. `Σ_i contribution_(i,t) = portfolioReturn_t` exactly; the maximum residual is recorded. The period figure is the arithmetic sum over intervals in percentage points, and holdings add up to the sum of daily portfolio returns, not the compounded cumulative return. It is labeled "Daily / Period Arithmetic Return Contribution" and is not Brinson, allocation/selection or linked geometric attribution.

**Target weights vs historical drifted weights.** Risk decomposition uses configured targets (what the allocation is designed to hold). Return contribution uses the historical drifted/reset weights (what the backtest actually held each day). The two are never mixed.

## Rolling analytics (Phase 5, `rolling-v1`)

Computed once in `simulate()` (`lib/analytics/{rolling,rollingSummary}.ts`) and shipped as `rollingAnalytics`; constants live in `ROLLING_METHODOLOGY`, so Phase 1 snapshot identity is unchanged (verified by cross-version replay).

- **Windows:** 20, 60 and 120 session returns; 60 by default.
- **Full windows only.** A value at date t uses the N ledger intervals ending at t's close (N + 1 closes). It exists only when all N intervals are valid for the statistic and chain session to session: each interval starts where the previous one ended. A missing session resets the count; a window is never compressed across it, and no partial window is shown.
- **Volatility** is `sampleStdDev(r) × √252` on the realized portfolio's daily returns (drifted weights, CASH accrual included): the Phase 2 function applied to the window.
- **Beta and correlation** are portfolio vs benchmark on the Phase 3 canonical aligned intervals only: the Phase 3 `beta` (`Cov(p, b) / Var(b)`) and `correlation`, applied to the window. An interval without benchmark prices at both ends blanks every window that contains it; a benchmark that starts later yields its first value N aligned intervals after its start.
- **Undefined values:** a full window whose statistic is undefined (zero benchmark variance, for example) is blank, counted, and reported with its reason, never forced. Short-sample notes are not attached to rolling points; the chart states the window length instead.
- **Chart:** the full-period statistic (Phase 2 realized volatility, Phase 3 beta or correlation) is drawn as a reference line. Correlation uses a fixed [−1, 1] axis; volatility is zero-anchored; beta always includes zero. Display downsampling keeps each gap's first and last point, so gaps stay visible. Short windows are noisy descriptions of the past, not forecasts.

## Historical stress tests (Phase 5, `stress-v1`, `stress-windows-v1`)

Stress runs through its own `/api/stress` request, independent of `/api/analysis` like quotes and the current curve: the analysis snapshot, hash and latency are unchanged, and a stress failure never touches the analysis.

**Fixed windows** (`config/stressWindows.ts`), between actual XNYS session closes. They are chosen, documented historical windows, not universal definitions of each crisis, and are never redefined dynamically.

| Event | Start close | End close | Sessions | Choice |
| --- | --- | --- | --- | --- |
| Global Financial Crisis | 2007-10-09 | 2009-03-09 | 356 | S&P 500 closing high to closing low |
| COVID Crash | 2020-02-19 | 2020-03-23 | 24 | S&P 500 closing high to closing low |
| 2022 Inflation / Rate Shock | 2021-12-31 | 2022-12-30 | 252 | Calendar year 2022 |

**Event convention.** Each event is an independent run of the unchanged Phase 1 simulation on its window. The configured target portfolio is initialized at target weights at the start close; the first earned return ends at the next session. Weights drift, and the same monthly closing resets apply. No result depends on another backtest's drifted weights. The analysis's CASH policy and prior-known Treasury rule are reused unchanged.

**Coverage.** Every positive-weight risky holding must have an adjusted price at every window session. Otherwise the event is reported as **Incomplete Historical Coverage** with each missing holding and its reason: pre-inception (provider-reported first trade after the start), provider history beginning later, missing sessions, or no history returned. It shows no portfolio figure: it is never shortened, bridged, proxy-filled or rebuilt from a subset. Over a historical span, `INSUFFICIENT_HISTORY` and `TICKER_NOT_FOUND` mean missing history. Other fetch errors (timeout, rate limit, malformed data) make the event unavailable with the provider message. The benchmark is checked separately: without full event coverage, benchmark return, benchmark volatility and active return are unavailable while a fully covered portfolio event remains. CASH needs the window's Treasury history, as in the main run.

**Metrics.**

- Portfolio return is `W_end / W_start − 1` on the event's compounded wealth.
- Benchmark return is the ETF's adjusted-price return over the same sessions.
- **Event active return** is portfolio return minus benchmark return. It is a simple difference over the window, not the annualized arithmetic active return of the benchmark section.
- Maximum drawdown is within the window, with the start close as the first peak.
- Portfolio and benchmark volatility are `sampleStdDev × √252` of the event's daily returns; they are unstable for short windows.
- **Holding returns** are each holding's own compounded return, `prod(1 + r_t) − 1` (CASH at its accrual). They are standalone returns, not contributions.
- Best and worst name every holding at the extreme; returns within 1e-12 are ties.
- The number of monthly resets inside the window is reported.

**Bounds.** Custom and preset bounds resolve to the first session on or after the requested start and the last completed session on or before the requested end. Today's unfinalized bar is excluded by the analysis's uniform cutoff. Any difference from the request is disclosed. Fewer than two completed sessions makes the event unavailable.

**Custom Historical Window.** The same rules apply to dates the user chooses. The start must precede the end, the end cannot be in the future, and the span is at most 10 years; longer horizons belong to the main analysis. Calendar coverage is enforced server-side. It is labeled as a historical window and never called a hypothetical stress test.

**Data and reproducibility.** Each security is fetched once over the span covering the requested windows: the fixed preset span 2007-10-09 → 2022-12-30 (cache keys shared by every portfolio holding that security) or the custom window. This uses the analysis's providers, cache-key format, TTLs and fallback rules. Treasury history is fetched only when CASH is held. The result carries its own trimmed snapshot and a SHA-256 over:

- the config, the Phase 1 `METHODOLOGY` and `STRESS_METHODOLOGY`;
- the windows version and both calendar versions;
- the snapshot: windows, prices on window sessions, Treasury observations from 14 days before each window, window sessions plus the next session, and fetch failures.

`runStress({...snapshot, config, now: metadata.generatedAt})` reproduces every event and the hash. Trimming is proven not to change any event.

Today's configured holdings applied to past windows carry selection and survivorship bias. Results are gross of costs and describe what happened, not what will happen.

## Portfolio construction (Phase 6, `construction-v1`)

Construction produces mathematically valid alternative allocations under explicit methodology and constraints. They are **not recommendations**, and no expected-return, mean-variance, Maximum Sharpe or historical-CAGR objective exists. Historical Sharpe is a comparison statistic only. It runs through its own `/api/construction` request with its own snapshot and hash; the analysis is untouched.

**Eligible universe and estimation sample.** Every risky ticker in the analyzed configuration is eligible, **zero-weight rows included**; CASH is excluded. The analysis ignores zero-weight holdings for coverage, but construction does not. To add a candidate, add it as a 0% holding and re-run the analysis. Before solving, the following are frozen:

- the universe and its canonical order (all arithmetic on lexicographically sorted tickers, so holding order never changes a weight);
- the estimation window: the analysis's requested period and finalized cutoff, with the effective start at the latest first valid session across **all** eligible assets;
- the common valid intervals: Phase 1 coverage rules applied to every eligible asset (no pairwise samples, no forward-fill, no bridging, no silent dropping; an unexplained gap fails explicitly). The one exception, where neither portfolio can hold a risky asset, is under **CASH and the risky budget** below;
- current weights, the CASH weight, bounds, required holdings and the covariance version.

Sample-size status: fewer than 60 common returns makes the risk model unavailable (inverse volatility, minimum variance and ERC report `insufficient_history`; equal weight remains available). 60–251 is Limited History. 252+ is "normal", which describes sample size only and does not imply forecasting reliability.

**Two covariance matrices, never mixed.** The Phase 4 Historical Risk Analysis keeps the **sample** covariance. Construction uses **Σ_construction = 252 × [(1 − δ)S + δμI]**: Ledoit–Wolf (2004) linear shrinkage of the daily n − 1 sample covariance S toward a scaled identity, with μ = trace(S)/N.

- δ is computed exactly as published, on the n-denominator S_n with centered returns x_k and ‖A‖² = tr(AAᵀ)/N:
  - m = tr(S_n)/N
  - d² = ‖S_n − mI‖²
  - b̄² = n⁻² Σ_k ‖x_k x_kᵀ − S_n‖²
  - δ = min(b̄², d²)/d², or 0 when d² = 0
- δ is a ratio of quantities that scale together, so it is unaffected by the denominator. Applying it to S gives the published estimator × n/(n − 1), the lab's uniform convention.
- Recorded: δ, the target, the sample convention, μ, λmin/λmax and condition numbers before and after shrinkage, and a covariance hash (tickers, interval-set id, version, matrix).
- There is no emergency ridge and no fallback estimator. Both matrices must pass the hardened validator (dimensions, finiteness, scale-aware symmetry and PSD at 1e-10 relative, eigensolver convergence); otherwise the risk-based methods are `invalid_covariance`.

**Zero-volatility assets.** A risky asset whose raw daily returns have zero or undefined dispersion (the Phase 2 rule) makes inverse volatility, minimum variance and ERC `invalid_inputs`, naming the asset: shrinkage must not mask unusable data. Equal weight remains available.

**CASH and the risky budget.** CASH stays outside Σ and is **fixed**: at its current weight by default, or at an explicit user weight. It is never optimized, so no method can move the portfolio into zero-risk CASH. B = 1 − CASH, and every method allocates only B. Historical comparisons keep the Treasury-based CASH accrual.

**Constraints and feasibility.** V1 is long only, fully invested, with no leverage, borrowing or shorting. For each risky asset, 0 ≤ lower ≤ upper ≤ 1 as a fraction of the **whole** portfolio. A positive minimum applies unconditionally, never as "0% or at least the minimum". A required holding needs a positive minimum. Checked before any optimizer runs:

- finite values and valid bounds;
- the CASH weight;
- Σ lower ≤ B ≤ Σ upper.

Consequences: with B = 0, all-CASH is feasible only if every minimum is 0. Equal weight, inverse volatility and minimum variance are then the all-CASH allocation ("All-CASH Allocation (zero risky budget)") and need no risky history or covariance. ERC is unavailable (no risky allocation, no risk-budget problem). Model risk is exactly zero with CASH contributing 0, and the comparison uses the Treasury CASH path on the session calendar, or reports the typed Treasury-unavailable state. When the current allocation is also all-CASH, neither compared portfolio can hold a risky asset. A zero-weight candidate's price history is then not a dependency and may be missing entirely: the window is the session calendar, no risk model is estimated, and the server does not fail on that candidate's fetch. If the current allocation holds a risky asset, or B > 0 (a proposal can hold one), every eligible asset's history is required as before. With B > 0 and no eligible risky asset, the problem is infeasible. Constraints are never relaxed, CASH is never changed, and required holdings are never dropped. Example: 20% CASH with two risky assets capped at 35% has 70% capacity against an 80% budget, so it is infeasible.

**Bounded projection.** One exact solver serves equal weight, inverse volatility and every solver step: argmin ‖w − r‖² subject to Σw = B and l ≤ w ≤ u. The solution is w_i = clip(r_i − τ, l_i, u_i), with τ found on the sorted breakpoints of the nonincreasing piecewise-linear Σ clip(r_i − τ) and solved in closed form. It never clips and renormalizes.

**Methods.** Each method's output:

| Method | Definition | Output |
| --- | --- | --- |
| Equal weight | Reference B/N; with bounds, its projection | Equal-Weight or Constrained Equal-Weight Allocation |
| Inverse volatility | σ_i = √Σ_construction[i,i]; reference B(1/σ_i)/Σ(1/σ_j); with bounds, the same projection. Not risk parity | Inverse-Volatility or Constrained Inverse-Volatility Allocation |
| Minimum variance | minimize wᵀΣ_construction w subject to Σw = B, l ≤ w ≤ u | Minimum-Variance Allocation |
| Equal risk contribution | With PCR_i = w_i(Σw)_i / wᵀΣw and N the eligible risky count fixed **before** solving: minimize Σ(PCR_i − 1/N)² subject to Σw = B, l ≤ w ≤ u | Equal-Risk-Contribution Allocation, or Constrained Risk-Balance Approximation |

How each solver works:

- **Minimum variance: solver.** FISTA projected gradient with gradient restart, step 1/L (L = 2λmax), each step an exact projection, starting from the constrained equal-weight allocation.
- **Minimum variance: polish.** After certification, an active-set polish solves the KKT system exactly on the identified free set. It is kept only if it satisfies the bounds exactly and certifies at least as well.
- **Minimum variance: tie rule.** Used only for a singular Σ. Every optimum shares Σw, so the optimal set is a polyhedron, and Dykstra's projections select its point nearest the constrained equal-weight allocation. With δ > 0, Σ_construction is positive definite and the optimum is unique.
- **ERC: starts.** Projected gradient with Armijo backtracking and Barzilai–Borwein steps over deterministic starts in fixed order:
  1. constrained equal weight;
  2. constrained inverse volatility;
  3. current allocation when feasible;
  4. the log-barrier risk-budget allocation (Spinu's convex formulation, used only as an initializer) projected onto the bounds;
  5. one tilt per asset, the projection of B(1 + e_k)/(N + 1).

  A start within 1e-9·B of an earlier start is recorded as coincident and not run twice. A zero-variance start lies outside the domain and is skipped. Each run stops when its residual reaches 1e-14 or stops improving for 2,000 iterations while within certification.
- **ERC: exact-parity acceptance.** F = Σ(PCR_i − 1/N)² is nonnegative. A feasible, finite endpoint with max|PCR_i − 1/N| ≤ 1e-6 has F ≤ N·10⁻¹², so it is within N·10⁻¹² of the global minimum. It is accepted as `parity_achieved` and no curvature estimate can overturn it. (Second review counterexample: Σ = diag(1, 1/2.25e12) has exact ERC [6.666662222e-7, 0.9999993333], parity ~1e-16. A fixed-step finite-difference Hessian reported curvature −2.4e11 there, rejected it and selected a ~50/50 plateau.)
- **ERC: second-order certification.** Every other first-order stationary endpoint can be a saddle. The first review counterexample is equal weight on Σ = [[1,0,−⅔],[0,1,−⅔],[−⅔,−⅔,1]], with PCR [1, 1, −1] and zero gradient. Such endpoints are checked on the **critical cone**. The constraints are linear, so the second-order necessary condition is dᵀ∇²F d ≥ 0 for every d with:
  - Σd = 0, and d_i = 0 where l_i = u_i;
  - d_i ≥ 0 at a lower bound and d_i ≤ 0 at an upper bound;
  - ∇Fᵀd = 0.

  How the check works:
  - **Hessian.** ∇²F is **analytic**: with J = (1/V)[diag(m) + diag(w)Σ − 2p mᵀ], a = eᵀp and c = e∘m + Σ(e∘w), ∇²F = 2JᵀJ + 2[(e_j + e_k − 2a)Σ_jk/V − 2(c_j m_k + m_j c_k)/V² + 8a m_j m_k/V²]. No step size is involved, so tiny weights are exact.
  - **Independent check of the Hessian.** It matches an exact-rational finite-difference Hessian to 4e-16 relative.
  - **Which bounds are released.** ∇Fᵀd = 0 forces d_i = 0 for any bound whose multiplier is positive under some valid KKT multiplier. With free assets, ν = their mean gradient. With none, ν ranges over [max ∇F at caps, min ∇F at floors], so an **empty free set is never taken as proof of optimality**. Bounds whose multiplier is at most 1e-6 (normalized) for every valid ν are released: they may move inward, alone or jointly.
  - **Where the minimum is found.** The cone's minimum curvature lies in the relative interior of one face: the free assets plus a subset of released bounds. There it is a minimum eigenvector of the Hessian restricted to that face's budget-preserving subspace (Helmert basis, Jacobi).
  - **Fast path.** If the subspace of every released bound has no curvature below −1e-6, the cone has none.
  - **Full enumeration.** Otherwise all 2^k faces are enumerated, up to 10 released bounds (beyond that the verdict is unverifiable). A face's minimum eigenvector counts only if it, or its negation, moves each released bound strictly inward (component > 1e-9).
  - **Verdicts.** Normalized curvature (× B²) carries an explicit roundoff bound, 64·N·ε·κ_V·‖|∇²F|‖_F·B², where κ_V = |w|ᵀ|Σ||w| / wᵀΣw.
    - `violated`: below −1e-6 by more than that bound.
    - `unverifiable`: within the bound of the threshold, or with an unresolved eigenspace. Never collapsed into verified.
    - `verified`: otherwise.
  - A `violated` point is escaped along its cone direction (up to 10 escapes per start) and the run continues. An `unverifiable` start does not certify, and the other deterministic starts decide.
  - A start certifies only with `parity_achieved`, or with first-order stationarity (projected-gradient and KKT residuals ≤ 1e-8) **and** `verified`.
  - The best certified start wins (objective, then parity, then order). No global-optimality claim is made except for exact parity.
- **ERC: reporting and wording.** Solver certification and achieved parity are reported separately. A certified result whose parity exceeds tolerance is labeled **Constrained Risk-Balance Approximation**, never exact ERC. The message claims the constraints make exact parity **infeasible** only when that is proven: Σ_construction is positive definite (so the long-only ERC allocation is unique; Maillard, Roncalli & Teiletche 2010), the log-barrier solution verifiably has PCR = 1/N, and scaled to B it breaks a bound, which the message names. Otherwise the message reads "Exact risk parity was not achieved by the solver under the selected constraints … It has not been shown that the constraints make exact parity impossible."

**Certification and diagnostics.** A result is usable only if, independently of the solver's stopping reason, it is finite, meets the budget and bounds within tolerance, and has normalized stationarity within tolerance. For ERC, exact parity is the alternative: a feasible, finite point with parity ≤ 1e-6 is the global minimum within N·10⁻¹². Stationarity is measured two ways: the gradient-mapping residual ‖w − P(w − s∇f)‖∞/B, and a multiplier-based KKT residual (free g_i = ν, lower-bound g_i ≥ ν, upper-bound g_i ≤ ν). Iteration exhaustion without certification is `non_converged`; non-finite arithmetic is `numerical_failure`; a small objective change alone never counts as convergence.

The result contract distinguishes:

- `success`
- `infeasible`
- `invalid_inputs`
- `insufficient_history`
- `invalid_covariance`
- `numerical_failure`
- `non_converged`
- `converged_but_parity_not_achieved`

Recorded with each result:

- the method, full-precision weights and objective;
- iterations and the termination reason;
- budget, bound, stationarity, KKT and parity residuals;
- binding floors, caps and fixed positions;
- the per-start ERC record and the tie rule;
- δ, the estimation window, the observation count, and warnings.

Each proposal also carries plain observations: 0% floors, binding caps, concentration above 50% of the risky budget, negative risk contributions, turnover above 50%, and, for minimum variance, "lower modeled variance does not imply better returns, smaller future drawdowns or suitability". Strange but valid results are shown and explained, never replaced.

**Tolerances** (`CONSTRUCTION_METHODOLOGY.tolerances`, versioned, one purpose each):

| Check | Tolerance |
| --- | --- |
| Budget and bound violations | 1e-10 (decimal weights) |
| Matrix symmetry and PSD | 1e-10 (relative) |
| Stationarity / KKT | 1e-8 (normalized) |
| ERC parity (max \|PCR_i − 1/N\|) | 1e-6 |
| Internal solver target | 1e-14 |
| ERC negative curvature on the critical cone (× B²) | −1e-6 |
| Curvature roundoff bound | 64·N·ε·κ_V·‖\|∇²F\|‖_F·B² |
| Weakly active bound (normalized multiplier) | 1e-6 |
| Cone-face direction (released-bound component) | 1e-9 |
| Released bounds enumerated (2^k faces) | at most 10 |
| Coincident starts (max-abs, × B) | 1e-9 |

**Turnover.** Estimated One-Way Turnover = ½ Σ |proposed − current| over the union of holdings, with a missing weight counting as 0 and CASH included. It is a distance between target allocations, not traded notional or backtest rebalancing turnover. No transaction costs are estimated.

**Comparisons.**

- **Construction Model Risk:** current and proposed allocations on the **same** Σ_construction (model volatility, standalone volatility, MRC, CRC, PCR and diversification ratio, via the Phase 4 Euler functions). It is labeled separately from the Phase 4 Historical Risk Analysis.
- **Historical comparison:** both target allocations are simulated by the unchanged engine, each re-initialized at target weights on the **same** start, the estimation sample's first session. A later-listing candidate therefore moves both starts. The data are identical (prices, Treasury, sessions, benchmark intervals, rebalancing) and every metric definition is unchanged. It is labeled **IN-SAMPLE RETROSPECTIVE ANALYSIS**: the weights were estimated on the same history, so this is not an out-of-sample backtest and does not validate any prediction.
- **Stress comparison:** the unchanged Phase 5 engine runs for each allocation on the same event snapshot. An event compares only when **both** portfolios cover it, i.e. the union of holdings; otherwise it reports Incomplete Historical Coverage with the missing tickers and no partial comparison. Benchmark-only failures stay isolated. Applying weights estimated later to earlier windows is a retrospective scenario, not a portfolio that could have been known at the time, and not a forecast.

**Proposal state and Apply.**

- A proposal is kept beside the builder draft and never mutates the current portfolio. One generation solves all four methods on the same frozen inputs, and the method selector only chooses the view.
- Construction is defined only while the builder still holds exactly the analyzed configuration (holdings, weights, CASH, benchmark, dates, CASH policy). Generate is disabled, with the reason shown, whenever the builder differs.
- The proposal is keyed by the analysis snapshot hash, the analyzed configuration, the builder configuration at generation, the constraints and the CASH choice. Any change marks it stale, and a stale proposal cannot be applied. A response keeps the key captured when its request was sent, so edits made while it was outstanding leave it stale.
- `applyProposal` enforces staleness itself: it re-checks builder consistency (a caller's stale key does not help), so newer edits are never overwritten.
- Apply uses full-precision weights (plain-decimal percent strings, ~1e-16 round-trip error). It revalidates the proposal itself before and after conversion: each eligible ticker present exactly once, CASH present when expected, no unknown tickers, the budget, the frozen bounds, the current editor bounds and the fixed CASH weight. It then replaces the builder's holdings. The analysis must be re-run to evaluate the applied allocation.
- Current quotes never enter construction.

Required text on every construction view: "For educational and analytical purposes only. Allocation outputs are mathematical results based on selected inputs, assumptions and constraints, not personalized recommendations."

## Forward model (V2, `forward-v1`) — in development

V2 adds a forward layer that is separate from every historical layer above. It
states what the model *assumes* for the next 12 months; it does not describe what
happened. Constants live in `FORWARD_METHODOLOGY`. They are appended to
`config/methodology.ts` without editing any earlier constant, so every Phase 1–6
snapshot hash is unchanged; a test pins each earlier constant's hash. The task plan
and the approved decisions are in [V2-TASKS.md](V2-TASKS.md). This section grows
as each part is implemented; anything not described here is not yet built.

**Horizon.** The outlook is fixed at the **next 12 months**. Nothing is compounded
past it, extrapolated to longer horizons or decayed.

**Risk window.** The historical window used to estimate covariance, volatility,
Forward Model Beta and correlation is **1Y, 3Y or 5Y** (default 3Y). It is separate
from the forecast horizon: changing it never changes the 12-month horizon. It is
also independent of the historical Analysis Period.
- **End:** the latest finalized market session. That is the last XNYS session
  before today's New York date: the current day's bar is excluded until the next New
  York date, as everywhere else in the lab.
- **Start:** N years before that session. The sample begins at the first session on
  or after that date.

**Forward risk model** (`forward-lw-augmented-v1`):
- **Universe:** the forward risky opportunity set (zero-weight rows included; CASH
  excluded) plus the selected market proxy.
- **One common aligned sample** under the Phase 1 coverage rules. There are no
  pairwise samples, no forward-fill and no bridging.
  - An interior or terminal missing session fails explicitly (`coverage_gap`), and
    so does an unexplained late start.
  - A later start is accepted only where the provider reports a later first trade.
    The window then shortens to the common period and is never silently shortened:
    the result shows the **Requested Risk Window**, the **Effective Risk Window**
    (the actual first and last session of the common sample), the aligned-return
    count, and the securities that caused the truncation.
- **Thresholds** apply to aligned *return* observations:
  - fewer than 60: the forward risk model is unavailable;
  - 60–251: Limited History;
  - 252 or more: normal.
- **Covariance:** one Ledoit–Wolf (2004) scaled-identity shrinkage covariance over
  universe ∪ proxy.
  - It uses the existing estimator, sample convention and annualization
    (Σ_annual = 252 × Σ_daily).
  - It is validated by the shared covariance validator (symmetry and PSD at 1e-10
    relative, eigensolver convergence), both before and after shrinkage. A failure
    makes the model unavailable (`invalid_covariance`).
  - Shrinkage δ and μ depend on the whole universe, so they are recorded with the
    model.
- **Forward Model Beta** = Σ_im / Σ_mm and **σ_m** = √Σ_mm, from that same matrix.
  - A held proxy therefore has β = 1 exactly and sits on the market point.
  - Every long-only portfolio satisfies β_p σ_m ≤ σ_p. So, with no views, no
    portfolio's forward Sharpe can exceed the Market CML Proxy slope.
  - It is labelled "Forward Model Beta vs VTI" (or the selected proxy), never bare
    "Beta".
- **Historical Correlation** is the Pearson correlation of the same common sample
  (sample covariance). It is never the shrunk model matrix.
- **Zero volatility:** a security (or the proxy) whose daily returns have zero or
  effectively zero dispersion over the effective window is a data/model error
  (`zero_volatility`, naming the ticker). It is never treated as a risk-free asset.
  The tolerance is the existing scale-aware rule: dispersion ≤ 1e-12 × the largest
  absolute daily return.
- **All-CASH:** only the proxy is estimated (σ_m is still available). Portfolio risk
  metrics, the risky frontier and the tangency portfolio report "No risky assets".
- **Single risky asset:** valid. Its β is Σ_im / Σ_mm, and its feasible risky
  frontier is a single point.
- **Audit:** each model records:
  - the requested and effective window and the aligned-return count;
  - the tickers and the proxy;
  - the limiting securities and the history status;
  - the covariance version, δ and μ, and the annualization;
  - the validation conditioning;
  - the betas, σ_m and the historical correlations;
  - a SHA-256 hash over the methodology, proxy, window, tickers, interval set and
    matrix.

  Replaying the builder on its price snapshot reproduces the model exactly.

**Forward risk-free rate.** Labelled **Forward Risk-Free Rate · 1Y U.S. Treasury
· Latest Available**, with its observation date and source. It is never called live.
- **Rate:** the latest available official 1-year constant-maturity Treasury yield
  (H.15 DGS1).
- **Basis:** a quoted yield used unconverted as the 12-month risk-free proxy. It is
  not a guaranteed realized holding-period return.
- **How it is read:** 1Y only, from both official sources:
  - FRED's DGS1;
  - the U.S. Treasury's Daily Par Yield Curve "1 Yr" column.

  Each source is read over the same 21-calendar-day window the current curve reads.
  Unpublished values ('.' / N/A) are skipped, and no observation dated after today
  (New York) is used.
- **Choosing between the two sources:**
  - The **later** observation date wins, because FRED's ingestion can lag the
    same-day H.15 release. On equal dates, FRED is used.
  - Rates are never merged or averaged. If the two sources disagree on the same
    date, FRED's value is used and the difference is recorded.
  - If one source fails, the other is used.
  - Provenance records the source, the observation date, the selection reason,
    the cache age and the retrieval metadata.
  - This rule applies only to the forward 1Y read. The historical Treasury logic,
    the current curve and the generic FRED-first fallback are unchanged.
- **Maximum age:** the newest observation must be at most **7 calendar days** older
  than the current New York date.
  - An older one returns `TREASURY_UNAVAILABLE` ("Latest available 1Y Treasury
    observation is stale").
  - The 21-day retrieval window exists only so that staleness is detected and
    reported.
  - Age is judged on every read, so a cached reading can age into unavailability.
- **Date:** DGS1's own latest observation, *not* the latest date shared with the
  other curve maturities.
- **Cache:** own key `fred:latest-DGS1:v1`, with the Treasury six-hour TTL.
- **When it is unavailable:**
  - if the read fails, or returns another maturity, a future date, a stale date or
    an invalid yield, the forward model is unavailable with the reason;
  - the 3M, 3Y, 5Y or 10Y rate is never substituted.
- **Historical analytics are unchanged.** They keep the prior-known DGS3MO
  methodology above.

**Market proxy.** VTI (default), SPY or VT. Only these broad equity funds are
accepted: a bond fund, or any other fund, can never stand in for the market
portfolio. VTI is a practical market proxy, not the theoretical global market
portfolio. Custom proxies need a separate, approved change.

**Market Risk Premium (MRP).**
- An explicit forward **assumption**, 5.00% by default, never presented as market
  data.
- The user may override it within **−10% to +20%** (inclusive). A negative
  premium is an intentional, allowed scenario.
- Values outside the range are rejected with the range stated, never clamped. The
  bound exists because an absurd premium (e.g. +500%) would make the frontier, CAL
  and SML meaningless while still looking mathematically valid.
- When MRP ≤ 0 leaves no security with an expected return above Rf, outputs such as
  the tangency portfolio report a typed *undefined* status. They are never
  manufactured.

**CAPM prior** (12 months):

> **CAPM Prior_i = Rf + Forward Model Beta_i × Market Risk Premium**

- **Rf** is the latest available 1Y Treasury proxy above.
- **Forward Model Beta** is measured against the selected Market Proxy, from the
  certified forward risk model. It is never re-estimated, and never replaced by the
  historical benchmark beta.
- **MRP** is the explicit, user-visible assumption.
- All values are decimals (5.00% = 0.05); formatting belongs to the UI.
- **What it is:** a model *equilibrium assumption*. It is **not**:
  - a historical realized return;
  - a historical CAGR or average return;
  - a price target;
  - historical alpha;
  - a guaranteed forecast.
- **What it never uses:** historical returns, analyst targets, Street data or
  Black–Litterman. A test shows that adding a large drift to a security's past
  returns, tripling its cumulative growth, leaves its prior unchanged.
- **One formula:** `capmRequiredReturn(rf, beta, mrp)` is the only implementation
  of Rf + β × MRP. The CAPM prior, CASH, the canonical expected market return and
  the later Security Market Line all call it, so the CAPM Required Return and the
  SML can never diverge.
- **Expected market return:** **Rf + MRP** — the β = 1 case of that function. It
  is exposed once, and the Market CML Proxy, the SML and explanations reuse that
  single value.
- **Market proxy:** its Forward Model Beta is 1 exactly, so its prior equals the
  expected market return. A held proxy has exactly one prior. A risk model in which
  a held proxy's beta is not exactly 1 is refused.
- **CASH:** expected return = Rf, with Forward Model Beta shown as 0. CASH stays
  outside the risky covariance model.
- **Negative inputs:**
  - Negative betas and a negative MRP are not special-cased. A prior below Rf, or
    below zero, is shown as calculated.
  - There is no floor at Rf, no clamp at zero and no substituted assumption.
  - MRP = 0 gives every risky security exactly Rf.
- **Impossible results:**
  - A 12-month simple return cannot be at or below −100%. A prior there is a typed
    `invalid_capm_prior` error, listing the ticker, beta, Rf, MRP and calculated
    prior. It is never clamped.
  - There is no upper cap.
- **Determinism:** the prior depends only on the risk model (recorded by its hash),
  Rf (value, observation date, source) and the MRP. Results come in the risk
  model's canonical ticker order, and retrieval timestamps do not affect them. The
  module has no Node-only or server-only imports, so the same function recomputes
  the prior in the browser when only the MRP changes (Q19).
- The Expected Return Gap is not computed until Black–Litterman exists.

**Views and confidence (inputs).**
- Each risky security has one of three views:
  - **No View** — the model uses the CAPM prior;
  - **Street View**;
  - **Manual View**, labelled **12M Expected Total Return** — the same return
    basis as the CAPM prior and the Black–Litterman vector. It must be above −100%
    and at most +200%; values outside that are rejected, never clamped. The upper
    bound is broad because single-stock views can be large, but it catches
    accidental entries such as 10000%.
- Street views are different: they are labelled **12M Price-Target Return ·
  Dividends Excluded**, a price-only return. That difference is always shown.
- The manual value is kept while another source is active.
- Confidence is explicit: 0–100%, default 50%. 0% ignores a view. It is never
  generated or inferred.
- Views are absolute and single-security, keyed by canonical ticker. CASH carries no
  view.

**Black–Litterman inputs: P, Q and Ω.** These are built from the saved views and
the certified forward risk model. No posterior is computed at this step.
- **Which views are ACTIVE.** A view is ACTIVE only when all of these hold:
  - its security is in the current forward risky universe;
  - it is a readable Manual or Street View;
  - for a Street View, a qualified Street value exists;
  - its confidence is above 0%.
- **Every other configured view** keeps a typed status and contributes nothing to P,
  Q, Ω or the active-view count. It stays visible:
  - `OUT_OF_UNIVERSE`: kept in the user's state as *not applicable*.
  - `ZERO_CONFIDENCE`: a configured view with no model effect.
  - `STREET_DATA_UNAVAILABLE`: Street View selected, but no qualified Street value.
    The security keeps its CAPM prior. The manual value, the CAPM prior or an
    average target is never substituted, and nothing is manufactured.
  - `INVALID_VIEW`: an unreadable saved view, or any view on CASH. CASH can never
    carry a view or a P row.
- **Order of checks:** no view; unreadable view; Street data; zero confidence;
  active.
- **One active view per security.** The selected source alone feeds Q.
- **Return basis is kept on every view:**
  - Manual: `total_return`, labelled "12M Expected Total Return".
  - Street: `price_return`, labelled "12M Price-Target Return · Dividends Excluded",
    and only from a **median** target.
  - Both have a 12-month horizon.
- **P** is m × n, for m active views over the n risky securities. Columns are
  exactly the risk model's canonical ticker order. Each row is a selector: 1 at the
  viewed security, 0 elsewhere. There are no relative views in V2.
- **Q** holds the m view returns in decimals (12% = 0.12), in P's row order. Rows
  follow canonical ticker order, so identical views give identical P, Q and Ω
  however they were created.
- **Ω** is diagonal. For view k:
  - Ω_k = (P_k τ Σ P_kᵀ) × (1 − c_k) / c_k, which equals τ Σ_kk (1 − c_k)/c_k for a
    selector row;
  - Σ is the certified annualized Ledoit–Wolf matrix, matching Q's 12-month units;
  - confidence c is a fraction in [0, 1].

  At the boundaries:
  - c = 50% gives Ω = τ Σ_kk; 25% gives 3×; 75% gives ⅓×;
  - c = 100% gives Ω = 0 exactly, with no epsilon;
  - c = 0% drops the view, and no infinite Ω is created.
- **No new numerical tolerance.** A non-finite or non-positive base variance is a
  typed `invalid_view_variance` failure naming the security.
- **τ** is the internal constant 0.05, recorded with the inputs. Under this Ω it
  cancels from the posterior mean. It does not control how aggressive the posterior
  is, and it is not a user setting.
- **No active views** gives P = 0 × n, Q = [] and Ω = 0 × 0. No placeholder view is
  created, so the posterior can equal the CAPM prior exactly.
- The module has no Node-only or server-only imports. Every view and confidence
  change therefore re-runs the same function wherever it happens.

**Black–Litterman posterior** (12 months):

> **μ_BL = Π + τΣPᵀ (PτΣPᵀ + Ω)⁻¹ (Q − PΠ)**

**Inputs.** Π is the Task 4 CAPM prior, Σ the certified annual Ledoit–Wolf
covariance, and P, Q and Ω the certified view inputs. None is re-estimated.
- All three must come from the same risk model (checked by hash) and follow its
  canonical ticker order.
- τ must be the approved internal 0.05.

**The solve.**
- **Computation:** S = τΣPᵀ, A = PS + Ω, b = Q − PΠ. One linear system A x = b holds
  **every active view at once**: views are never applied in sequence or blended per
  asset. Then μ_BL = Π + S x.
- **Solver:** the system is solved with the existing `solveLinear` (Gaussian
  elimination with partial pivoting; its pivot test is unchanged).
- **Certification:** the solve passes only if its relative backward error
  **η = ‖Ax − b‖∞ / (‖A‖∞‖x‖∞ + ‖b‖∞) ≤ 1e-12**, where ‖v‖∞ = max|vᵢ| and
  ‖A‖∞ = the maximum absolute row sum.
  - A zero denominator passes only with a zero residual; there is never a division
    by zero.
  - The residual, matrix, solution and RHS norms, η, the tolerance and the verdict
    are recorded with the result.
- **Failures:** a non-finite A, b, x, residual, denominator or η is a typed
  `numerical_failure`. A singular system is `singular_view_system`, listing the
  active views involved.
- **Nothing is added:** no ridge, no diagonal epsilon, no pseudoinverse, no dropped
  view and no reduced confidence. Regularization would be a separate methodology
  decision.

**Properties.** Each is proved by a test.
- **No active views:** μ_BL is an exact copy of Π, bit for bit. No arithmetic runs.
- **One view on A at confidence c:**
  - μ_A − Π_A = c (Q_A − Π_A);
  - every other security moves by (Σ_BA / Σ_AA) × c (Q_A − Π_A). Negative covariance
    moves it the other way, and zero covariance leaves it exactly unchanged.
- **Several views:** the joint solution equals the closed-form simultaneous result,
  which differs from a per-asset (1 − c)Π + cQ blend.
- **100% confidence:** Ω = 0. Each viewed security ends exactly at its Q when the
  system is solvable; otherwise the typed failure applies.
- **τ invariance:** scaling τ in both τΣ and Ω leaves μ_BL unchanged.
- **Determinism:** the result does not depend on ticker, price or view order.

**Impossible results.**
- A 12-month expected return at or below −100% is an `invalid_posterior` error. It
  names the security, its CAPM prior and posterior, and every active view in the
  solve, and it is never clamped.
- This can come through correlation, not only through a direct view. For example, a
  −90% view held at 100% on a security whose covariance with another is twice its
  own variance pulls that other security to about −182%.
- There is no upper cap.

**Return basis and CASH.**
- Each view keeps its source and return basis through the posterior. A Street
  `price_return` view is never relabelled as total return, and no dividend
  adjustment is invented: the price-return versus total-return difference stays a
  visible limitation until Task 14.
- CASH stays at Rf, outside Σ and the solve.
- The Expected Return Gap is computed later (Task 7).

**Forward expected-return table** (one row per risky security, canonical order):
- **Forward Model Beta.**
- **CAPM Prior:** one field, from `capmRequiredReturn`. It is the same quantity the
  SML will call the CAPM Required Return, so it is never computed twice.
- **The Task 5 view classification:** status (`ACTIVE`, `NO_VIEW`, `ZERO_CONFIDENCE`,
  `STREET_DATA_UNAVAILABLE`, …), source, basis, view return, confidence and the
  reason a security stays at its prior. Out-of-universe and invalid views are
  listed separately.
- **BL Expected Return.**
- **Expected Return Gap** = BL Expected Return − CAPM Prior. It can be positive,
  zero or negative, and is never called alpha, mispricing, undervalued or
  overvalued. With no active view, every gap is exactly 0.
- **CASH** appears as a separate row when the portfolio lists it: β 0, CAPM Prior =
  BL Expected Return = Rf, gap 0, and no view possible.
- A Street price-return view keeps `price_return` (Dividends Excluded) and is never
  converted.

**Portfolio forward metrics** (one allocation; Stock Lab reuses the same function
for the Scenario Baseline and the Proposed Portfolio):
- **Weights:**
  - each weight must be finite and nonnegative;
  - no ticker may appear twice;
  - every ticker must be in the modeled universe (or be CASH);
  - weights must total 1 within the existing portfolio tolerance (1e-6). Anything
    outside is rejected, never rescaled.
  - Within the tolerance, the existing `parsePortfolio` rule applies: a total within
    floating-point noise (≤ 1e-13) is used as entered; otherwise the accepted
    residual is normalized once, explicitly, and recorded (`normalized`,
    `weightTotal`).
- **Expected return:** E[R_p] = Σ w_i μ_BL,i + w_cash Rf, in decimal 12-month
  units. Nothing is compounded.
- **Forward Model Beta:** β_p = Σ w_i β_i, with CASH 0, from the Task 3 betas. It is
  never re-estimated from a return series.
- **CAPM Required Return:** `capmRequiredReturn(Rf, β_p, MRP)`, the same function.
- **Expected Return Gap:** E[R_p] − Required_p, which equals Σ w_i × gap_i (CASH
  gap 0). A test proves this identity across views, MRPs and a normalized residual.
- **Model volatility:** σ_p = √(w_riskyᵀ Σ w_risky) on the Task 3 Σ. Risky weights
  are not rescaled: 50% risky and 50% CASH uses 0.5. CASH adds zero variance and
  covariance.
  - The existing `portfolioVariance` roundoff rule applies: |variance| ≤ 1e-12 ×
    (Σ|wᵢ|σᵢ)² is zero, and a materially negative variance is a typed
    `numerical_failure`.
- **Forward Model Sharpe** = (E[R_p] − Rf) / σ_p, only when σ_p > 0. Otherwise it is
  unavailable, with reason "No risky assets" (all risky weights zero) or "Zero
  portfolio volatility" (e.g. a perfect hedge). It is never 0, NaN or Infinity.
- **All-CASH** is a valid state: E = Rf, β 0, Required = Rf, gap 0, σ 0, Sharpe
  unavailable ("No risky assets").
- **100% in one security** reproduces that security's model values.
- **Expected Return Contribution** = w_i × μ_i, a linear one-period decomposition of
  E[R_p]. It is not realized or historical attribution.

**Result hash.** The Task 7 result carries `resultHash`, a SHA-256 of a canonical
economic payload. It sits above the risk-model hash and records it, rather than
replacing it.
- **What the payload contains**, in fixed key order and canonical ticker order:
  - the methodology version, risk-model hash, proxy and window;
  - the Rf value and observation date;
  - the MRP and τ;
  - the active views (ticker, source, basis, confidence, return);
  - the CAPM prior and BL vectors;
  - the portfolio's risky weights, CASH weight and forward metrics.
- **What it leaves out:** retrieval timestamps, cache ages, labels, UI state, the
  order things were created in, and views with no model effect.
- **Implementation:** `sha256Hex` (`lib/utils/sha256.ts`), a synchronous,
  browser-safe SHA-256 over the string's UTF-8 bytes (TextEncoder; no Node crypto,
  no Buffer). It matches Node's `crypto` exactly in tests: FIPS vectors, every byte
  length 0–300, multi-byte strings at the block boundaries, Unicode, emoji, lone
  surrogates, 1 MB strings, JSON payloads and 500 random strings.
- It identifies results for audit only. It is not used for security. The existing
  server `snapshotHash` is unchanged.

**Efficient frontier** (risky universe, 12 months; `buildEfficientFrontier`):
- **Problem:** minimize wᵀΣw subject to Σw = 1, μ_BLᵀw = r and w ≥ 0. It is
  long-only, over risky assets only (no CASH), with a 100% budget and no caps.
  - Σ is the Task 3 Ledoit–Wolf covariance and μ_BL the Task 6 posterior. Both must
    come from the same risk model (checked by hash) in canonical order.
  - Only the efficient branch is solved: r runs from r_GMV up to the highest
    expected return.
  - There is no Monte Carlo and no random-portfolio cloud.
- **GMV anchor (point 0):**
  - It is the existing `minimumVariance`, called exactly as the Constructor calls
    it: 100% budget, 0–100% bounds, constrained equal-weight start.
  - It is not re-solved. r_GMV = μ_BLᵀw_GMV is the bottom of the branch.
- **Single point (Q35):** if max μ − r_GMV ≤ 1e-12, the frontier is the GMV alone
  (`single_point`).
  - This covers one asset, equal expected returns and near-ties.
  - The test never uses exact floating-point equality.
- **Grid:** otherwise there are 41 targets, r_k = r_GMV + (k/40)(max μ − r_GMV). The
  last target is exactly max μ.
- **Interior points (1–39):** a deterministic primal active-set QP (Nocedal &
  Wright, Algorithm 16.3).
  - **Start:** the feasible allocation (1 − t)·w_GMV + t·e_k. Here e_k is 100% in
    the first security holding exactly max μ, and t places the start's return on
    the target. Every target is therefore feasible by construction.
  - **Return constraint (Q36):** because Σw = 1, μᵀw = r is the same constraint as
    (μ − r·1)ᵀw = 0. The solve uses that row divided by s = max|μᵢ − r|, which keeps
    the KKT system well conditioned even when expected returns are nearly equal.
    - Only the numerical representation changes. The feasible set, the target and
      the weights do not.
    - Certification below is always in original coordinates: |μᵀw − r| ≤ 1e-10.
    - A zero or non-finite s is a typed failure. It cannot occur once the status is
      `frontier`, because then s ≥ (max μ − r_GMV)/40 > 0.
  - **Each iteration:**
    - solve the exact KKT system on the current free set with the existing
      `solveLinear` (pivot test unchanged);
    - step as far as feasibility allows;
    - add the first bound reached. Only one bound joins per iteration (lowest index
      on ties), so the working set stays linearly independent.
  - **At a face optimum:** release the bound with the most negative multiplier
    (lowest index on ties), provided it is below −1e-8 × 2λmax(Σ). That is the same
    KKT tolerance certification uses.
  - **Rounding:** a weight that rounding pushes a few ulps below zero during a step
    is held at 0. The returned point is always an exact face solution, never a
    clipped one.
  - **Releases are kept (Q38).** A security at 0% in the GMV starts pinned, and it
    may need to enter at a higher target. So bounds both join and leave, and no
    n + 2 bound on iterations exists.
  - **Cycle guard:** at every iteration the pinned set is recorded as its canonical
    sorted index list. If a set recurs within the same target's solve, the solve
    stops at once with `non_converged` (`active_set_cycle`).
  - **Cap:** max(50, 2n²) iterations (882 at n = 21), then `non_converged`
    (`iteration_cap`). There are no retries and no changed tolerances.
  - **Record:** each point keeps its iterations, joins, releases, the cap that
    applied and whether a cycle was detected.
- **Top endpoint (point 40):** the minimum-variance portfolio of the near-tied top
  set T. It is 100% invested, holds no negative weights, and holds nothing outside
  T.
  - **The tie set (Q37):** T = {i : max μ − μᵢ ≤ 1e-12} (`topReturnTieTolerance`).
    This is a numerical tie tolerance, not an economic assumption, and each μᵢ is
    kept as it is.
  - **One rule for every case:**
    - one security in T gives 100% in it, as before;
    - several, exact ties and near-ties alike, give the existing `minimumVariance`
      on Σ_TT.
  - **Stability:** a one-rounding-step difference between two securities no
    longer flips the endpoint to 100% in one of them.
  - **Reporting:** the endpoint reports its actual μᵀw, never max μ in its place.
- **Top-endpoint certification (Q39):** the endpoint is certified as the problem that
  defines it, not as an exact target-return problem. The exact-return KKT would
  wrongly reject a near-tie mix whenever a lower-variance security sits just below
  the top. Every one of these must pass:
  - budget |Σw − 1| ≤ 1e-10 and bound max(0, −min w) ≤ 1e-10;
  - exactly zero weight outside T;
  - `minimumVariance`'s own certification rules on T (100% budget, 0–100% bounds):
    projected-gradient stationarity and KKT, each ≤ 1e-8, normalized by
    2·λmax(Σ_TT);
  - max μ − μᵀw ≤ 1e-12 plus a rounding allowance of
    (n + 2)·ε·(|max μ| + Σ|wᵢμᵢ|), the standard bound on evaluating that
    difference. Any return given up by diversifying across T is therefore within
    the tie definition.
- **Certification (Q34):** the GMV and every interior point are checked from their
  weights alone. No solver multipliers or working set are used.
  - **Constraint residuals:**
    - budget |Σw − 1| ≤ 1e-10;
    - bound max(0, −min w) ≤ 1e-10;
    - target return |μᵀw − r| ≤ 1e-10.
  - **KKT ≤ 1e-8:** the residual is divided by 2·λmax(Σ), computed exactly as
    `minimumVariance` computes it.
    - The residual is the smallest achievable violation, over the budget and return
      multipliers (λ, ν). For each pair (λ, ν) the violation is the larger of two
      quantities:
      - stationarity on free weights, |2(Σw)ᵢ − λ − νμᵢ|;
      - dual feasibility on weights at 0%: 2(Σw)ⱼ − λ − νμⱼ must be ≥ 0, and any
        shortfall counts.
    - A weight ≤ 1e-10 counts as at its bound.
    - For fixed ν the best λ is explicit. What remains is a convex piecewise-linear
      function of ν, minimized exactly over its breakpoints.
  - **The GMV always certifies.** ν = 0 is among the multipliers considered, so the
    GMV's residual never exceeds `minimumVariance`'s own.
  - **Failures:** tolerances are never relaxed. A failed point is
    `numerical_failure` and is not plotted: it has no weights, expected return or
    volatility.
    - Its residuals are still recorded, or null when no candidate was produced,
      together with the reason.
    - Every point also records its iteration count.
- **Volatility:** √(wᵀΣw), via the existing `portfolioVariance` with its roundoff
  rule unchanged. Each point lists its binding tickers: those at 0% and any at 100%.
- **Frontier hash:** `frontierHash` is a SHA-256 of a canonical payload:
  - the version, risk-model hash, tickers, μ_BL and status;
  - for each point: index, role, target, status and weights.
- **Verified by tests:**
  - Every interior point matches a brute-force optimum to 1e-12 (all 2ⁿ supports
    enumerated, each solved independently) on seven models of 3–8 assets and on
    the fixture forward chain.
  - Expected returns as close as 2e-12 still give all 41 certified points, matching
    the brute force and passing |μᵀw − r| ≤ 1e-10.
  - All 41 points certify at the maximum universe of 21 securities.
  - Two-asset closed forms hold.
  - Σ-order invariance holds.
  - A corner portfolio that lands exactly on a grid point certifies.
  - A duplicated security still certifies: the Ledoit–Wolf Σ stays positive
    definite.
  - Near-ties at the top give the exact tie's mix, and the endpoint certifies even
    with a lower-variance security just below the tie set. The exact-return KKT
    would reject that same allocation.
  - On seeded stress models releases do occur, no cycle is detected, and no solve
    comes near the cap.
  - A forced loop stops with `active_set_cycle`.

**GMV and the Constructor's Minimum Variance** (Task 9):
- **GMV is risk-only.** It minimizes wᵀΣw subject to the budget and bounds.
  Expected returns, the MRP, the Treasury rate, CAPM, Black–Litterman and Street
  views never enter it. They only set where it is plotted: its chart y-coordinate
  is w_GMVᵀμ_BL. Changing μ_BL moves that coordinate and never the weights.
- **It is the frontier's anchor.** Its volatility is the lowest of every certified
  frontier point.
- **The same problem on the same inputs.** Both sides call the existing
  `minimumVariance` with an equal-weight start. With the same risky universe, Σ,
  budget, bounds and CASH treatment they are one optimization problem. Tests prove:
  - **No CASH, 0–100% bounds:** identical weights, variance and volatility, bit for
    bit, whatever the ticker order, object key order or retrieval metadata.
  - **CASH c fixed outside the optimizer, no binding bound:** the Constructor's risky
    weights equal (1 − c) × GMV (within 1e-15 at c = 0%, 10%, 25% and 50%). They sum
    to 1 − c and are never renormalized.
- **Expected differences** (never inconsistencies):
  - **A binding floor or cap:** it changes the feasible set. The Constructor holds
    the security at that bound with a higher variance than GMV, and the same
    optimizer given the same bound reproduces it exactly.
  - **A different covariance:** Portfolio Theory's Σ is the forward risk model over
    the selected risk window, with the market proxy in the Ledoit–Wolf estimation
    universe. The Constructor's Σ is holdings-only over the Analysis Period.
    - Even over the same dates, adding the proxy changes the shrinkage target and
      intensity, so the weights differ.
    - A different period moves them further.
- **Display (Q40):** Portfolio Theory shows only its own GMV. The Constructor's
  allocation is never plotted as another frontier point. The page carries this
  note: "Portfolio Theory GMV uses the forward risk model and selected historical
  risk window. The Constructor uses its own analysis-period covariance and may
  therefore produce a different Minimum Variance allocation."

**Tangency Portfolio** (Task 10; the constrained risky Maximum Forward Model Sharpe
portfolio, `buildTangencyPortfolio`):
- **Problem:** maximize (aᵀw)/√(wᵀΣw), with a = μ_BL − Rf·1, subject to Σw = 1 and
  w ≥ 0.
  - μ_BL is the Task 6 posterior, Rf the CAPM prior's forward 1Y Treasury rate and
    Σ the Task 3 Ledoit–Wolf covariance. All three must come from one risk model
    (hash, proxy, window, and the same Rf as the posterior's CASH).
  - CASH is not in the problem; it is combined with the tangency later, on the
    Model CAL.
  - The tangency is its own exact portfolio. It is never inserted into or
    interpolated onto the 41-point frontier grid. Its chart coordinates are
    (volatility, 12M BL expected return).
- **Existence:** max aᵢ > 1e-12 (`positiveExcessReturnTolerance`), whatever the sign
  of the MRP.
  - A negative MRP with a view that lifts one security more than 1e-12 above Rf
    has a tangency.
  - Otherwise the result is `no_positive_excess_return`. No portfolio is
    manufactured, and the least-negative-Sharpe portfolio is never reported in
    its place.
- **No filtering:** once a tangency exists, the whole risky universe stays in the
  problem. A security at or below Rf, or with a negative expected return, can still
  be held for diversification. Long-only is the only asset restriction.
- **Reformulation:** with s = max aᵢ, solve min yᵀΣy subject to (a/s)ᵀy = 1 and
  y ≥ 0.
  - Scaling by s keeps the constraint well conditioned when excess returns are
    tiny, and does not change the solution.
  - Then w = y / Σᵢ yᵢ: each yᵢ divided by the sum of all y components, which must
    be positive and finite.
  - s is recorded as `excessReturnScale`, solver provenance rather than an
    assumption.
  - Identities: aᵀy = s, the portfolio excess return is s / 1ᵀy, and the Sharpe
    ratio is s / √(yᵀΣy).
- **Solver:** the Task 8 active-set QP with one equality row. No budget row is
  added.
  - **Start:** 100% in the security with the largest excess return (its scaled
    coefficient is exactly 1; lowest index on an exact tie). The start is a
    numerical detail: other feasible starts give the same tangency.
  - **Releases are kept:** securities enter by release, and one can leave (join)
    and re-enter.
  - **Safety:** deterministic lowest-index ties, the active-set cycle guard and the
    max(50, 2n²) cap. Iterations, joins, releases, the cap and the cycle flag are
    recorded.
  - **Single security:** 100% in it, with no QP.
  - **No risky assets:** "No risky assets", with no solver.
- **Certification of the scaled y-problem** (independent of the solver's
  multipliers):
  - |(a/s)ᵀy − 1| ≤ 1e-10 and max(0, −min y) ≤ 1e-10.
  - KKT ≤ 1e-8, normalized by 2·λmax(Σ)·1ᵀy (`minimumVariance`'s L·B, with
    B = 1ᵀy).
    - The residual is the exact minimum, over the one multiplier, of the largest
      stationarity or dual-feasibility violation.
    - Because each (a/s)ᵢ ≤ 1, 1ᵀy ≥ 1. The solver releases only below
      −1e-8·2λmax, so it is never looser than this check.
- **Certification of the final portfolio:**
  - |Σw − 1| ≤ 1e-10 and w ≥ 0;
  - |aᵀy/s − 1| ≤ 1e-10;
  - μ_BLᵀw − Rf > 0 and σ > 0;
  - **Sharpe identity:** Sharpe(w) = (μ_BLᵀw − Rf)/√(wᵀΣw) must equal
    s/√(yᵀΣy).
    - Exactly, the difference is Sharpe_y·((a/s)ᵀy − 1) + Rf·(Σw − 1)/σ. Its bound
      therefore uses the existing 1e-10 equality and budget tolerances, plus the
      floating-point allowance (n + 2)·ε·(2|Sharpe_y| + (Σ|wᵢμᵢ| + |Rf|)/σ), in
      the form approved for Q39.
  - Every output (expected return, excess, variance, volatility, Forward Model
    Sharpe) is recomputed from the final w.
- **Verified by tests:**
  - closed forms (two and three securities, w ∝ Σ⁻¹a when all are held);
  - a brute-force maximum Sharpe over every support (weights to 1e-12);
  - the exact target-return frontier solve at the tangency's return reproduces it
    (or the top endpoint in the near-tie region);
  - Sharpe ≥ every certified frontier point and every single security;
  - the MRP and view cases, the 1e-12 threshold, ticker-order invariance, the hash,
    a forced cycle and invalid inputs.
- **Tangency hash:** `tangencyHash` is a SHA-256 of a canonical payload:
  - the version, risk-model hash, proxy and window;
  - Rf with its observation date;
  - the canonical tickers, μ_BL and the weights.

  `expectedReturnsHash` identifies the μ_BL lineage. Inputs are put in canonical
  (sorted ticker) order first, so equivalent orderings give the same result and
  hash. Timestamps, labels and display state are excluded.

**Local assumption state.** One state holds the risk window, market proxy, MRP and
per-ticker views. Portfolio Theory and Stock Lab share it.
- It is stored only in this browser, under the versioned key
  `portfolio-lab:forward-assumptions:v1`.
- Corrupt, unsupported or denied storage restores the defaults with a notice; a
  state is never partly restored.
- Every change is revalidated as a whole state, and an invalid state is never stored.
- τ (fixed at 0.05) is internal and is not part of the user's assumptions.

**Terminology.** Forward and historical statistics carry distinct labels wherever
both can appear, and a forward label is never shortened to a bare "Beta" or
"Sharpe":

| Forward label | Historical counterpart | Never written as |
| --- | --- | --- |
| Forward Model Beta / Model Beta vs Market Proxy | Historical Beta vs Benchmark | "Beta" |
| Forward Model Sharpe | Historical Sharpe | "Sharpe" |
| Model Capital Allocation Line (Model CAL) | — | "CML" |
| Market CML Proxy | — | "CML" |
| Expected Return Gap (Positive / Negative) | historical CAPM alpha | alpha, undervalued, overvalued |

## Reproducibility and limitations

Results contain normalized source observations, UTC sessions, original configuration, finalized-data cutoff, fetch/source provenance, versioned methodology/calendar, interval-set hash and SHA-256 snapshot identity. Replaying `simulate({...result.snapshot, config: result.config, now: result.metadata.generatedAt})` reproduces the ledger. No durable server snapshot retention is claimed; future provider revisions can change newly fetched results. Hashes alone cannot recover old data. Production redistribution and retention permissions remain a release gate.

API results stream losslessly in pull-based chunks (DATA-PROVIDERS.md, Large snapshot transport); no calculation input is downsampled and no size cap truncates a result. The largest 20-holding, ~46-year analysis is about 48 MB uncompressed, including about 2.4 MB of rolling series. Stress (~0.35 MB for the sample) and construction (~1.2 MB for the sample) responses are separate. The browser buffers each whole response; server-side display summarization remains a later option. Stress and construction replay the same way: `runStress({...snapshot, config, now})` and `runConstruction({config, constraints, cash, ...snapshot, now})`.

Sources: [H.15 publication schedule](https://www.federalreserve.gov/releases/h15/), [DGS3MO definition](https://fred.stlouisfed.org/series/DGS3MO), [FRED real-time/vintage periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [NYSE sessions](https://www.nyse.com/trade/hours-calendars), [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars).
