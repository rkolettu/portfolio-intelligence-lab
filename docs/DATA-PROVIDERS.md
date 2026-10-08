# Data providers

## Phase 9: deployed market data through Portfolio Lab's own Market Data API

Deployed equity history and current quotes come from the **market-data service**,
Portfolio Lab's standalone backend in its own repository, `portfolio-lab-market-data`
(FastAPI + yfinance, Render Free; its README documents routes, cache and settings).
Portfolio Lab depends on no other project. The flow is:

```
Browser → Portfolio Lab API routes (Vercel) → /api/market-data (Render) → yfinance → Yahoo
```

- The browser never calls Render. Portfolio Lab's server routes authenticate with
  `X-Portfolio-Lab-Service-Key`; the key exists only in Render and Vercel settings
  and is never logged or bundled (checked: absent from `.next/static`).
- The free instance sleeps when idle (no keep-warm). The landing page wakes it through
  Portfolio Lab's server without blocking render; see DEPLOYMENT.md.
- Render retrieves, normalizes, validates, caches and reports provenance. Every
  calculation (returns, Sharpe, beta, covariance, risk contribution, stress,
  optimization) stays in this repository's TypeScript engine, unchanged.
- Portfolio Lab adapter: `lib/market-data/providers/marketDataService.ts`
  (`MarketDataServiceProvider`). It implements the unchanged `HistoricalProvider` /
  `QuoteProvider` contracts plus optional batch capabilities. Nothing Yahoo-specific
  crosses it: the service returns provider-neutral records (dates, adjusted closes,
  currency, exchange, instrument, first trade date, provenance).
- **Batching:** `lib/server/history.ts` (`loadHistories`) serves the analysis, the
  Stress Lab and the Constructor. Every ticker is looked up in the per-instance cache
  under the unchanged keys; all misses from one call go upstream as **one** request
  (≤ 21 symbols: 20 holdings + benchmark). The direct research adapter keeps its
  bounded four-at-a-time per-ticker path. A failed security keeps its exact typed
  failure; it is never removed.
- **Quotes** batch the same way (one request for all uncached symbols). The service
  returns the raw observation (latest regular-market print and time, recent raw
  closes, retrieval time); Portfolio Lab classifies freshness with its existing
  rules (`lib/market-data/quoteObservation.ts`, shared with the direct adapter). A
  print is **Latest Available**, never Live; a finalized raw close is **End of Day**
  (the "previous close" case, labelled with its fallback reason); stale status is
  re-derived on every read as before.

### Adjustment convention (qualified 2026-09-30)

yfinance is called with every option explicit: `interval="1d"`, `auto_adjust=False`,
`back_adjust=False`, `repair=False`, `actions=True`, `keepna=False`,
`prepost=False`, `rounding=False`, and an explicit `start`. The value served is
Yahoo's own `adjclose` ("Adj Close"): split- **and** dividend-adjusted; ETF
distributions are dividends. It is the same series the direct adapter reads.

- `period="max"`/`range=max` is never used. Yahoo answers it with **monthly** bars even
  for `interval=1d` (405 SPY bars instead of 8,474 daily; values up to 15 % off the
  daily series at the shared dates).
- Missing adjusted closes are dropped, never filled. No forward fill, interpolation
  or bridging. Pre-listing ranges return `INSUFFICIENT_HISTORY` with the same message
  as the direct adapter; a partial range starts at the first listed session and
  carries the provider-reported first trade date.
- Only final sessions are cached (a weekday's bar after 16:20 New York). Portfolio
  Lab additionally applies its unchanged prior-market-day rule to every series.
- The request's start is the analysis start minus ten days, exactly as the direct
  adapter requests.

### Live qualification (2026-09-30)

`npm run qualify:service` (`scripts/service-qualification.ts`) ran the direct Yahoo
adapter and the service on identical securities and dates, then the unchanged
engine on both:

| Check | Result |
|---|---|
| Session dates (sample 5Y; 10Y vs VT; AAPL/MSFT/NVDA/AGG 3Y) | identical: 1,253 / 2,511 / 750 returns, identical first trade dates |
| Adjusted close | max relative difference 1.38e-6 |
| Daily portfolio return | max absolute difference 6.8e-7 |
| Ending wealth | max $0.004 on ~$16,700 (1.3e-7 relative) |
| CAGR, volatility, Sharpe, Sortino, maximum drawdown | ≤ 7e-7 relative; identical trough dates |
| Beta, alpha, tracking error | beta 6.8e-6 abs; alpha 1.9e-8 abs; TE 1.1e-7 abs |
| Correlations, MRC, PCR, sample-covariance volatility | ≤ 3.1e-6 abs |
| Stress (GFC, COVID, 2022): returns and drawdowns | ≤ 1.4e-7 abs; identical statuses |
| Construction: Ledoit–Wolf δ, μ; weights for all four methods | δ 1.5e-8 abs; weights ≤ 5.8e-7 abs; identical statuses |

Every difference is explained by one upstream property: Yahoo re-derives `adjclose`
per request and rounds it to float32. Two identical direct requests differ by 4–7e-7
relative, and the full-history request the service caches differs from a windowed
request by the same order. No difference appears at display precision. Replay of
analysis, stress and construction from their snapshots is exact through the service
(`npm run smoke:providers` with the service configured), and a repeated construction
is identical.

### Service cache, refresh and failure handling (Render)

Complete-history cache per (provider, ticker, interval, convention), sliced per request;
bounded LRU (3M sessions, ~36 MB). Incremental refresh fetches only the tail plus a
14-day overlap and appends when the overlap matches within 5e-6; any mismatch (a new
dividend or split re-bases every earlier adjusted close, or a corrected close) triggers
a full refetch, so adjustment bases are never spliced. Single-flight per symbol.
Retries (backoff + jitter) only for timeouts, connection resets, temporary 5xx and
throttling. A circuit breaker (5 failures → 30 s, doubling to 5 min) serves cached
history marked `stale` (Portfolio Lab adds a provenance warning) and fails uncached
requests fast with a typed retryable error. Four concurrent upstream calls at most.
Background prewarm of SPY, QQQ, IWM, BND, GLD (full histories cover every stress
window), rerun after every cold start. Details and measurements: the
`portfolio-lab-market-data` README.

### Terms

Yahoo Finance is an unofficial source with no redistribution or data licence. The
project owner chose this $0 path for a non-commercial educational deployment on
2026-09-30; the registration in `config/deployed-providers.ts` records that
acceptance explicitly (`upstreamAcceptance`). The direct browser-facing adapter
remains local research only.

### Future providers

Add `TwelveDataProvider`, `PolygonProvider` or another adapter by implementing the
same contracts, either in Portfolio Lab (`lib/market-data/providers/`) or behind the
service (a new `provider.py` returning the same normalized records). Register it
through the path below. No analytics, cache keys, validation or UI code changes.

# Phase 1 provider qualification

## Separation and source selection

Historical equities/ETFs: Yahoo chart candidate, isolated behind `HistoricalProvider`. There is no freely accessible official exchange/issuer source qualified here for a coherent multi-asset, dividend/split-adjusted daily history. FRED's equity indexes are not interchangeable with adjusted ETF prices. Paid/free-tier APIs needing credentials have not been silently selected. Yahoo is the unofficial candidate explicitly allowed by the spec, and it is **local research only** (below).

Historical Treasury: official Federal Reserve H.15 DGS3MO via FRED's public CSV export, no key. Current Treasury: separate DGS3MO/DGS1/DGS3/DGS5/DGS10 reads with latest common observation date. V2 forward risk-free (`getLatestOneYearYield`): a separate DGS1-only read from both FRED and the U.S. Treasury file, returning the later official observation (FRED on equal dates; never merged or averaged; selection recorded in provenance), cached under `fred:latest-DGS1:v1` with the six-hour Treasury TTL. The forward model rejects an observation more than 7 calendar days old (`TREASURY_UNAVAILABLE`). It never substitutes another maturity. The curve read, historical reads and the generic FRED-first fallback are unchanged. Quotation basis and modeled availability are documented in METHODOLOGY.md. No discount-yield series is substituted.

Current quotes: independent Yahoo chart capability. Latency is unqualified, so regular quotes are Latest Available. The latest finalized **raw** closing observation is a fallback if a quote is absent or older. End of Day does not certify an official exchange auction close. `chartPreviousClose` is not used: its range-dependent meaning is insufficient for a trustworthy day-change denominator. No portfolio day estimate or market value is fabricated.

The fallback registry replaces entire equivalent historical series, preserves source/error lineage, and rejects different securities/currencies/conventions. Identical duplicate dates collapse; conflicts fail. Missing adjusted values are left as gaps for calendar validation, never replaced by raw closes.

## The direct Yahoo adapter is local-only

(Phase 9: deployments reach Yahoo only through the authenticated market-data service
above; this section still governs the direct adapter.)

`yahooLocalResearchEnabled` in `config/providers.ts` is default-deny:

| Runtime | Yahoo |
| --- | --- |
| `npm run dev`, Vitest, `npm run smoke:providers` (`NODE_ENV` not `production`) | enabled |
| Local production build (`npm run build && npm start`) | disabled unless `PORTFOLIO_LAB_LOCAL_YAHOO=1` |
| Any runtime with `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION` or `VERCEL_DEPLOYMENT_ID` set | **disabled, even with the opt-in** |

Vercel production and preview therefore never call Yahoo, and no environment variable can re-enable it there. The former `ENABLE_YAHOO_PRODUCTION` flag has been removed and is ignored (a regression test sets it on simulated Vercel preview/production and still gets `UNQUALIFIED_PROVIDER`). A production build that forgot to expose Vercel system variables still denies Yahoo because the opt-in is absent. `AWS_LAMBDA_*` variables are not used as hosting signals: Vercel hides them under Fluid compute.

With no qualified provider, analyses holding any equity/ETF return a typed `UNQUALIFIED_PROVIDER` error with no retry/edit actions, current quotes are unavailable, and the official FRED curve and CASH-only runs continue to work. This was observed in a local production server without the opt-in.

## Replacement-provider path

Deployed adapters are registered in code, in `config/deployed-providers.ts`, never by environment:

1. Implement `HistoricalProvider` (and/or `QuoteProvider`) under `lib/market-data/providers/`. History must return whole series under `total_return_aware_adjusted` with split **and** distribution adjustment. Quotes must not claim `live` without qualified latency metadata.
2. Qualify it: terms/licence review for public display, caching and retention; a deployed-runtime smoke from the intended Vercel region covering every sample holding and SPY/VT/QQQ/AGG, an invalid symbol, range limits and throttling; and split/distribution fixture reconciliation (for example 2-for-1 raw 100→50 adjusted 50→50 yields zero return).
3. Register `{ provider, qualification }` with `termsUrl` (https), `termsReviewedOn`, `deployedSmoke`, `conventionEvidence` and `reviewer`. `assertQualified` runs at module load and rejects incomplete evidence and the direct Yahoo adapter, failing closed with `UNQUALIFIED_PROVIDER`. A provider whose upstream is Yahoo is admissible only through the market-data service and only with a recorded `upstreamAcceptance` (owner, date, scope, `transport: "market-data-service"`). The environment supplies only the service URL and key, never qualification.
4. The existing fallback registry, identity/convention checks, cache keys (which include provider names) and snapshot metadata apply unchanged.

## Treasury publication timing

The Fed states that H.15 "is posted daily Monday through Friday at 4:15pm" and not on holidays or when the Board is closed (checked 2026-09-28). FRED CSV carries no vintages, so each observation's availability is **modeled**: 23:59 ET on the next federal business day, from a versioned federal calendar (`config/federal-holidays.json`, pandas `USFederalHolidayCalendar` 1975–2029 plus 16 documented executive-order and national-mourning closures). Extra closed days can only delay modeled availability, so supplemental closures are conservative.

No-look-ahead guards:

- Rates are used only when modeled availability is strictly before the interval's starting close, including early closes, and are frozen for the interval.
- A rate whose availability precedes its own observation date, or is unparseable, fails as `MALFORMED_DATA` instead of being silently filtered.
- A date outside federal-calendar coverage fails; unknown days are never assumed to be business days.
- The federal calendar version is recorded in result metadata and the snapshot hash.

Live evidence (2026-09-29 03:26 UTC): the Fed had published September 28 data at 16:15 ET, yet FRED still served only 2026-09-25, whose modeled availability (2026-09-29 03:59 UTC) was still in the future. The smoke's `TREASURY_TIMING` check (every date the model calls known must already be served) reported `modelConservative: true`. FRED ingestion lag is real and exceeds the same-day H.15 release; the one-business-day margin covers it. This is evidence for the current cadence, not a proof of historical vintages.

## Calendar maintenance

Artifacts are generated deterministically by `scripts/generate-calendar.py` with pinned `scripts/calendar-requirements.txt` (exchange-calendars 4.13.2, the latest release as of 2026-03-10; pandas 3.0.6). Each artifact records its version, generator versions, coverage and a SHA-256 of its contents. Regenerating reproduced the previous sessions byte-for-byte. The 2026–2028 holidays and early closes match NYSE's published schedule (checked 2026-09-28; pinned by a test). Coverage ends 2028-12-31, the last year NYSE publishes.

`npm run calendar:check` runs automatically as `prebuild` (and therefore on Vercel builds). It fails the build on a hash mismatch (hand edits), malformed sessions, federal coverage shorter than session coverage, or when session coverage ends within **180 days**, and warns within 365 days. Runtime bounds come from artifact metadata; requests beyond coverage fail rather than guess.

Renewal: when NYSE publishes a new year or announces an unscheduled closure, raise `SESSIONS_END`/`FEDERAL_END` (or wait for an exchange_calendars release containing the closure), update the pin, regenerate, run `npm run calendar:check` and the calendar tests, and add the new closure to the tests. A calendar change is a methodology-visible change: calendar versions enter the snapshot hash.

## Large snapshot transport

API results are serialized once and streamed as UTF-8 in pull-based 64 KiB chunks (backpressure; the buffer is released on client cancel). There is no `Content-Length`. Every observation and full ledger precision is preserved; nothing is downsampled. Vercel documents that streamed function responses are not subject to the 4.5 MB buffered body limit. `Cache-Control: no-store` omits `no-transform` so Vercel's CDN may gzip/brotli the JSON.

Measured in a local production server and the in-app browser: a 20-holding, 1980–2026 run (11,726 returns, 244,095 observations) streamed **44.76 MB** losslessly in 891 chunks, in 2.9 s. The 5-year sample is 1.9 MB. The browser still buffers and parses the whole result; server memory holds the result, its JSON and its bytes transiently.

This work also removed an O(sessions × rates) prior-known-rate scan that made that run take about two minutes of CPU. A randomized test pins the indexed lookup to the original selection rule. The in-memory data cache is now bounded by bytes (64 MB default) as well as entries (128); oversized values are returned but not retained.

## Cached quote freshness

Every quote carries absolute expiry timestamps. `statusExpiresAt` is the market timestamp plus 120 s for live claims, or plus the stated delay plus 120 s for delayed claims. `staleAfter` is the close of the next NYSE session after the observation, attached server-side on every cache read. Status is re-derived per read from the immutable cached value: live/delayed claims lapse to Latest Available and are never upgraded, and a quote is `stale` once a newer close exists. A Friday close stays fresh over the weekend and goes stale at Monday's close. The browser re-evaluates displayed quotes every 15 s while visible, advancing the server's clock by elapsed time (immune to browser clock skew).

`cacheAgeSeconds` for quotes is measured from the upstream response `Date`. The live test caught Next's fetch cache serving a 29-minute-old quote response while revalidating, which had been reported as 0 s.

## Local smoke evidence

Run: `npm run smoke:providers`, 2026-09-29 03:26 UTC, Node 26.3.1 on macOS, actual network calls; 2 s.

- Sample SPY/QQQ/IWM/BND/GLD/CASH, requested 2021-09-28 through 2026-09-28: effective 2021-09-28 through 2026-09-25, 1,253 close-to-close returns, continuous SPY benchmark overlap, historical DGS3MO CASH accrual, ending wealth $16,781.49. Monday's current-day bar was deliberately excluded.
- SPY quote: market timestamp 2026-09-28T20:00:00Z, Latest Available, `staleAfter` 2026-09-29T20:00:00Z.
- Current official 3M/1Y/3Y/5Y/10Y curve on common date 2026-09-25; Treasury timing check conservative (above).
- The same sample through the local production server and in-app browser rendered identical results. Without the opt-in, the same server returned `UNQUALIFIED_PROVIDER`.
- Earlier, query1 returned HTTP 429 while query2 with a standard user agent succeeded; query2 is the same provider, not independent fallback.
- Routine Vitest and browser tests use deterministic synthetic fixtures and never require upstream availability.

These facts establish a **local integration smoke**, not a contractual or deployed-runtime qualification. Newly fetched corrected data can change numerical results (successive fetches differed by about $0.00001 in ending wealth); rely on snapshot replay, not a fixed live price.

## Stress-window data (Phase 5)

`/api/stress` fetches each holding and the benchmark once over the span of the requested windows. The fixed preset span is 2007-10-09 → 2022-12-30, so its cache keys are identical for every portfolio holding a given security; a Custom Historical Window uses its own span. Providers, key format, TTLs, concurrency and whole-series fallback are the analysis's, unchanged. DGS3MO is fetched only when CASH is held. Failures are recorded per security and judged per event instead of failing the request.

Observed live (2026-09-29): Yahoo answers a range entirely before a security's listing with HTTP 400 and `{"chart":{"error":{"description":"Data doesn't exist for startDate = …, endDate = …"}}}` (for example ARM over 2007–2022), while an unknown symbol is HTTP 404. `fetchPublic` returns listed error statuses with their body to the adapter (default none, so FRED is unchanged). The Yahoo adapter maps only that 400 body to non-retryable `INSUFFICIENT_HISTORY`; every other 400 remains `PROVIDER_ERROR`. Stress therefore reports such a holding as Incomplete Historical Coverage, and a main analysis over a pre-listing period reports insufficient history instead of a retryable provider fault. If Yahoo changes that text, the case falls back to the provider-error label.

Live smoke of the sample (1.3 s, 351 KB): all three windows complete. With a VT benchmark, the GFC event keeps its portfolio result while benchmark and active results are unavailable, because VT's provider-reported first trade is 2008-06-26.

## Construction data (Phase 6)

`/api/construction` fetches every eligible ticker, zero-weight candidates included, plus the benchmark over the analysis's requested window, using the analysis's cache keys, TTL, concurrency and fallback registry. DGS3MO is fetched over the same window. It also fetches the fixed stress preset span with the Stress Lab's keys (and DGS3MO there when CASH is held or fixed above zero). An eligible asset whose history cannot be fetched fails the request with its ticker; it is never silently dropped from the universe. The one exception is a request where neither portfolio can hold a risky asset (current allocation all-CASH and CASH fixed at 100%): candidate history is then unused, and the all-CASH comparison runs on the session calendar and Treasury data. A benchmark failure only disables benchmark-relative comparison metrics. Current quotes are never read. Live sample: 1.7 s, about 1.2 MB, including the replay snapshot.

## Cache, timeout and provenance

Successful history is fetched as a coherent whole requested series (with ten days of boundary context); normalized in-memory cache TTL one hour. Quotes use 60 seconds. Treasury uses six hours. Vercel/Next fetch caching uses the same TTLs and may serve a stale response while revalidating, which provenance cache ages now expose. No chunk splicing across adjustment scales and no stale-as-complete historical fallback. Freshness records cache age separately from market observation age, source response/fetch time, last successful refresh and observation date.

The in-memory cache deduplicates identical concurrent calls on one instance. Provider calls use at most four equity requests concurrently, a four-second per-attempt timeout including body consumption, at most one retry for transient failures, and no retry for invalid symbols/permission/rate limits. Provider response bodies are bounded to 16 MB. Quotes/current Treasury never invalidate the historical snapshot.

## Unresolved production qualification — do not misrepresent this as live production data

1. **Deployed equity provider (Phase 9):** the Render market-data service is registered with local qualification evidence and the owner's recorded acceptance of Yahoo's terms. Its deployed-runtime smoke must be re-run against the real Render and Vercel URLs after the first deployment and recorded in `config/deployed-providers.ts`. Without `MARKET_DATA_SERVICE_URL`/`MARKET_DATA_SERVICE_KEY`, deployed equity analysis stays unavailable, as before.
2. **Vercel runtime checks:** no deployment was authorized or performed. After deploying, verify streamed >4.5 MB responses and CDN compression, FRED egress from the chosen region, and the default-deny gate (`UNQUALIFIED_PROVIDER`).
3. **Yahoo rights and stability** (local research): no documented SLA/quota or redistribution/retention licence. Special/capital-gain distributions, historical symbol reuse/delistings and all corporate actions have not been independently certified; unsupported terminal events fail closed.
4. **FRED vintages:** CSV exposes revised observations, not release histories. DGS3MO starts 1981-09-01; CASH-holding runs requiring earlier rates fail closed. Exact point-in-time studies require a qualified vintage source.
5. **Calendar renewal** is enforced by the build guard; unscheduled closures still require a human update.
6. **Cross-instance quota control:** configure Vercel Firewall/shared rate limiting; process memory alone is not sufficient public abuse protection.
7. **Transport scale:** 20-holding/50-year results are about 45 MB uncompressed per run. That is acceptable for Phase 1 correctness, but a later phase may want server-side summarization for display. Calculation inputs must never be downsampled.

No credentials are read or sent by client code. Historical analysis remains usable if optional quotes are unavailable.

Sources: [Yahoo adjusted-close explanation](https://help.yahoo.com/kb/SLN28256.html), [FRED DGS3MO definition](https://fred.stlouisfed.org/series/DGS3MO), [Fed H.15 publication schedule](https://www.federalreserve.gov/releases/h15/), [FRED vintage semantics](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [NYSE calendar](https://www.nyse.com/trade/hours-calendars), [exchange-calendars releases](https://pypi.org/project/exchange-calendars/), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Vercel body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), [Vercel compression](https://vercel.com/docs/how-vercel-cdn-works/compression).
