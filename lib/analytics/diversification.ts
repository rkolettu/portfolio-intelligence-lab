import { RISK_METHODOLOGY } from "@/config/methodology";
import { sampleStandardDeviation } from "@/lib/utils/numerical";
import { fail } from "@/lib/utils/errors";

/** vol_i = sampleStdDev(daily return_i) × sqrt(252). */
export function standaloneVolatility(returns: readonly number[]): number {
  return (
    sampleStandardDeviation(returns) *
    Math.sqrt(RISK_METHODOLOGY.riskAnnualization)
  );
}

/** WA Vol = Σ w_i × vol_i over capital weights (CASH contributes vol 0). */
export function weightedAverageVolatility(
  weights: readonly number[],
  volatilities: readonly number[],
): number {
  if (weights.length !== volatilities.length)
    fail("INVALID_INPUT", "Weights must match volatilities.");
  return weights.reduce((s, w, i) => s + w * volatilities[i], 0);
}

/** Capital concentration over ALL positive weights, CASH included. Measures weight
 * concentration, not correlation diversification. Ties keep portfolio order. */
export function concentration(
  holdings: readonly { ticker: string; weight: number }[],
) {
  if (!holdings.length)
    fail("INVALID_INPUT", "Concentration requires holdings.");
  const hhi = holdings.reduce((s, h) => s + h.weight ** 2, 0);
  const ranked = holdings
    .map((h, order) => ({ ...h, order }))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  const top = ranked.slice(0, 3);
  return {
    hhi,
    effectiveHoldings: 1 / hhi,
    largest: { ticker: ranked[0].ticker, weight: ranked[0].weight },
    top3: {
      tickers: top.map((h) => h.ticker),
      weight: top.reduce((s, h) => s + h.weight, 0),
    },
  };
}
