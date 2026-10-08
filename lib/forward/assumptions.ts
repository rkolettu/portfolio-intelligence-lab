import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ForwardAssumptionState,
  ForwardAssumptions,
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
  forwardRiskFree: "Forward Risk-Free · 1Y U.S. Treasury",
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
  effectiveRiskWindow: "Effective Risk Window",
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
} as const;
