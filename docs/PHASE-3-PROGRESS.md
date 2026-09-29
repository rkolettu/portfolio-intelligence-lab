# Execution ledger — docs/IMPLEMENTATION-PLAN.md, Phase 3 only

Spec §28–33, §41, §55–56, §58 and §69–71, plan §8 (rules 5–7), §9, §12, §14, §17 and the Phase 3 acceptance rows, and PHASE-1/2-PROGRESS, DATA-PROVIDERS and METHODOLOGY were reread. Phase 2 was checkpointed as commit `fbd04d6` on `phase-2-performance`. Phase 3 was developed on `phase-3-benchmark`, uncommitted because no commit was requested for this phase. No Phase 4+ work: no covariance matrix, holding correlations, risk contribution, capital vs risk, diversification, return contribution, rolling statistics, stress tests or construction.

Pre-flight: Phase 2 → Phase 3 contracts agree. The ledger carries each interval's start/end, portfolio return and prior-known `riskFreeReturn`. The snapshot carries the benchmark's adjusted prices. `BenchmarkMetrics` was pre-declared in Phase 1 types. Plan §12 fixes the formulas and the separate guards for alpha and beta.

Ruling: One canonical alignment, `alignBenchmark` in `lib/backtest/alignment.ts`. An interval is aligned only when the benchmark has adjusted closes at both of its endpoints (plan §8.5, "match on the same interval"). No forward-fill and no bridging across a missing session. It exposes the comparison period, aligned count, interval-set hash, interior/leading/trailing exclusions and risk-free coverage. Cost: a single missing benchmark close removes two intervals from the relative sample.
Ruling: Rebuild the Phase 1 `benchmarkPath` as a view over that alignment rather than keeping a second date intersection. A randomized test against the verbatim Phase 1 implementation (300+ coverage patterns) proves identical output and errors. Replaying the live snapshot on the Phase 2 commit and on Phase 3 yields identical snapshot hash, ledger, growth path and performance. Cost: none observed; Phase 1 behavior is unchanged.
Ruling: All benchmark-relative metrics carry the identical `Sample` object. Alpha, regression beta and R² require a prior-known risk-free return for every aligned interval and are otherwise unavailable with the missing count. They are never re-estimated on a smaller sample. Cost: one missing rate hides alpha for the run.
Ruling: Beta is guarded on raw-benchmark variance; alpha on excess-benchmark variance (plan §12). They can diverge, and a test covers both directions. Correlation needs variance in both series and clamps only floating-point overshoot past ±1. Tracking error is 0 when active returns are constant; the information ratio is then unavailable. Minimums: 2 aligned returns, and 3 rows for the regression. Short-sample note below 252. The Phase 2 zero tolerance (1e-12 relative) is reused. Cost: policy thresholds are documented rather than spec text.
Ruling: The geometric comparison (both cumulative returns and CAGRs) and benchmark drawdown use the continuous rebased path and require continuous coverage (plan §8.7). The portfolio keeps its drifted weights. Benchmark drawdown reuses the unchanged Phase 2 drawdown functions. Cost: an interior benchmark gap disables these while leaving arithmetic statistics available on the matched intervals.
Ruling: Constants live in a separate `BENCHMARK_METHODOLOGY` (`benchmark-v1`); `METHODOLOGY` is untouched, so Phase 1 snapshot hashes are unchanged (verified). No R² standard errors or t-statistics (spec: not V1).

## Implemented

- `lib/backtest/alignment.ts`: `alignBenchmark` (canonical sample) plus `benchmarkPath` derived from it. `lib/backtest/engine.ts` computes the alignment once and passes it to the path and the summary (additive).
- `lib/analytics/benchmark.ts`: pure `beta`, `correlation`, `activeReturns`, `annualizedActiveReturn`, `trackingError`, `informationRatio` and `capmRegression` (alpha, slope, R²) over already-aligned arrays; no filtering inside.
- `lib/analytics/benchmarkSummary.ts`: composes `BenchmarkAnalytics` (comparison period, relative metrics, geometric comparison, risk-free coverage, benchmark drawdown). `lib/utils/numerical.ts` gains `sampleCovariance`.
- Types: `AlignedInterval`, `BenchmarkAlignment`, `ComparisonPeriod`, `SeriesDrawdown`, and `BenchmarkAnalytics` on `BacktestResult`.
- UI: `components/benchmark/BenchmarkSection.tsx` (section 04):
  - a summary row with benchmark, comparison period, aligned count and risk-free coverage;
  - a "Regression & co-movement" strip (Beta, CAPM alpha with regression β, Correlation, R²);
  - an "Arithmetic active returns" strip (Annualized active return, Tracking error, Information ratio);
  - a "Geometric comparison" table (cumulative return and CAGR, Portfolio vs ETF);
  - methodology tooltips on every metric.
- UI: Drawdown Lab (section 05) gains a Portfolio / SPY / Both radio group. Both mode shows the portfolio area plus the benchmark line, two statistics rows and a legend. Options are disabled with the reason when the benchmark path is unavailable, and there is a note when the benchmark window starts later. Portfolio drawdown is unchanged.
- UI refactor: a generic `KpiStrip`. `InfoTip` now computes its own width and offset so tooltips stay inside the viewport in any grid (replacing Phase 2's 7-column `nth-child` CSS). The mobile nav scrolls internally.
- Sections are renumbered 04 Benchmark, 05 Drawdowns, 06 Ledger, 07 Current context; nav, header, methodology panel, provider smoke, METHODOLOGY.md and README are updated.

## Verification

Final code: lint exit 0; strict typecheck exit 0; **187 tests across 20 files pass** (151 before Phase 3; 36 new: alignment 6, pure benchmark metrics 11, engine-level 13, components 6). The production build passes with the calendar guard. **Playwright 8/8** (1 new; 2 Phase 2 tests scoped to the overview strip) against a freshly started production server.

Sample portfolio (live, 2026-09-29 UTC, SPY): comparison period 2021-09-29 → 2026-09-28, 1,253 aligned returns, 0 excluded, risk-free coverage complete.

| Metric | Value |
| --- | --- |
| Beta | 0.7293 |
| Correlation | 0.9718 |
| CAPM alpha (annualized) | −0.363% |
| Regression beta | 0.7292 |
| R² | 0.9443 |
| Annualized active return | −3.17% |
| Tracking error | 5.56% |
| Information ratio | −0.571 |
| Cumulative return, portfolio / SPY | +66.16% / +88.42% |
| CAGR, portfolio / SPY | +10.70% / +13.52% |
| SPY max drawdown | −24.50% (peak 2022-01-03, trough 2022-10-12, recovered 2023-12-13; 709 calendar / 489 trading days) |

The 5-year window moved one session from Phase 2 because the calendar date advanced.

Independent verification: the live result was recomputed with Python's standard library (its own date alignment on SPY closes; `statistics.covariance`, `correlation` and `linear_regression`). All 8 relative metrics agree within 2.4e-15. The geometric comparison agrees within 6.4e-15, and the benchmark maximum drawdown matches exactly.

Snapshot replay: replaying the live response reproduces `benchmarkAnalytics` exactly. The same snapshot on the Phase 2 commit (git worktree) and on Phase 3 gives an identical snapshot hash, ledger, Phase 1 growth path and Phase 2 performance.

Manual in-app verification: the local production server (`PORTFOLIO_LAB_LOCAL_YAHOO=1`) running the sample in the in-app browser showed the values above. Toggling Both showed the portfolio and SPY statistic rows and chart series. Desktop (1320 px) and mobile (390 px) screenshots were captured headlessly against the same server because the pane was hidden, then reviewed: no horizontal overflow, tooltips inside the viewport.

## Defects found and fixed

- **Tooltip anchoring was layout-fragile.** Phase 2's `nth-child` rules assumed a 7-item strip, so 3- and 4-item strips would open tooltips off-screen. `InfoTip` now clamps width and offset from the trigger's measured position. The first JS version picked a side using a 260 px width while CSS used 240 px on mobile, and wrongly right-aligned; caught by the mobile e2e bound check and fixed by computing both in JS.
- **Mobile header overflow.** The added nav link overflowed at 390 px; the nav now scrolls within the header.
- **Drawdown legend** wrapped into a column in Both mode; the legend no longer shrinks.
- **Ambiguous e2e selectors** (`dl.kpi-strip` now matches three strips) were scoped to the overview.

No Phase 1 or Phase 2 methodology bug was exposed; both are unchanged and verified by cross-version replay.

## Remaining risks and open decisions

- **Alpha is a single-factor intercept** against a user-chosen ETF with latest-vintage DGS3MO accruals (modeled availability, not vintage-proven). It is not a skill or significance claim; no t-statistics.
- **Policy thresholds:** 2 aligned returns (3 for the regression) and the 1e-12 relative zero tolerance are documented choices, not spec text.
- **Interior benchmark gaps** leave arithmetic statistics on matched intervals but disable geometric comparison and benchmark drawdown. The comparison-period dates then span the gaps; the excluded count is displayed.
- **Late-starting benchmark in the drawdown view:** its running peak starts at the comparison start while the portfolio's is full-history. This is disclosed rather than recomputing portfolio drawdown in-window, which would change Phase 2 methodology.
- **Annualization** by 252 and √252 remains a reporting convention for irregular calendar gaps.
- Carried forward: no qualified deployed provider or Vercel deployment (DATA-PROVIDERS.md gates unchanged).

Phase 3 stops here. Phase 4 has not been started.
