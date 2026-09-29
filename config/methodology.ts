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
