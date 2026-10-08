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
import type {
  CapmPrior,
  ForwardRiskModel,
  MarketCmlProxyOutcome,
  ModelCalOutcome,
  SecurityMarketLine,
  SecurityMarketLineOutcome,
  TangencyOutcome,
} from "@/lib/types/forward";

/** E[R](σ) = intercept + slope·σ for a capital line (Model CAL or Market CML Proxy). */
export function capitalLineReturnAt(
  line: { intercept: number; slope: number },
  volatility: number,
): number {
  void line;
  void volatility;
  throw new Error("Task 11: not implemented");
}

/** E[R](β) on the SML, through the canonical capmRequiredReturn(Rf, β, MRP). */
export function securityMarketLineReturnAt(line: SecurityMarketLine, beta: number): number {
  void line;
  void beta;
  throw new Error("Task 11: not implemented");
}

/** The Model CAL from the certified tangency; unavailable (reason carried through)
 * whenever the tangency is. */
export function buildModelCal(tangency: TangencyOutcome): ModelCalOutcome {
  void tangency;
  throw new Error("Task 11: not implemented");
}

/** The Market CML Proxy from the CAPM prior (Rf, MRP, E[R_m] = Rf + MRP) and the
 * risk model's σ_m; unavailable when MRP ≤ 1e-12. */
export function buildMarketCmlProxy(input: {
  riskModel: Pick<ForwardRiskModel, "hash" | "marketProxy" | "marketVolatility">;
  capmPrior: CapmPrior;
}): MarketCmlProxyOutcome {
  void input;
  throw new Error("Task 11: not implemented");
}

/** The SML from the CAPM prior; defined for every valid MRP. */
export function buildSecurityMarketLine(input: { capmPrior: CapmPrior }): SecurityMarketLineOutcome {
  void input;
  throw new Error("Task 11: not implemented");
}
