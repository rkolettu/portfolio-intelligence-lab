import type { ModelRisk } from "@/lib/types/construction";
import { LabError } from "@/lib/utils/errors";
import { riskContributions } from "@/lib/analytics/riskContribution";
import { weightedAverageVolatility } from "@/lib/analytics/diversification";

/** Construction Model Risk: the Phase 4 Euler decomposition evaluated on
 * Σ_construction (the optimizer's own estimator), for any allocation. CASH stays
 * outside Σ, so risky weights are not renormalized. Kept separate from the Phase 4
 * Historical Risk Analysis on the sample covariance. */
export function modelRisk(input: {
  covariance: readonly (readonly number[])[];
  tickers: readonly string[];
  weights: readonly number[];
  cashWeight?: number;
}): ModelRisk {
  const { covariance, tickers, weights } = input;
  const cash = { weight: input.cashWeight ?? 0, contribution: 0 as const };
  try {
    const sigma = covariance.map((row, i) => Math.sqrt(row[i]));
    const decomposition = riskContributions(covariance, weights);
    const waVol = weightedAverageVolatility(weights, sigma);
    const ok = decomposition.ok ? decomposition : null;
    return {
      available: true,
      variance: decomposition.variance,
      volatility: ok ? ok.volatility : 0,
      weightedAverageVolatility: waVol,
      diversificationRatio: ok ? waVol / ok.volatility : null,
      holdings: tickers.map((ticker, i) => ({
        ticker,
        weight: weights[i],
        standaloneVolatility: sigma[i],
        marginal: ok ? ok.marginal[i] : null,
        component: ok ? ok.component[i] : null,
        percentage: ok ? ok.percentage[i] : null,
      })),
      residuals: ok ? ok.residuals : null,
      cash,
    };
  } catch (error) {
    if (error instanceof LabError)
      return { available: false, reason: error.detail.message };
    throw error;
  }
}

/** Zero-risk model for an allocation with no risky exposure (all CASH): volatility
 * 0, no risky contributions, CASH contributing exactly 0. Standalone volatilities
 * are shown when a construction covariance exists, otherwise unavailable. */
export function zeroRiskModel(input: {
  tickers: readonly string[];
  standalone: readonly number[] | null;
  cashWeight: number;
}): ModelRisk {
  return {
    available: true,
    variance: 0,
    volatility: 0,
    weightedAverageVolatility: 0,
    diversificationRatio: null,
    holdings: input.tickers.map((ticker, i) => ({
      ticker,
      weight: 0,
      standaloneVolatility: input.standalone ? input.standalone[i] : null,
      marginal: null,
      component: null,
      percentage: null,
    })),
    residuals: null,
    cash: { weight: input.cashWeight, contribution: 0 },
  };
}
