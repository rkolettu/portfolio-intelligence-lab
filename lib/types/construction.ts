// Phase 6 construction contracts. Weights are full-precision decimals of the WHOLE
// portfolio; display rounding never feeds back into calculations.
import type { Metric, Sample, WealthPoint } from "./analytics";
import type { PortfolioConfig } from "./portfolio";

export type ConstructionMethod =
  | "equal_weight"
  | "inverse_volatility"
  | "minimum_variance"
  | "equal_risk_contribution";

export type ConstructionStatus =
  | "success"
  | "infeasible"
  | "invalid_inputs"
  | "insufficient_history"
  | "invalid_covariance"
  | "numerical_failure"
  | "non_converged"
  | "converged_but_parity_not_achieved";

/** Bounds for one eligible risky asset, as fractions of the whole portfolio.
 * A positive minimum applies unconditionally (never "0 or at least min"). */
export type OptimizationConstraint = {
  ticker: string;
  minWeight: number;
  maxWeight: number;
  /** Must carry a positive minimum. */
  required: boolean;
};

/** CASH stays outside the risky covariance matrix and is fixed, never optimized. */
export type CashChoice =
  { mode: "current" } | { mode: "fixed"; weight: number };

export type ConstructionRequest = {
  config: PortfolioConfig;
  constraints: OptimizationConstraint[];
  cash: CashChoice;
};

export type AllocationWeight = { ticker: string; weight: number };

export type SolverStart = {
  /** equal_weight, inverse_volatility, current, log_barrier_risk_budget, tilt_<ticker>. */
  name: string;
  used: boolean;
  reason: string | null;
  iterations: number;
  objective: number | null;
  stationarity: number | null;
  parity: number | null;
  termination: string;
  selected: boolean;
  /** Negative-curvature escapes taken from saddle points during this start. */
  escapes: number;
  /** Second-order verdict at the endpoint (ERC); null when the start did not run.
   * parity_achieved: feasible with max|PCR_i − 1/N| ≤ parity tolerance, so the
   * nonnegative objective is within N·tol² of its global minimum and no curvature
   * test is needed. Otherwise the critical-cone curvature check's outcome. */
  secondOrder:
    "parity_achieved" | "verified" | "violated" | "unverifiable" | null;
  /** Minimum normalized curvature (× B²) found on the critical cone (or on a
   * subspace containing it); null when no direction applies or none was checked. */
  curvature: number | null;
};

export type ConstructionDiagnostics = {
  objective: { name: string; value: number | null };
  iterations: number;
  termination: string;
  residuals: {
    budget: number | null;
    bound: number | null;
    /** Normalized projected-gradient (gradient-mapping) residual. */
    stationarity: number | null;
    /** Normalized multiplier-based KKT residual. */
    kkt: number | null;
    /** max |PCR_i − 1/N| (ERC only). */
    parity: number | null;
  };
  binding: { lower: string[]; upper: string[]; fixed: string[] };
  /** Unconstrained reference allocation (equal weight, inverse volatility). */
  reference: AllocationWeight[] | null;
  starts: SolverStart[];
  tieRule: string | null;
  notes: string[];
};

export type ConstructionOutcome = {
  method: ConstructionMethod;
  status: ConstructionStatus;
  label: string;
  reason: string | null;
  /** Full-precision weights (universe in configuration order, then CASH) when usable. */
  weights: AllocationWeight[] | null;
  diagnostics: ConstructionDiagnostics;
};

/** Construction Model Risk: evaluated on Σ_construction, never the Phase 4 sample. */
export type ModelRisk =
  | {
      available: true;
      volatility: number;
      variance: number;
      weightedAverageVolatility: number;
      diversificationRatio: number | null;
      holdings: {
        ticker: string;
        weight: number;
        /** null when no construction covariance exists (e.g. all-CASH, no risk model). */
        standaloneVolatility: number | null;
        marginal: number | null;
        component: number | null;
        percentage: number | null;
      }[];
      residuals: { crc: number; pcr: number } | null;
      /** CASH is outside Σ: it contributes exactly zero risk. */
      cash: { weight: number; contribution: 0 };
    }
  | { available: false; reason: string };

/** In-sample retrospective backtest summary for one target allocation. */
export type HistoricalSide =
  | {
      available: true;
      cumulativeReturn: Metric;
      cagr: Metric;
      volatility: Metric;
      sharpe: Metric;
      sortino: Metric;
      maximumDrawdown: Metric;
      beta: Metric;
      trackingError: Metric;
      informationRatio: Metric;
      correlation: Metric;
      growth: WealthPoint[];
    }
  | { available: false; reason: string };

export type StressComparisonEvent = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
} & (
  | {
      status: "complete";
      current: { return: Metric; maximumDrawdown: Metric };
      proposed: { return: Metric; maximumDrawdown: Metric };
      benchmark: Metric;
    }
  | { status: "incomplete_coverage"; missing: string[] }
  | { status: "unavailable"; reason: string }
);

export type ConstructionProposal = ConstructionOutcome & {
  /** 0.5 × Σ|proposed − current| over the union of holdings, CASH included. */
  turnover: number | null;
  /** Plain explanations of binding constraints, concentration, hedges, turnover. */
  observations: string[];
  modelRisk: ModelRisk;
  historical: HistoricalSide;
  stress: StressComparisonEvent[];
};

export type ConstructionAnalytics = {
  methodologyVersion: string;
  config: PortfolioConfig;
  inputs: {
    /** Eligible risky universe in configuration order (zero weights included). */
    universe: string[];
    constraints: OptimizationConstraint[];
    cash: CashChoice;
    cashWeight: number;
    /** B = 1 − fixed CASH weight. */
    riskyBudget: number;
    current: AllocationWeight[];
  };
  estimation:
    | {
        available: true;
        sample: Sample;
        status: "normal" | "limited";
        finalizedCutoff: string;
        notes: string[];
      }
    | { available: false; reason: string; observationCount: number };
  covariance:
    | {
        available: true;
        estimator: string;
        target: string;
        version: string;
        sampleConvention: string;
        shrinkage: number;
        mu: number;
        /** Annualized Σ_construction, universe order. */
        construction: number[][];
        standaloneVolatility: number[];
        hash: string;
        conditioning: {
          sample: {
            minEigenvalue: number;
            maxEigenvalue: number;
            conditionNumber: number | null;
          };
          construction: {
            minEigenvalue: number;
            maxEigenvalue: number;
            conditionNumber: number | null;
          };
        };
      }
    | { available: false; reason: string };
  /** Risky assets with zero or undefined empirical volatility. */
  zeroVolatility: string[];
  current: { modelRisk: ModelRisk; historical: HistoricalSide };
  comparison:
    | { available: true; sample: Sample; benchmark: string }
    | { available: false; reason: string };
  proposals: ConstructionProposal[];
  metadata: {
    generatedAt: string;
    snapshotHash: string;
    methodologyVersions: Record<string, string>;
    warnings: string[];
    currentDataUsed: false;
  };
  snapshot: ConstructionSnapshot;
};

export type ConstructionSnapshot = {
  estimation: {
    prices: import("./data").HistoricalSeries[];
    treasury: import("./data").TreasurySeries | null;
    sessions: import("./data").Session[];
    eligibleEndDate: string;
  };
  stress: import("./analytics").StressSnapshot;
};
