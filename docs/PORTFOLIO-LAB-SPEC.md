# Portfolio Intelligence & Construction Lab — Revised Build Instructions

## 0. ROLE AND PRODUCT STANDARD

Act as a senior asset manager, portfolio-construction specialist, quantitative portfolio analyst, and product engineer.

Build a production-quality portfolio analytics and construction application for a finance portfolio.

The product should demonstrate that the builder understands:

- portfolio construction
- portfolio backtesting
- performance measurement
- benchmark-relative analysis
- portfolio risk decomposition
- covariance and correlation
- diversification
- drawdowns
- historical stress testing
- portfolio optimization
- data quality
- financial methodology
- reproducible analytics
- institutional-quality UI/UX
- software architecture
- testing

The product should feel like a small but legitimate institutional portfolio-analytics platform, not a student dashboard.

The strongest message should be:

> I built the financial analytics engine, data pipeline, portfolio-construction logic, and product experience underneath the interface.


---

# 0A. LIVE / CURRENT DATA PRINCIPLE

Use the freshest reliable data available whenever doing so improves accuracy **without compromising methodological consistency**.

The application should distinguish clearly between:

- live or near-live market data
- delayed market data
- latest official closing data
- historical adjusted data
- latest official Treasury data

Never describe delayed or end-of-day data as real-time.

Every current-data element should expose, where available:

- provider
- observation timestamp
- market date
- whether the value is live, delayed, end-of-day, or latest official
- cache age
- last successful refresh

The guiding rule is:

> Use live/current data for current-state context. Use properly aligned historical data for historical analytics.

Do not force intraday data into calculations that are defined using daily adjusted closes.

Examples:

- Current portfolio market value may use live or delayed quotes if available.
- Current holding prices may use live or delayed quotes if available.
- Current benchmark level may use live or delayed quotes if available.
- Current Treasury references should use the latest available official Treasury observations.
- Historical backtests must use historical adjusted price data.
- Historical covariance, beta, Sharpe, Sortino, drawdowns, stress tests, and attribution must remain based on internally consistent historical return series.
- Do not mix an intraday unadjusted quote with an adjusted-close return series and pretend the result is a clean historical return.

If a market is currently open and the provider offers reliable intraday data, the UI may show a clearly separated:

**Current Market Snapshot**

This may include:

- latest price
- current-day change
- benchmark change
- portfolio estimated current value
- current Treasury reference
- timestamp / freshness status

Keep this current snapshot separate from historical performance statistics unless a dedicated intraday methodology is implemented.


---

# 1. CORE PRODUCT PHILOSOPHY

The application should answer:

- How has this portfolio performed?
- How much risk has it taken?
- What drives that risk?
- Which holdings dominate portfolio risk?
- How diversified is the portfolio?
- How correlated are the holdings?
- How has the portfolio behaved relative to a benchmark?
- How severe have historical drawdowns been?
- How would this portfolio have behaved during major historical stress periods?
- How would changing the allocation alter portfolio risk?
- What mathematically valid alternative allocations exist under explicit constraints?

Do not generate personalized investment recommendations.

Do not rank portfolios as "good" or "bad."

Present analytics, assumptions, trade-offs, and mathematically generated alternatives.

---

# 2. PRODUCT NAMING

Preferred V1 name:

**Portfolio Risk & Analytics Lab**

Preferred V2 name after portfolio construction is added:

**Portfolio Intelligence & Construction Lab**

Do not use "Performance Attribution" unless the product actually contains a defined return-attribution methodology.

Risk contribution may be called:

- Risk Contribution
- Risk Attribution
- Volatility Contribution

If a return-contribution feature is added, label it separately as:

- Return Contribution

Do not imply Brinson attribution unless a proper allocation/selection attribution model exists.

---

# 3. AI STRATEGY

## V1 — NO AI REQUIRED

The V1 product should create value through:

- real market data
- financial calculations
- portfolio analytics
- portfolio construction mathematics
- stress testing
- data engineering
- exceptional UX

Do not add an LLM merely to make the application appear AI-powered.

Do not add:

- generic AI insights
- chat for its own sake
- generated market outlooks
- stock recommendations
- AI-generated calculations

## V2 — AI ASSET-MANAGER LAYER

AI may be added only after the analytics engine is reliable.

The AI layer must consume structured outputs from the analytics engine.

The model must never calculate or invent portfolio statistics itself when the engine already provides them.

The AI layer may:

- explain portfolio risk drivers
- summarize benchmark-relative behavior
- explain concentration
- explain drawdowns
- summarize stress-test results
- explain changes between two allocations
- answer methodology questions
- help users explore analytical trade-offs

The AI layer must cite or reference the engine outputs it uses.

The AI layer must not:

- fabricate metrics
- change portfolio calculations
- silently override assumptions
- recommend specific securities as personalized investment advice
- claim certainty about future returns

---

# 4. DESIGN DIRECTION

Before writing UI code:

1. Inspect the existing portfolio website.
2. Inspect existing projects.
3. Extract the current design system.
4. Reuse that visual language.

Reuse:

- typography
- dark-theme palette
- surface colors
- accent colors
- border treatments
- spacing
- navigation
- buttons
- cards
- icon style
- chart styling
- visual rhythm

Do not create a disconnected design system.

The project should look like:

**institutional asset-management software + modern financial terminal + premium product design**

Aim for:

- Bloomberg-like information density
- modern visual hierarchy
- clean professional charts
- restrained motion
- high information value per screen

Avoid:

- generic AI SaaS design
- giant gradient backgrounds
- excessive glassmorphism
- neon glow
- huge rounded cards
- decorative finance graphics
- unnecessary pie charts
- giant empty hero areas
- chatbot-first interfaces
- decorative clutter

Use:

- subtle 1px borders
- restrained radius
- compact spacing
- tabular numerals
- clean grid alignment
- sophisticated tooltips
- thoughtful hover states
- responsive layout
- keyboard accessibility
- reduced-motion support

The interface should communicate:

> Serious financial software.

---

# 5. TECH STACK

Prefer the existing portfolio stack when possible.

Recommended:

- Next.js
- TypeScript
- Tailwind CSS
- Recharts or another lightweight charting library
- Zod
- Vitest

Optional if useful:

- mathjs or a small matrix utility
- a dedicated heatmap implementation
- Web Worker only if analytics later become computationally heavy

Do not place finance formulas directly in React components.

The analytics engine must be reusable outside the UI.

Avoid `any`.

---

# 6. APPLICATION ARCHITECTURE

Suggested structure:

```text
/app
/components
  /layout
  /portfolio
  /controls
  /metrics
  /charts
  /risk
  /benchmark
  /drawdown
  /stress
  /construction
  /methodology
/lib
  /analytics
    returns.ts
    performance.ts
    risk.ts
    covariance.ts
    benchmark.ts
    drawdown.ts
    riskContribution.ts
    diversification.ts
    stress.ts
    rebalance.ts
    rolling.ts
    optimization.ts
  /market-data
  /treasury-data
  /backtest
  /validation
  /types
  /utils
/tests
/config
```

The calculation engine should be:

- typed
- modular
- pure where practical
- deterministic
- independently testable
- documented
- separated from display logic

---

# 7. CORE TYPES

Create reusable TypeScript types.

Example:

```ts
type PortfolioHolding = {
  ticker: string
  weight: number
}

type PortfolioConfig = {
  holdings: PortfolioHolding[]
  benchmark: string
  requestedStartDate: string
  endDate: string
  rebalanceFrequency: "monthly"
}

type PriceObservation = {
  date: string
  adjustedClose: number
}

type ReturnObservation = {
  date: string
  return: number
}

type TreasuryObservation = {
  date: string
  annualYield: number
}

type DataCoverage = {
  ticker: string
  firstAvailableDate: string
  lastAvailableDate: string
  observationCount: number
  status: "complete" | "partial" | "insufficient" | "unavailable"
}
```

Also define:

- PortfolioMetrics
- RiskMetrics
- BenchmarkMetrics
- RiskContribution
- DrawdownEpisode
- StressTestResult
- BacktestResult
- ConstructionResult
- OptimizationConstraint
- MethodologyMetadata
- DataQualityState

---

# 8. MARKET DATA ADAPTER

V1 should not require a paid market-data subscription.

Create a provider-independent market-data adapter.

Example:

```ts
getHistoricalPrices(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<PriceObservation[]>
```

Requirements:

- fetch server-side
- use adjusted historical prices / total-return-aware adjusted prices
- retrieve live or near-live quotes where a reliable free source supports them
- fall back to delayed or latest official closing data when live data is unavailable
- never label delayed data as real-time
- normalize output
- cache aggressively while respecting data freshness
- use shorter cache lifetimes for current quotes than for historical series
- deduplicate identical requests
- validate chronological ordering
- remove duplicate dates
- never fabricate missing prices
- expose first and last available historical date
- expose latest quote timestamp where available
- expose fetch timestamp
- expose provider name
- expose freshness / delay status
- handle invalid symbols cleanly
- allow provider replacement later

A free Yahoo Finance implementation is acceptable for a portfolio project if the provider is isolated behind an adapter and its unofficial nature is documented.

Do not tightly couple analytics to a specific market-data provider.

Where supported, create a separate current-quote adapter:

```ts
getCurrentQuote(
  ticker: string
): Promise<CurrentQuote>
```

Suggested normalized type:

```ts
type CurrentQuote = {
  ticker: string
  price: number
  previousClose?: number
  change?: number
  changePercent?: number
  marketTimestamp: string
  fetchedAt: string
  status: "live" | "delayed" | "end_of_day" | "latest_available"
  provider: string
}
```

Do not make historical analytics depend on the availability of current quotes.

Historical and current-data adapters should be separable so the application can use the best provider for each job.


---


# 8A. DATA-SOURCE PRIORITY AND FALLBACKS

Prefer data sources in this order when practical:

1. official government / exchange / issuer source
2. stable documented public API
3. reputable market-data provider with a free tier
4. unofficial public endpoint only when isolated behind an adapter and clearly documented

Different data types may use different providers.

For example:

- historical adjusted equity / ETF prices may come from a market-data provider
- current quotes may come from a separate quote provider
- Treasury data should preferably come from an official U.S. government or Federal Reserve source

Build provider fallback capability where reasonable.

A fallback must never silently change the meaning of the data.

If the primary source fails:

- try an approved fallback provider
- normalize to the same schema
- preserve the provider identity
- expose that a fallback was used
- do not silently substitute a different security or series

Prefer accuracy and transparency over pretending the application is always live.

---

# 9. TOTAL RETURN POLICY

Use adjusted prices that account for splits and distributions where the selected provider supports them.

The methodology panel must explicitly state whether the chosen data series represents:

- price return
or
- total return

Preferred:

**total-return-aware adjusted prices**

Do not compare a total-return portfolio series with an unadjusted benchmark series.

All portfolio and benchmark return series must use the same return convention.

---

# 10. DATA COVERAGE AND EFFECTIVE START DATE

This must be explicit.

For a portfolio backtest, define:

```text
effectivePortfolioStartDate =
latest first-valid date among all required portfolio holdings
```

If the user requests a start date earlier than the effective start date:

- do not silently fabricate history
- do not silently substitute another asset
- do not silently treat the missing asset as cash

Instead display:

- Requested Start Date
- Effective Start Date
- Holding that constrained the start date

Example:

> Requested 2016-01-01. Analysis begins 2019-06-13 because XYZ has no earlier valid history.

Portfolio absolute analytics may use the portfolio's effective date.

Benchmark-relative analytics should use the overlapping valid period between portfolio and benchmark.

Clearly disclose if benchmark-relative metrics use a shorter sample.

---

# 11. TRADING-CALENDAR ALIGNMENT

Use actual observed market dates.

Do not calculate a return across a missing asset observation as if nothing happened.

Do not blindly forward-fill asset prices.

For standard U.S.-listed assets that should share a trading calendar:

- build a common valid-date set
- flag unexpected missing observations
- avoid silently converting missing prices into zero returns

For benchmark analytics:

- align benchmark returns to the portfolio return dates
- compute benchmark-relative metrics only on common valid observations

For covariance and correlation:

- use a single common set of dates across included risky holdings
- expose observation count

---

# 12. PORTFOLIO BUILDER

Create a premium portfolio builder.

Fields:

- Ticker
- Weight %

Features:

- add holding
- remove holding
- edit ticker
- edit weight
- uppercase normalization
- allocation total
- approximate 100% validation
- no negative weights in standard V1
- duplicate-ticker detection
- optional intelligent combination of duplicate tickers
- CASH special asset
- maximum approximately 20 holdings
- clear data errors
- local save
- restore on refresh
- no login
- no account requirement

Use localStorage.

---

# 13. SAMPLE PORTFOLIO

A user should be able to see the product immediately.

Include:

**Load Sample Portfolio**

Example:

```text
SPY   40%
QQQ   15%
IWM   10%
BND   20%
GLD   10%
CASH   5%
```

The sample should produce visually meaningful:

- risk contribution
- correlation
- benchmark comparison
- drawdowns
- stress results

---

# 14. ANALYSIS CONTROLS

Benchmark:

- SPY
- VT
- QQQ
- AGG
- Custom

Default:

- SPY

Analysis Period:

- 1Y
- 3Y
- 5Y
- 10Y
- MAX
- Custom

Default:

- 5Y

Rebalancing:

- Monthly in V1

Do not overload V1 with many rebalance settings.

Display:

- requested period
- effective start date
- benchmark
- historical risk-free proxy
- current Treasury reference
- rebalancing
- data as-of date

---

# 15. BACKTEST RETURN CONVENTION

Use arithmetic daily returns:

```text
r_t = adjustedPrice_t / adjustedPrice_(t-1) - 1
```

Use arithmetic daily returns for:

- covariance
- correlation
- beta
- regression
- risk contribution
- tracking error
- rolling risk

Use geometric compounding for:

- cumulative wealth
- cumulative return
- CAGR
- drawdown

---

# 16. MONTHLY REBALANCING

Build a real portfolio backtest.

Initial allocation:

- allocate to target weights on the first valid analysis date

Monthly rebalance convention:

- allow weights to drift with returns during the month
- after the last trading session of the month, reset weights to target weights before the next trading-session return is earned

This avoids look-ahead bias.

Document the exact convention.

No transaction costs, taxes, bid/ask spread, or slippage in V1 unless explicitly implemented.

Display:

> Results are gross of transaction costs, taxes, and trading frictions.

Optional later:

- turnover
- estimated transaction costs

---

# 17. CASH TREATMENT

CASH is not a normal security.

Preferred V1 treatment:

- earn a historical short-term Treasury proxy

Do not model cash with zero return unless Treasury data is unavailable.

If zero-return cash is used as a fallback:

- disclose it prominently
- do not silently switch methodologies

Cash accrual should use the calendar-day gap between portfolio observations.

Preferred conversion:

```text
cashReturn_t =
(1 + annualYield_(t-1))^(calendarDays / 365) - 1
```

Use the most recent Treasury observation that was available before the return interval.

Do not use future Treasury observations.

---

# 18. HISTORICAL RISK-FREE RATE

Use a historical 3-month U.S. Treasury proxy.

Acceptable source examples:

- FRED DGS3MO
- another clearly documented U.S. Treasury / Federal Reserve source

The historical risk-free series is used for:

- Sharpe
- Sortino
- CAPM alpha
- cash proxy if applicable

The historical rate must vary through time.

Align rates without look-ahead.

Do not use today's Treasury yield for historical performance metrics.

---

# 19. CURRENT TREASURY REFERENCE

Separately retrieve current Treasury yields.

Suggested maturities:

- 3M
- 1Y
- 3Y
- 5Y
- 10Y

Map selected horizon approximately:

```text
1Y  -> 1Y
3Y  -> 3Y
5Y  -> 5Y
10Y -> 10Y
MAX -> 10Y
```

For custom ranges:

- select the nearest supported maturity

This is informational context only.

Never feed current horizon yields into historical:

- Sharpe
- Sortino
- alpha
- drawdown
- backtest
- stress results

Display the current Treasury data date.

---

# 20. CORE PERFORMANCE METRICS

Calculate:

- Ending Value
- Cumulative Return
- CAGR
- Annualized Volatility
- Sharpe Ratio
- Sortino Ratio
- Maximum Drawdown

Optional:

- Calmar Ratio

Starting indexed wealth:

```text
$10,000
```

---

# 21. CUMULATIVE RETURN

```text
Cumulative Return =
endingValue / startingValue - 1
```

---

# 22. CAGR

```text
CAGR =
(endingValue / startingValue)^(1 / elapsedYears) - 1
```

Use actual elapsed calendar time.

Do not assume an exact integer number of years.

---

# 23. ANNUALIZED VOLATILITY

```text
dailyVol =
sampleStandardDeviation(dailyReturns)

annualizedVol =
dailyVol * sqrt(252)
```

Use 252 trading days for risk annualization.

---

# 24. DAILY RISK-FREE RETURN

For return intervals between trading dates:

```text
dailyRf_t =
(1 + annualRf_(t-1))^(calendarDays / 365) - 1
```

This naturally handles weekend accrual.

If a simpler 252-day convention is chosen instead, it must be documented and used consistently.

Preferred implementation:

**actual calendar-day accrual with prior-known Treasury yield**

---

# 25. SHARPE RATIO

Create aligned daily excess returns:

```text
excess_t =
portfolioReturn_t - riskFreeReturn_t
```

Then:

```text
Sharpe =
mean(excess_t)
/
sampleStdDev(excess_t)
*
sqrt(252)
```

Do not use the current Treasury reference.

Expose the observation count.

---

# 26. SORTINO RATIO

Use daily excess returns.

Define downside observations as:

```text
downside_t = min(excess_t, 0)
```

Calculate downside deviation across the full aligned sample:

```text
dailyDownsideDeviation =
sqrt(mean(downside_t^2))
```

Then:

```text
annualizedExcessReturn =
mean(excess_t) * 252

annualizedDownsideDeviation =
dailyDownsideDeviation * sqrt(252)

Sortino =
annualizedExcessReturn /
annualizedDownsideDeviation
```

Do not calculate the denominator using only the negative rows unless that alternative methodology is explicitly chosen and documented.

---

# 27. DRAWDOWN

For wealth series:

```text
runningPeak_t =
max(wealth_0 ... wealth_t)

drawdown_t =
wealth_t / runningPeak_t - 1
```

Maximum Drawdown:

```text
minimum(drawdown_t)
```

Identify:

- Peak Date
- Trough Date
- Recovery Date
- Calendar Days to Recovery
- Trading Days to Recovery
- Current Drawdown

If unrecovered:

```text
Recovery Date = Not Recovered
```

---

# 28. BENCHMARK ANALYTICS

Calculate:

- Beta
- CAPM Alpha
- Correlation
- Tracking Error
- Information Ratio
- Annualized Active Return
- Portfolio CAGR
- Benchmark CAGR

Do not label `Portfolio CAGR - Benchmark CAGR` as the Information Ratio numerator.

The Information Ratio must use arithmetic active returns consistent with tracking error.

---

# 29. BETA

Using aligned daily portfolio and benchmark returns:

```text
Beta =
Cov(Rp, Rb) /
Var(Rb)
```

Use sample covariance and sample variance consistently.

---

# 30. CAPM ALPHA

Use excess returns:

```text
PortfolioExcess_t =
Rp_t - Rf_t

BenchmarkExcess_t =
Rb_t - Rf_t
```

Estimate OLS:

```text
PortfolioExcess =
alphaDaily + beta * BenchmarkExcess + error
```

Report:

```text
annualizedAlpha =
alphaDaily * 252
```

Use linear annualization for regression alpha.

Do not compound the regression intercept.

Optionally expose:

- R²
- standard error
- t-statistic

Do not make inference statistics a V1 requirement.

---

# 31. TRACKING ERROR

```text
active_t =
portfolioReturn_t - benchmarkReturn_t

TrackingError =
sampleStdDev(active_t) * sqrt(252)
```

---

# 32. INFORMATION RATIO

Use:

```text
InformationRatio =
mean(active_t)
/
sampleStdDev(active_t)
*
sqrt(252)
```

Equivalent display fields:

```text
Annualized Active Return =
mean(active_t) * 252

Annualized Tracking Error =
sampleStdDev(active_t) * sqrt(252)
```

Keep the arithmetic-return convention internally consistent.

---

# 33. CORRELATION

Use Pearson correlation on aligned daily arithmetic returns.

Expose the common observation count.

---

# 34. RISK CONTRIBUTION — HERO FEATURE

Build a sample covariance matrix from aligned daily asset returns.

Let:

```text
w = target portfolio weight vector
Σ_daily = sample covariance matrix
Σ_annual = 252 * Σ_daily
```

Portfolio annualized variance:

```text
variance_p =
w' Σ_annual w
```

Portfolio annualized volatility:

```text
sigma_p =
sqrt(w' Σ_annual w)
```

Marginal Contribution to Risk:

```text
MRC_i =
(Σ_annual w)_i / sigma_p
```

Component Contribution to Risk:

```text
CRC_i =
w_i * MRC_i
```

Percentage Contribution to Risk:

```text
PCR_i =
CRC_i / sigma_p
```

Checks:

```text
sum(CRC_i) ≈ sigma_p
sum(PCR_i) ≈ 1
```

Support negative contributions.

Never clamp negative risk contributions to zero.

---

# 35. RISK-CONTRIBUTION LABELING

The default risk-contribution view should use **target portfolio weights**.

Label it clearly:

> Risk Contribution at Target Weights

This avoids implying that the output represents an average of every drifted weight through the historical backtest.

Optional future feature:

- realized average risk contribution using time-varying portfolio weights

Do not mix these concepts.

---

# 36. COVARIANCE METHODOLOGY

V1:

- sample covariance
- common aligned daily observations
- minimum observation threshold

Suggested thresholds:

- fewer than 60 common observations: insufficient
- 60–251 observations: usable with warning
- 252+ observations: normal

Display:

- observation count
- analysis window
- covariance methodology

Do not imply that historical covariance is a stable forecast of future covariance.

Optional future methodology:

- exponentially weighted covariance
- Ledoit-Wolf shrinkage

---

# 37. CAPITAL VS RISK

This should be the visual centerpiece.

Show:

**Capital Allocation**

versus

**Risk Contribution**

The user should immediately see:

> portfolio weight != portfolio risk exposure

Per holding display:

- Ticker
- Weight
- Annualized Volatility
- Beta
- Risk Contribution
- Return Contribution if later implemented

Allow sorting by:

- Weight
- Risk Contribution
- Volatility
- Beta

---

# 38. RETURN CONTRIBUTION

If the product uses the word "attribution," add a separate return-contribution section.

At a minimum calculate daily holding contribution:

```text
contribution_(i,t) =
weight_(i,t-1) * return_(i,t)
```

And:

```text
portfolioReturn_t =
sum_i contribution_(i,t)
```

For multi-period contribution, do not naively sum daily contributions and label them as geometric total-return attribution.

If multi-period linked attribution is not implemented, label the section:

> Daily / Period Arithmetic Return Contribution

Document the methodology clearly.

Do not call this Brinson attribution.

---

# 39. CORRELATION MATRIX

Create a professional heatmap.

Requirements:

- symmetric matrix
- labels
- values from -1 to +1
- clean tooltip
- readable through approximately 15 holdings
- neutral professional palette
- visually distinct positive, near-zero, and negative correlation
- no rainbow colors

Use the same aligned sample as the covariance matrix.

---

# 40. DIVERSIFICATION METRICS

Calculate:

### Weighted Average Standalone Volatility

```text
WA Vol =
sum(weight_i * annualizedVolatility_i)
```

### Diversification Ratio

```text
Diversification Ratio =
weightedAverageStandaloneVolatility /
portfolioVolatility
```

### Effective Number of Holdings

```text
Effective Holdings =
1 / sum(weight_i^2)
```

Also calculate:

- Largest Position
- Top 3 Concentration
- HHI
- Highest Correlation Pair
- Lowest Correlation Pair

Remember:

Effective number of holdings measures weight concentration, not correlation diversification.

Do not present it as a complete diversification score.

---

# 41. DRAWDOWN LAB

Create a dedicated drawdown section.

Plot:

- Portfolio Drawdown
- Benchmark Drawdown toggle

Show:

- Maximum Drawdown
- Peak Date
- Trough Date
- Recovery Date
- Calendar Days to Recovery
- Trading Days to Recovery
- Current Drawdown

---

# 42. ROLLING ANALYTICS

Default window:

- 60 trading days

Options:

- 20D
- 60D
- 120D

Metrics:

- Rolling Volatility
- Rolling Beta
- Rolling Correlation

Use one interactive chart with a segmented control rather than three giant charts.

Do not display a rolling metric until the full selected window exists.

---

# 43. STRESS LAB

Create a major section:

**Stress Lab**

Historical event presets:

- Global Financial Crisis
- COVID Crash
- 2022 Inflation / Rate Shock

Store exact dates in configuration.

Never dynamically redefine historical windows.

Example COVID window:

```text
2020-02-19 through 2020-03-23
```

Select and document defensible GFC and 2022 dates once.

---

# 44. STRESS-TEST PORTFOLIO CONVENTION

A historical stress test should answer:

> How would this configured target portfolio have behaved during this historical window?

At the first valid date of the stress period:

- initialize the portfolio at target weights
- allow weights to drift
- apply the same monthly-rebalance methodology if the period crosses a rebalance boundary

This makes stress results independent of whatever portfolio weights happened to exist before the event in another backtest.

Document this convention.

---

# 45. STRESS METRICS

For each event calculate:

- Portfolio Return
- Benchmark Return
- Active Return
- Maximum Drawdown
- Best Performing Holding
- Worst Performing Holding
- Holding-Level Returns

Optional:

- Portfolio Volatility
- Benchmark Volatility

---

# 46. STRESS DATA LIMITATIONS

Never fabricate pre-inception history.

Never silently substitute historical proxies.

If one or more holdings lack the full required event history:

Display:

**Incomplete Historical Coverage**

List missing holdings.

Explain:

> This stress result cannot be calculated accurately because one or more holdings lack sufficient historical data during the selected period.

Do not output a misleading complete-portfolio return.

Future versions may support explicitly documented proxies.

V1 should not.

---

# 47. CUSTOM HISTORICAL WINDOW

If implementation remains clean, support:

- Start Date
- End Date

Label:

**Custom Historical Window**

Do not call it a hypothetical stress test.

---

# 48. PORTFOLIO CONSTRUCTOR

After the analytics engine is stable, add a dedicated construction layer.

The constructor must be mathematically separate from the backtest.

Inputs:

- eligible holdings
- current weights
- minimum weight
- maximum weight
- required holdings
- optional cash limit
- long-only toggle in supported modes

V1 construction methods should prioritize risk-based methods that do not require fragile expected-return forecasts.

Recommended methods:

1. Equal Weight
2. Inverse Volatility
3. Minimum Variance
4. Equal Risk Contribution / Risk Parity

Optional later:

5. Maximum Diversification
6. Target Volatility
7. Mean-Variance / Maximum Sharpe

Do not make historical Maximum Sharpe the default constructor.

Historical mean returns are unstable expected-return estimates.

---

# 49. MINIMUM-VARIANCE PORTFOLIO

Solve:

```text
minimize:
w' Σ w
```

Subject to:

```text
sum(w) = 1
w_i >= minWeight_i
w_i <= maxWeight_i
```

Default:

- long only
- fully invested

Use the same covariance estimation methodology disclosed to the user.

For optimizer use, consider shrinkage covariance before treating the feature as production-grade.

---

# 50. INVERSE-VOLATILITY PORTFOLIO

Calculate raw score:

```text
score_i = 1 / volatility_i
```

Normalize:

```text
weight_i =
score_i / sum(score)
```

Then apply explicit constraints if supported.

---

# 51. EQUAL-RISK-CONTRIBUTION PORTFOLIO

Solve for weights such that percentage risk contributions are approximately equal:

```text
PCR_i ≈ 1 / N
```

Subject to:

```text
sum(w) = 1
w_i >= 0
```

Expose:

- convergence status
- iteration count if useful
- final risk contributions
- optimization tolerance

Do not claim an optimizer succeeded if it did not converge.

---

# 52. EXPECTED-RETURN OPTIMIZATION

Do not use historical CAGR as an unquestioned expected-return input.

If mean-variance / max-Sharpe optimization is later added, expected returns must come from an explicit assumption source:

- user-entered assumptions
- historical arithmetic mean, clearly labeled
- configurable capital-market assumptions

Display the expected-return methodology prominently.

Never conceal the instability of expected-return-sensitive optimization.

---

# 53. ALLOCATION SANDBOX

Make this a core construction workflow after the analytics dashboard is working.

Compare:

**Current Portfolio**

vs

**Proposed Portfolio**

Show:

- weights
- annualized volatility
- Sharpe
- beta
- max drawdown
- tracking error
- diversification ratio
- risk contributions
- historical stress results
- turnover from current allocation

Do not present the proposed allocation as a recommendation.

Label:

> Mathematical allocation under selected constraints and methodology.

---

# 54. TURNOVER

For proposed weights:

```text
oneWayTurnover =
0.5 * sum(abs(proposedWeight_i - currentWeight_i))
```

Display turnover for construction comparisons.

Transaction-cost modeling may be a later feature.

---

# 55. OVERVIEW UI

Create a dense, premium KPI strip.

Primary metrics:

- Ending Value
- Cumulative Return
- CAGR
- Annualized Volatility
- Sharpe
- Maximum Drawdown

Benchmark-relative row:

- Beta
- Alpha
- Tracking Error
- Information Ratio
- Benchmark Correlation

Do not make every number a giant card.

---

# 56. GROWTH OF $10,000

Interactive chart:

**Growth of $10,000**

Series:

- Portfolio
- Benchmark

Normalize both to $10,000.

Features:

- responsive layout
- date tooltip
- portfolio value
- benchmark value
- benchmark toggle
- professional axis formatting
- restrained animation

---

# 57. CURRENT TREASURY CONTEXT

Add a compact rates element:

**Treasury Curve Reference**

Example:

```text
3M   X.XX%
1Y   X.XX%
3Y   X.XX%
5Y   X.XX%
10Y  X.XX%
```

Highlight the maturity corresponding to the selected horizon.

Display latest available date.

Do not make this a full rates terminal.

---


# 57A. CURRENT MARKET SNAPSHOT

Where reliable current data is available, add a compact current-state section separate from historical analytics.

Possible fields:

- Portfolio Estimated Current Value
- Current-Day Portfolio Change
- Current-Day Portfolio Change %
- Benchmark Current-Day Change
- Latest Holding Prices
- Current Treasury Reference
- Market Status
- Last Updated

For a weighted portfolio without share counts, current-day portfolio change may be estimated from target or latest known portfolio weights:

```text
estimatedPortfolioDayReturn =
sum(weight_i * holdingDayReturn_i)
```

Label the weighting assumption clearly.

Do not imply that target-weight current-day performance equals the exact performance of a drifted real-world portfolio.

If the application later tracks share quantities or a current holdings state, use those actual quantities instead.

Show a freshness badge such as:

- Live
- 15m Delayed
- End of Day
- Latest Official

Only display a status supported by the provider metadata.

Historical KPI cards should retain their historical methodology and should not fluctuate intraday unless a separate "through current market" methodology is deliberately implemented and documented.

---

# 58. METHODOLOGY PANEL

Create a dedicated methodology drawer or modal.

Explain:

## Data
- price provider
- adjusted-price / total-return methodology
- Treasury source
- fetch timestamp

## Coverage
- requested start
- effective start
- overlapping benchmark period
- observation counts

## Portfolio
- initial allocation
- monthly rebalancing
- target-weight convention
- transaction-cost assumption
- CASH treatment

## Returns
- daily arithmetic return
- geometric compounding
- cumulative return
- CAGR

## Risk
- volatility
- covariance
- risk contribution
- correlation

## Risk-Free
- historical 3M Treasury proxy
- alignment rule
- no-look-ahead rule
- annual-to-period conversion

## Benchmark
- beta
- alpha
- tracking error
- information ratio
- correlation

## Drawdowns
- peak
- trough
- recovery

## Stress Testing
- exact windows
- initialization convention
- missing-history rules

## Construction
- objective function
- covariance estimator
- constraints
- convergence rules

## Annualization
- 252 trading days for volatility statistics
- calendar-day accrual for cash/risk-free return intervals

---

# 59. DATA-QUALITY STATES

Never make the UI look more certain than the data.

Support:

- Complete Data
- Partial History
- Insufficient History
- Benchmark Partial History
- Treasury Data Unavailable
- Ticker Not Found
- Provider Error
- Stale Cached Data
- Optimizer Did Not Converge

Display:

- data as-of date
- effective start date
- number of observations

---

# 60. ERROR HANDLING

One failed ticker should not crash the application.

Example:

> We couldn't retrieve historical data for XYZ.

Offer:

- Retry
- Remove Holding
- Edit Ticker
- Return to Portfolio Builder

Use timeouts and graceful server errors.

Never substitute data silently.

---

# 61. LOADING EXPERIENCE

Use skeleton states.

Possible stages:

- Loading market history
- Loading Treasury history
- Validating coverage
- Building portfolio
- Calculating analytics
- Preparing stress tests

Do not fake long loading sequences.

---

# 62. MICROINTERACTIONS

Use restrained motion.

Examples:

- KPI values animate once
- charts fade in
- allocation bars transition
- allocation comparisons animate smoothly
- selected horizon transition
- responsive tooltips

Use approximately:

```text
150–250ms
```

Respect:

```text
prefers-reduced-motion
```

---

# 63. PAGE STRUCTURE

Suggested hierarchy:

1. Navigation
2. Compact Hero
3. Portfolio Builder + Controls
4. Overview
5. Performance
6. Risk Contribution
7. Diversification
8. Benchmark
9. Drawdowns
10. Rolling Analytics
11. Stress Lab
12. Portfolio Constructor
13. Methodology

Do not create a random card grid.

---

# 64. HERO

Title:

**Portfolio Intelligence & Construction Lab**

Subtitle:

**See what actually drives your portfolio.**

Supporting line:

> Analyze performance, risk concentration, diversification, benchmark behavior, historical stress performance, and alternative portfolio allocations.

Primary CTA:

**Analyze Sample Portfolio**

Secondary CTA:

**Build Portfolio**

Keep the hero compact.

The application itself is the product.

---

# 65. RESPONSIVE DESIGN

Desktop is the priority.

Mobile must still be usable.

Mobile:

- stack charts intelligently
- horizontally scroll dense tables when necessary
- simplify controls
- preserve KPI readability
- preserve chart tooltips
- do not shrink content until unusable
- preserve section hierarchy

---

# 66. ACCESSIBILITY

Ensure:

- keyboard navigation
- visible focus states
- sufficient contrast
- accessible chart labels where practical
- non-color indicators for gain/loss
- labeled form fields
- reduced-motion support

---

# 67. CACHING AND PERFORMANCE

Optimize:

- historical price requests
- Treasury requests
- repeated symbol/date-range requests
- covariance calculations
- React rerenders

Use:

- server-side caching
- normalized cache keys
- stale-while-revalidate where appropriate
- freshness-aware cache policies
- memoized analytics
- efficient matrix operations
- normalized datasets

Suggested cache philosophy:

- current quotes: seconds to a few minutes depending on provider limits and delay
- current Treasury reference: refresh based on official publication cadence
- recent historical bars: shorter TTL than old history
- old historical bars: long TTL because finalized history rarely changes
- stress-window data: very long TTL once validated
- methodology/configuration: versioned rather than repeatedly fetched

Do not hammer free public providers merely to make the UI appear more real-time.

Cache key should include:

- provider
- ticker
- start date
- end date
- return convention / adjusted-price convention if relevant

Portfolio sizes are small enough that analytics should feel nearly instant after data is loaded.

---

# 68. REPRODUCIBILITY

Every analysis result should be reproducible.

Store or expose:

- historical price provider
- current quote provider
- Treasury provider
- requested date range
- effective date range
- benchmark overlap range
- rebalance convention
- historical-data fetch timestamp
- current quote market timestamp
- current quote fetch timestamp
- freshness / delay status
- methodology version

Optional:

- analytics-engine version string

This is especially valuable for a finance portfolio project.

---

# 69. TESTING — CORE MATH

Create deterministic unit tests for:

- Daily Returns
- Cumulative Return
- CAGR
- Annualized Volatility
- Historical Risk-Free Conversion
- Cash Accrual
- Sharpe
- Sortino
- Maximum Drawdown
- Recovery Dates
- Beta
- Alpha
- Correlation
- Tracking Error
- Information Ratio
- Covariance
- Covariance Matrix
- Portfolio Variance
- Portfolio Volatility
- Marginal Risk Contribution
- Component Risk Contribution
- Percentage Risk Contribution
- Diversification Ratio
- Effective Number of Holdings
- Return Contribution
- Stress Window Return
- Monthly Rebalancing
- Turnover
- Inverse Volatility
- Minimum Variance
- Equal Risk Contribution
- Current Quote Normalization
- Quote Freshness Status
- Provider Fallback
- Historical / Current Data Separation

---

# 70. EDGE-CASE TESTING

Test:

- single-asset portfolio
- all cash
- zero volatility
- constant benchmark
- missing benchmark date
- missing asset date
- unequal ticker history
- short ticker history
- invalid ticker
- invalid weights
- weights over 100%
- weights under 100%
- negative weight
- duplicate ticker
- Treasury holiday
- Treasury missing observation
- long Treasury data gap
- historical event before ETF inception
- benchmark starts after portfolio
- negative risk contribution
- zero tracking error
- zero downside deviation
- optimizer infeasible constraints
- optimizer non-convergence
- near-singular covariance matrix
- current quote unavailable while historical data works
- stale current quote
- delayed quote mislabeled by provider metadata
- market closed
- provider fallback activation
- current quote timestamp older than latest historical close
- historical provider and current quote provider disagree materially
- latest Treasury observation unavailable on the current date

Use numerical tolerances for floating-point comparisons.

Required identities:

```text
sum(PCR_i) ≈ 1
sum(CRC_i) ≈ portfolio volatility
daily portfolio return ≈ sum(daily holding contributions)
```

---

# 71. NUMERICAL SAFETY

Do not divide by approximately zero.

Explicitly handle undefined metrics.

Examples:

- Sharpe undefined when excess-return volatility is zero
- Sortino undefined when downside deviation is zero
- Beta undefined when benchmark variance is zero
- Information Ratio undefined when tracking error is zero
- risk contribution undefined when portfolio volatility is effectively zero

Display:

`N/A`

with a tooltip explaining why.

Do not display Infinity or NaN.

---

# 72. SECURITY AND INPUT SAFETY

Even without user accounts:

- validate all tickers
- validate dates
- validate portfolio size
- cap request ranges
- cap number of holdings
- sanitize URL parameters
- use server-side provider calls
- do not expose private API credentials
- use request timeout / abort handling
- add lightweight rate protection if the public endpoint can be abused

---

# 73. DISCLAIMER

Include a subtle professional disclaimer:

> For educational and analytical purposes only. Historical results do not guarantee future performance and should not be considered investment advice.

For construction outputs add:

> Portfolio allocations shown are mathematical outputs based on the selected inputs, assumptions, and constraints, not personalized recommendations.

---

# 74. IMPLEMENTATION PRIORITY

## PHASE 1 — FOUNDATION

1. Inspect current repository
2. Inspect existing portfolio design
3. Extract design tokens
4. Define architecture
5. Define types
6. Build historical market-data adapter
7. Build current-quote adapter
8. Build Treasury adapter
9. Build provider fallback / freshness metadata
10. Build validation
11. Build data-coverage logic
12. Build portfolio builder
13. Implement return engine
14. Implement monthly rebalancing
15. Implement risk-free alignment
16. Implement reproducibility metadata

## PHASE 2 — PERFORMANCE

17. Cumulative return
18. CAGR
19. Annualized volatility
20. Sharpe
21. Sortino
22. Drawdown engine
23. Growth of $10,000

## PHASE 3 — BENCHMARK

22. Beta
23. Alpha
24. Correlation
25. Tracking error
26. Information ratio
27. Benchmark overlap rules

## PHASE 4 — PORTFOLIO RISK

28. Covariance matrix
29. Portfolio volatility
30. Risk contribution
31. Capital vs Risk
32. Correlation matrix
33. Diversification metrics
34. Return contribution

## PHASE 5 — STRESS + ROLLING

35. Rolling volatility
36. Rolling beta
37. Rolling correlation
38. Historical stress definitions
39. Coverage validation
40. Stress calculations
41. Stress UI
42. Custom historical window if clean

## PHASE 6 — PORTFOLIO CONSTRUCTION

43. Allocation sandbox
44. Turnover
45. Equal weight
46. Inverse volatility
47. Minimum variance
48. Equal risk contribution
49. Constraints
50. Construction comparison UI

## PHASE 7 — POLISH

51. Current Treasury context
52. Methodology panel
53. Data-quality states
54. Loading states
55. Error states
56. Accessibility
57. Responsive behavior
58. Visual QA
59. Performance optimization
60. Full analytics test coverage
61. Final methodology review

## PHASE 8 — OPTIONAL AI LAYER

Only after all previous phases are reliable:

62. Define structured analytics schema for AI
63. Add methodology-aware explanation layer
64. Add portfolio-change explanation
65. Add stress-result explanation
66. Add risk-concentration explanation
67. Add guardrails against fabricated metrics
68. Add explicit source references to engine outputs

---

# 75. V1 DEFINITION OF DONE

A recruiter should be able to:

1. Open the application.
2. Load a sample portfolio immediately.
3. View real historical total-return-aware performance.
4. Understand the requested versus effective analysis period.
5. Compare portfolio growth against a benchmark.
6. See cumulative return and CAGR.
7. See annualized volatility.
8. See a historically calculated Sharpe ratio.
9. See Sortino.
10. See beta, alpha, tracking error, information ratio, and correlation.
11. Understand the exact benchmark-overlap sample.
12. See maximum drawdown and recovery history.
13. See which holdings drive portfolio volatility.
14. Compare capital weights to risk contributions.
15. Explore the covariance/correlation structure.
16. See diversification statistics.
17. Explore rolling volatility, beta, and correlation.
18. Examine major historical stress periods.
19. Understand when stress results cannot be calculated.
20. See current Treasury context separately from historical risk-free methodology.
21. Open a methodology panel and understand every major calculation.
22. Use the project comfortably on desktop and mobile.
23. View data-source and analysis metadata.
24. Compare the current portfolio to mathematically generated alternative allocations.
25. Understand that construction outputs are model results rather than investment recommendations.

---

# 76. FINAL PRODUCT STANDARD

The application should feel credible to someone working in:

- Asset Management
- Portfolio Management
- Investment Research
- Multi-Asset Investing
- Wealth Management
- Portfolio Analytics
- Risk
- Portfolio Construction

The math must be defensible.

The assumptions must be visible.

The data lineage must be understandable.

The UI must be exceptional.

The product should reward exploration.

An interviewer should be able to spend ten minutes inside the application and continue discovering meaningful analytical depth.

---

# 77. FIRST TASK

Do not immediately implement the entire product.

First inspect:

- the current repository
- existing portfolio design
- current project architecture
- reusable components
- existing dependencies
- deployment environment

Then respond with:

1. Proposed application architecture
2. Product naming recommendation
3. Historical data-source strategy
4. Current / live quote strategy
5. Treasury-data strategy
6. Provider fallback and freshness strategy
7. Data-flow diagram
8. Effective-start-date / data-alignment rules
9. Analytics-module structure
10. Backtest methodology
11. Risk methodology
12. Benchmark methodology
13. Portfolio-construction methodology
14. Component hierarchy
15. State-management approach
16. Caching approach
17. Testing strategy
18. Exact implementation phases
19. Technical risks
20. Data-provider risks
21. Live-data availability / latency risks
22. Numerical / methodology risks
23. Decisions that must be locked before implementation

Do not begin a massive code dump before establishing this plan.

Once the plan is approved, implement Phase 1.
