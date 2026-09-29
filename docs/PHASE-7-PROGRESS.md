# Phase 7 — polish and release-readiness ledger

Resumed on `phase-7-polish` from the interrupted, uncommitted working tree. No restart, reset, deployment, AI, or new feature phase. The Phase 1–6 calculation code and methodology versions are frozen unless a concrete bug is documented and reproduced first.

## Inherited work

Kept the signed-zero-safe shared formatters and tests; quality vocabulary and Treasury horizon mapping; section primitives; nine-topic native methodology drawer; Risk/Diversification split; concise metric tooltips; constructor workflow and expandable diagnostics; responsive CSS; numbered sections; and browser checks. The workspace extraction into AnalysisSections, CurrentMarket and LineageSection was unfinished.

Fresh baseline: 444/451 tests passed; seven workspace render tests failed with `CurrentMarket is not defined`. Typecheck reported five missing symbols. Lint reported three errors and 23 unused symbols. Neither PHASE-7-PROGRESS.md nor FINAL-AUDIT.md existed. The earlier 440-test checkpoint was not the state actually on disk.

Ruling: Continue in the current checkout and phase branch, preserving prior edits, as explicitly requested. Use this file as the execution ledger rather than restarting the phase or generating a new plan. Commit and merge to `main` requested at close ("continue and ship"); no deployment.

## Work and evidence

- Completed the workspace extraction: restored imports and the Apply callback, defined result status explicitly (avoiding the accidental browser `window.status` global), and moved quote ageing solely into CurrentMarket. The existing failing tests became green: 451/451.
- First production build passed, including calendar integrity guard. Initial browser suite passed 20/20 at phone/tablet/laptop/wide widths.
- Initial live-provider sample succeeded, with conservative Treasury timing, all three stress events and all four construction methods. This is local integration evidence, not deployed-provider qualification.
- Review found display/accessibility defects: builder total still used raw `toFixed`; tooltips were not vertically constrained or hoverable; chart focus outlines were suppressed; coincident growth paths had overlapping endpoint labels. Regression checks added before fixes.

## Work and evidence (continued)

- Remaining display fixes: axis percent ticks keep fractional precision (`-0.2%`, not a repeated `0%`); Current Market shows cache age at fetch separately from observation age; lineage copy no longer implies the hash alone can replay data; methodology drawer text matches the Phase 6 certification rules and the conservative (non-vintage) Treasury timing model; the Return-convention fact now reads as a label, not an enum.
- Methodology drawer focus trap: an extended keyboard-only browser test (15 Tabs inside the open dialog) reproduced focus escaping the modal. Fixed with explicit Tab/Shift+Tab wraparound and a focusable scroll region; the test now passes.
- Live replay (`npm run smoke:providers`): analysis, stress and construction results replay exactly from the fetched normalized snapshots, and a repeated construction run is bitwise identical. No extra provider requests or persistent retention were introduced.
- Scale: 20 holdings × 11,779 daily returns (1980–2026, monthly rebalancing) computed in ≈1.1 s server-side. The lossless JSON response is ≈47.5 MB uncompressed; the phone layout still fits at 390 px with the 20×20 heatmap. Payload size is a recorded limitation, not addressed by display-only downsampling in this phase.
- No calculation code changed: `git diff` over `lib/analytics lib/backtest lib/state lib/server config app/api` is empty.

## Final verification (2026-09-29)

- `npm run test -- --run`: 47 files, 453/453 passed.
- `npm run typecheck`, `npm run lint`: clean.
- `npm run build`: passed (calendar guard included).
- `npm run test:e2e`: 29/29 passed, including keyboard-only workflow and focus trap, duplicate-request guard, and visual review at 390/768/1320/1920 px with no horizontal overflow or page errors.
- Manual walk-through on the local production build with live data: see `docs/FINAL-AUDIT.md`.

## Release blockers (external, unchanged)

Deployed-provider qualification, Vercel egress/streaming/compression checks, and shared public rate limiting (Vercel Firewall on `/api/*` or a shared limiter) remain open. Until a deployed equity provider is qualified, a Vercel deployment returns `UNQUALIFIED_PROVIDER` for equity analyses; Treasury context and CASH-only runs still work.
