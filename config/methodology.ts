export const METHODOLOGY = {
  version: "phase1-v1",
  engineVersion: "0.1.0",
  currency: "USD",
  calendar: "XNYS",
  returnConvention: "total_return_aware_adjusted",
  initialWealth: 10_000,
  maxHoldings: 20,
  maxYears: 50,
  weightTolerance: 1e-6,
  numericalTolerance: 1e-10,
  maxRateAgeDays: 7,
  cashDayBasis: 365,
  riskAnnualization: 252,
  rebalance: "monthly_close_reset",
  treasurySeries: "DGS3MO",
  rateAvailability: "next_business_day_23_59_New_York_modeled",
} as const;

/** Phase 2 performance conventions. Separate from METHODOLOGY so Phase 1 replay
 * identity (snapshot hash) is unchanged; results record this version. */
export const PERFORMANCE_METHODOLOGY = {
  version: "performance-v1",
  /** CAGR elapsed years = actual calendar days / 365.25 (cash accrual stays ACT/365). */
  cagrDayBasis: 365.25,
  riskAnnualization: METHODOLOGY.riskAnnualization,
  /** Minimum return observations for volatility, Sharpe and Sortino. */
  minimumReturns: 2,
  /** Below this many returns, annualized statistics carry a short-sample note. */
  shortSampleReturns: 252,
  episodeLimit: 10,
} as const;

/** Phase 3 benchmark-relative conventions (separate version; Phase 1/2 unchanged). */
export const BENCHMARK_METHODOLOGY = {
  version: "benchmark-v1",
  riskAnnualization: METHODOLOGY.riskAnnualization,
  /** Minimum aligned returns for beta, correlation, active return, TE and IR. */
  minimumReturns: 2,
  /** OLS with an intercept needs at least three rows. */
  minimumRegressionRows: 3,
  shortSampleReturns: 252,
} as const;

/** Phase 4 risk conventions (separate version; Phase 1–3 unchanged). */
export const RISK_METHODOLOGY = {
  version: "risk-v1",
  label:
    "Risk Contribution at Target Weights — CASH treated as locally riskless",
  riskAnnualization: METHODOLOGY.riskAnnualization,
  /** Common observations: < 60 insufficient, 60–251 limited, ≥ 252 normal. */
  minimumObservations: 60,
  normalObservations: 252,
  /** Relative tolerance for zero variance / rank deficiency (× matrix scale). */
  zeroTolerance: 1e-12,
  /** Relative tolerance for eigenvalue-based PSD and singularity diagnostics. */
  eigenTolerance: 1e-10,
} as const;

/** Phase 5 rolling conventions (separate version; Phase 1–4 unchanged). A window
 * of N needs N consecutive scheduled session returns ending on the plotted date. */
export const ROLLING_METHODOLOGY = {
  version: "rolling-v1",
  windows: [20, 60, 120],
  defaultWindow: 60,
  riskAnnualization: METHODOLOGY.riskAnnualization,
} as const;

/** Phase 6 construction conventions (separate version; Phase 1–5 unchanged).
 * Tolerances are deliberately distinct: no single epsilon serves every check. */
export const CONSTRUCTION_METHODOLOGY = {
  version: "construction-v1",
  covariance: {
    estimator: "ledoit-wolf-2004",
    target: "scaled_identity",
    version: "lw-scaled-identity-v1",
    sampleConvention:
      "n − 1 sample covariance; δ from the published n-denominator formula (scale-invariant)",
  },
  solverVersion: "construction-solver-v1",
  riskAnnualization: METHODOLOGY.riskAnnualization,
  /** Common observations: < 60 unavailable, 60–251 limited, ≥ 252 normal (sample size only). */
  minimumObservations: 60,
  normalObservations: 252,
  tolerances: {
    /** Budget and bound violations, decimal portfolio weights. */
    weight: 1e-10,
    /** Symmetry / PSD / rank, relative to matrix scale. */
    matrixRelative: 1e-10,
    /** Normalized projected-gradient and KKT residuals required to certify a solution. */
    stationarity: 1e-8,
    /** max |PCR_i − 1/N| for exact equal risk contribution. */
    parity: 1e-6,
    /** Internal convergence target, far below the certification threshold. */
    solverTarget: 1e-14,
    /** Holding returns / weights treated as equal for binding and tie reporting. */
    binding: 1e-10,
    /** ERC second-order check: normalized curvature (× B²) below −curvature on the
     * critical cone is a feasible negative-curvature direction, i.e. not a local minimum. */
    curvature: 1e-6,
    /** A bound whose normalized KKT multiplier (× B) is at most this is weakly active
     * and its feasible one-sided directions are probed for negative curvature. */
    weakMultiplier: 1e-6,
    /** Starts closer than this (× B, max-abs) are the same start. */
    distinctStart: 1e-9,
    /** A released bound's component of a unit critical-cone direction must exceed
     * this (with the feasible sign) for the direction to lie inside that cone face. */
    coneDirection: 1e-9,
    /** Roundoff bound on analytic-Hessian curvature, in units of N·ε·κ_V·‖|H|‖_F·B²
     * (κ_V = |w|ᵀ|Σ||w| / wᵀΣw). Curvature within this bound of −curvature is
     * unverifiable, never verified. */
    curvatureRoundoff: 64,
  },
  limits: {
    eigenSweeps: 100,
    minimumVarianceIterations: 100_000,
    ercIterationsPerStart: 50_000,
    /** Negative-curvature escapes allowed per ERC start. */
    ercEscapes: 10,
    /** Weakly active bounds the critical-cone check enumerates (2^k faces); more is
     * reported as second-order unverifiable. */
    ercConeBounds: 10,
    tieBreakIterations: 100_000,
  },
  tieRule:
    "Among numerically optimal minimum-variance allocations, the one closest (Euclidean) to the constrained equal-weight allocation.",
} as const;

/** Phase 5 stress conventions (separate version; Phase 1–4 unchanged). Each event
 * re-initializes at target weights on its start-session close and reuses the
 * Phase 1 simulation unchanged, including monthly closing resets. */
export const STRESS_METHODOLOGY = {
  version: "stress-v1",
  /** Custom Historical Window span cap; longer horizons belong to the main analysis. */
  maxCustomYears: 10,
  /** Holding returns within this absolute distance are reported as tied. */
  tieTolerance: 1e-12,
  /** Treasury observations kept before each window for prior-known rate lookup. */
  treasuryContextDays: 14,
} as const;
