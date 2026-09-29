# Phase 1 provider qualification

## Separation and source selection

Historical equities/ETFs: Yahoo chart candidate, isolated behind `HistoricalProvider`. There is no freely accessible official exchange/issuer source qualified here for a coherent multi-asset, dividend/split-adjusted daily history. FRED's equity indexes are not interchangeable with adjusted ETF prices. Paid/free-tier APIs needing credentials have not been silently selected. Yahoo is the unofficial candidate explicitly allowed by the spec, and it is **local research only** (below).

Historical Treasury: official Federal Reserve H.15 DGS3MO via FRED's public CSV export, no key. Current Treasury: separate DGS3MO/DGS1/DGS3/DGS5/DGS10 reads with latest common observation date. Quotation basis and modeled availability are documented in METHODOLOGY.md. No discount-yield series is substituted.

Current quotes: independent Yahoo chart capability. Latency is unqualified, so regular quotes are Latest Available. The latest finalized **raw** closing observation is a fallback if a quote is absent or older. End of Day does not certify an official exchange auction close. `chartPreviousClose` is not used: its range-dependent meaning is insufficient for a trustworthy day-change denominator. No portfolio day estimate or market value is fabricated.

The fallback registry replaces entire equivalent historical series, preserves source/error lineage, and rejects different securities/currencies/conventions. Identical duplicate dates collapse; conflicts fail. Missing adjusted values are left as gaps for calendar validation, never replaced by raw closes.

## Yahoo is local-only

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
3. Register `{ provider, qualification }` with `termsUrl` (https), `termsReviewedOn`, `deployedSmoke`, `conventionEvidence` and `reviewer`. `assertQualified` runs at module load and rejects incomplete evidence and any Yahoo-named adapter, failing closed with `UNQUALIFIED_PROVIDER`.
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

## Cache, timeout and provenance

Successful history is fetched as a coherent whole requested series (with ten days of boundary context); normalized in-memory cache TTL one hour. Quotes use 60 seconds. Treasury uses six hours. Vercel/Next fetch caching uses the same TTLs and may serve a stale response while revalidating, which provenance cache ages now expose. No chunk splicing across adjustment scales and no stale-as-complete historical fallback. Freshness records cache age separately from market observation age, source response/fetch time, last successful refresh and observation date.

The in-memory cache deduplicates identical concurrent calls on one instance. Provider calls use at most four equity requests concurrently, a four-second per-attempt timeout including body consumption, at most one retry for transient failures, and no retry for invalid symbols/permission/rate limits. Provider response bodies are bounded to 16 MB. Quotes/current Treasury never invalidate the historical snapshot.

## Unresolved production qualification — do not misrepresent this as live production data

1. **No qualified deployed equity provider.** Yahoo is local-only by construction; deployed equity analysis stays unavailable until a replacement completes the registration path above.
2. **Vercel runtime checks:** no deployment was authorized or performed. After deploying, verify streamed >4.5 MB responses and CDN compression, FRED egress from the chosen region, and the default-deny gate (`UNQUALIFIED_PROVIDER`).
3. **Yahoo rights and stability** (local research): no documented SLA/quota or redistribution/retention licence. Special/capital-gain distributions, historical symbol reuse/delistings and all corporate actions have not been independently certified; unsupported terminal events fail closed.
4. **FRED vintages:** CSV exposes revised observations, not release histories. DGS3MO starts 1981-09-01; CASH-holding runs requiring earlier rates fail closed. Exact point-in-time studies require a qualified vintage source.
5. **Calendar renewal** is enforced by the build guard; unscheduled closures still require a human update.
6. **Cross-instance quota control:** configure Vercel Firewall/shared rate limiting; process memory alone is not sufficient public abuse protection.
7. **Transport scale:** 20-holding/50-year results are about 45 MB uncompressed per run. That is acceptable for Phase 1 correctness, but a later phase may want server-side summarization for display. Calculation inputs must never be downsampled.

No credentials are read or sent by client code. Historical analysis remains usable if optional quotes are unavailable.

Sources: [Yahoo adjusted-close explanation](https://help.yahoo.com/kb/SLN28256.html), [FRED DGS3MO definition](https://fred.stlouisfed.org/series/DGS3MO), [Fed H.15 publication schedule](https://www.federalreserve.gov/releases/h15/), [FRED vintage semantics](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [NYSE calendar](https://www.nyse.com/trade/hours-calendars), [exchange-calendars releases](https://pypi.org/project/exchange-calendars/), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Vercel body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), [Vercel compression](https://vercel.com/docs/how-vercel-cdn-works/compression).
