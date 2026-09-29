# Execution ledger — docs/IMPLEMENTATION-PLAN.md, Phase 1 only

Spec and plan read completely; original documents preserved. Working directly in the local repository by explicit user instruction. No later-phase implementation.

Pre-flight: 1A → 1B normalized types, decimal units, date/error contracts agree.
Pre-flight: 1B → 1C whole adjusted snapshots, prior-known rates and independent quotes agree.
Pre-flight: 1C → 1D immutable configurations, reproducibility and typed coverage agree.
Pre-flight: Phase 2's reference to basic benchmark wealth requires Phase 1 interval matching and continuous overlap/rebasing, but no benchmark metrics.

Ruling: User approved existing spec/plan and direct execution; use its 1A–1D checklist without regenerating a plan or creating a worktree. Empty repository has no base commit; keep a file ledger rather than commit-based skill helpers. Cost if wrong: workflow bookkeeping, no financial behavior.
Ruling: Lock proposed Phase 1 defaults: USD U.S. equities/ETFs, 20 holdings, 1e-6 budget tolerance with explicit normalization, 50-year input cap, seven-day rate-age limit, whole-run explicit zero CASH fallback, ACT/365 synthetic accrual, monthly closing reset. No Phase 2 metrics. Cost if wrong: policy change requires a methodology-version change and rerun.
Ruling: Supplied reference is currently light; reuse its Inter/neutral/editorial identity in the explicitly requested dark theme. Cost if wrong: visual tokens can be revised without changing analytics.

1A: complete — contracts, validation, sample, scaffold and design/runtime evidence.
1B: implemented and deterministic tests/local real-data smoke pass; public rights and Vercel egress remain unqualified and production-gated.
1C: complete — coverage, session-aware arithmetic returns, wealth/drift/monthly resets, prior-known Treasury/CASH, continuous benchmark path and replay metadata.
1D: implemented — builder, controls, localStorage, independent requests, retry/edit/remove, lineage and stale-response isolation. Five Chromium workflows passed; final visual check and independent review completed.

Ruling: Exclude current-market-day Yahoo daily bars until the next market date; retain requested end plus explicit finalized cutoff. Provider does not certify intraday bars as final. Cost: latest historical session can lag the close; current quotes remain separate.
Ruling: Model FRED availability at next federal business day 23:59 ET and disclose latest-vintage limitations. Cost: conservative lag excludes some actually available rates and cannot prove vintage accuracy.
Ruling: Keep the unqualified Yahoo candidate enabled for local/preview testing and production-gated; no public release/deployment performed. Cost: production history unavailable until terms and Vercel egress are qualified.
Ruling: Detailed API responses above 4 MB fail explicitly rather than dropping finance inputs. Cost: largest portfolio/range combinations require a future transport design.
Ruling: Pin ESLint 9.39.5 because current Next.js React/import/accessibility plugins reject ESLint 10 APIs. Cost: linter major-version maintenance remains dependent on upstream plugin compatibility.

Verification so far: validation RED→GREEN; core returns/calendar/Treasury RED→GREEN; normalization/fallback/cache RED→GREEN; engine RED→GREEN; state RED→GREEN. Snapshot-cutoff replay, whole-body timeout and older-quote fallback regression tests were observed failing, corrected, and included in the green 84-test suite. Production build passed outside the sandbox (restricted worker stalled); browser suite passed 4/4 after disambiguating Next's unrelated route-announcer alert. Automatic approval review briefly hit an account usage limit; user requested continuation and the normal approval path subsequently permitted the rerun.

Final independent review: no Critical findings. Two Important findings were reproduced and fixed: proxy-host same-origin handling (403→200 for legitimate request, still rejects unrelated Origin), and prominent result-bound zero-CASH disclosure (visible even after draft edits). Regression tests ran RED→GREEN. A mixed known/missing-rate fixture additionally verifies whole-run zero CASH while preserving known risk-free returns/nulls.

Final: minor (deferred): when a future qualified live adapter is added, re-evaluate cached live status as quote age passes its live threshold. Yahoo never emits live, so this path is currently dormant; no live claim is shipped by the configured provider.

Final: Ruling: later-phase financial metrics remain absent; production licensing/egress, vintage accuracy, shared rate limiting and oversized transport remain explicit gates, not hidden readiness claims. The independent reviewer deferred those declared external qualifications; the main agent owns actual source-site visual inspection and final test evidence. Cost if wrong: release requires these checks rather than assuming local success qualifies deployment.

Final verification: lint clean, strict typecheck clean, 87 deterministic tests across 11 files passed, production build passed. Final browser and live local workflow evidence recorded below after completion. Original spec/plan remain unchanged. No worktree, deployment, Phase 2 code, AI layer, authentication or unrelated project changes.

Final browser suite: 5/5 Chromium tests passed against the final production build, including unmocked route-origin validation, sample/result workflow, quote outage isolation, retry/remove/edit, persistence, mobile overflow, keyboard and reduced-motion checks. Live in-app-browser test against the production server then completed successfully with actual providers: requested 2021-09-28–2026-09-28, effective 2021-09-28–2026-09-25, 1,253 returns, continuous SPY overlap, ending ledger wealth $16,781.49. Separate current quotes and common-date Treasury curve rendered. Desktop builder/result layouts visually inspected; no Phase 2 charts or metrics added.

Local Phase 1 implementation verification is complete. The plan's full deployed-provider qualification gate remains open because no Vercel deployment/terms qualification was performed. Production Yahoo activation remains off by default. Work stops here as instructed.

## Phase 1 hardening — complete, 2026-09-29 UTC

The four requested documents were reread; the Phase 1 contracts remain consistent. The user's hardening priorities extend tasks 1B/1C/1D only. Working plan: (1) local-only Yahoo and explicit production replacement registry/evidence, (2) verify Treasury release timing and strengthen cutoff diagnostics/validation, (3) regenerate versioned calendars with metadata, reproducible tooling and a build-time renewal guard, (4) lossless streamed snapshots, bounded cache memory and quote freshness re-evaluation, then all requested checks and one independent review. Original spec and implementation plan remain unchanged.

Ruling: Keep direct-checkout/file-ledger execution from Phase 1; no worktree or commits requested, and repository still has no baseline commit. Cost: review must use named files instead of a commit diff.
Ruling: No public historical provider is qualified merely by successful HTTPS requests. Make Yahoo local-only, including local production-build smoke; no environment flag may activate it on Vercel. Prepare an explicit code registration path for a separately qualified replacement. Cost: deployed equity analysis stays unavailable until provider rights and deployed egress are established.
Ruling: Preserve the conservative Treasury timing model and synthetic ACT/365 semantics, with explicit latest-vintage limits; do not claim that modeled timestamps remove revision bias. Cost: strict historical point-in-time studies still require qualified vintages.
Ruling: Use Vercel-supported streaming for the full JSON snapshot, preserving all observations and ledger precision. No durable provider-data store is introduced. Cost: the browser still buffers the full result; deployed streaming must be smoke-tested in the eventual project.

### Continuation (Claude Code, after Codex's usage limit)

Codex's unverified edits were inspected in place and kept, not restarted. They were: local-only Yahoo gate, empty deployed registry, streamed route, cached-quote refresh and its tests, plus two RED Treasury tests. On resumption: lint and typecheck were clean, 92/94 tests passed, and the two Treasury tests failed because their implementations had not been written. Codex's plan above was completed as follows.

Ruling: Make the Yahoo gate default-deny. Enabled only when `NODE_ENV` is not `production` (dev, tests, CLI smoke) or with `PORTFOLIO_LAB_LOCAL_YAHOO=1` on a local production build. Any `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION` or `VERCEL_DEPLOYMENT_ID` blocks it regardless. The obsolete `ENABLE_YAHOO_PRODUCTION` is removed. `AWS_LAMBDA_*` is not a signal: Vercel hides it under Fluid compute. Cost: local `npm start` smoke needs one extra variable.
Ruling: Deployed adapters register in code with a `ProviderQualification` record (terms URL and review date, deployed smoke, convention evidence, reviewer). `assertQualified` rejects incomplete evidence and any Yahoo-named adapter. Cost: a replacement provider requires a reviewed code change, by design.
Ruling: Treasury availability keeps Codex's modeled next-federal-business-day 23:59 ET rule. Added documented executive-order/national-mourning federal closures (only delays availability); versioned federal calendar with explicit 1975–2029 coverage (fails outside); rejection of availability earlier than the observation date; federal calendar version in metadata and snapshot hash. Cost: a few rates become usable one business day later than necessary.
Ruling: Calendar artifacts are regenerated by a pinned, deterministic generator with version, coverage and content hash. Regeneration reproduced the previous sessions byte-for-byte. `prebuild` fails on tampering or within 180 days of coverage end; coverage stays at NYSE's published 2028 horizon. Cost: builds after mid-2028 fail until the calendar is renewed.
Ruling: Keep the lossless streamed transport; measure it rather than trim financial data. Dropped `no-transform` so the CDN may compress, and release the buffer on cancel. Cost: a 20-holding/46-year run is about 45 MB uncompressed.
Ruling: Quote freshness uses absolute timestamps: `statusExpiresAt` for live/delayed lapse, and `staleAfter` = next NYSE close after the observation, attached server-side per cache read. The browser re-evaluates displayed quotes every 15 s from the server clock plus elapsed time. This replaces Codex's fixed 24-hour stale rule, which marked every Friday close stale on Sunday. Cost: stale is a session concept, not a latency claim.

Defects found by live verification and fixed, each with a regression test:
- My added per-session availability validation constructed an `Intl.DateTimeFormat` per rate per session (122 s route latency). Now `marketDate` reuses one formatter and each rate array is validated once.
- Pre-existing O(sessions × rates) prior-known-rate scan: about 119 s CPU for a 20-holding 1980–2026 run, invisible at 5 years. Replaced with a sort-once, binary-search index (0.8 s). A randomized test proves identical selection against the original full-scan rule.
- Quote `cacheAgeSeconds` was hard-coded to 0, although Next's fetch cache served a 29-minute-old response while revalidating. It is now measured from the upstream response `Date`, and an invalid quote `Date` header no longer throws.
- The in-memory cache was bounded by entry count only; it is now also bounded at 64 MB, and oversized values are not retained.
- `UNQUALIFIED_PROVIDER` no longer offers retry/edit actions or points users at a repository file.

Verification (final code): lint clean; strict typecheck clean; 114 deterministic tests across 12 files pass (was 87/11 at Phase 1 close); production build passes with the calendar guard (session calendar confirmed absent from client chunks); Playwright 5/5 against a freshly started production server (the port was verified free). Live `npm run smoke:providers`: sample 2021-09-28 → 2026-09-25, 1,253 returns, ending wealth $16,781.49, Treasury timing check conservative, quote `staleAfter` correct, in 2 s. In-app browser against local production servers: default-deny server returned `UNQUALIFIED_PROVIDER` with the FRED curve intact; opt-in server rendered the identical sample; a 20-holding 1980–2026 run streamed 44.76 MB losslessly (11,726 returns, 244,095 observations) in 2.9 s. Evidence and sources are in DATA-PROVIDERS.md.

Still open, stated as gates rather than readiness: no qualified deployed equity/quote provider; no Vercel deployment performed, so streaming, compression and egress remain unverified in the deployed runtime; FRED vintages; unscheduled-closure renewal requires a human update; shared rate limiting. The independent review Codex planned was not run; the user did not request subagents in this continuation.

Phase 1 hardening stops here. No Phase 2 metrics, charts or code were added.
