// V2 forward-model contracts (Layer B: what the model assumes for the next 12
// months). Kept apart from the historical contracts in ./analytics. Weights, returns,
// yields and confidences are decimals; display formatting never feeds back.
import type { Sample } from "./analytics";
import type { LatestTreasuryYield } from "./data";

export type RiskWindow = "1Y" | "3Y" | "5Y";
export type MarketProxy = "VTI" | "SPY" | "VT";

/** User assumptions shared by Portfolio Theory and Stock Lab. */
export type ForwardAssumptions = {
  /** Historical window for covariance, volatility, beta and correlation. It never
   * changes the 12-month forecast horizon. */
  riskWindow: RiskWindow;
  marketProxy: MarketProxy;
  /** Market Risk Premium: an explicit assumption, never market data. */
  marketRiskPremium: number;
};

/** Which view the user selected for a security. */
export type ViewSource = "none" | "street" | "manual";

/** One security's view as the user set it (absolute, single-security). */
export type ViewInput = {
  source: ViewSource;
  /** The user's 12-month expected total return (same basis as the CAPM prior).
   * Kept while another source is active, so switching back loses nothing. */
  manualReturn: number | null;
  /** 0–1. Zero ignores the view; one is the limiting high-confidence view. */
  confidence: number;
};

/** Views keyed by canonical ticker (CASH never carries a view). */
export type ViewState = Record<string, ViewInput>;

/** The one local assumption state shared by Portfolio Theory and Stock Lab. */
export type ForwardAssumptionState = {
  assumptions: ForwardAssumptions;
  views: ViewState;
};

/** Forward 12-month risk-free proxy: the latest available official DGS1
 * observation, read through the existing Treasury providers and used unconverted.
 * Same shape as the data layer's reading, so nothing is re-described. */
export type ForwardRiskFree = LatestTreasuryYield;

/** The risk-estimation window: what was requested and the common aligned sample
 * actually used. Thresholds apply to aligned RETURN observations. */
export type EffectiveRiskWindow = {
  requested: RiskWindow;
  /** N years before the end session (a calendar date; the sample starts at the
   * first session on or after it). */
  requestedStartDate: string;
  /** First session on or after the requested start. */
  requestedFirstSession: string;
  /** The latest finalized market session (independent of the Analysis Period). */
  endDate: string;
  /** First and last session of the common aligned sample (price base → last close). */
  effectiveStartDate: string;
  effectiveEndDate: string;
  /** Aligned close-to-close return observations in the common sample. */
  alignedReturns: number;
  sample: Sample;
  /** < 60 aligned returns is unavailable; 60–251 limited; 252+ normal. */
  status: "normal" | "limited";
  /** True when the common sample starts after the requested first session. */
  shortened: boolean;
  /** Securities whose provider-reported first trade set the later start. */
  limitingTickers: string[];
  notes: string[];
};

/** Eigen-diagnostics of one validated covariance matrix. */
export type CovarianceConditioning = {
  minEigenvalue: number;
  maxEigenvalue: number;
  conditionNumber: number | null;
  singular: boolean;
  rank: number;
};

/** The certified forward risk model: one Ledoit–Wolf covariance over the forward
 * risky universe plus the market proxy, estimated on one common aligned sample.
 * Forward Model Beta and σ_m come from that same matrix. A new model is required
 * when the risk window, market proxy, universe or market history changes; MRP,
 * views and confidence never change it. */
export type ForwardRiskModel = {
  methodologyVersion: string;
  covarianceVersion: string;
  /** Forward risky universe (zero-weight rows included), canonical (sorted) order;
   * CASH excluded. Empty for an all-CASH portfolio. */
  tickers: string[];
  marketProxy: MarketProxy;
  /** The proxy is itself a security in the universe. */
  proxyInUniverse: boolean;
  /** True when the universe is empty: only the proxy is estimated. */
  noRiskyAssets: boolean;
  /** Tickers of the estimated matrix: universe ∪ proxy, canonical order. */
  modelTickers: string[];
  window: EffectiveRiskWindow;
  /** Annualized Ledoit–Wolf Σ over `modelTickers` (× 252). */
  modelCovariance: number[][];
  /** Its risky-universe block, `tickers` order. */
  covariance: number[][];
  /** √Σ_ii of the risky universe, `tickers` order. */
  modelVolatility: number[];
  /** Forward Model Beta vs the market proxy, Σ_im / Σ_mm, `tickers` order. */
  modelBeta: number[];
  /** σ_m = √Σ_mm. */
  marketVolatility: number;
  shrinkage: {
    estimator: string;
    target: string;
    /** Ledoit–Wolf δ ∈ [0, 1] of the augmented matrix. */
    delta: number;
    /** Annualized scaled-identity target μ = tr(S)/N × 252. */
    mu: number;
    sampleConvention: string;
  };
  annualization: { factor: number; convention: string };
  /** Both matrices pass the shared validator; conditioning before and after shrinkage. */
  validation: {
    tolerance: number;
    sample: CovarianceConditioning;
    model: CovarianceConditioning;
  };
  /** Historical (sample) correlation over the same common sample, `modelTickers`
   * order. Labelled Historical Correlation; never the shrunk model matrix. */
  sampleCorrelation: { tickers: string[]; matrix: (number | null)[][] };
  /** SHA-256 over methodology, proxy, window, tickers, interval set and matrix. */
  hash: string;
};

export type ForwardRiskModelFailure =
  | "invalid_inputs"
  | "history_unavailable"
  | "coverage_gap"
  | "insufficient_history"
  | "zero_volatility"
  | "invalid_covariance";

/** A forward risk model, or a typed reason it cannot be estimated. */
export type ForwardRiskModelOutcome =
  | { available: true; model: ForwardRiskModel }
  | {
      available: false;
      code: ForwardRiskModelFailure;
      reason: string;
      /** Securities responsible, when known (the proxy included). */
      tickers: string[];
      riskWindow: RiskWindow;
      requestedStartDate: string | null;
      endDate: string | null;
      /** Aligned returns in the common sample, when one was built. */
      alignedReturns: number | null;
    };

/** One risky security's CAPM prior. Shared inputs (Rf, MRP, proxy, window) live on
 * the parent result, so every row is computed from exactly the same values. */
export type CapmPriorRow = {
  ticker: string;
  /** Forward Model Beta from the certified risk model (never re-estimated). */
  forwardModelBeta: number;
  /** Rf + β × MRP: the 12-month CAPM prior, identical to the CAPM Required Return. */
  capmPrior: number;
};

/** The 12-month CAPM prior: an equilibrium model assumption, not a historical
 * return, price target, forecast guarantee or historical alpha. */
export type CapmPrior = {
  methodologyVersion: string;
  /** Hash of the forward risk model the betas came from. */
  riskModelHash: string;
  marketProxy: MarketProxy;
  riskWindow: RiskWindow;
  /** Latest available 1Y Treasury yield (DGS1), decimal. */
  riskFreeRate: number;
  riskFreeObservationDate: string;
  riskFreeSource: string;
  /** Explicit Market Risk Premium assumption, decimal. */
  marketRiskPremium: number;
  /** Rf + MRP: the ONE canonical forward expected market return. */
  expectedMarketReturn: number;
  /** Risky securities, canonical (risk-model) order. */
  rows: CapmPriorRow[];
  /** CASH stays outside the risky model: β = 0, expected return = Rf. */
  cash: { ticker: "CASH"; forwardModelBeta: 0; expectedReturn: number };
};

/** A 12-month simple return at or below −100% that the CAPM formula produced. */
export type InvalidCapmPrior = {
  ticker: string;
  forwardModelBeta: number;
  riskFreeRate: number;
  marketRiskPremium: number;
  capmPrior: number;
};

export type CapmPriorOutcome =
  | { available: true; prior: CapmPrior }
  | { available: false; code: "invalid_inputs"; reason: string }
  | {
      available: false;
      code: "invalid_capm_prior";
      reason: string;
      invalid: InvalidCapmPrior[];
    };

/** Return basis of a 12-month view. Manual views are total returns (the CAPM prior's
 * basis); Street views are price-target returns with dividends excluded. Kept on
 * every view so the methodology stays auditable. */
export type ViewReturnBasis = "total_return" | "price_return";

/** A provider-neutral Street view for one security, as produced from qualified,
 * normalized Street data (never from a provider directly). Only the median target
 * qualifies; nothing is ever manufactured. */
export type StreetViewInput =
  | {
      ticker: string;
      available: true;
      /** Median target / provider quote − 1, decimal. */
      priceTargetReturn: number;
      basis: "price_return";
      horizonMonths: 12;
      targetStatistic: "median";
      provider: string;
      retrievedAt: string;
    }
  | { ticker: string; available: false; reason: string };

/** How a configured view (or a security without one) enters the model. */
export type ViewStatus =
  | "ACTIVE"
  | "NO_VIEW"
  | "OUT_OF_UNIVERSE"
  | "ZERO_CONFIDENCE"
  | "STREET_DATA_UNAVAILABLE"
  | "INVALID_VIEW";

/** One security's view classification, with its full audit metadata. */
export type ViewClassification = {
  ticker: string;
  /** What the user selected (None / Manual / Street). */
  requestedSource: ViewSource;
  status: ViewStatus;
  /** The source whose return feeds (or would feed) Q; null when there is none. */
  source: "manual" | "street" | null;
  basis: ViewReturnBasis | null;
  horizonMonths: 12 | null;
  /** Confidence as a FRACTION in [0, 1] (0.5 = 50%); never a whole-number percent. */
  confidence: number | null;
  /** The 12-month view return in decimals (0.12 = 12%); Q's value when ACTIVE. */
  viewReturn: number | null;
  /** "12M Expected Total Return" or "12M Price-Target Return · Dividends Excluded". */
  label: string | null;
  /** Why the view has no model effect; null when ACTIVE or NO_VIEW. */
  reason: string | null;
};

/** An ACTIVE view: its P row, Q entry and Ω diagonal. */
export type ActiveView = ViewClassification & {
  status: "ACTIVE";
  source: "manual" | "street";
  basis: ViewReturnBasis;
  horizonMonths: 12;
  confidence: number;
  viewReturn: number;
  /** Row of P, Q and Ω. */
  row: number;
  /** Canonical column of the viewed security in the risk model. */
  column: number;
  /** P_k τ Σ P_kᵀ (= τ Σ_kk for an absolute view). */
  baseVariance: number;
  /** baseVariance × (1 − c) / c; exactly 0 at 100% confidence. */
  omega: number;
};

/** Certified Black–Litterman inputs: absolute single-security views over the
 * certified forward risk model. No posterior is computed here. */
export type BlackLittermanInputs = {
  methodologyVersion: string;
  riskModelHash: string;
  /** Internal constant; under this Ω it cancels from the posterior mean. */
  tau: number;
  omegaConvention: string;
  /** P's columns: the risk model's canonical risky universe. */
  universeTickers: string[];
  /** One row per universe security, canonical order. */
  securities: ViewClassification[];
  /** Saved views outside the universe (kept, contributing nothing), sorted. */
  notApplicable: ViewClassification[];
  /** Saved views that cannot be read (e.g. a view on CASH), sorted. */
  invalid: ViewClassification[];
  /** ACTIVE views in canonical order: row k of P, Q and Ω. */
  activeViews: ActiveView[];
  /** Every configured view with no model effect (status ≠ ACTIVE, ≠ NO_VIEW). */
  inactiveViews: ViewClassification[];
  /** m × n selector matrix; 0 × n (empty) when no view is active. */
  P: number[][];
  /** m view returns, decimals, in P's row order. */
  Q: number[];
  /** m × m diagonal view-uncertainty matrix. */
  Omega: number[][];
  dimensions: { views: number; securities: number };
};

export type BlackLittermanInputsOutcome =
  | { available: true; inputs: BlackLittermanInputs }
  | {
      available: false;
      code: "invalid_inputs" | "invalid_view_variance";
      reason: string;
      tickers: string[];
    };

/** Q32 certification of the Black–Litterman solve A x = b (infinity norms). */
export type BlackLittermanSolveCertification =
  | { required: false; reason: "no_active_views" }
  | {
      required: true;
      /** ‖Ax − b‖∞ */
      residualNorm: number;
      /** ‖A‖∞ (maximum absolute row sum) */
      matrixNorm: number;
      /** ‖x‖∞ */
      solutionNorm: number;
      /** ‖b‖∞ */
      rhsNorm: number;
      /** η = ‖r‖∞ / (‖A‖∞‖x‖∞ + ‖b‖∞); null when that denominator is exactly 0. */
      relativeBackwardError: number | null;
      tolerance: number;
      passed: boolean;
    };

/** One risky security's posterior. */
export type BlackLittermanRow = {
  ticker: string;
  capmPrior: number;
  /** 12-month Black–Litterman expected return, decimal. */
  blackLittermanExpectedReturn: number;
};

/** The view metadata carried into (and reported with) the posterior. */
export type PosteriorViewSummary = Pick<
  ActiveView,
  "ticker" | "source" | "basis" | "horizonMonths" | "confidence" | "viewReturn" | "label"
>;

/** The certified Black–Litterman posterior expected-return vector. No Expected
 * Return Gap, portfolio metric or frontier is computed here. */
export type BlackLittermanPosterior = {
  methodologyVersion: string;
  riskModelHash: string;
  marketProxy: MarketProxy;
  riskWindow: RiskWindow;
  tau: number;
  /** Canonical risk-model order: the order of every vector below. */
  universeTickers: string[];
  capmPrior: number[];
  blackLittermanExpectedReturn: number[];
  rows: BlackLittermanRow[];
  /** "prior_only" when no view is active (posterior = prior exactly). */
  status: "prior_only" | "posterior";
  /** Task 5 active views, source and return basis preserved. */
  activeViews: ActiveView[];
  certification: BlackLittermanSolveCertification;
  /** CASH stays at Rf, outside the solve. */
  cash: { ticker: "CASH"; forwardModelBeta: 0; expectedReturn: number };
};

export type BlackLittermanFailure =
  | "invalid_inputs"
  | "singular_view_system"
  | "numerical_failure"
  | "invalid_posterior";

export type BlackLittermanPosteriorOutcome =
  | { available: true; posterior: BlackLittermanPosterior }
  | {
      available: false;
      code: BlackLittermanFailure;
      reason: string;
      /** The active views involved in the failed solve. */
      activeViews: PosteriorViewSummary[];
      certification: BlackLittermanSolveCertification | null;
      /** For invalid_posterior: each security at or below −100%. */
      invalid: { ticker: string; capmPrior: number; blackLittermanExpectedReturn: number }[];
    };

/** A forward statistic that can be undefined. The reason is required when it is
 * unavailable, so no metric is ever filled with 0, NaN or Infinity. */
export type ForwardMetric =
  | { available: true; value: number }
  | { available: false; reason: "No risky assets" | "Zero portfolio volatility" };

/** One risky security in the shared forward expected-return table. */
export type ExpectedReturnRow = {
  ticker: string;
  /** Forward Model Beta vs the market proxy (Task 3). */
  forwardModelBeta: number;
  /** Rf + β × MRP from capmRequiredReturn: the CAPM Prior, which is the same value
   * the SML later calls the CAPM Required Return. One field, one computation. */
  capmPrior: number;
  /** Task 5 classification, preserved (never reduced to view / no view). */
  viewStatus: ViewStatus;
  requestedSource: ViewSource;
  viewSource: "manual" | "street" | null;
  viewBasis: ViewReturnBasis | null;
  /** The configured view return (decimal), when there is one. */
  viewReturn: number | null;
  /** Fraction in [0, 1], when a view is configured. */
  confidence: number | null;
  /** Why the security stays at its CAPM prior, when a view is configured. */
  viewReason: string | null;
  blackLittermanExpectedReturn: number;
  /** BL Expected Return − CAPM Prior. Never alpha, mispricing or a valuation call. */
  expectedReturnGap: number;
};

/** CASH in the expected-return table: β 0, Rf throughout, gap 0, no view possible. */
export type CashExpectedReturnRow = {
  ticker: "CASH";
  forwardModelBeta: 0;
  capmPrior: number;
  viewStatus: "NO_VIEW";
  blackLittermanExpectedReturn: number;
  expectedReturnGap: 0;
};

/** w_i × μ_i: the forward one-period expected-return contribution (linear model). Not
 * realized or historical attribution. */
export type ExpectedReturnContribution = {
  ticker: string;
  weight: number;
  expectedReturn: number;
  contribution: number;
};

/** Forward metrics of one allocation on the certified forward model. CASH earns Rf
 * and carries zero model variance; risky weights are never rescaled. */
export type PortfolioForwardMetrics = {
  /** The weights used: risky in canonical order, then CASH. */
  weights: { tickers: string[]; risky: number[]; cash: number };
  /** The input total, and whether the existing once-only normalization was applied
   * (|total − 1| within the portfolio tolerance but above floating-point noise). */
  weightTotal: number;
  normalized: boolean;
  riskyWeight: number;
  noRiskyAssets: boolean;
  /** 12M BL expected return: Σ w_i μ_BL,i + w_cash Rf. */
  expectedReturn: number;
  /** Σ w_i β_i (CASH β = 0). */
  forwardModelBeta: number;
  /** capmRequiredReturn(Rf, β_p, MRP). */
  capmRequiredReturn: number;
  /** expectedReturn − capmRequiredReturn = Σ w_i gap_i. */
  expectedReturnGap: number;
  /** w_riskyᵀ Σ w_risky under the existing roundoff rule. */
  modelVariance: number;
  modelVolatility: number;
  /** (E[R_p] − Rf) / σ_p, only when σ_p > 0. */
  forwardModelSharpe: ForwardMetric;
  /** Risky securities in canonical order, then CASH when held. */
  expectedReturnContributions: ExpectedReturnContribution[];
};

export type PortfolioForwardOutcome =
  | { available: true; metrics: PortfolioForwardMetrics }
  | {
      available: false;
      code: "invalid_inputs" | "invalid_weights" | "numerical_failure";
      reason: string;
      tickers: string[];
    };

/** The Task 7 forward result: the expected-return table, the portfolio's forward
 * metrics and a deterministic, browser-safe result hash above the risk-model hash. */
export type ForwardExpectedReturnsResult = {
  methodologyVersion: string;
  riskModelHash: string;
  marketProxy: MarketProxy;
  riskWindow: RiskWindow;
  riskFreeRate: number;
  riskFreeObservationDate: string;
  marketRiskPremium: number;
  expectedMarketReturn: number;
  tau: number;
  /** One row per risky security, canonical order. */
  rows: ExpectedReturnRow[];
  /** Present when the portfolio lists CASH. */
  cash: CashExpectedReturnRow | null;
  activeViewCount: number;
  notApplicableViews: ViewClassification[];
  invalidViews: ViewClassification[];
  blackLittermanStatus: "prior_only" | "posterior";
  certification: BlackLittermanSolveCertification;
  portfolio: PortfolioForwardMetrics;
  /** SHA-256 of the canonical economic payload (see the methodology). */
  resultHash: string;
};

export type ForwardExpectedReturnsOutcome =
  | { available: true; result: ForwardExpectedReturnsResult }
  | {
      available: false;
      code: "invalid_inputs" | "invalid_weights" | "numerical_failure";
      reason: string;
      tickers: string[];
    };

/** Outcome of one deterministic solve (frontier point or tangency). */
export type ForwardSolverStatus =
  | "success"
  | "infeasible"
  | "invalid_inputs"
  | "numerical_failure"
  | "non_converged";

/** Certification residuals (Q34); null when the solve produced no candidate. */
export type ForwardSolverResiduals = {
  /** |Σw − 1| ≤ 1e-10 */
  budget: number | null;
  /** |μᵀw − target| ≤ 1e-10 (decimal annual return) */
  return: number | null;
  /** max(0, −min w) ≤ 1e-10 */
  bound: number | null;
  /** KKT / stationarity residual normalized by 2·λmax(Σ) ≤ 1e-8 */
  kkt: number | null;
};

/** One efficient-frontier point. Only certified points carry weights and may be
 * plotted; every point records its residuals. */
export type FrontierPoint = {
  index: number;
  /** "gmv": the existing minimumVariance anchor; "max_return": the top endpoint. */
  role: "gmv" | "interior" | "max_return";
  targetReturn: number;
  status: ForwardSolverStatus;
  certified: boolean;
  reason: string | null;
  /** Risky weights in canonical order, summing to 1 — certified points only. */
  weights: number[] | null;
  expectedReturn: number | null;
  volatility: number | null;
  /** Binding tickers as the existing bindingConstraints reports them for 0–100%
   * bounds: lower = held at 0%, upper = held at 100% (the problem has no caps). */
  binding: { lower: string[]; upper: string[] };
  residuals: ForwardSolverResiduals;
  iterations: number;
};

/** The deterministic, certified efficient frontier of the risky universe. */
export type EfficientFrontier = {
  methodologyVersion: string;
  riskModelHash: string;
  /** Canonical risky universe and the BL expected returns the frontier used. */
  tickers: string[];
  expectedReturns: number[];
  /** "single_point" when max μ − r_GMV ≤ 1e-12 (Q35): the GMV alone. */
  status: "frontier" | "single_point";
  gmv: {
    expectedReturn: number;
    volatility: number;
    weights: number[];
    solver: { termination: string; iterations: number };
  };
  maxExpectedReturn: number;
  /** Securities tied for the highest expected return: max μ − μ_i ≤ the Q37
   * top-return tie tolerance (their μ are kept as they are). */
  maxReturnTickers: string[];
  /** 2·λmax(Σ): the KKT normalization, as in minimumVariance. */
  kktNormalization: number;
  tolerances: {
    budget: number;
    bound: number;
    targetReturn: number;
    kkt: number;
  };
  /** Q35 single-point threshold and Q37 top-return tie tolerance. */
  thresholds: { singlePoint: number; topReturnTie: number };
  points: FrontierPoint[];
  certifiedCount: number;
  /** SHA-256 of the canonical frontier payload (risk-model hash, μ, targets, results). */
  frontierHash: string;
};

export type EfficientFrontierOutcome =
  | { available: true; frontier: EfficientFrontier }
  | {
      available: false;
      code: "invalid_inputs" | "no_risky_assets" | "gmv_unavailable";
      reason: string;
    };

/** A straight line E = intercept + slope × x drawn through an anchor point. The
 * CAL and the Market CML Proxy are solid from x = 0 to the anchor and dashed beyond
 * it (borrowing at Rf, outside the lab's modeled allocation constraints). */
export type CapitalMarketLine = {
  id: "model_cal" | "market_cml_proxy" | "security_market_line";
  axis: "volatility" | "beta";
  intercept: number;
  slope: number;
  anchor: { x: number; y: number };
  /** x where the solid segment ends; null when the whole line is one treatment (SML). */
  solidUntil: number | null;
};
