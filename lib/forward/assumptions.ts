import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ForwardAssumptionState,
  ForwardAssumptions,
  MarketProxy,
  ViewInput,
} from "@/lib/types/forward";

/** Defaults: 3Y risk window, VTI market proxy, 5.00% Market Risk Premium. */
export const DEFAULT_FORWARD_ASSUMPTIONS: ForwardAssumptions = Object.freeze({
  riskWindow: FORWARD_METHODOLOGY.defaultRiskWindow,
  marketProxy: FORWARD_METHODOLOGY.defaultMarketProxy,
  marketRiskPremium: FORWARD_METHODOLOGY.defaultMarketRiskPremium,
});

/** A security with no view: the model uses its CAPM prior. Confidence keeps the
 * 50% default for when a view is later selected. */
export function defaultView(): ViewInput {
  return {
    source: "none",
    manualReturn: null,
    confidence: FORWARD_METHODOLOGY.views.defaultConfidence,
  };
}

export function defaultForwardState(): ForwardAssumptionState {
  return { assumptions: { ...DEFAULT_FORWARD_ASSUMPTIONS }, views: {} };
}

/** Exact labels for forward concepts. Shown wherever two similar statistics could be
 * confused (forward vs historical beta and Sharpe, Model CAL vs CML). UI text only:
 * kept out of FORWARD_METHODOLOGY so wording edits never change a methodology hash. */
export const FORWARD_LABELS = {
  outlook: "Next 12 Months",
  marketRiskPremium: "Market Risk Premium",
  assumption: "Assumption",
  marketProxy: "Market Proxy",
  /** Shown with its observation date and source; never called live. */
  forwardRiskFree: "Forward Risk-Free Rate",
  forwardRiskFreeSource: "1Y U.S. Treasury",
  latestAvailable: "Latest Available",
  modelBeta: "Forward Model Beta",
  modelBetaLong: "Model Beta vs Market Proxy",
  historicalBeta: "Historical Beta vs Benchmark",
  forwardSharpe: "Forward Model Sharpe",
  historicalSharpe: "Historical Sharpe",
  capmPrior: "CAPM Prior",
  capmRequired: "CAPM Required Return",
  blExpectedReturn: "BL Expected Return",
  expectedReturnGap: "Expected Return Gap",
  positiveGap: "Positive Expected Return Gap",
  negativeGap: "Negative Expected Return Gap",
  efficientFrontier: "Efficient Frontier",
  gmv: "Global Minimum Variance",
  tangency: "Tangency Portfolio",
  modelCal: "Model Capital Allocation Line",
  modelCalShort: "Model CAL",
  marketCmlProxy: "Market CML Proxy",
  sml: "Security Market Line",
  requestedRiskWindow: "Requested Risk Window",
  effectiveRiskWindow: "Effective Risk Window",
  /** Sample correlation on the risk model's common sample; never the shrunk Σ. */
  historicalCorrelation: "Historical Correlation",
  scenarioBaseline: "Scenario Baseline",
  proposedPortfolio: "Proposed Portfolio",
  /** Manual View basis: same as the CAPM prior and the BL vector. */
  manualView: "12M Expected Total Return",
  /** Street View basis: a price-only return, never relabelled as total return. */
  streetReturn: "12M Price-Target Return · Dividends Excluded",
  ratingsCounted: "Ratings Counted",
  retrieved: "Retrieved",
  borrowingExtension:
    "Requires borrowing/leverage at the assumed risk-free rate and is outside the lab's modeled allocation constraints.",
  /** Q40: Portfolio Theory's note on the Constructor's Minimum Variance. */
  gmvConstructorNote:
    "Portfolio Theory GMV uses the forward risk model and selected historical risk window. The Constructor uses its own analysis-period covariance and may therefore produce a different Minimum Variance allocation.",
  /** Task 11: shown in place of the Market CML Proxy when MRP ≤ 1e-12. The dashed
   * region of the Model CAL and of the proxy both reuse `borrowingExtension`. */
  marketCmlProxyUnavailable:
    "The Market CML Proxy is not shown because the Market Risk Premium assumption is zero, negative or too small to distinguish from zero (not above 1e-12). The market proxy then offers no meaningful expected return above the risk-free rate, so a capital market line through it would be misleading.",
  /** Task 11: SML note when MRP = 0. */
  smlFlat:
    "With a Market Risk Premium of 0%, the model expects the risk-free rate at every Forward Model Beta, so the Security Market Line is flat.",
  /** Task 11: SML note when MRP < 0. */
  smlDownward:
    "With a negative Market Risk Premium, model expected return falls as Forward Model Beta rises, so the Security Market Line slopes downward.",
} as const;

/** "Forward Model Beta vs VTI": always names the selected proxy, never bare "Beta". */
export const modelBetaLabel = (proxy: MarketProxy) =>
  `${FORWARD_LABELS.modelBeta} vs ${proxy}`;
