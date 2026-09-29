# Execution ledger — docs/IMPLEMENTATION-PLAN.md, Phase 4 only

Spec §34–40 and §69–71, plan §8 (rule 6), §9, §11, §14, §17 and §22, the Phase 4 gate and acceptance rows, all prior progress ledgers, METHODOLOGY and DATA-PROVIDERS were reread. Phase 3 was checkpointed as commit `0da3fcb`; Phase 4 was developed on branch `phase-4-risk`, uncommitted because no commit was requested for this phase. No Phase 5+ work: no rolling statistics, stress tests, custom periods, optimizer, minimum-variance, inverse-volatility or risk-parity allocations, or sandbox.

Pre-flight: Phase 3 → Phase 4 contracts agree. The Phase 1 ledger records each interval's `holdingReturns` (adjusted-price ratios), `startWeights` (beginning-of-interval drifted/reset weights) and `contributions` (their product). Phase 1 coverage rejects interior gaps for positive-weight risky holdings. Phase 3's `beta` and benchmark alignment are reusable. The plan locks the 60/252 thresholds, the CASH convention, the acceptance fixtures and "no unexplained PD repair".

Ruling: One canonical risky-holding sample, `alignHoldings` in `lib/backtest/alignment.ts`, built from the ledger. An interval is kept only when every risky holding has a valid return on it (the same both-endpoints rule as Phase 3), so every covariance cell, correlation, volatility and contribution shares one observation set. No second price intersection is written. Cost: none for a valid backtest, whose sample equals the full ledger from the latest risky effective start.
Ruling: CASH stays outside Σ as locally riskless (plan §11). Risky target weights are not renormalized, CASH MRC/CRC/PCR are exactly 0, and HHI/effective holdings include CASH. The decomposition is labeled "Risk Contribution at Target Weights — CASH treated as locally riskless". Cost: CASH accrual variability appears only in realized (Phase 2) volatility.
Ruling: Thresholds are those already locked in plan §8 and spec §36: fewer than 60 common observations makes the whole covariance family unavailable, 60–251 is flagged limited, 252+ is normal. Capital concentration and return contribution remain available. Cost: short or new-holding portfolios show N/A risk decomposition.
Ruling: Numerical safety without silent forcing:
- The matrix is mirrored for exact symmetry.
- Jacobi eigenvalues check PSD; roundoff negatives of at most 1e-10 relative are tolerated, and larger ones make the family unavailable with the reason.
- Singular matrices are disclosed.
- `w′Σw` within 1e-12 relative is zero volatility, with contributions and DR unavailable; a materially negative value is an error.
- Constant holdings use the Phase 2 zero rule: volatility 0 and correlations null, not forced to 1.
- Correlations clamp only roundoff past ±1.
- Any `LabError` inside the covariance family becomes a typed unavailable state instead of failing the whole analysis.
Cost: thresholds are documented engineering choices.
Ruling: Return contribution reads the engine's recorded contributions, which use actual beginning-of-interval weights; the identity with the daily portfolio return is exact. The period figure is an arithmetic sum labeled "Daily / Period Arithmetic Return Contribution", never attribution. Cost: it does not add to the compounded cumulative return; the UI shows both.
Ruling: Holding beta reuses Phase 3's `beta` on the Phase 3 benchmark-aligned sample (plan §8: "may be shorter … must expose it"); a note carries its sample. CASH beta is unavailable because it is riskless. Cost: the beta sample can differ from the covariance sample.
Ruling: `RISK_METHODOLOGY` (`risk-v1`) is a separate constant; `METHODOLOGY` is untouched, so Phase 1 snapshot hashes are unchanged (verified by cross-version replay).

## Implemented

- Modules:
  - `lib/backtest/alignment.ts`: `alignHoldings`.
  - `lib/analytics/covariance.ts`: sample matrix, annualization, eigenvalues, PSD/symmetry diagnostics.
  - `correlation.ts`: matrix and extreme pairs.
  - `riskContribution.ts`: `w′Σw`, MRC/CRC/PCR, identity residuals.
  - `diversification.ts`: standalone vol, weighted vol, concentration.
  - `returnContribution.ts`.
  - `riskSummary.ts`: composer, attached once in `simulate()`.
- Display helpers: `lib/charts/diverging.ts` (OKLab blue ↔ red around the reference `#383835` midpoint; ink chosen for at least 4.58:1) and `lib/charts/riskDisplay.ts` (sorting, zero-anchored axis).
- UI section "04 / Risk":
  - summary row (decomposition, common sample, observations, risky count);
  - Risk overview strip (target σ with realized σ as footnote, weighted standalone vol, DR, effective holdings, top-3);
  - one sort control (Weight / Risk contribution / Volatility / Beta) scoping both the Capital vs Risk hero and the holding table;
  - the hero: capital and PCR bars on one zero-anchored axis, with negative contributions extending left;
  - holding risk table with weight, vol, beta, MRC, CRC, PCR and a totals row;
  - correlation heatmap (real table, values in cells, exact-value hover, dense mode above 10 holdings);
  - arithmetic return-contribution table;
  - methodology tooltips throughout.
- Later sections renumbered to 05–08; the nav, header, methodology panel, provider smoke, METHODOLOGY.md and README are updated.

## Verification

Final code: lint exit 0; strict typecheck exit 0; **233 tests across 25 files pass** (187 before Phase 4; 46 new: covariance/correlation 9, risk contribution and diversification 11, return contribution 5, engine-level risk 12, components and display helpers 9). The production build passes. **Playwright 9/9** (1 new; the mobile test also covers the risk section) against a freshly started production server.

Sample portfolio (live, SPY benchmark): common sample 2021-09-29 → 2026-09-28, 1,253 observations across SPY/QQQ/IWM/BND/GLD, status normal.

| Holding | Weight | Volatility | Beta | MRC | CRC | PCR |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 40.00% | 17.19% | 1.00 | 16.72% | 6.69% | 51.63% |
| QQQ | 15.00% | 23.00% | 1.27 | 21.75% | 3.26% | 25.18% |
| IWM | 10.00% | 22.38% | 1.11 | 19.67% | 1.97% | 15.18% |
| BND | 20.00% | 6.06% | 0.08 | 2.10% | 0.42% | 3.25% |
| GLD | 10.00% | 18.91% | 0.17 | 6.16% | 0.62% | 4.76% |
| CASH | 5.00% | 0.00% | N/A | 0.00% | 0.00% | 0.00% |

- Target-weight σ 12.955% (realized Phase 2 volatility 12.90%).
- Weighted standalone volatility 15.665%; diversification ratio 1.209.
- HHI 0.245; effective holdings 4.08; largest SPY 40%; top-3 (SPY, BND, QQQ) 75%.
- Highest correlation SPY/QQQ 0.950; lowest QQQ/GLD 0.151.
- Identity residuals: ΣCRC − σ 2.8e-17; ΣPCR − 1 2.2e-16.
- Arithmetic return contribution: SPY +27.97, QQQ +12.99, GLD +9.34, IWM +4.12, CASH +0.95, BND −0.46 pp; total +54.91 pp (sum of daily returns) vs +66.16% compounded; daily identity residual 0.

Independent verification: plain Python recomputed from the snapshot's raw prices, with its own session alignment, `statistics.covariance`/`correlation`/`stdev` and hand-written matrix algebra; no production code called. Maximum absolute differences:

| Quantity | Max diff |
| --- | --- |
| Annual covariance | 1.0e-16 |
| σ | 5.6e-17 |
| MRC | 2.5e-16 |
| CRC | 9.7e-17 |
| PCR | 5.6e-16 |
| Correlation matrix | 2.1e-15 |
| Standalone volatility | 2.8e-16 |
| Weighted volatility | 8.3e-17 |
| Diversification ratio | 2.2e-16 |
| Effective holdings | 0 |
| Risky return contribution | 1.9e-16 |

The extreme pairs match.

Snapshot replay: the live response replays to an identical `riskAnalytics`. The same snapshot on the Phase 3 commit (git worktree) and on Phase 4 yields an identical snapshot hash, ledger, growth path, Phase 2 performance and Phase 3 benchmark analytics.

UI review:
- The in-app browser on the live local production server showed the values above.
- Desktop (1320 px) and mobile (390 px) screenshots, captured headlessly against the same server because the pane was hidden, were reviewed: no horizontal overflow; the mobile Capital vs Risk rows stack values under the bars; the tables scroll within their containers.
- A live 15-holding portfolio (SPY … XLV) rendered a readable 15 × 15 dense heatmap with positive, near-zero and negative correlations (IEF/XLE −0.13) and no page overflow.

## Defects found and fixed

- `capitalRiskScale` added a spurious negative axis segment for all-positive values: the floor epsilon had the wrong sign. Caught by a unit test.
- Heatmap cell ink could fall to 4.40:1 at mid-tones with the app's warm inks; it now uses white or black ink, which guarantees at least 4.58:1 (tested across the scale).
- A correlation rounding to zero printed as `-0.00` (seen live on the 15-holding heatmap); it now prints 0.00.
- A covariance-family `LabError` would have failed the entire analysis; it is now contained as a typed unavailable state.
- An e2e test title claimed heatmap coverage its fixture could not exercise; it was renamed, and the heatmap tooltip is covered by component tests and live review.

No Phase 1–3 methodology bug was exposed; all prior outputs are unchanged by cross-version replay.

## Remaining risks and open decisions

- **Sample covariance** is noisy, especially for 60–251 observations and many holdings; no shrinkage or EWMA (spec: optional future). Singular matrices are disclosed but not regularized.
- **Target-weight snapshot vs realized:** the decomposition is a model at configured weights. A realized, time-varying-weight risk contribution is a spec "optional future" and not implemented.
- **CASH as riskless** ignores accrual variability in the decomposition, by the documented convention.
- **Holding beta** may use a shorter benchmark-aligned sample than the covariance sample; it is disclosed per cell.
- **Arithmetic return contribution** does not sum to the compounded return, as labeled; no linked or Brinson attribution.
- **Heatmap scale:** readable through 15 holdings; 16–20 relies on dense cells and horizontal scroll.
- **Tolerances:** 1e-12 zero variance and 1e-10 eigenvalue tolerances are documented engineering choices.
- Carried forward: no qualified deployed provider or Vercel deployment.

Phase 4 stops here. Phase 5 has not been started.
