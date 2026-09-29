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

## Reproducibility and limitations

Results contain normalized source observations, UTC sessions, original configuration, finalized-data cutoff, fetch/source provenance, versioned methodology/calendar, interval-set hash and SHA-256 snapshot identity. Replaying `simulate({...result.snapshot, config: result.config, now: result.metadata.generatedAt})` reproduces the ledger. No durable server snapshot retention is claimed; future provider revisions can change newly fetched results. Hashes alone cannot recover old data. Production redistribution and retention permissions remain a release gate.

The API rejects detailed responses larger than 4 MB and asks for a shorter period/fewer holdings, rather than silently downsampling calculation inputs. A later transport/retention design is required for the largest 20-holding/50-year payloads.

Sources: [H.15 publication schedule](https://www.federalreserve.gov/releases/h15/), [DGS3MO definition](https://fred.stlouisfed.org/series/DGS3MO), [FRED real-time/vintage periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [NYSE sessions](https://www.nyse.com/trade/hours-calendars), [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars).
