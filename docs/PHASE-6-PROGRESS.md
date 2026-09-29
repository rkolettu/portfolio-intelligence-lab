# Execution ledger — docs/IMPLEMENTATION-PLAN.md, Phase 6 only

The user's Phase 6 brief (methodology locked after an independent review) is the binding specification for this phase, together with spec §48–54, §58, §69–70, §73 and plan §9, §13, §17 and the Phase 6 rows. The nine required documents were read in full earlier in this session and are unchanged since; Phase 5 was checkpointed as `6af295d` and Phase 6 is developed on `phase-6-construction`. Phase 1–5 methodology is not changed. No expected-return optimization, Maximum Sharpe, mean-variance frontier or AI. No Phase 7 polish.

Pre-flight: Phase 5 → Phase 6 contracts.
- `simulate()` is pure and re-initializes at target weights on the requested start, so current and proposed portfolios can be backtested on one frozen snapshot and one start date.
- `runStress()` is pure over a snapshot, so both portfolios can be stressed on identical event data.
- `portfolioCoverage()` enforces the common-session rules (no forward-fill, no bridging, explained late starts) but only for positive-weight holdings.
- Phase 4 `riskContributions()` and `weightedAverageVolatility()` are pure over any matrix and weights.
- The Phase 1 placeholder `ConstructionResult` (`converged: boolean`) has no consumers and is replaced.

Pre-flight defects to fix under the brief's "harden the existing matrix-validation path" (each needs a failing test first):
- Phase 4 `covarianceDiagnostics` never checks dimensions or finiteness: a NaN diagonal flows into NaN eigenvalues that pass the PSD comparison.
- Its Jacobi stopping rule uses an absolute floor (`off ≤ 1e-30 × max(1, Σ a_ii²)`), so a matrix at scale ~1e-20 stops before any rotation, and an indefinite matrix reads as PSD.
- Eigensolver non-convergence is silent.

Pre-flight: `toDraft` rounds weights to 1e-8 percent. After normalization, a weight on a bound can land about 1e-9 outside it, beyond the locked 1e-10 bound tolerance, so Apply cannot reuse it.

Pre-flight: the analysis fetches only positive-weight holdings, while the construction universe must include zero-weight eligible assets. Construction therefore needs its own server request and snapshot, like Phase 5 stress.

Ruling: Construction runs through its own `/api/construction` request. One request freezes the inputs (universe, bounds, CASH, analysis snapshot) and solves all four methods on the same estimation sample and covariance. The method selector then chooses which proposal to view without re-solving, so every method's comparison uses identical inputs. Cost if wrong: the response carries four proposals instead of one.
Ruling: The eligible universe is every risky ticker in the analyzed configuration, zero-weight rows included; CASH is excluded. To add a candidate, the user adds it as a 0% holding and re-runs the analysis. The estimation window is the analysis's requested period; its effective start is the latest first valid session across the whole universe (Phase 1 coverage rules applied to every eligible asset). Cost if wrong: no separate estimation-window editor in V1.
Ruling: Canonical ordering: all construction arithmetic runs on tickers sorted lexicographically, and results are mapped back to configuration order for display. Reordering holdings therefore gives bitwise-identical weights (tested). Cost if wrong: none.
Task 1: complete (hardened `lib/analytics/matrix.ts`: finite/square/scale-aware symmetry/PSD/rank checks, Jacobi with eigenvectors, a relative convergence rule and explicit non-convergence; Phase 4 `covarianceDiagnostics` delegates to it. The three pre-flight bugs were reproduced on the unmodified code (NaN diagonal accepted, 1e-20-scale indefinite matrix accepted as eigenvalues +1e-20/+1e-20, non-square accepted), then RED→GREEN. Tests: npx vitest --run → 301/301. Replay of the live Phase 5 snapshot through the new code is bitwise identical to Phase 5 for the hash, ledger and every Phase 2–5 analytics block, eigenvalue diagnostics included.)
Ruling: Ledoit–Wolf δ is computed exactly as published, on the n-denominator sample covariance (m = tr(S_n)/N, d² = ‖S_n − mI‖², b̄² = n⁻² Σ_k ‖x_k x_kᵀ − S_n‖², δ = min(b̄², d²)/d², with ‖A‖² = tr(AAᵀ)/N). δ is a ratio of quantities that scale together, so it is independent of the n versus n − 1 convention. It is applied to the Phase 4 n − 1 sample covariance with μ = tr(S)/N; the result is the published estimator × n/(n − 1), the lab's uniform convention. δ = 0 when d² = 0 (already a scaled identity, or one asset). Cost if wrong: none; the reconciliation is exact and tested.
Task 2: complete (`lib/analytics/shrinkage.ts`. The independent fixture was generated in Python from the paper's per-observation definitions and cross-checked against the aggregated scikit-learn-style formula: δ = 0.35854311296390456, the two agreeing to 2e-16. TypeScript matches δ to 14 digits and every entry to < 1e-12 relative after the n/(n − 1) rescaling. Also covered: determinism, δ invariance to rescaling returns, δ = 0 for a scaled-identity sample and for one asset. Tests: npx vitest --run tests/analytics/shrinkage.test.ts → 5/5; RED observed as missing module.)
Ruling: Bounded budget projection is exact, not iterative. The solution has the closed form w_i = clip(r_i − τ, l_i, u_i); τ is found on the sorted breakpoints of the nonincreasing piecewise-linear Σ clip(r_i − τ), then solved in closed form on the crossing segment. Singleton sets (B = Σl or Σu) return the bound vector exactly; a feasible reference is returned unchanged. Constrained Equal Weight, constrained Inverse Volatility and every solver step reuse this one function. Cost if wrong: none; tested against hand solutions, including one where clip-and-renormalize differs.
Ruling: Certification is solver-independent and uses separate versioned tolerances (`CONSTRUCTION_METHODOLOGY.tolerances`): budget/bound 1e-10; matrix symmetry/PSD 1e-10 relative; stationarity 1e-8 for both the gradient-mapping residual ‖w − P(w − s∇f)‖∞/B and a multiplier-based KKT residual (free g_i = ν, lower-bound g_i ≥ ν, upper-bound g_i ≤ ν); ERC parity 1e-6 on max |PCR_i − 1/N|; internal solver target 1e-14. Cost if wrong: thresholds are engineering choices, recorded centrally.
Tasks 3–4: complete (`CONSTRUCTION_METHODOLOGY`, typed construction contract replacing `converged: boolean`, `lib/analytics/optimization.ts`; tests: npx vitest --run tests/analytics/optimization.test.ts → 13/13, including the brief's infeasible case (CASH 20%, two risky caps of 35%: 70% capacity < 80% budget); RED observed as missing module; typecheck clean)
Ruling: Minimum variance uses FISTA projected gradient with O'Donoghue–Candès gradient restart. The step is 1/L with L = 2λmax from the validated eigen-decomposition, each step is an exact projection, and it starts from the constrained equal-weight allocation. Only after the gradient phase certifies does an active-set polish solve the KKT system exactly on the identified free set; it is kept only if feasible and at least as stationary with no worse objective. It never rescues an iteration-exhausted run and never clips. Cost if wrong: none observed.
Ruling: Tie rule for nonunique minimum variance (singular Σ only): every optimum shares Σw (strict convexity along range(Σ)), so the optimal set is the polyhedron F ∩ (w* + null(Σ) ∩ 1⊥). Dykstra's alternating projections pick its point nearest the constrained equal-weight allocation, and it is accepted only if certified with objective within 1e-12·λmax·B² of the optimum. With Ledoit–Wolf δ > 0 the construction matrix is positive definite, so the rule applies only to degenerate inputs. Cost if wrong: an alternative tie rule would pick a different, equally optimal allocation.
Ruling: ERC minimizes Σ(PCR_i − 1/N)² by projected gradient with Armijo backtracking and Barzilai–Borwein steps (normalized by B²), over the deterministic starts in fixed order: constrained equal weight, constrained inverse volatility, current allocation when feasible. A start with zero portfolio variance is skipped as outside the domain; N is fixed before solving. The best certified start wins (objective, then parity, then order). Certification (stationarity and KKT ≤ 1e-8) and parity (≤ 1e-6) are reported separately; certified with parity above tolerance is `converged_but_parity_not_achieved`, labeled Constrained Risk-Balance Approximation. No global-optimality claim is made. Cost if wrong: a better local optimum could exist beyond the three starts.
Tasks 5–7: complete (`lib/analytics/construction/{common,equalWeight,inverseVolatility,minimumVariance,equalRisk}.ts`; tests: npx vitest --run tests/analytics/construction.test.ts → 19/19; RED observed as missing modules. One test fixture was wrong: an "interior" minimum-variance matrix whose unconstrained solution shorts asset 0. It was replaced by a true interior case and a long-only case checked against the reduced closed form [0, 0.2340, 0.7660], where KKT holds (asset 0 gradient 0.01762 ≥ multiplier 0.01743). Diagnostics: MV diag(0.04, 0.01) → [0.16, 0.64] in 27 iterations, residuals ≤ 3e-17; ERC → [0.8/3, 1.6/3] in 7 iterations, parity 1.7e-16.)
Ruling: Estimation sample = Phase 1 `portfolioCoverage` applied to the whole eligible universe (every asset given a nominal positive weight for coverage only), over the analysis's requested period and finalized cutoff. An unexplained gap or missing history fails construction explicitly rather than dropping the asset. < 60 common returns: IV/MV/ERC `insufficient_history` while Equal Weight stays available; 60–251: Limited History; ≥ 252: normal (sample size only). Zero-volatility risky assets (Phase 2 dispersion rule on raw returns) make IV/MV/ERC `invalid_inputs`, naming the assets. Cost if wrong: none observed.
Ruling: Current vs Proposed comparison. Both target allocations are simulated with the unchanged Phase 1 engine from the estimation sample's first session (set by the latest eligible asset, so a later-listing candidate moves both starts), on the same prices, Treasury series, sessions and benchmark. Construction Model Risk evaluates both on the same Σ_construction via the Phase 4 Euler functions. Stress runs the unchanged Phase 5 `runStress` for each allocation on the same snapshot; an event compares only if both portfolios cover it, i.e. the union of holdings, otherwise it is Incomplete Historical Coverage listing the missing tickers. Cost if wrong: none observed.
Ruling: CASH appears in proposals whenever it is in the current allocation or the fixed CASH weight is positive; B = 1 − fixed CASH. Minimum-variance polish must satisfy bounds exactly, not merely within 1e-10, because the builder schema rejects even −1e-18. Every other path already ends in the exact projection. Cost if wrong: none.
Tasks 8–9: complete (`lib/analytics/turnover.ts`, `lib/analytics/construction/modelRisk.ts`, `lib/backtest/construction.ts` `runConstruction`; tests: npx vitest --run → 356/356 across 39 files; RED observed as missing modules. The brief's cases are covered: zero-weight eligible asset included and constraining the start; fixed CASH; determinism and holding-order invariance (bitwise); infeasible for every method without relaxation; zero-volatility asset; < 60 observations; pinned current allocation giving identical paths and zero turnover, with ERC honestly an approximation; the same comparison start; union stress coverage; union turnover; same-Σ model risk; Treasury outage; exact replay; out-of-universe constraint rejected. Lint and typecheck clean.)
Defect (Phase 1, exposed by Phase 6 replay): `parsePortfolio` rescaled weights by their floating-point total unconditionally, so parsing was not idempotent. 0.6 + 0.3 + 0.1 = 0.9999999999999999: three successive parses gave three different weight vectors, and the documented replay `simulate({...snapshot, config: result.config})` produced a different snapshot hash and ledger for such portfolios. The same applied to stress and construction replay. It was reproduced on the unmodified code. Fix: skip rescaling when |total − 1| ≤ 1e-13 (floating-point noise, far below the 1e-6 input tolerance); a genuine accepted residual is still normalized, once. Tests `normalizes weights idempotently …` and `replays exactly from result.config …` RED → GREEN; suite 364/364. Portfolios whose weights sum to exactly 1 (the sample included) are bitwise unchanged; the live sample replay remains identical to Phase 5. Cost if wrong: for noise-level totals, weights stay as entered instead of being rescaled by ≤ 1e-16 relative.
Task 10: complete (`lib/validation/construction.ts`, `lib/server/construction.ts`, `app/api/construction/route.ts`; tests: npx vitest --run → 364/364; RED observed as missing module, then the replay-hash failure that exposed the normalization defect above. Covered: zero-weight tickers fetched with the analysis's cache keys and the Stress Lab's preset span, an eligible-asset fetch failure surfaced with its ticker (never dropped), benchmark outage isolated to relative metrics, current quotes having no effect, request-shape/duplicate/out-of-universe validation, the provider gate, exact replay. Lint clean.)
Task 11: complete (`lib/state/construction.ts`: default draft, request plus client feasibility, input key, `fullPrecisionPercent`, revalidating `applyProposal`; shared `tests/fixtures/construction.ts`; tests: npx vitest --run tests/components/constructionState.test.ts → 7/7; RED observed as missing module. Covered: no mutation of the current builder or config; binding 35% caps preserved through the percent round trip; stale after constraint, CASH or analysis changes; tampered or unusable proposals refused. My own round-trip test tolerance was corrected from 1e-17 to 1e-15: ×100 then ÷100 each round, giving about 1e-16 absolute near 1. It stays five orders below the 1e-10 constraint tolerance.)
Ruling: UI. Section 09 Portfolio Constructor follows the Stress Lab (spec §63) and is keyed per analysis result. Controls:
- A method selector: a view choice, since one generation solves all four.
- B per-asset min/max/required table, with zero-weight candidates tagged.
- C CASH fixed at current or at an explicit weight.
- Client feasibility errors before any request, then Generate.

Outputs:
- the proposed-allocation table (current, proposed, difference, binding tag) and Estimated One-Way Turnover;
- Apply, disabled when stale;
- Construction Model Risk on Σ_construction, kept separate from Historical Risk Analysis;
- a Historical comparison under an "IN-SAMPLE RETROSPECTIVE ANALYSIS" note, with a Current vs Proposed chart;
- a Stress comparison on union coverage, and an all-methods table;
- solver and covariance internals in a collapsed panel, and the exact required disclaimer.

"Proposed" uses dataviz slot-3 aqua #199e70 beside portfolio blue (CVD ΔE 19.6, normal ΔE 20.9 on #1e1e1d). Apply goes through the workspace's `edit(replace)`, which persists the draft and marks the analysis as belonging to the previous allocation. Cost if wrong: visual only.
Ruling: The product is renamed "Portfolio Intelligence & Construction Lab" (h1, page title, footer, README), as plan §2 and §23 schedule for when construction ships; the header reads "/ Construction" with a Constructor nav link; later sections are renumbered 10 (ledger) and 11 (current context). Cost if wrong: labels only.
Tasks 12–13: complete (`components/construction/{ConstructionSection,ProposalView,ComparisonChart}.tsx`, workspace/nav/CSS; tests: npx vitest --run → 379/379; RED observed as missing module; two over-broad test queries were tightened. npm run build passes with `/api/construction` registered and the session calendar absent from client chunks. npx playwright test → 13/13 on a fresh production server (2 new: the constructor workflow with stale guard and full-precision Apply, and constructor mobile overflow).)
Defect (found in the live sample review): `bindingConstraints` reported lower bounds only when positive, so minimum variance placing QQQ and IWM at the long-only 0% floor showed "no binding constraints", understating what drives the result. Fix: the 0% floor counts as binding (and the UI tags it "at 0% floor"). Test `reports an asset held at the long-only 0% floor as binding` RED → GREEN.
Ruling: Economically strange but valid outputs are explained, never replaced. Each proposal carries plain `observations`: assets at the 0% floor, minimums or caps; fixed positions; any asset receiving over 50% of the risky budget; negative risk contributions under Σ_construction; one-way turnover over 50%; and for minimum variance always "Lower modeled variance does not imply better returns, smaller future drawdowns or suitability." Tests RED → GREEN (`proposalObservations`, orchestrator); suite 382/382. Cost if wrong: the 50% thresholds are presentation choices.
Verification — independent (numpy + stdlib, no production code) on the live sample, default and constrained (caps 30%, GLD required ≥ 5%, CASH fixed 10%). It rebuilt the common sample (2021-09-29 → 2026-09-28, n = 1,253), Ledoit–Wolf from the paper's outer-product definitions, the projection by bisection, minimum variance by exhaustive active-set enumeration (3⁵ free/lower/upper combinations), unconstrained ERC by Spinu's convex Newton method, and bounded ERC by a separate numerical-gradient projected gradient. Max |diff|:

| Quantity | Max |diff| |
| --- | --- |
| δ | 1.7e-17 |
| Σ_construction | 6.9e-17 |
| Condition numbers | 1.8e-12 |
| Equal weight | 0 |
| Inverse volatility | 1.1e-16 |
| Minimum variance | 1.7e-16 |
| ERC (Spinu) | 1.9e-15 |
| ERC parity vs 1/N | 1.9e-15 |
| Bounded ERC | 1.4e-11 |
| Turnover | 1.1e-16 |
| Model volatility | 2.8e-17 |
| Model PCR | 1.7e-16 |
| Model CRC | 1.4e-17 |
| Current model risk | 1.1e-16 |
Defects from UI review (layout only, verified by viewport screenshots): the global text-input styling enlarged the Required checkboxes and CASH radios, and wrapped "Fixed at current" across three lines (compact scoped styles fixed both). The Binding-constraints KPI said "min" for 0% floors; the new `bindingSummary` helper (RED → GREEN) now words them "0% floor" consistently. The "Skip to portfolio builder" text seen in stitched element captures is a capture artifact: in a real viewport the link sits at y = −100 until keyboard focus.
Verification — live: provider smoke passes (analysis, rolling, stress and construction; Treasury timing conservative). Sample construction: δ = 0.01076; condition number 83.85 → 66.78; 0.6–1.7 s; 1.2 MB. Replay reproduces the hash and proposals; repeated runs are identical. Constructor reviewed at 1320 px and 390 px on the local production server (default and constrained runs): no overflow, no NaN/Infinity, no recommendation language, end labels present, stale guard shown, constrained ERC labeled Constrained Risk-Balance Approximation.
Final gate (final code): lint exit 0, typecheck exit 0, 384/384 unit and component tests, production build passes (calendar guard; `/api/construction` registered; no calendar in client chunks), Playwright 13/13 on a fresh production server.
Final review: not performed. The session's usage limit was reached before an independent whole-branch review; the work is uncommitted on `phase-6-construction`.

Phase 6 stops here. Phase 7 has not been started.

## Adversarial review fixes (after the first Phase 6 pass)

An independent adversarial review reported five findings plus Apply revalidation gaps. Each is fixed below with a regression test that failed first. Scope is limited to those findings: no Phase 7 work, no broad redesign.

Review fix M3 (extreme-scale PSD): `jacobiEigen` computed ‖A‖²_F and its off-diagonal mass on raw entries. At finite scales like 1e-200 or 1e200 the squares underflowed to 0 or overflowed to ∞, so the relative stopping rule passed before any rotation, and the indefinite [[1,2],[2,1]]·s was accepted with its diagonal as eigenvalues. Reproduced RED at 1e±100…1e±300. Fix: normalize by an exact power of two (2^⌊log₂ max|a_ij|⌋) before any convergence arithmetic, rescale eigenvalues on return, and report non-finite intermediates as non-convergence. Power-of-two scaling is exact, so normal-scale matrices take bit-identical rotations; the live Phase 5 snapshot still replays bitwise identically. Tests: indefinite rejected and [[2,1],[1,2]]·s accepted with eigenvalues s·{1,3} for s ∈ {1e-300, 1e-200, 1e-100, 1, 1e100, 1e200, 1e300}; Jacobi eigenvalues at 1e±250.
Review fix C1 (ERC false certification): certification used first-order stationarity only. On the review's Σ = [[1,0,−2/3],[0,1,−2/3],[−2/3,−2/3,1]], with equal-weight, inverse-volatility and current starts all coinciding at 1/3, the solver accepted equal weight after zero iterations. That point is a saddle, with PCR [1, 1, −1] and F = 2.667, and the solver then claimed "the constraints prevent equal risk contributions", although exact ERC (29.5209%, 29.5209%, 40.9581%) is feasible. Reproduced RED on the unmodified solver. Fix:
- **Second-order check.** At every first-order-stationary endpoint, `ercSecondOrder` builds the Hessian of F by central differences of the analytic gradient. It takes the minimum eigenvalue of the reduced Hessian on the free subspace {d_bound = 0, Σd = 0} (Helmert basis) and probes one-sided directions into weakly active bounds (normalized multiplier ≤ 1e-6). Normalized curvature (× B²) below −1e-6 is a feasible negative-curvature direction.
- **Escapes.** Such a saddle is escaped along that direction (up to 10 escapes per start) and projected gradient resumes. A start certifies only if first-order (stationarity and KKT ≤ 1e-8) AND second-order verified.
- **Distinct starts.** Starts within 1e-9·B of an earlier start are recorded "Coincides with …" and not run again. Deterministic distinct starts are added: the log-barrier risk-budget allocation (Spinu's convex formulation, used only as an initializer; the objective and its certification are unchanged) projected onto the bounds, and one tilt per asset (projection of B(1 + e_k)/(N + 1)).
- **Wording.** Infeasibility of exact parity is claimed only when proven: Σ is positive definite (so the long-only ERC allocation is unique) and that allocation, scaled to B, breaks a bound, which the message names. Otherwise: "Exact risk parity was not achieved by the solver under the selected constraints … It has not been shown that the constraints make exact parity impossible."

Tests (RED → GREEN): negative curvature detected at the saddle and not at the solution; the counterexample now reaches exact ERC (parity ≤ 1e-6, ≥ 1 escape, the selected start second-order verified); coincident starts recorded and ≥ 2 distinct added starts run; deterministic repeat; the proven-infeasible cap case gets the strong message naming "B at 53.33%"; the singular hedge gets safe wording only.
Ruling (C1): Three older tests were updated because the start set changed by design: the IV-vs-ERC start count, the hedge's coincident second start, and the forced-exhaustion case, which now uses a binding cap because with open bounds the log-barrier start is already the exact solution. A zero covariance replaces the hedge as the "no start in domain" fixture. The orchestrator passes canonical tickers so tilts read `tilt_<ticker>`. Cost if wrong: none; the intent of each test is preserved.
Review fix H2 (stale proposals after builder edits): the proposal key covered only the analysis hash, constraints and CASH choice. A proposal made for one benchmark or start date still applied after the builder changed, and Apply replaced the builder's holdings, overwriting newer holding edits. Fix:
- **Consistency gate.** `builderConsistency` requires the builder's validated configuration to equal the analyzed configuration canonically (holdings, weights, CASH, benchmark, dates, CASH policy).
- **Key.** It now covers the analysis hash, the analyzed configuration, the builder configuration at generation, the constraints and the CASH choice.
- **Generate** is disabled, with the reason shown, while the builder differs from the analysis.
- **`applyProposal` enforces it itself.** It re-checks builder consistency (a stale key from the caller does not help), the key, and the full revalidation: each universe ticker present exactly once, CASH present when expected, no unknown tickers, frozen bounds and the current editor bounds, then the post-conversion round trip.
- **In-flight edits.** A response keeps the key captured when its request was sent, so edits made while it was outstanding leave it stale and unappliable.

Tests RED → GREEN: builder benchmark, start-date, holding, weight and CASH edits each block Apply at the state layer; a changed builder yields a different key; missing CASH, a missing holding, an unknown holding and tighter current bounds are refused; a valid unchanged proposal still applies with full precision; the UI disables Generate for an inconsistent builder; an edit during an outstanding request leaves the returned proposal stale with Apply blocked; an edit after generation blocks Apply.
Review fix M4 (20 risky holdings + CASH): validation capped holdings at 20 rows including CASH, so a valid 20-risky construction with a fixed CASH weight produced a 21-row proposal. The unwrapped stress comparison then threw and failed the whole request; the backtest and Apply were rejected too. Reproduced RED (the fixed-CASH case failed inside `runStress`). Rule chosen, as the review preferred: **at most 20 risky holdings plus CASH**, which never consumes a risky slot, consistent with CASH's special-asset treatment everywhere else. It is applied across every consumer:
- `parsePortfolio` counts risky holdings (the `METHODOLOGY.maxHoldings = 20` value is unchanged, so no snapshot hash moves), with a clear message and only a generous anti-abuse bound in the schema;
- the builder adds up to 21 rows and shows "n / 20 risky + CASH";
- the stored-draft schema allows 21 rows;
- the quotes route accepts 22 tickers (20 risky, CASH, benchmark);
- the construction request allows 20 risky constraints.

Construction also wraps the stress comparison so any `LabError` becomes typed unavailable events and never crashes the request. Tests RED → GREEN across layers: validation (20 risky + CASH accepted, 21 risky rejected with the message), builder cap and restore, 22 quote tickers accepted and 23 rejected, maximum-portfolio construction end to end, a fixed-CASH append to 20 risky with comparison and stress intact, one above the maximum giving a typed INVALID_INPUT (orchestrator and server), and Apply of a maximum proposal.
Ruling (M4, performance): the added ERC starts exposed a cost. On a 20-asset portfolio two tilt starts ran to the 50,000-iteration cap although already certified, chasing the internal 1e-14 target below floating-point noise (2.7 s). ERC now stops at a precision floor (no residual improvement for 2,000 iterations while within the 1e-8 certification threshold), matching the minimum-variance rule: 0.49 s, same certified results. A RED test first exposed a test defect of my own (an unbounded `while` in the builder test hung the suite against the old reducer cap); it was bounded. Cost if wrong: none; certification thresholds are unchanged.
Review fix M5 (100% CASH): with an empty risky universe, the comparison window came only from risky coverage ("no eligible risky assets"), so the backtest was unavailable. Model risk was unavailable too, and with zero-weight candidates plus 100% CASH, inverse volatility and minimum variance reported `insufficient_history` for a problem needing no risky history. Reproduced RED. Fix:
- B = 0 is explicit. Equal weight, inverse volatility and minimum variance are the all-CASH allocation (label "All-CASH Allocation (zero risky budget)") without any risk-model gate. ERC is `invalid_inputs`: "no risky allocation and no risk-budget problem".
- An allocation with no risky exposure gets an explicit zero-risk model: volatility 0, no risky contributions, and a new `cash: {weight, contribution: 0}` field on every available model-risk result, shown as a CASH row "outside Σ".
- The comparison window always comes from Phase 1 `portfolioCoverage`. With no risky holdings that is the session calendar (the existing all-CASH rule), so the Treasury CASH path is compared without inventing risky history. Missing Treasury history yields the existing typed `TREASURY_UNAVAILABLE` reason.

Tests RED → GREEN: 100% CASH with Treasury (all-CASH proposals, ERC unavailable, zero model volatility, identical current/proposed paths, stress complete, exact replay); 100% CASH without Treasury (typed Treasury reason); a positive risky minimum making all-CASH infeasible; zero-weight candidates with 100% CASH and < 60 observations still giving all-CASH (not insufficient history).

### Verification after the review fixes

Run on the final uncommitted tree.
- **Unit and component tests:** 412/412 across 43 files.
- **Playwright:** 13/13.
- **Lint, typecheck and build:** all clean. `/api/construction` is registered.
- **Live smoke:** passed. Treasury `modelConservative` is true. Stress: GFC −37.02%, COVID −23.02%, 2022 −16.79%.
- **Live construction:** 623 ms. δ = 0.010758. EW, IV, MV and ERC all succeed.
- **Constrained live case:** ERC is labeled a Constrained Risk-Balance Approximation. The message proves infeasibility: exact ERC would need BND at 44.21%, above its 30% cap.
- **Independent verification** (`verify6.py`, NumPy reimplementation), largest differences:

  | Check | Max difference |
  |---|---|
  | δ | 8.2e-17 |
  | Σ_construction | 1.0e-16 |
  | κ | 4.5e-12 |
  | EW | 0 |
  | IV | 3.3e-16 |
  | MV | 3.3e-16 |
  | ERC against Spinu | 3.6e-16 |
  | Parity | 6.4e-16 |
  | Turnover | 5.6e-17 |
  | Model volatility | 4.2e-17 |
  | PCR | 3.9e-16 |
  | CRC | 4.9e-17 |
  | Bounded ERC against an independent projected-gradient solve | 3.7e-10 |

- **ERC counterexample** (Σ = [[1,0,−2/3],[0,1,−2/3],[−2/3,−2/3,1]], EW, IV and current all at 1/3):
  - Result: `success` with 29.5209% / 29.5209% / 40.9581%, parity 1.3e-15.
  - At 1/3 the check finds curvature −648 and detects the saddle.
  - The equal-weight start escapes once and certifies. IV and current are recorded as coinciding with it and are not rerun.
  - The log-barrier and three tilt starts all certify, second-order verified.
- **Determinism:** the counterexample and both live construction snapshots (default and constrained) give byte-identical output when run twice. Snapshot replay reproduces the stored `snapshotHash` and proposals exactly.
- **Phase 1–5 regression:** the replay of the live Phase 5 snapshot is identical to the pre-Phase-6 capture for every section.

### Remaining Phase 6 risks (superseded by the list after the second review)

- **ERC is local, not global.** Under binding bounds the equal-risk objective is nonconvex. Certification is local: first-order conditions plus second-order curvature from a finite-difference Hessian. Multistart makes a missed better stationary point unlikely, but not impossible.
- **Second-order check is a necessary condition only.** Directions with curvature inside the tolerance are accepted, so a degenerate saddle flatter than 1e-6 could still certify.
- **Infeasibility proof needs a positive-definite Σ.** A singular Σ always gets the safe "not achieved by the solver" wording, even when exact parity is in fact impossible. Ledoit–Wolf makes Σ_construction positive definite whenever δμ > 0, so this is rare in practice.
- **The comparison is retrospective and in-sample.** Σ_construction is estimated on the same window as the historical comparison. The UI and metadata say so, but the comparison flatters every risk-based proposal.
- **Yahoo stays a local research provider.** Nothing here is deployment-ready.
- **The review-fix pass has had no fresh review.** It was verified by tests and independent reimplementation, but no second reviewer has checked it.

## Second adversarial review fixes

A second independent review reported three defects. Each fix below has a regression test that failed first. Scope is limited to those findings: no Phase 7 work, no broad redesign.

Second review fix 1 (critical): exact ERC rejected by the finite-difference Hessian. `ercSecondOrder` used a fixed step h = 1e-6·B. On Σ = diag(1, 1/2.25e12) the exact ERC is [6.666662222e-7, 0.9999993333337778]. That step exceeds the small weight itself, so the check reported curvature −2.4e11 at the global minimum (parity 1.1e-16, F = 1.2e-32). Every start that reached it was rejected, and a ~50/50 plateau (F = 0.5) was selected. Reproduced RED. Fix:
- **Exact-parity acceptance.** A feasible, finite endpoint with max|PCR_i − 1/N| ≤ 1e-6 (so F ≤ N·10⁻¹²) is the global minimum of the nonnegative objective. It is recorded `parity_achieved` and certified whatever a curvature estimate says. It is checked at stationary endpoints, before any curvature test, and again after each run.
- **Analytic Hessian.** Other stationary points use ∇²F = 2JᵀJ + 2Σ_i e_i∇²p_i, which has no step size (`ercHessian`). A companion magnitude matrix and the cancellation factor κ_V = |w|ᵀ|Σ||w| / V give an explicit roundoff bound, 64·N·ε·κ_V·‖|∇²F|‖_F·B².
- **Explicit states.** `parity_achieved`, `verified`, `violated` and `unverifiable`. Curvature within the roundoff bound of −1e-6, or an unresolved eigenspace, is `unverifiable` and never certifies.

Tests RED → GREEN:
- the analytic Hessian matches an independent Richardson-refined finite-difference Hessian at ordinary points, and a scale-aware one at the tiny weight; the fixed-step estimate misstates that curvature by more than 50%;
- the pure solver certifies the tiny-weight ERC to 1e-8 relative, with the selected start `parity_achieved` and the plateau never chosen;
- the full pipeline, with synthetic HI/LO prices giving Σ_construction ≈ diag(1, 1/2.25e12)·a²·252 (δ = 2.9e-16), gives HI = 6.6677e-7: within 1.6e-4 of the review value and 1e-9 of the closed form σ₁w₁ = σ₂w₂ on the pipeline's own Σ;
- curvature near the threshold (bisection on a Σ(ρ) family) is `unverifiable`, while −2·tol is `violated` and −tol/2 is `verified`.

Ruling (second review fix 1): option A (analytic Hessian) was chosen over adaptive differences. It is exact at any weight scale, it was independently verified (exact-rational finite differences agree to 4.3e-16 relative), and its roundoff has a closed-form bound. Cost if wrong: none observed; the bound is conservative, so borderline cases become `unverifiable` rather than wrongly verified.

Second review fix 2 (high): the critical cone was ignored. With no free coordinate, the check probed no direction and returned verified. At equal weight on the saddle Σ with lower [⅓, ⅓, 0] and upper [1, 1, ⅓], all three coordinates sit on bounds with zero multipliers. The joint release (1, 1, −2) has curvature −648, yet the point was certified. Reproduced RED. Fix: the check works on the critical cone.
- **Classifying bounds.** Active bounds are classified with the full valid multiplier range, not a single ν. With no free coordinate, ν ∈ [max ∇F at caps, min ∇F at floors].
- **Releasing bounds.** A bound is fixed if any valid multiplier exceeds 1e-6. Otherwise it is released, and may move inward alone or jointly with other released bounds.
- **Checking the cone.** The minimum over the cone is the minimum eigenvector of some face (free assets plus a subset of released bounds) that lies strictly inside that face. So the check takes the whole released subspace first (fast path), then enumerates every face when needed (2^k, at most 10 released bounds, otherwise `unverifiable`).
- **Deterministic restarts.** They are unchanged: `violated` escapes along the cone direction, and `unverifiable` does not certify.

Tests RED → GREEN:
- the unrestricted saddle and the review's weakly active saddle (no free coordinate, three bounds released) are `violated` at −648, direction (1, 1, −2);
- weakly active lower bounds only, a weakly active upper bound only, and a mixed active/free point are each `violated`;
- a sign-restricted cone rejects ±(1, 1, −2) as infeasible and reports (0, −1, 1) at −468;
- a strongly active vertex has cone {0} and is `verified`;
- the full solver escapes the weak-bound saddle and reaches [0.5, 0.5, 0], F = 1/6, confirmed by a brute-force grid;
- determinism.

Second review fix 3 (medium): all-CASH required unused candidate history. With AAA at 0% and CASH at 100%, the server failed on AAA's missing history, and the engine derived the comparison window from AAA's coverage, although neither portfolio can hold AAA. Reproduced RED at engine and server level. Fix:
- `zeroRiskyExposure(config, cash)` is true when the current allocation has no risky weight and CASH is 100% (B = 0), so every proposal is all-CASH or infeasible.
- In that case the engine estimates nothing, uses the session calendar as the window (the Phase 1 all-CASH rule) and runs the Treasury CASH path, and the server does not fail on the candidate's fetch.
- Equal weight, inverse volatility and minimum variance stay all-CASH, ERC stays `invalid_inputs`, and model volatility is 0.
- Missing Treasury data keeps the typed Treasury reason.
- The result no longer depends on whether the candidate's history exists.

Tests RED → GREEN:
- engine: the candidate absent from every snapshot; the comparison equals a portfolio with no candidate at all; independence from the candidate's history; missing Treasury;
- server: the all-CASH request succeeds with the candidate's fetch failing.

Guards, which passed before and after:
- current risky with 100% fixed CASH still needs the current holding's history, at engine and server level;
- current all-CASH with B = 0.5 still needs the proposed holding's history.

Matrix coverage: singular PSD matrices (duplicate assets, a perfect hedge, rank 2 of 3) were added to the extreme-scale grid from 1e-300 to 1e300. Rank, singularity, a null condition number and the eigenvalue scale all hold. This passed at once, as coverage of the first-review M3 fix. Mutation check: with the power-of-two normalization disabled the test fails, and with it restored the test passes.

### Verification after the second review fixes

- **Unit and component tests:** 438/438 across 44 files (26 new).
- **Playwright:** 13/13.
- **Lint, typecheck and build:** clean.
- **Live smoke:** passed. Construction took 619 ms, and the default allocations are unchanged.
- **Live constrained case:** unchanged. ERC is still labeled a Constrained Risk-Balance Approximation with the proven-infeasibility message (BND 44.21% needed, 30% cap).
- **20-asset construction:** 0.49 s, unchanged.
- **Independent verification, `verify6.py`:** δ 1.2e-17; Σ 8.3e-17; κ 8.8e-13; EW 0; IV 1.4e-16; MV 3.3e-16; ERC against Spinu 8.3e-17; parity 1.4e-16; turnover 1.1e-16; model volatility 3.5e-17; PCR 3.9e-16; CRC 3.5e-17; current 4.4e-16; bounded ERC 2.2e-10.
- **Independent verification, `verify-so.py`:**
  - The analytic Hessian matches exact-rational (`fractions`) finite differences to at most 4.3e-16 relative, on the saddle cases, the tiny-weight ERC, C3, a strongly active vertex, and both live ERC endpoints.
  - An independently rebuilt critical cone agrees on every verdict, curvature and released-bound count. It uses its own multiplier classification and samples nonnegative combinations of transfer rays: −648, −648, −468, 1.125e12, 3.448, {0}, 1.618 and 4.272.
  - The tiny-weight ERC equals the rational closed form exactly.
- **Both ERC counterexamples rerun:**
  - The tiny-weight case gives `success` at [6.666662222225185e-7, 0.9999993333337778], parity 1.1e-16.
  - The weak-bound saddle is `violated` at −648 with 3 bounds released. The solver escapes it and reaches [0.5, 0.5, 0], proven constrained-infeasible (asset 3 needs 40.96% against a ⅓ cap).
  - The first-review saddle still reaches 29.5209 / 29.5209 / 40.9581%, with the selected start now `parity_achieved`.
- **Determinism:** repeated runs of every counterexample and of both live snapshots are byte-identical. Snapshot replay reproduces both live hashes and proposals exactly.
- **Phase 1–5 regression:** the replay of the live snapshot is identical to the pre-Phase-6 capture in all ten sections.

### Remaining Phase 6 risks (after the second review)

- **ERC certification is local, except at exact parity.** Multistart makes a missed better stationary point unlikely, not impossible.
- **Plateaus can certify.** First- and second-order tolerances are absolute on normalized quantities. On a badly scaled Σ a far-from-optimal plateau can certify, as with 50/50 (F = 0.5) on the tiny-weight Σ. Selection by objective keeps it from winning when any start reaches a better point, but with bounds and no reachable parity that relies on the starts.
- **Enumeration cap.** More than 10 weakly active bounds at one stationary point make the verdict `unverifiable`, and that start then does not certify.
- **Flat directions.** Directions with curvature above −1e-6 are accepted, so the check remains a necessary condition within tolerance, not a sufficient one.
- **Singular Σ.** Infeasibility of exact parity is still proven only for a positive-definite Σ.
- **In-sample comparison.** The comparison remains retrospective and in-sample, and Yahoo remains a local research provider.
- **No fresh review of these fixes.** They are verified by tests and independent reimplementation; no third reviewer has checked them.

Phase 6 stops here. Phase 7 has not been started.
