# Phase 1 methodology — phase1-v1

Scope: normalized data, validation, coverage, arithmetic daily returns, synthetic wealth, drift, monthly resets, CASH/risk-free alignment, basic continuous benchmark wealth and reproducibility. No CAGR, volatility, Sharpe, Sortino, drawdowns, risk decomposition, stress, or optimization has been implemented.

## Inputs and units

USD U.S.-listed equities/ETFs and CASH, long only, 1–20 unique normalized symbols. Display weights are percentages; all domain weights, returns, and annual yields are decimals. Total weights must be within 1e-6 of one; accepted residuals are explicitly normalized. Zero-weight rows stay editable but do not affect coverage. Requested dates are ISO date-only strings, not UTC timestamps. Dates must be real, ordered, nonfuture and within a 50-year span. The versioned session artifact supports 1976–2028; ranges outside it fail explicitly.

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

**Covariance and annualization.** `Σ_daily` is the sample (n − 1) covariance matrix, computed once per upper-triangle cell and mirrored, so it is exactly symmetric. `Σ_annual = 252 × Σ_daily`. Diagonals equal each holding's sample variance. Eigenvalues (cyclic Jacobi) confirm positive semidefiniteness. Roundoff-sized negative eigenvalues (≥ −1e-10 × the largest) are tolerated; larger ones make the covariance family unavailable with the reason and are never repaired. A rank-deficient matrix (duplicate, perfectly correlated or constant holdings) is disclosed as singular; target-weight risk remains defined. Historical sample covariance describes the window; it is not a forecast.

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

## Reproducibility and limitations

Results contain normalized source observations, UTC sessions, original configuration, finalized-data cutoff, fetch/source provenance, versioned methodology/calendar, interval-set hash and SHA-256 snapshot identity. Replaying `simulate({...result.snapshot, config: result.config, now: result.metadata.generatedAt})` reproduces the ledger. No durable server snapshot retention is claimed; future provider revisions can change newly fetched results. Hashes alone cannot recover old data. Production redistribution and retention permissions remain a release gate.

The API rejects detailed responses larger than 4 MB and asks for a shorter period/fewer holdings, rather than silently downsampling calculation inputs. A later transport/retention design is required for the largest 20-holding/50-year payloads.

Sources: [H.15 publication schedule](https://www.federalreserve.gov/releases/h15/), [DGS3MO definition](https://fred.stlouisfed.org/series/DGS3MO), [FRED real-time/vintage periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [NYSE sessions](https://www.nyse.com/trade/hours-calendars), [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars).
