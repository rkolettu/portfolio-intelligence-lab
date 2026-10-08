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

/** The risk-estimation window actually used, which may start later than requested. */
export type EffectiveRiskWindow = {
  requested: RiskWindow;
  requestedStartDate: string;
  /** The latest finalized market session (independent of the Analysis Period). */
  endDate: string;
  sample: Sample;
  status: "normal" | "limited";
  /** True when the common sample starts after the requested start. */
  shortened: boolean;
  /** Securities whose first trade set a later effective start. */
  limitingTickers: string[];
  notes: string[];
};

/** The server's hashed forward risk-model snapshot. A new snapshot is required when
 * the risk window, market proxy, universe or market history changes; MRP, views
 * and confidence are applied to it by the same pure functions anywhere. */
export type ForwardRiskModel = {
  methodologyVersion: string;
  /** Forward risky universe, canonical (sorted) order; CASH excluded. */
  tickers: string[];
  marketProxy: MarketProxy;
  /** The proxy is itself a security in the universe. */
  proxyInUniverse: boolean;
  window: EffectiveRiskWindow;
  /** Annualized Ledoit–Wolf Σ of the risky universe: the risky block of the matrix
   * estimated over universe ∪ proxy. Canonical order. */
  covariance: number[][];
  /** Forward Model Beta Σ_im / Σ_mm, canonical order. */
  modelBeta: number[];
  /** σ_m = √Σ_mm. */
  marketVolatility: number;
  /** Ledoit–Wolf δ of the augmented matrix. */
  shrinkage: number;
  /** Historical sample correlation over the effective window (canonical order);
   * null where a security is constant. Labelled historical, never the model Σ. */
  sampleCorrelation: (number | null)[][];
  riskFree: ForwardRiskFree;
  hash: string;
};

/** A forward statistic that can be undefined (e.g. Sharpe at zero volatility). */
export type ForwardMetric =
  { available: true; value: number } | { available: false; reason: string };

/** One row of the shared forward expected-return table. */
export type ExpectedReturnRow = {
  ticker: string;
  /** Forward Model Beta vs the market proxy. */
  modelBeta: number;
  /** Rf + β × MRP; the CAPM Required Return. */
  capmPrior: number;
  /** The source the user selected. */
  requestedSource: ViewSource;
  /** The source that entered the model ("none" when a requested view is unavailable). */
  viewSource: ViewSource;
  /** Q_k when a view entered the model, otherwise null. */
  activeView: number | null;
  /** Confidence of the view that entered the model, otherwise null. */
  confidence: number | null;
  blExpectedReturn: number;
  /** BL Expected Return − CAPM Required Return. Never called alpha. */
  expectedReturnGap: number;
  /** Why a requested view did not enter the model. */
  viewNote: string | null;
};

/** Forward metrics of one allocation (CASH earns Rf and carries zero model risk). */
export type PortfolioForwardMetrics = {
  /** 12M BL expected return: Σ w_i μ_BL,i + w_cash Rf. */
  expectedReturn: number;
  /** √(wᵀΣw) on the forward Σ. */
  modelVolatility: number;
  /** (E[R_p] − Rf) / σ_p; unavailable at zero model volatility. */
  forwardModelSharpe: ForwardMetric;
  /** Σ w_i β_i (CASH β = 0). */
  modelBeta: number;
  /** Rf + β_p × MRP. */
  capmRequiredReturn: number;
  /** expectedReturn − capmRequiredReturn. */
  expectedReturnGap: number;
  cashWeight: number;
};

/** Outcome of one deterministic solve (frontier point or tangency). */
export type ForwardSolverStatus =
  | "success"
  | "infeasible"
  | "invalid_inputs"
  | "numerical_failure"
  | "non_converged";

/** Certification residuals; null when the solve produced no candidate. */
export type ForwardSolverResiduals = {
  budget: number | null;
  /** |wᵀμ − target| (frontier points only). */
  return: number | null;
  bound: number | null;
  /** Normalized KKT / stationarity residual. */
  kkt: number | null;
};

/** One efficient-frontier point. Failed points carry no weights and are not plotted. */
export type FrontierPoint = {
  targetReturn: number;
  status: ForwardSolverStatus;
  reason: string | null;
  /** Risky weights, canonical order, summing to 1. */
  weights: number[] | null;
  expectedReturn: number | null;
  volatility: number | null;
  /** Tickers at the 0% floor or a binding cap. */
  binding: { lower: string[]; upper: string[] };
  residuals: ForwardSolverResiduals;
  iterations: number;
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
