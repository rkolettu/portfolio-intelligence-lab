// V2 forward risk model (Layer B). One common aligned sample across the forward
// risky universe (zero-weight rows included) and the market proxy; one Ledoit–Wolf
// covariance over all of them; Forward Model Beta and σ_m from that same matrix.
// Every estimator, validator and coverage rule is the existing one: nothing here
// is a second covariance implementation.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { portfolioCoverage } from "@/lib/backtest/coverage";
import { sampleMetadata, snapshotHash } from "@/lib/backtest/metadata";
import { arithmeticReturn } from "@/lib/analytics/returns";
import { annualizeCovariance } from "@/lib/analytics/covariance";
import { correlationMatrix } from "@/lib/analytics/correlation";
import { ledoitWolf } from "@/lib/analytics/shrinkage";
import {
  validateCovariance,
  type MatrixDiagnostics,
} from "@/lib/analytics/matrix";
import type {
  DataError,
  HistoricalSeries,
  Session,
} from "@/lib/types/data";
import type {
  CovarianceConditioning,
  ForwardRiskModel,
  ForwardRiskModelFailure,
  ForwardRiskModelOutcome,
  MarketProxy,
  RiskWindow,
} from "@/lib/types/forward";
import {
  isEffectivelyZero,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";
import { validDate } from "@/lib/utils/dates";
import { LabError } from "@/lib/utils/errors";
import { symbolSchema } from "@/lib/validation/symbols";
import {
  marketProxySchema,
  riskWindowSchema,
} from "@/lib/validation/forward";

const M = FORWARD_METHODOLOGY;

export type ForwardRiskModelInput = {
  /** Forward risky opportunity set (any order); CASH never belongs here. */
  universe: readonly string[];
  marketProxy: MarketProxy;
  riskWindow: RiskWindow;
  requestedStartDate: string;
  /** The latest finalized market session. */
  endDate: string;
  prices: readonly HistoricalSeries[];
  /** Scheduled sessions from the requested start through the end session. */
  sessions: readonly Session[];
  /** Securities whose history could not be fetched (judged before estimation). */
  unavailable?: readonly { ticker: string; error: DataError }[];
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const list = (tickers: readonly string[]) =>
  tickers.length <= 1
    ? tickers.join("")
    : `${tickers.slice(0, -1).join(", ")} and ${tickers.at(-1)}`;

function conditioning(d: MatrixDiagnostics): CovarianceConditioning {
  return {
    minEigenvalue: d.minEigenvalue,
    maxEigenvalue: d.maxEigenvalue,
    conditionNumber: d.conditionNumber,
    singular: d.singular,
    rank: d.rank,
  };
}

/** Estimate the certified forward risk model, or report exactly why it cannot be
 * estimated. Pure and order-invariant: all arithmetic runs on sorted tickers. */
export function buildForwardRiskModel(
  input: ForwardRiskModelInput,
): ForwardRiskModelOutcome {
  const unavailable = (
    code: ForwardRiskModelFailure,
    reason: string,
    tickers: readonly string[] = [],
    alignedReturns: number | null = null,
  ): ForwardRiskModelOutcome => ({
    available: false,
    code,
    reason,
    tickers: [...tickers],
    riskWindow: input.riskWindow,
    requestedStartDate: validDate(input.requestedStartDate)
      ? input.requestedStartDate
      : null,
    endDate: validDate(input.endDate) ? input.endDate : null,
    alignedReturns,
  });

  // Inputs: canonical tickers, no CASH, no duplicates, an allowed proxy and window.
  const bad = input.universe.filter((t) => {
    const parsed = symbolSchema.safeParse(t);
    return !parsed.success || parsed.data !== t || t === "CASH";
  });
  if (bad.length)
    return unavailable(
      "invalid_inputs",
      `${list(bad)} cannot be in the forward risky universe: tickers must be canonical U.S. symbols and CASH is not a risky security.`,
      bad,
    );
  if (new Set(input.universe).size !== input.universe.length)
    return unavailable(
      "invalid_inputs",
      "The forward risky universe lists a security more than once.",
    );
  if (!marketProxySchema.safeParse(input.marketProxy).success)
    return unavailable(
      "invalid_inputs",
      `The market proxy must be ${M.marketProxies.join(", ")}.`,
      [String(input.marketProxy)],
    );
  if (!riskWindowSchema.safeParse(input.riskWindow).success)
    return unavailable(
      "invalid_inputs",
      `The risk window must be one of ${M.riskWindows.join(", ")}.`,
    );
  if (
    !validDate(input.requestedStartDate) ||
    !validDate(input.endDate) ||
    input.requestedStartDate >= input.endDate
  )
    return unavailable(
      "invalid_inputs",
      "The risk window needs a valid requested start before its end session.",
    );

  const tickers = [...input.universe].sort();
  const proxy = input.marketProxy;
  const modelTickers = [...new Set([...tickers, proxy])].sort();

  // Any security whose history could not be fetched leaves the model unavailable;
  // none is dropped from the opportunity set.
  const failed = (input.unavailable ?? []).filter((f) =>
    modelTickers.includes(f.ticker),
  );
  if (failed.length) {
    const names = [...new Set(failed.map((f) => f.ticker))].sort();
    return unavailable(
      "history_unavailable",
      `History for ${list(names)} could not be loaded for the risk window: ${failed
        .map((f) => `${f.ticker}: ${f.error.message}`)
        .join("; ")}`,
      names,
    );
  }

  // One common aligned sample under the Phase 1 coverage rules: no forward-fill, no
  // bridging; a later start only where the provider reports a later first trade.
  let coverage: ReturnType<typeof portfolioCoverage>;
  try {
    coverage = portfolioCoverage(
      {
        holdings: modelTickers.map((ticker) => ({ ticker, weight: 1 })),
        benchmark: proxy,
        requestedStartDate: input.requestedStartDate,
        endDate: input.endDate,
        rebalanceFrequency: "monthly",
        cashPolicy: "historical_proxy",
      },
      [...input.prices],
      [...input.sessions],
    );
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    const d = error.detail;
    return unavailable(
      d.code === "COVERAGE_GAP"
        ? "coverage_gap"
        : d.code === "INSUFFICIENT_HISTORY"
          ? "insufficient_history"
          : "history_unavailable",
      d.message,
      d.ticker ? [d.ticker] : [],
    );
  }
  const sessions = coverage.sessions;
  const n = sessions.length - 1;
  if (n < M.minimumObservations) {
    const limiting = [...coverage.limitingHoldings].sort();
    return unavailable(
      "insufficient_history",
      `Only ${n} aligned daily returns are common to ${list(modelTickers)} in the risk window; the forward risk model needs at least ${M.minimumObservations}.${
        limiting.length
          ? ` The common sample starts ${sessions[0].date} because ${list(limiting)} ${plural(limiting.length, "has", "have")} no earlier provider-reported history.`
          : ""
      }`,
      limiting,
      n,
    );
  }

  // Aligned arithmetic returns, one column per model ticker (canonical order).
  const columns = modelTickers.map((t) => {
    const p = new Map(
      input.prices
        .find((s) => s.ticker === t)!
        .observations.map((o) => [o.date, o.adjustedClose]),
    );
    return sessions
      .slice(1)
      .map((s, k) => arithmeticReturn(p.get(sessions[k].date)!, p.get(s.date)!));
  });

  // A risky security (or the proxy) without dispersion is a data/model error, never
  // a synthetic risk-free asset: the existing scale-aware rule (Phase 2).
  const flat = modelTickers.filter((_, i) =>
    isEffectivelyZero(sampleStandardDeviation(columns[i]), columns[i]),
  );
  if (flat.length)
    return unavailable(
      "zero_volatility",
      `${list(flat)} ${plural(flat.length, "has", "have")} zero or effectively zero volatility over the effective risk window (daily dispersion ≤ 1e-12 × the largest absolute daily return). A risky security is never treated as a risk-free asset, so the forward risk model is unavailable.`,
      flat,
      n,
    );

  let lw: ReturnType<typeof ledoitWolf>;
  try {
    lw = ledoitWolf(columns);
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    return unavailable(
      "invalid_covariance",
      `Covariance estimation failed: ${error.detail.message}`,
      [],
      n,
    );
  }
  const sampleAnnual = annualizeCovariance(lw.sample);
  const modelCovariance = annualizeCovariance(lw.shrunk);
  const tolerance = M.covariance.matrixTolerance;
  const vs = validateCovariance(sampleAnnual, { tolerance });
  const vm = validateCovariance(modelCovariance, { tolerance });
  if (!vs.ok || !vm.ok)
    return unavailable(
      "invalid_covariance",
      `Covariance validation failed: ${(!vs.ok ? vs : !vm.ok ? vm : null)!.reason}`,
      [],
      n,
    );

  const at = (t: string) => modelTickers.indexOf(t);
  const m = at(proxy);
  const varianceM = modelCovariance[m][m];
  if (!(varianceM > 0) || !Number.isFinite(varianceM))
    return unavailable(
      "invalid_covariance",
      `The market proxy ${proxy} has no positive model variance.`,
      [proxy],
      n,
    );
  const idx = tickers.map(at);
  const covariance = idx.map((i) => idx.map((j) => modelCovariance[i][j]));
  // Exact when i = m: Σ_mm / Σ_mm = 1.
  const modelBeta = idx.map((i) => modelCovariance[i][m] / varianceM);

  let correlation: (number | null)[][];
  try {
    correlation = correlationMatrix(
      lw.sample,
      modelTickers.map(() => false),
    );
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    return unavailable("invalid_covariance", error.detail.message, [], n);
  }

  const sample = sampleMetadata(sessions);
  const requestedFirstSession = input.sessions.find(
    (s) => s.date >= input.requestedStartDate,
  )!.date;
  const shortened = sessions[0].date > requestedFirstSession;
  const limitingTickers = [...coverage.limitingHoldings].sort();
  const status = n < M.normalObservations ? "limited" : "normal";
  const notes = [
    ...(shortened
      ? [
          `The requested ${input.riskWindow} window starts ${requestedFirstSession}; the common aligned sample starts ${sessions[0].date} because ${list(limitingTickers)} ${plural(limitingTickers.length, "has", "have")} no earlier provider-reported history.`,
        ]
      : []),
    ...(status === "limited"
      ? [
          `Limited History: ${n} aligned daily returns (${M.minimumObservations}–${M.normalObservations - 1}); covariance and Forward Model Beta estimates are unstable.`,
        ]
      : []),
    ...(vs.diagnostics.singular
      ? [
          "The sample covariance is singular (duplicate or perfectly correlated securities); the Ledoit–Wolf estimate is what the model uses.",
        ]
      : []),
    ...(tickers.length
      ? []
      : [
          "No risky assets: only the market proxy is estimated. Portfolio risk metrics, the risky frontier and the tangency portfolio are unavailable.",
        ]),
  ];

  const model: ForwardRiskModel = {
    methodologyVersion: M.version,
    covarianceVersion: M.covariance.version,
    tickers,
    marketProxy: proxy,
    proxyInUniverse: tickers.includes(proxy),
    noRiskyAssets: tickers.length === 0,
    modelTickers,
    window: {
      requested: input.riskWindow,
      requestedStartDate: input.requestedStartDate,
      requestedFirstSession,
      endDate: input.endDate,
      effectiveStartDate: sample.startDate,
      effectiveEndDate: sample.endDate,
      alignedReturns: n,
      sample,
      status,
      shortened,
      limitingTickers,
      notes,
    },
    modelCovariance,
    covariance,
    modelVolatility: idx.map((i) => Math.sqrt(modelCovariance[i][i])),
    modelBeta,
    marketVolatility: Math.sqrt(varianceM),
    shrinkage: {
      estimator: M.covariance.estimator,
      target: M.covariance.target,
      delta: lw.shrinkage,
      mu: lw.mu * M.riskAnnualization,
      sampleConvention: M.covariance.sampleConvention,
    },
    annualization: {
      factor: M.riskAnnualization,
      convention: `Σ_annual = ${M.riskAnnualization} × Σ_daily (daily arithmetic close-to-close returns)`,
    },
    validation: {
      tolerance,
      sample: conditioning(vs.diagnostics),
      model: conditioning(vm.diagnostics),
    },
    sampleCorrelation: { tickers: modelTickers, matrix: correlation },
    hash: snapshotHash({
      methodology: { version: M.version, covariance: M.covariance },
      marketProxy: proxy,
      riskWindow: input.riskWindow,
      requestedStartDate: input.requestedStartDate,
      endDate: input.endDate,
      modelTickers,
      intervalSetId: sample.intervalSetId,
      matrix: modelCovariance,
    }),
  };
  return { available: true, model };
}
