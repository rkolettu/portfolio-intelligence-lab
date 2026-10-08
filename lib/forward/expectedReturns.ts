// V2 forward expected-return table and portfolio forward metrics (Layer B). Every
// quantity comes from the certified pieces: Task 3 Σ and Forward Model Beta, Task 4
// CAPM prior and capmRequiredReturn, Task 5 view classifications, Task 6 posterior.
// Pure and browser-safe; the result hash uses the browser-safe SHA-256.
import { FORWARD_METHODOLOGY, METHODOLOGY } from "@/config/methodology";
import { portfolioVariance } from "@/lib/analytics/riskContribution";
import type {
  BlackLittermanInputs,
  BlackLittermanPosterior,
  CapmPrior,
  CashExpectedReturnRow,
  ExpectedReturnRow,
  ForwardExpectedReturnsOutcome,
  ForwardMetric,
  ForwardRiskModel,
  PortfolioForwardOutcome,
} from "@/lib/types/forward";
import { LabError } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/utils/sha256";
import { capmRequiredReturn } from "./capm";

/** The forward model one allocation is evaluated on. Stock Lab evaluates the
 * Scenario Baseline and the Proposed Portfolio on the same context. */
export type ForwardModelContext = {
  /** Canonical risky universe. */
  tickers: readonly string[];
  /** Task 3 annual Ledoit–Wolf Σ (risky block). */
  covariance: readonly (readonly number[])[];
  /** Task 3 Forward Model Beta. */
  forwardModelBeta: readonly number[];
  /** Task 6 BL expected returns, canonical order. */
  expectedReturns: readonly number[];
  riskFreeRate: number;
  marketRiskPremium: number;
  /** CASH's expected return (Rf), from the CAPM prior result. */
  cashExpectedReturn: number;
};

/** Floating-point noise below which a weight total is used as entered (the
 * parsePortfolio rule); between it and the portfolio tolerance, the accepted
 * residual is normalized once, explicitly. */
const WEIGHT_NOISE = 1e-13;

/** Forward metrics of one allocation: expected return, Forward Model Beta, CAPM
 * required return, Expected Return Gap, model volatility on the risky weights (never
 * rescaled; CASH has zero variance) and Forward Model Sharpe when σ_p > 0. */
export function portfolioForwardMetrics(
  context: ForwardModelContext,
  weights: readonly { ticker: string; weight: number }[],
): PortfolioForwardOutcome {
  const { tickers, covariance, forwardModelBeta, expectedReturns } = context;
  const n = tickers.length;
  if (
    covariance.length !== n ||
    covariance.some((row) => row.length !== n) ||
    forwardModelBeta.length !== n ||
    expectedReturns.length !== n ||
    ![
      context.riskFreeRate,
      context.marketRiskPremium,
      context.cashExpectedReturn,
      ...forwardModelBeta,
      ...expectedReturns,
    ].every(Number.isFinite)
  )
    return {
      available: false,
      code: "invalid_inputs",
      reason: "The forward model context has inconsistent dimensions or non-finite values.",
      tickers: [],
    };
  const reject = (reason: string, names: string[] = []): PortfolioForwardOutcome => ({
    available: false,
    code: "invalid_weights",
    reason,
    tickers: names,
  });
  const bad = weights.filter((w) => !Number.isFinite(w.weight) || w.weight < 0);
  if (bad.length)
    return reject(
      "Portfolio weights must be finite and nonnegative.",
      bad.map((w) => w.ticker),
    );
  const seen = weights.map((w) => w.ticker);
  const duplicates = seen.filter((t, i) => seen.indexOf(t) !== i);
  if (duplicates.length)
    return reject("A security appears more than once in the portfolio.", [
      ...new Set(duplicates),
    ]);
  const unknown = seen.filter((t) => t !== "CASH" && !tickers.includes(t));
  if (unknown.length)
    return reject(
      "Every weighted security must be in the modeled forward universe (or be CASH).",
      unknown,
    );
  const total = weights.reduce((s, w) => s + w.weight, 0);
  if (Math.abs(total - 1) > METHODOLOGY.weightTolerance)
    return reject(
      `Portfolio weights total ${(total * 100).toFixed(6)}%; they must total 100% within the portfolio tolerance (±0.0001 percentage points). Invalid weights are rejected, never rescaled.`,
    );
  const normalized = Math.abs(total - 1) > WEIGHT_NOISE;
  const scale = normalized ? total : 1;
  const weightOf = (t: string) =>
    (weights.find((w) => w.ticker === t)?.weight ?? 0) / scale;
  const risky = tickers.map(weightOf);
  const cash = weightOf("CASH");

  const expectedReturn =
    risky.reduce((s, w, i) => s + w * expectedReturns[i], 0) +
    cash * context.cashExpectedReturn;
  const beta = risky.reduce((s, w, i) => s + w * forwardModelBeta[i], 0);
  const required = capmRequiredReturn(
    context.riskFreeRate,
    beta,
    context.marketRiskPremium,
  );
  let variance: number;
  try {
    variance = portfolioVariance(covariance, risky);
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    return {
      available: false,
      code: "numerical_failure",
      reason: error.detail.message,
      tickers: [],
    };
  }
  const volatility = Math.sqrt(variance);
  const riskyWeight = risky.reduce((s, w) => s + w, 0);
  const noRiskyAssets = risky.every((w) => w === 0);
  const sharpe: ForwardMetric =
    volatility > 0
      ? {
          available: true,
          value: (expectedReturn - context.riskFreeRate) / volatility,
        }
      : {
          available: false,
          reason: noRiskyAssets ? "No risky assets" : "Zero portfolio volatility",
        };
  const values = [expectedReturn, beta, required, variance, volatility];
  if (!values.every(Number.isFinite) || (sharpe.available && !Number.isFinite(sharpe.value)))
    return {
      available: false,
      code: "numerical_failure",
      reason: "Portfolio forward metrics are not finite.",
      tickers: [],
    };
  return {
    available: true,
    metrics: {
      weights: { tickers: [...tickers], risky, cash },
      weightTotal: total,
      normalized,
      riskyWeight,
      noRiskyAssets,
      expectedReturn,
      forwardModelBeta: beta,
      capmRequiredReturn: required,
      expectedReturnGap: expectedReturn - required,
      modelVariance: variance,
      modelVolatility: volatility,
      forwardModelSharpe: sharpe,
      expectedReturnContributions: [
        ...tickers.map((ticker, i) => ({
          ticker,
          weight: risky[i],
          expectedReturn: expectedReturns[i],
          contribution: risky[i] * expectedReturns[i],
        })),
        ...(seen.includes("CASH")
          ? [
              {
                ticker: "CASH",
                weight: cash,
                expectedReturn: context.cashExpectedReturn,
                contribution: cash * context.cashExpectedReturn,
              },
            ]
          : []),
      ],
    },
  };
}

/** The shared forward expected-return table, the portfolio's forward metrics and the
 * deterministic result hash. Every input must describe the same risk model, in its
 * canonical order. */
export function buildForwardExpectedReturns(input: {
  riskModel: Pick<ForwardRiskModel, "tickers" | "covariance" | "hash">;
  capmPrior: CapmPrior;
  inputs: BlackLittermanInputs;
  posterior: BlackLittermanPosterior;
  weights: readonly { ticker: string; weight: number }[];
}): ForwardExpectedReturnsOutcome {
  const { riskModel: model, capmPrior: prior, inputs, posterior } = input;
  const tickers = model.tickers;
  const invalid = (reason: string): ForwardExpectedReturnsOutcome => ({
    available: false,
    code: "invalid_inputs",
    reason,
    tickers: [],
  });
  if (
    [prior.riskModelHash, inputs.riskModelHash, posterior.riskModelHash].some(
      (h) => h !== model.hash,
    )
  )
    return invalid(
      "The CAPM prior, view inputs and posterior must come from the same forward risk model.",
    );
  const same = (list: readonly string[]) =>
    list.length === tickers.length && list.every((t, i) => t === tickers[i]);
  if (
    !same(prior.rows.map((r) => r.ticker)) ||
    !same(inputs.securities.map((c) => c.ticker)) ||
    !same(posterior.universeTickers) ||
    prior.rows.some((r, i) => r.capmPrior !== posterior.capmPrior[i])
  )
    return invalid(
      "The CAPM prior, view inputs and posterior must follow the risk model's canonical order and share one prior.",
    );

  const rows: ExpectedReturnRow[] = tickers.map((ticker, i) => {
    const c = inputs.securities[i];
    const bl = posterior.blackLittermanExpectedReturn[i];
    return {
      ticker,
      forwardModelBeta: prior.rows[i].forwardModelBeta,
      capmPrior: prior.rows[i].capmPrior,
      viewStatus: c.status,
      requestedSource: c.requestedSource,
      viewSource: c.source,
      viewBasis: c.basis,
      viewReturn: c.viewReturn,
      confidence: c.confidence,
      viewReason: c.reason,
      blackLittermanExpectedReturn: bl,
      expectedReturnGap: bl - prior.rows[i].capmPrior,
    };
  });
  const portfolio = portfolioForwardMetrics(
    {
      tickers,
      covariance: model.covariance,
      forwardModelBeta: prior.rows.map((r) => r.forwardModelBeta),
      expectedReturns: posterior.blackLittermanExpectedReturn,
      riskFreeRate: prior.riskFreeRate,
      marketRiskPremium: prior.marketRiskPremium,
      cashExpectedReturn: prior.cash.expectedReturn,
    },
    input.weights,
  );
  if (!portfolio.available) return portfolio;
  const p = portfolio.metrics;
  const cash: CashExpectedReturnRow | null = input.weights.some(
    (w) => w.ticker === "CASH",
  )
    ? {
        ticker: "CASH",
        forwardModelBeta: 0,
        capmPrior: prior.cash.expectedReturn,
        viewStatus: "NO_VIEW",
        blackLittermanExpectedReturn: prior.cash.expectedReturn,
        expectedReturnGap: 0,
      }
    : null;

  // The canonical economic payload: fixed key order, canonical ticker order, and
  // only values that change the financial result (no labels, timestamps, cache ages
  // or display state). It sits above, and records, the risk-model hash.
  const payload = {
    kind: "forward-expected-returns",
    methodologyVersion: FORWARD_METHODOLOGY.version,
    riskModelHash: model.hash,
    marketProxy: prior.marketProxy,
    riskWindow: prior.riskWindow,
    riskFree: {
      series: "DGS1",
      observationDate: prior.riskFreeObservationDate,
      annualYield: prior.riskFreeRate,
    },
    marketRiskPremium: prior.marketRiskPremium,
    tau: posterior.tau,
    tickers: [...tickers],
    activeViews: posterior.activeViews.map((v) => [
      v.ticker,
      v.source,
      v.basis,
      v.confidence,
      v.viewReturn,
    ]),
    capmPrior: rows.map((r) => r.capmPrior),
    blackLittermanExpectedReturn: rows.map((r) => r.blackLittermanExpectedReturn),
    portfolio: {
      risky: p.weights.risky,
      cash: p.weights.cash,
      expectedReturn: p.expectedReturn,
      forwardModelBeta: p.forwardModelBeta,
      capmRequiredReturn: p.capmRequiredReturn,
      expectedReturnGap: p.expectedReturnGap,
      modelVariance: p.modelVariance,
      forwardModelSharpe: p.forwardModelSharpe.available
        ? p.forwardModelSharpe.value
        : null,
    },
  };

  return {
    available: true,
    result: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: model.hash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      riskFreeRate: prior.riskFreeRate,
      riskFreeObservationDate: prior.riskFreeObservationDate,
      marketRiskPremium: prior.marketRiskPremium,
      expectedMarketReturn: prior.expectedMarketReturn,
      tau: posterior.tau,
      rows,
      cash,
      activeViewCount: posterior.activeViews.length,
      notApplicableViews: inputs.notApplicable,
      invalidViews: inputs.invalid,
      blackLittermanStatus: posterior.status,
      certification: posterior.certification,
      portfolio: p,
      resultHash: sha256Hex(JSON.stringify(payload)),
    },
  };
}
