// V2 line engine (Layer B, Task 11): the Model Capital Allocation Line, the Market
// CML Proxy and the Security Market Line as DEFINITIONS (intercept, slope) plus
// semantic breakpoints. No chart domain, colours, dash styles or UI live here: the
// chart layer draws capital lines solid from σ = 0 to `solidThroughVolatility` and
// dashed beyond it (borrowing/leverage at Rf), and evaluates the SML over its own β
// axis. Every formula has exactly one implementation:
// - capital lines (CAL, CML proxy): capitalLineReturnAt;
// - SML: securityMarketLineReturnAt → the Task 4 capmRequiredReturn.
// Inputs are the certified upstream results only (Task 10 tangency, Task 4 CAPM
// prior, Task 3 σ_m). Pure and browser-safe.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  CapmPrior,
  ForwardRiskModel,
  MarketCmlProxyOutcome,
  ModelCalOutcome,
  SecurityMarketLine,
  SecurityMarketLineOutcome,
  TangencyOutcome,
} from "@/lib/types/forward";
import { fail } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/utils/sha256";
import { capmRequiredReturn, expectedMarketReturn } from "./capm";

const L = FORWARD_METHODOLOGY.lines;
const MRP_TOLERANCE = FORWARD_METHODOLOGY.tangency.positiveExcessReturnTolerance;

/** E[R](σ) = intercept + slope·σ for a capital line (Model CAL or Market CML Proxy). */
export function capitalLineReturnAt(
  line: { intercept: number; slope: number },
  volatility: number,
): number {
  if (
    !Number.isFinite(line.intercept) ||
    !Number.isFinite(line.slope) ||
    !Number.isFinite(volatility)
  )
    fail(
      "INVALID_INPUT",
      "A capital line return needs a finite intercept, slope and volatility.",
    );
  return line.intercept + line.slope * volatility;
}

/** E[R](β) on the SML, through the canonical capmRequiredReturn(Rf, β, MRP). */
export function securityMarketLineReturnAt(line: SecurityMarketLine, beta: number): number {
  return capmRequiredReturn(line.intercept, beta, line.slope);
}

/** The rounding allowance of an anchor identity y = intercept + slope·x:
 * anchorAllowanceUlps·ε·(|intercept| + |slope·x| + |y|). */
const anchorAllowance = (intercept: number, slope: number, x: number, y: number) =>
  L.anchorAllowanceUlps *
  Number.EPSILON *
  (Math.abs(intercept) + Math.abs(slope * x) + Math.abs(y));

/** The canonical Rf lineage shared by the market-line hashes. */
const riskFreeLineage = (prior: Pick<CapmPrior, "riskFreeObservationDate" | "riskFreeRate">) => ({
  series: "DGS1",
  observationDate: prior.riskFreeObservationDate,
  annualYield: prior.riskFreeRate,
});

/** The Model CAL from the certified tangency; unavailable (reason carried through)
 * whenever the tangency is. */
export function buildModelCal(tangency: TangencyOutcome): ModelCalOutcome {
  if (!tangency.available)
    return {
      available: false,
      code: tangency.code,
      reason: tangency.reason,
      cause: tangency.cause,
    };
  const t = tangency.tangency;
  const intercept = t.riskFreeRate;
  const slope = t.forwardModelSharpe;
  const sigma = t.volatility;
  const mu = t.expectedReturn;
  const numericalFailure = (reason: string): ModelCalOutcome => ({
    available: false,
    code: "numerical_failure",
    cause: "certification_failed",
    reason,
  });
  if (
    !Number.isFinite(intercept) ||
    !Number.isFinite(slope) ||
    !Number.isFinite(sigma) ||
    !Number.isFinite(mu) ||
    !(sigma > 0)
  )
    return numericalFailure(
      `The tangency must have a finite Rf, Forward Model Sharpe and expected return and a positive, finite volatility (Rf ${intercept}, Sharpe ${slope}, σ_t ${sigma}, μ_t ${mu}); no Model CAL is drawn.`,
    );
  // Anchor identity: the line passes through the tangency (σ_t, μ_t).
  const residual = Math.abs(capitalLineReturnAt({ intercept, slope }, sigma) - mu);
  const allowance = anchorAllowance(intercept, slope, sigma, mu);
  if (!(residual <= allowance))
    return numericalFailure(
      `The Model CAL does not pass through the tangency: |Rf + Sharpe·σ_t − μ_t| = ${residual} exceeds the rounding allowance ${allowance}; no Model CAL is drawn.`,
    );

  const methodologyVersion = FORWARD_METHODOLOGY.version;
  // Economic lineage only: no labels, timestamps, chart domain or display state.
  const lineHash = sha256Hex(
    JSON.stringify({
      kind: "model_cal",
      methodologyVersion,
      tangencyHash: t.tangencyHash,
      intercept,
      slope,
      solidThroughVolatility: sigma,
    }),
  );
  return {
    available: true,
    line: {
      kind: "model_cal",
      methodologyVersion,
      riskModelHash: t.riskModelHash,
      marketProxy: t.marketProxy,
      riskWindow: t.riskWindow,
      riskFreeRate: t.riskFreeRate,
      riskFreeObservationDate: t.riskFreeObservationDate,
      lineHash,
      intercept,
      slope,
      solidThroughVolatility: sigma,
      tangencyVolatility: sigma,
      tangencyExpectedReturn: mu,
      tangencyHash: t.tangencyHash,
      anchorResidual: residual,
      anchorAllowance: allowance,
    },
  };
}

/** The Market CML Proxy from the CAPM prior (Rf, MRP, E[R_m] = Rf + MRP) and the
 * risk model's σ_m; unavailable when MRP ≤ 1e-12. */
export function buildMarketCmlProxy(input: {
  riskModel: Pick<ForwardRiskModel, "hash" | "marketProxy" | "marketVolatility">;
  capmPrior: CapmPrior;
}): MarketCmlProxyOutcome {
  const { riskModel: m, capmPrior: prior } = input;
  const rf = prior.riskFreeRate;
  const mrp = prior.marketRiskPremium;
  const marketReturn = prior.expectedMarketReturn;
  const sigmaM = m.marketVolatility;
  const invalid = (reason: string): MarketCmlProxyOutcome => ({
    available: false,
    code: "invalid_inputs",
    reason,
    marketRiskPremium: Number.isFinite(mrp) ? mrp : null,
  });

  if (prior.riskModelHash !== m.hash)
    return invalid("The CAPM prior and σ_m must come from the same forward risk model.");
  if (prior.marketProxy !== m.marketProxy)
    return invalid("The CAPM prior and the risk model must use the same market proxy.");
  if (!Number.isFinite(rf) || !Number.isFinite(mrp) || !Number.isFinite(marketReturn))
    return invalid(
      "The Market CML Proxy needs a finite risk-free rate, Market Risk Premium and expected market return.",
    );
  if (marketReturn !== expectedMarketReturn(rf, mrp))
    return invalid(
      "The expected market return must be the canonical Rf + MRP of the CAPM prior.",
    );
  if (!Number.isFinite(sigmaM) || !(sigmaM > 0))
    return invalid("The market proxy's model volatility σ_m must be positive and finite.");

  // At or below the tolerance the proxy offers no meaningful expected excess return
  // (for MRP ≤ 0 the risk-free asset weakly dominates it; 0 < MRP ≤ 1e-12 is
  // indistinguishable from zero): no flat or downward line is drawn in its place.
  if (!(mrp > MRP_TOLERANCE))
    return {
      available: false,
      code: "market_proxy_has_no_positive_expected_excess_return",
      reason: `The market proxy's expected excess return (the Market Risk Premium, ${mrp}) is zero, negative or too small to distinguish from zero (not above the ${MRP_TOLERANCE} tolerance), so the proxy offers no meaningful expected return above the risk-free rate and no Capital Market Line proxy is drawn. The Market Risk Premium assumption itself is unchanged.`,
      marketRiskPremium: mrp,
    };

  const intercept = rf;
  const slope = mrp / sigmaM;
  if (!Number.isFinite(slope))
    return invalid(`The Market CML Proxy slope MRP/σ_m (${slope}) is not finite.`);
  // Anchor identity: the line passes through the proxy (σ_m, Rf + MRP).
  const residual = Math.abs(capitalLineReturnAt({ intercept, slope }, sigmaM) - marketReturn);
  const allowance = anchorAllowance(intercept, slope, sigmaM, marketReturn);
  if (!(residual <= allowance))
    return invalid(
      `The Market CML Proxy does not pass through the market proxy: |Rf + (MRP/σ_m)·σ_m − E[R_m]| = ${residual} exceeds the rounding allowance ${allowance}.`,
    );

  const methodologyVersion = FORWARD_METHODOLOGY.version;
  // Economic lineage only: no labels, timestamps, chart domain or display state.
  const lineHash = sha256Hex(
    JSON.stringify({
      kind: "market_cml_proxy",
      methodologyVersion,
      riskModelHash: m.hash,
      marketProxy: m.marketProxy,
      riskWindow: prior.riskWindow,
      riskFree: riskFreeLineage(prior),
      marketRiskPremium: mrp,
      marketProxyVolatility: sigmaM,
    }),
  );
  return {
    available: true,
    line: {
      kind: "market_cml_proxy",
      methodologyVersion,
      riskModelHash: m.hash,
      marketProxy: m.marketProxy,
      riskWindow: prior.riskWindow,
      riskFreeRate: rf,
      riskFreeObservationDate: prior.riskFreeObservationDate,
      lineHash,
      marketRiskPremium: mrp,
      intercept,
      slope,
      marketProxyVolatility: sigmaM,
      expectedMarketReturn: marketReturn,
      solidThroughVolatility: sigmaM,
      anchorResidual: residual,
      anchorAllowance: allowance,
    },
  };
}

/** The SML from the CAPM prior; defined for every valid MRP. */
export function buildSecurityMarketLine(input: { capmPrior: CapmPrior }): SecurityMarketLineOutcome {
  const { capmPrior: prior } = input;
  const rf = prior.riskFreeRate;
  const mrp = prior.marketRiskPremium;
  if (!Number.isFinite(rf) || !Number.isFinite(mrp))
    return {
      available: false,
      code: "invalid_inputs",
      reason: "The Security Market Line needs a finite risk-free rate and Market Risk Premium.",
    };

  const methodologyVersion = FORWARD_METHODOLOGY.version;
  // Economic lineage only: no labels, timestamps, chart domain or display state.
  const lineHash = sha256Hex(
    JSON.stringify({
      kind: "security_market_line",
      methodologyVersion,
      riskModelHash: prior.riskModelHash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      riskFree: riskFreeLineage(prior),
      marketRiskPremium: mrp,
    }),
  );
  return {
    available: true,
    line: {
      kind: "security_market_line",
      methodologyVersion,
      riskModelHash: prior.riskModelHash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      riskFreeRate: rf,
      riskFreeObservationDate: prior.riskFreeObservationDate,
      lineHash,
      marketRiskPremium: mrp,
      intercept: rf,
      slope: mrp,
      direction: mrp > 0 ? "upward" : mrp === 0 ? "flat" : "downward",
    },
  };
}
