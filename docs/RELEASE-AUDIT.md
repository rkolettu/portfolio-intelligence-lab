# Release audit

## Phase 9 (2026-09-30): standalone market-data backend and multi-page workspace

Portfolio Lab is independent of every other project. Its market-data backend is its own
repository, `portfolio-lab-market-data` (FastAPI + yfinance, pinned), deployed as its own
Render free web service. No change to methodology, calculations, covariance/risk,
benchmark, stress, construction, Ledoit–Wolf, ERC, alignment, Treasury or
snapshot/replay semantics; existing golden and replay tests pass unmodified.

### Verdict

**Verified and ready for first deployment.** Remaining steps are operational:

1. Create the two GitHub repositories and push (no GitHub credentials were available in
   the build environment).
2. Deploy `portfolio-lab-market-data` on Render Free (settings in DEPLOYMENT.md) with
   `PORTFOLIO_LAB_SERVICE_KEY`.
3. Deploy Portfolio Lab on Vercel with `MARKET_DATA_SERVICE_URL` and
   `MARKET_DATA_SERVICE_KEY`.
4. Re-run `npm run qualify:service` and `npm run smoke:providers` against the deployed
   service and record the result in `config/deployed-providers.ts`.
5. Add a Vercel Firewall rate-limit rule on `/api/*`, and confirm the recorded owner
   acceptance of Yahoo's terms (`upstreamAcceptance`).

### Checks performed

| Area | Result |
|---|---|
| Market-data backend tests | 33 / 33 (upstream faked; auth, batch, cache, incremental refresh, coalescing, retries, circuit breaker, concurrency, missing ticker, pre-listing, partial batch, quotes, maximum portfolio, logging) |
| Portfolio Lab unit/component tests | 473 / 473 |
| Portfolio Lab browser tests | 44 / 44 (routes, deep link, reload, back/forward, mobile, reduced motion, wake on load, slow-wake sample offer, cached sample, failure isolation across routes) |
| Lint · typecheck · production build · `VERCEL=1` build | clean · clean · pass · pass |
| Local integration (standalone service under uvicorn) | sample; 15 securities + CASH; 20 securities + VT (21 symbols in one batch): analysis, Stress Lab and Constructor all succeed; 21-symbol quote batch, all Latest Available |
| Cold start (service down, then started 8 s after Analyze) | landing rendered in ~0.2 s unblocked; "Waking market-data service…" immediately; "Loading historical prices…" as soon as the service answered; overview ~15 s |
| Cached sample, live | service down: offer after ~21 s of waking, never automatic; "Cached sample · Last refreshed …" |
| Hard refresh on `/analysis/risk` | analysis re-run from the tab's saved configuration; same page |
| `VERCEL=1` runtime | with the service: analysis and quotes through it; without it: `UNQUALIFIED_PROVIDER` |
| Finance outputs | replay exact (analysis, stress, construction, construction repeat); direct adapter vs service: identical sessions, differences ≤ float32 upstream noise (beta 1.5e-6, weights 4.8e-7 absolute) |
| Secret exposure | key absent from `.next/static`; never logged |
| Responsive, every route | 390 / 768 / 820 / 1024 / 1320 / 1920 px: no page overflow |

### Defects found and fixed in this pass

- `/analysis` did not redirect: a render-time `redirect()` never runs because the
  shell withholds page content until an analysis exists. Moved to `next.config.ts`.
- Provenance/source cells never wrapped, so the longer service provider name made
  the lineage table scroll even at 1920 px. They now wrap.
- The workspace keeps Stress Lab events and the Constructor's proposal per analysis,
  so leaving and returning never refetches or loses a generated proposal; a request
  cut short by leaving the page is made again on return, never left spinning.
- Focus is moved to the page heading when Analyze opens the overview (the submit
  button is gone), instead of being lost to `<body>`.

### Workspace behaviour

- Routes: `/` (builder), `/analysis/{overview,performance,benchmark,risk,rolling,stress,constructor}`,
  `/analysis` → overview. Each page has its own title for the route announcer.
- State: one `WorkspaceProvider` in the root layout holds the draft, the displayed
  analysis (memory only), current market context and per-analysis page state. Page
  bodies are memoized on the result, so quotes arriving or builder edits never
  re-render charts.
- Normal navigation: measured, 8 page changes made one request (the Stress Lab's
  first visit). A browser test pins `analysis: 1, stress: 1, construction: 1` across
  navigation, method switches and a builder edit.
- Hard refresh: re-runs the tab's last analyzed configuration (sessionStorage, a few
  hundred bytes) and returns to the same page. Nothing large is stored (test: all
  browser storage < 4 KB). A deep link in a new tab shows "No active analysis" with
  the builder and an in-place sample run.
- Errors stay on their route: a Stress or Constructor failure leaves every other
  page working (tests); quote/Treasury failures only affect the Overview's market
  panel.
- Loading stages: "Waking market-data service…" appears only when the readiness
  check does not answer within 1.2 s (tested both ways). Prices, coverage and
  analytics are one server request, so they are one truthful step, not a fabricated
  sequence.
- Sample fallback: only when the **sample** fails for a service reason, the error
  offers "View cached sample"; nothing switches silently; the page is labelled
  "Cached sample · Last refreshed <time>"; custom portfolios never get it (tested).
  The cache (`data/cached-sample.json.gz`, 594 KiB) is real data produced through the
  service by `npm run sample:snapshot`.

### Bundle (gzip JavaScript, measured in the browser)

| | Before (single page) | After |
|---|---|---|
| `/` first load | 378 KB | **242 KB** (−36 %) |
| After Analyze → Overview | 378 KB | 365 KB |
| After visiting all seven pages | 378 KB | 453 KB |

Route splitting makes the landing page and first report view lighter; a visitor who
opens every page downloads about 20 % more in total because per-route chunks repeat
some shared modules. Not tuned further.

### Known limitations

- Touch still verified with Chromium emulation only (no WebKit/device).
- Render free tier: the in-memory cache is lost on restart or deploy; prewarm refills
  the five common symbols in seconds, others refetch on demand.
- History served stale during a circuit-open period can end before the latest session;
  the unchanged coverage rules then report the gap rather than shorten the analysis.
- Yahoo re-derives adjusted closes per request (float32), so live re-analysis can
  differ in the 7th significant digit; snapshots replay exactly.
- Render Free sleeps after 15 idle minutes (no keep-warm, by design): the first visitor
  after a quiet period waits for the wake (typically 30–60 s on Render), and the
  in-memory cache restarts empty (prewarm refills the five common symbols).
- Earlier findings still apply: per-instance rate limiting; in-handler validation
  failures return HTTP 200 with `{ok:false}`.

---

## Release audit of 2026-09-29 (superseded by the Phase 9 section above)


Branch `release-audit`, audited 2026-09-29 against the Phase 8 checkpoint (`d49402f`). Scope: concrete release defects only. No redesign, no new features. No change to finance methodology, construction algorithms, provider restrictions or existing test fixtures.

## Verdict

**NOT READY FOR DEPLOYMENT.** The code is release-quality: every check below passes and every defect found is fixed. The remaining blockers are deployment prerequisites, not code defects:

1. **No qualified deployed market-data provider.** `config/deployed-providers.ts` registers none, and Yahoo is blocked on any Vercel host by design. On Vercel, every equity analysis returns `UNQUALIFIED_PROVIDER`. That includes the hero's "Analyze Sample Portfolio" button, so it errors, and Stress Lab and the Portfolio Constructor are unreachable. I confirmed this with `VERCEL=1` on a production build. The Treasury curve and CASH-only runs work. The fix is to register a provider through the documented qualification path in `docs/DATA-PROVIDERS.md`, not to relax the gate.
2. **Cross-instance rate limiting is not configured.** The built-in limiter is per instance (30 requests/min/IP). Before a public launch, add a Vercel Firewall rule on `/api/*`, as `docs/DEPLOYMENT.md` specifies.
3. **Post-deploy check.** Once blocker 1 is resolved, confirm on Vercel that large analysis responses stream and are compressed (a 10-year, 6-holding run is 4.7 MB; the documented worst case is about 45 MB).

## Checks performed

| Area | Result |
|---|---|
| Unit and component tests | 461 / 461 pass (48 files) |
| Browser tests (Playwright, Chrome) | 37 / 37 pass |
| Lint · typecheck | clean · clean |
| Production build and calendar guard | pass (calendars cover through 2028) |
| Live-provider workflow (`npm run smoke:providers`) | pass; figures match `docs/FINAL-AUDIT.md` |
| Analysis replay, stress replay, construction replay | exact |
| Deterministic construction repeat | exact |
| Reduced motion | decorative animation and transitions removed (browser test) |
| Keyboard-only | existing keyboard workflow and dialog focus-trap tests pass |
| Touch / mobile | 3 new touch browser tests pass, plus manual probes at 390 / 768 / 820 px |
| Responsive sweep | 390, 768, 820, 1024, 1320, 1920 px |
| Hosted-provider gate | simulated with `VERCEL=1` |
| API boundary probes | curl against a production build |

## Defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 1 | Touch: tapping a holding in Capital vs Risk, the risk table, return contribution, Stress Lab bars or constructor rows did nothing. Touch pointers fire enter and leave around every tap, which cancelled the highlight. | A tap now pins the highlight, a second tap releases it, and a tap on unrelated content clears it (`HoldingFocus`). |
| 2 | Touch: phantom highlights. After a tap and a scroll, Chromium emits synthetic mouse boundary events at the last touch point. | Hover counts only on devices matching `(hover: hover)`. Hybrid laptops keep both hover and tap. |
| 3 | Pair cards were buttons with no action; they only worked on browsers that focus a tapped button (Safari doesn't). | Tap toggles the pair highlight; `aria-pressed` reports the state. |
| 4 | Correlation cells relied on compatibility `mouseenter` events on touch, with the same phantom risk and no way to dismiss. | Explicit tap to select, tap again to clear; a tap outside the matrix closes the panel. |
| 5 | Definition tips (ⓘ) opened on tap only where the button receives focus. | Tap opens the tip; a tap outside closes it. |
| 6 | Touch targets: the ⓘ trigger was 16 px (a Phase 8 regression from 24 px), and custom checkboxes and radios were 16 px. | 24 px hit area on the trigger; 24 px checkboxes and radios on coarse pointers; 18 px legend toggles. |
| 7 | Hover-only effects stuck after a tap (allocation-strip dimming and tips, table row tracking, Capital vs Risk hover bars). | Gated behind `@media (hover: hover)`. The Capital vs Risk delta bracket now follows the pinned or hovered holding. |
| 8 | Negative risk contribution: the hatching was invisible in the default Overlay view, because an inline `background` shorthand overrode the CSS hatch pattern. | Inline style now sets `backgroundColor` only. |
| 9 | Hero weight nodes: a tapped node's label vanished immediately. | A tap shows the node's label. |
| 10 | No favicon (`/favicon.ico` returned 404). | Added `app/icon.svg` using the existing three-bar brand mark. |

## Touch behavior

| Interaction | Touch behavior |
|---|---|
| Chart tooltips (growth, drawdown, rolling, stress path, comparison) | Tap shows the terminal tooltip (Recharts touch support). |
| Correlation heatmap | Tap a cell: row and column light up, the panel opens, the four-decimal readout updates. Tap again or elsewhere to clear. Printed two-decimal values need no interaction. |
| Pair cards | Tap toggles the pair highlight across heatmap and risk views. |
| Capital vs Risk | View switch is a native radio group. Tap a row to pin the highlight and delta bracket. The Δ column always shows the difference without interaction. |
| Cross-component ticker highlight | Tap-pinned; released by a second tap or a tap elsewhere. |
| Constructor rows | Before/after bars are always visible; tap highlights. |
| Stress Lab | Event tabs are native radios; holding rows tap-highlight; path tooltip on tap. |
| Hero nodes | Decorative; tap reveals a label. |
| Not ported to touch | Rolling-window shading follows the mouse only; the tapped tooltip already gives the value. Desktop hover dimming is deliberately not forced onto touch. |

Coverage: `tests/e2e/portfolio.spec.ts` "touch" blocks (tooltips, definitions, holding pin/release, heatmap cell, pair card, overflow) and the touch assertions in `tests/components/visual.test.tsx`.

## Negative risk contribution

Fixture: `tests/fixtures/hedge.ts`, a new file with the same deterministic inputs as the existing `hedge()` in `tests/components/risk.test.tsx` (unchanged). HEDGE contributes −16.27% of risk.

- **Geometry:** the bar ends exactly at the zero line and extends left, both in the thin Overlay bar and in the Risk view's morphing bar. The capital ghost starts at zero. The `0%` tick sits on the zero line.
- **Hatching:** the computed `background-image` is `repeating-linear-gradient` in both views (browser test). Screenshot reviewed at 390 px.
- **Not colour-only:** direction of the bar, a "hedge" tag, a minus-signed share (`-16.27%`) and a signed delta (`-36.27 pp`).

## Responsive status

At 390, 768, 820, 1024, 1320 and 1920 px, with results, a generated proposal and the dialog open:

- `scrollWidth` equals the viewport at every width.
- The sticky header stays at `top: 0`.
- The methodology dialog stays within the viewport once its slide-in finishes.
- Chart and heatmap tooltips stay within the viewport.
- Wide tables scroll locally (`overflow-x: auto`): 14 at 390 px, 4 at 820 px, none at 1320 px and above.
- Constructor, Stress Lab and correlation-matrix screenshots reviewed at 390 px.
- No page errors at any width.

## Accessibility status

- Decorative motifs are `aria-hidden` and text-free.
- Controls are native radios, checkboxes and buttons with accessible names; pair cards expose `aria-pressed`.
- The active nav link uses `aria-current`.
- The dialog traps focus and returns it on close (existing test).
- Every chart has a data table.
- Values and signs are never colour-only.
- Touch targets are at least 24 px.
- Reduced motion removes all animation.
- Remaining gap: correlation cells are not keyboard-focusable. Their two-decimal values are printed in an accessible table; only the four-decimal readout needs pointer or touch.

## Performance status

Measured on a 10-year live-data run:

- **Timing:** analysis about 2.0 s; Stress Lab finishes about 0.8 s later.
- **Requests:** one per endpoint (analysis, stress, quotes, Treasury). Method switches, event switches, view switches and builder edits trigger no requests; construction runs only on Generate.
- **Hover:** no long tasks while sweeping the pointer across the growth and rolling charts; the analysis sections are memoized against builder edits.
- **Payloads:** analysis 4.7 MB (carries the replay snapshot by design; streamed), construction 2.1 MB, stress 0.35 MB.
- **Client JS:** 428 KB gzip across all emitted chunks. The largest is 250 KB gzip (React, Recharts, Zod, app). Acceptable for a chart-heavy analytics client; nothing unnecessary found.

## Security and runtime status

- **Secrets:** no provider credentials or API keys exist. The only environment read is in the server-only `config/providers.ts`, and the client bundle contains no provider URLs or server modules. Server modules import `server-only`, and no client component imports them.
- **Provider gate:** default-deny for Yahoo; any `VERCEL*` variable blocks it even with the local opt-in (verified). No deployed provider is registered (blocker 1).
- **Validation:**
  - portfolio input is parsed with Zod;
  - the construction and stress schemas are strict and take inputs only; client-sent results are rejected, and all results are recomputed server-side;
  - bodies over 16,000 characters are rejected (400);
  - more than 22 quote symbols are rejected (400);
  - cross-origin browser requests are rejected (403);
  - GET returns 405.
- **Provider limits:** provider responses are capped at 16 MB with a 4 s timeout and one retry; 4 concurrent fetches; in-memory cache bounded to 128 entries and 64 MB.
- **Responses:** API responses are `no-store` and streamed in 64 KB chunks; every route declares `maxDuration: 60`.
- **Cache TTLs:** history 1 h, quotes 60 s (freshness re-derived on every read), Treasury 6 h.
- **Error isolation:** hard failures of quotes, Treasury, Stress Lab and the constructor (dropped connections, non-JSON 500s) leave every core analytic rendered with no page errors. Stress and constructor show retry actions (new browser test).

## Known limitations (not blockers)

- Touch was verified with Chromium touch emulation only. WebKit is not installed, and no physical iOS or Android device was tested. Fixes 3 and 5 target Safari behavior specifically.
- Validation failures raised inside a handler return HTTP 200 with `{ ok: false, error }`. The client reads the body correctly, but status-code monitoring will under-count invalid requests.
- The 16,000-character body limit is checked after the body is read. The platform's own request-size limit bounds that.
- Very large analyses (MAX period, 20 holdings) can reach about 45 MB uncompressed in the browser.
- The calendar build guard will fail builds starting 180 days before its 2028 coverage end, so the NYSE calendar artifact must be refreshed before then.
- Social-card metadata (Open Graph images) was never supported and was not added.

## Files changed in this audit

- **Components:** `components/ui/HoldingFocus.tsx`, `components/metrics/InfoTip.tsx`, `components/risk/CorrelationHeatmap.tsx`, `components/risk/CapitalVsRisk.tsx`, `components/risk/RiskSection.tsx`, `components/risk/ReturnContribution.tsx`, `components/stress/StressHoldingBars.tsx`, `components/construction/ProposalView.tsx`, `components/hero/Hero.tsx`.
- **Styles and icon:** `app/globals.css`, `app/analytics.css`, `app/icon.svg`.
- **Tests:** `tests/fixtures/hedge.ts` (new), `tests/components/visual.test.tsx`, `tests/e2e/portfolio.spec.ts`.
