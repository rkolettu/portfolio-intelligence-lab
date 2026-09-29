import { RISK_METHODOLOGY } from "@/config/methodology";
import { alignHoldings } from "@/lib/backtest/alignment";
import type {
  BenchmarkAlignment,
  HoldingRisk,
  LedgerRow,
  Metric,
  RiskAnalytics,
  Sample,
} from "@/lib/types/analytics";
import type { Result } from "@/lib/types/data";
import type { PortfolioHolding } from "@/lib/types/portfolio";
import { isEffectivelyZero } from "@/lib/utils/numerical";
import { LabError } from "@/lib/utils/errors";
import { beta } from "./benchmark";
import { correlationMatrix, extremePairs } from "./correlation";
import {
  annualizeCovariance,
  covarianceDiagnostics,
  sampleCovarianceMatrix,
} from "./covariance";
import {
  concentration,
  standaloneVolatility,
  weightedAverageVolatility,
} from "./diversification";
import { returnContribution } from "./returnContribution";
import { riskContributions } from "./riskContribution";

const { minimumObservations, normalObservations } = RISK_METHODOLOGY;
const na = (reason: string): Metric => ({ available: false, reason });
const ok = (value: number, sample: Sample, notes: string[] = []): Metric => ({
  available: true,
  value,
  sample,
  ...(notes.length ? { notes } : {}),
});
const RISKLESS =
  "CASH is modeled as locally riskless (zero volatility and covariance) in this decomposition; its historical accrual still enters realized volatility.";

/** Phase 4 risk layer. One canonical risky-holding sample drives covariance,
 * correlation, standalone volatility and target-weight risk contribution. Capital
 * concentration and arithmetic return contribution do not depend on it. Pure. */
export function summarizeRisk(input: {
  holdings: readonly PortfolioHolding[];
  ledger: readonly LedgerRow[];
  /** The full backtest sample (return contribution spans every interval). */
  sample: Sample;
  benchmarkAlignment: Result<BenchmarkAlignment>;
}): RiskAnalytics {
  const { holdings, ledger, sample: fullSample, benchmarkAlignment } = input;
  const aligned = alignHoldings(holdings, ledger);
  const n = aligned.sample?.returnCount ?? 0;
  const allCash = aligned.tickers.length === 0;

  // Holding betas: Phase 3 beta on the Phase 3 benchmark-aligned intervals.
  const byDate = new Map(ledger.map((r) => [r.date, r]));
  const betaFor = (index: number): Metric => {
    if (!benchmarkAlignment.ok) return na(benchmarkAlignment.error.message);
    const a = benchmarkAlignment.value;
    if (!a.sample)
      return na(
        "The benchmark has no return interval overlapping the portfolio sample.",
      );
    const h = a.observations.map(
      (o) => byDate.get(o.date)!.holdingReturns[index],
    );
    const b = a.observations.map((o) => o.benchmarkReturn);
    const result = beta(h, b);
    return result.ok
      ? ok(result.value, a.sample, [
          `Benchmark-aligned sample (${a.sample.returnCount} returns, ${a.sample.startDate} → ${a.sample.endDate}); may differ from the covariance sample.`,
          ...result.notes,
        ])
      : na(result.reason);
  };

  const contribution = returnContribution(holdings, ledger);
  const base = {
    methodologyVersion: RISK_METHODOLOGY.version,
    label: RISK_METHODOLOGY.label,
    concentration: concentration(holdings),
    returnContribution: { sample: fullSample, ...contribution },
  };

  if (allCash) {
    const reason =
      "The portfolio is entirely CASH; there are no risky holdings for a covariance matrix.";
    const zeroNote = [
      "Entirely CASH, modeled as locally riskless: target-weight volatility is zero.",
    ];
    return {
      ...base,
      sample: { available: false, reason, observationCount: 0 },
      covariance: { available: false, reason },
      correlation: { available: false, reason },
      portfolio: {
        volatility: ok(0, fullSample, zeroNote),
        variance: ok(0, fullSample, zeroNote),
        weightedAverageVolatility: ok(0, fullSample, zeroNote),
        diversificationRatio: na(
          "The diversification ratio is undefined when target-weight volatility is zero.",
        ),
        identityResiduals: null,
      },
      holdings: holdings.map((h) => ({
        ticker: h.ticker,
        weight: h.weight,
        riskless: true,
        volatility: ok(0, fullSample, [RISKLESS]),
        beta: na(
          "CASH is treated as locally riskless and excluded from risky analytics.",
        ),
        marginal: na("Undefined: target-weight portfolio volatility is zero."),
        component: na("Undefined: target-weight portfolio volatility is zero."),
        percentage: na(
          "Undefined: target-weight portfolio volatility is zero.",
        ),
      })),
    };
  }

  const insufficient =
    !aligned.sample || n < minimumObservations
      ? `Only ${n} common daily observations across all risky holdings; covariance-based risk requires at least ${minimumObservations}.`
      : null;
  const riskIndex = new Map(aligned.tickers.map((t, k) => [t, k]));

  // One typed unavailable state for the whole covariance family (insufficient
  // sample or a genuine numerical failure); history and capital metrics survive.
  const unavailableFamily = (
    reason: string,
    observationCount: number,
  ): RiskAnalytics => ({
    ...base,
    sample: { available: false, reason, observationCount },
    covariance: { available: false, reason },
    correlation: { available: false, reason },
    portfolio: {
      volatility: na(reason),
      variance: na(reason),
      weightedAverageVolatility: na(reason),
      diversificationRatio: na(reason),
      identityResiduals: null,
    },
    holdings: holdings.map((h, index) => ({
      ticker: h.ticker,
      weight: h.weight,
      riskless: h.ticker === "CASH",
      volatility: h.ticker === "CASH" ? na(RISKLESS) : na(reason),
      beta:
        h.ticker === "CASH"
          ? na(
              "CASH is treated as locally riskless and excluded from risky analytics.",
            )
          : betaFor(index),
      marginal: na(reason),
      component: na(reason),
      percentage: na(reason),
    })),
  });
  if (insufficient) return unavailableFamily(insufficient, n);
  try {
    return covarianceFamily();
  } catch (error) {
    if (error instanceof LabError)
      return unavailableFamily(
        `Covariance-based risk unavailable: ${error.detail.message}`,
        n,
      );
    throw error;
  }

  function covarianceFamily(): RiskAnalytics {
    const sample = aligned.sample!;
    const status = n < normalObservations ? "limited" : "normal";
    const sampleNotes =
      status === "limited"
        ? [
            `Limited history: ${n} common observations (${minimumObservations}–${normalObservations - 1}); covariance estimates are unstable.`,
          ]
        : [];
    const columns = aligned.tickers.map((_, k) =>
      aligned.rows.map((r) => r.returns[k]),
    );
    const daily = sampleCovarianceMatrix(columns);
    const annual = annualizeCovariance(daily);
    const diagnostics = covarianceDiagnostics(annual);
    const constant = columns.map((c, i) =>
      isEffectivelyZero(Math.sqrt(daily[i][i]), c),
    );
    const correlation = correlationMatrix(daily, constant);
    const pairs = extremePairs(aligned.tickers, correlation);
    const vols = columns.map((c, i) =>
      constant[i] ? 0 : standaloneVolatility(c),
    );
    const decomposition = riskContributions(annual, aligned.weights);
    const waVol = weightedAverageVolatility(aligned.weights, vols);
    const notes = [
      ...sampleNotes,
      ...(diagnostics.singular
        ? [
            "The covariance matrix is singular (duplicate, perfectly correlated or constant holdings); target-weight risk is still defined, but the matrix is not invertible.",
          ]
        : []),
    ];

    const holdingRisk: HoldingRisk[] = holdings.map((h, index) => {
      const k = riskIndex.get(h.ticker);
      if (h.ticker === "CASH" || k === undefined)
        return {
          ticker: h.ticker,
          weight: h.weight,
          riskless: true,
          volatility: ok(0, sample, [RISKLESS]),
          beta: na(
            "CASH is treated as locally riskless and excluded from risky analytics.",
          ),
          // CASH has a zero row in the decomposition, so its contributions are exactly 0.
          marginal: decomposition.ok
            ? ok(0, sample, [RISKLESS])
            : na(decomposition.reason),
          component: decomposition.ok
            ? ok(0, sample, [RISKLESS])
            : na(decomposition.reason),
          percentage: decomposition.ok
            ? ok(0, sample, [RISKLESS])
            : na(decomposition.reason),
        };
      return {
        ticker: h.ticker,
        weight: h.weight,
        riskless: false,
        volatility: ok(vols[k], sample, [
          ...sampleNotes,
          ...(constant[k]
            ? [
                "Constant daily returns: zero standalone volatility; correlations undefined.",
              ]
            : []),
        ]),
        beta: betaFor(index),
        marginal: decomposition.ok
          ? ok(decomposition.marginal[k], sample, sampleNotes)
          : na(decomposition.reason),
        component: decomposition.ok
          ? ok(decomposition.component[k], sample, sampleNotes)
          : na(decomposition.reason),
        percentage: decomposition.ok
          ? ok(decomposition.percentage[k], sample, sampleNotes)
          : na(decomposition.reason),
      };
    });

    return {
      ...base,
      sample: {
        available: true,
        sample,
        status,
        tickers: aligned.tickers,
        cashWeight: aligned.cashWeight,
        notes,
      },
      covariance: {
        available: true,
        tickers: aligned.tickers,
        daily,
        annual,
        diagnostics,
      },
      correlation: {
        available: true,
        tickers: aligned.tickers,
        matrix: correlation,
        highest: pairs.highest,
        lowest: pairs.lowest,
        undefinedTickers: aligned.tickers.filter((_, i) => constant[i]),
      },
      portfolio: {
        volatility: decomposition.ok
          ? ok(decomposition.volatility, sample, notes)
          : ok(0, sample, [
              ...notes,
              "Target-weight portfolio volatility is zero within numerical tolerance.",
            ]),
        variance: ok(decomposition.variance, sample, notes),
        weightedAverageVolatility: ok(waVol, sample, sampleNotes),
        diversificationRatio: decomposition.ok
          ? ok(waVol / decomposition.volatility, sample, sampleNotes)
          : na(
              "The diversification ratio is undefined when target-weight volatility is zero.",
            ),
        identityResiduals: decomposition.ok ? decomposition.residuals : null,
      },
      holdings: holdingRisk,
    };
  }
}
