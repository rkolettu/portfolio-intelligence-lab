# Execution ledger — docs/IMPLEMENTATION-PLAN.md, Phase 2 only

Spec §20–27, §41, §55–56, §58, §69–71 and plan §9–10, §14, §17 and the Phase 2 acceptance rows were reread. The Phase 1 + hardening work was checkpointed first as commit `3bf96b9` on `main`. Phase 2 was developed on branch `phase-2-performance`, uncommitted, because no commit was requested for this phase. No Phase 3+ work: no beta, alpha, tracking error, information ratio, benchmark statistics, covariance, risk contribution, diversification or construction.

Pre-flight: Phase 1 → Phase 2 contracts agree. The ledger already carries per-interval arithmetic returns, compounded wealth and prior-known `riskFreeReturn` with rate observation dates. Phase 1 `types/analytics.ts` pre-declared `Metric`, `PortfolioMetrics`, `RiskMetrics` and `DrawdownEpisode`. The plan assigns Phase 2 the "basic aligned benchmark wealth from Phase 1" for the comparison chart.

Ruling: Compute metrics once inside `simulate()` via pure modules and ship them on `BacktestResult.performance`, so replay from the snapshot reproduces them and React only formats. Phase 1 methodology is untouched. The engine change is purely additive (one field), and Phase 2 constants live in a separate `PERFORMANCE_METHODOLOGY` (`performance-v1`), so Phase 1 snapshot hashes are unchanged. Cost: about 1 MB more payload on the largest run; negligible against the 45 MB ledger.
Ruling: CAGR years = actual calendar days / 365.25, the plan's proposed denominator, documented separately from ACT/365 cash accrual. Short-period CAGR is kept with an "annualized from less than one year" label, per the plan. Cost: short windows show large annualized figures, clearly labelled.
Ruling: Volatility, Sharpe and Sortino require at least 2 returns and carry a short-sample note below 252. Dispersion at or below 1e-12 × the largest absolute observation counts as zero (scale-aware, per plan §22). Cost: a genuinely tiny but real dispersion below 1e-12 relative would read as zero; not reachable with market data.
Ruling: Sharpe and Sortino are unavailable unless every interval has a prior-known risk-free return; never computed on a subset (plan §5). Cost: a single missing rate hides both ratios for the run.
Ruling: Drawdown episodes follow plan §10 exactly: last equal high-water mark as peak, first minimum as trough, recovery at or above peak, never searched past the effective end, and durations measured peak → recovery in calendar days and sessions. Cost: none; this is the documented definition.
Ruling: The Growth of $10,000 benchmark overlay uses the Phase 1 continuous-overlap path (both normalized at the overlap start), with a toggle and an explicit note when the window is shortened. No benchmark statistics and no benchmark drawdown toggle; those belong to later phases. Cost: the §41 benchmark-drawdown toggle is deferred.
Ruling: Recharts 3.10.1 (the plan's proposed stack; React 19 compatible), pinned exact. Chart colors were validated with the dataviz palette checker against the #1e1e1d surface: portfolio #3987e5, benchmark #d95926; all six checks pass. Display-only min/max downsampling (at most about 640 points) always keeps the trough, extremes and annotated dates. Calculations use full series. Cost: measured +110 KB gzipped (+388 KB raw) client JavaScript versus the Phase 1 build (268 → 378 KB gzipped), mostly Recharts.

## Implemented

- `lib/utils/numerical.ts`: mean, two-pass sample standard deviation, scale-aware zero test.
- `lib/analytics/performance.ts`: cumulative return, elapsed years, actual-time CAGR.
- `lib/analytics/risk.ts`: annualized volatility, aligned excess returns, Sharpe, full-sample downside deviation, Sortino.
- `lib/analytics/drawdown.ts`: drawdown series, maximum drawdown, chronological episodes, ranking.
- `lib/analytics/summary.ts`: composes `PerformanceSummary` from the ledger. Attached in `lib/backtest/engine.ts`.
- `lib/charts/series.ts`: display-only downsampling, growth series selection, month-end table rows, axis ticks.
- UI: `components/metrics/{MetricStrip,InfoTip}.tsx` (seven-KPI strip; N/A with reason; methodology tooltips on hover and keyboard focus), `components/charts/{GrowthChart,theme}.tsx` (legend and toggle, direct end labels, crosshair tooltip, $10,000 reference line, accessible summary, month-end table, reduced-motion aware), and `components/drawdown/DrawdownLab.tsx` (the seven §41 statistics, drawdown area with shaded max episode and trough marker, month-end table, deepest-episodes table). Sections are renumbered 02 Overview, 03 Performance, 04 Drawdowns, 05 Historical ledger, 06 Current context. Methodology panel text was added.
- `scripts/provider-smoke.ts` now prints Phase 2 metrics.
- Docs: METHODOLOGY.md "Performance metrics" section and README.

## Verification

Final code: lint exit 0; strict typecheck exit 0; **151 tests across 16 files pass** (114 before Phase 2; 37 new: performance 11, drawdown 9, engine-level summary 8, components 9). The production build passes with the calendar guard. **Playwright 7/7** (2 new) against a freshly started production server; the port was verified free.

Independent cross-check: the live sample result was recomputed in plain Python from the raw ledger. Ending value, cumulative return, CAGR, volatility, Sharpe, Sortino, maximum and current drawdown agree within 1.4e-16, and the maximum-drawdown episode (peak 2021-12-27, trough 2022-10-14, recovery 2023-12-14, 717 calendar / 495 trading days) matches exactly.

Live sample workflow (`npm run smoke:providers`, 2026-09-29 UTC): effective 2021-09-28 → 2026-09-25, 1,253 returns, ending value $16,781.49, cumulative +67.81%, CAGR +10.93%, volatility 12.89%, Sharpe 0.57, Sortino 0.83, maximum drawdown −21.63%, current drawdown −1.20%. Treasury timing check conservative.

Manual in-app verification: a local production server (`PORTFOLIO_LAB_LOCAL_YAHOO=1`) running the sample portfolio showed the same KPIs in the in-app browser. The desktop (1320 px) and mobile (390 px) screenshots, captured headlessly against the same server because the pane was hidden, were reviewed: KPI strip, Growth of $10,000 with hover readout, drawdown chart with shaded episode and trough label, episode table, no horizontal overflow, and tooltips inside the viewport.

## Defects found during Phase 2 and fixed

- Reduced-motion hook assumed `window.matchMedia`, which crashed in jsdom and would crash in any browser lacking it. It now treats a missing API as "no preference".
- Hidden methodology tooltips occupied layout past the right edge, causing horizontal page scroll at 390 px. They now use `display: none` while hidden and open toward the inside of their column. A mobile anchor reset lost a specificity contest (0,2,0 vs 0,3,0); fixed with `:nth-child(n)`.
- Axis labels repeated ("Jan 2024 Jan 2024"); ticks are now month or year starts, at most 8. Drawdown ticks were uneven; they now use 1/2/5 × 10^k steps with float-safe labels.
- Volatility displayed a "+" sign; non-negative statistics are now unsigned.
- The KPI strip computed years in the component (`/ 365.25`); `elapsedYears` now comes from the analytics summary, so no convention lives in React.

No Phase 1 methodology bug was exposed. Phase 1 behavior and snapshot hashes are unchanged.

## Remaining risks and open decisions

- **Benchmark drawdown toggle (spec §41)** is deferred to benchmark work, per the scope instruction. The Growth chart's benchmark line is Phase 1 overlap wealth only.
- **CAGR day basis 365.25** is the plan's proposal; switching to 365 would be a `performance-v2` change.
- **Sortino minimum of 2 returns** is policy; the spec formula is defined for one observation.
- **Zero-dispersion tolerance (1e-12 relative)** is a documented engineering choice, not spec text.
- **Annualization by √252** assumes i.i.d. daily returns; weekend and holiday intervals count as single observations (spec convention). Displayed as a reporting convention with no significance claims.
- **Upstream revisions:** Yahoo adjusted closes vary in late decimals between fetches (about $0.001 on ending wealth between runs); rely on snapshot replay for exact reproduction.
- **Payload:** the performance series add about 1 MB to the largest (about 45 MB) run; server-side display summarization remains a later-phase option.
- Carried from Phase 1: no qualified deployed provider or Vercel deployment; the gates in DATA-PROVIDERS.md are unchanged.

Phase 2 stops here. Phase 3 has not been started.
