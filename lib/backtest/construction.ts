import {
  BENCHMARK_METHODOLOGY,
  CONSTRUCTION_METHODOLOGY,
  METHODOLOGY,
  PERFORMANCE_METHODOLOGY,
  RISK_METHODOLOGY,
  ROLLING_METHODOLOGY,
  STRESS_METHODOLOGY,
} from "@/config/methodology";
import { STRESS_WINDOWS_VERSION } from "@/config/stressWindows";
import type {
  BacktestResult,
  Sample,
  StressAnalytics,
  StressSnapshot,
} from "@/lib/types/analytics";
import type {
  AllocationWeight,
  CashChoice,
  ConstructionAnalytics,
  ConstructionMethod,
  ConstructionOutcome,
  ConstructionProposal,
  HistoricalSide,
  ModelRisk,
  OptimizationConstraint,
  StressComparisonEvent,
} from "@/lib/types/construction";
import type {
  HistoricalSeries,
  Session,
  TreasurySeries,
} from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { marketDate } from "@/lib/utils/dates";
import { fail, LabError } from "@/lib/utils/errors";
import {
  isEffectivelyZero,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";
import { arithmeticReturn } from "@/lib/analytics/returns";
import { annualizeCovariance } from "@/lib/analytics/covariance";
import { ledoitWolf } from "@/lib/analytics/shrinkage";
import { validateCovariance } from "@/lib/analytics/matrix";
import {
  allocationFeasible,
  bindingConstraints,
  checkFeasibility,
} from "@/lib/analytics/optimization";
import { oneWayTurnover } from "@/lib/analytics/turnover";
import type { MethodResult } from "@/lib/analytics/construction/common";
import { equalWeight } from "@/lib/analytics/construction/equalWeight";
import { inverseVolatility } from "@/lib/analytics/construction/inverseVolatility";
import { minimumVariance } from "@/lib/analytics/construction/minimumVariance";
import { equalRiskContribution } from "@/lib/analytics/construction/equalRisk";
import {
  modelRisk,
  zeroRiskModel,
} from "@/lib/analytics/construction/modelRisk";
import { proposalObservations } from "@/lib/analytics/construction/observations";
import { FEDERAL_CALENDAR_VERSION } from "@/lib/treasury-data/normalize";
import { CALENDAR_VERSION } from "./calendar";
import { portfolioCoverage } from "./coverage";
import { simulate } from "./engine";
import { sampleMetadata, snapshotHash } from "./metadata";
import { runStress } from "./stress";

export type ConstructionInput = {
  /** The analyzed configuration; zero-weight rows define eligible candidates. */
  config: PortfolioConfig;
  /** Bounds per eligible ticker; omitted tickers default to [0, 1], optional. */
  constraints: OptimizationConstraint[];
  cash: CashChoice;
  estimation: {
    prices: HistoricalSeries[];
    treasury: TreasurySeries | null;
    sessions: Session[];
    eligibleEndDate: string;
  };
  stress: StressSnapshot;
  now: string;
};

const METHODS: ConstructionMethod[] = [
  "equal_weight",
  "inverse_volatility",
  "minimum_variance",
  "equal_risk_contribution",
];
const NAMES: Record<ConstructionMethod, string> = {
  equal_weight: "Equal-Weight Allocation",
  inverse_volatility: "Inverse-Volatility Allocation",
  minimum_variance: "Minimum-Variance Allocation",
  equal_risk_contribution: "Equal-Risk-Contribution Allocation",
};
const {
  minimumObservations,
  normalObservations,
  tolerances: T,
} = CONSTRUCTION_METHODOLOGY;

function label(method: ConstructionMethod, r: MethodResult, budget: number) {
  if (r.status === "converged_but_parity_not_achieved")
    return "Constrained Risk-Balance Approximation";
  if (r.weights && budget === 0)
    return "All-CASH Allocation (zero risky budget)";
  if (r.constrained)
    return method === "equal_weight"
      ? "Constrained Equal-Weight Allocation"
      : "Constrained Inverse-Volatility Allocation";
  return NAMES[method];
}

function historical(run: () => BacktestResult): HistoricalSide {
  try {
    const r = run();
    const rel = r.benchmarkAnalytics.relative;
    return {
      available: true,
      cumulativeReturn: r.performance.portfolio.cumulativeReturn,
      cagr: r.performance.portfolio.cagr,
      volatility: r.performance.risk.volatility,
      sharpe: r.performance.risk.sharpe,
      sortino: r.performance.risk.sortino,
      maximumDrawdown: r.performance.risk.maximumDrawdown,
      beta: rel.beta,
      trackingError: rel.trackingError,
      informationRatio: rel.informationRatio,
      correlation: rel.correlation,
      growth: r.performance.growth,
    };
  } catch (error) {
    if (error instanceof LabError)
      return { available: false, reason: error.detail.message };
    throw error;
  }
}

/** Union-coverage stress comparison: an event compares only when BOTH portfolios
 * cover it, so every holding in either portfolio has full event history. */
function compareStress(
  current: StressAnalytics,
  proposed: StressAnalytics,
): StressComparisonEvent[] {
  return current.events.map((c, i) => {
    const p = proposed.events[i];
    const base = {
      id: c.id,
      name: c.name,
      startDate: c.startDate ?? c.requestedStartDate,
      endDate: c.endDate ?? c.requestedEndDate,
    };
    if (c.status === "unavailable" || p.status === "unavailable")
      return {
        ...base,
        status: "unavailable" as const,
        reason:
          c.status === "unavailable"
            ? c.reason
            : p.status === "unavailable"
              ? p.reason
              : "",
      };
    if (
      c.status === "incomplete_coverage" ||
      p.status === "incomplete_coverage"
    )
      return {
        ...base,
        status: "incomplete_coverage" as const,
        missing: [
          ...new Set(
            [c, p].flatMap((e) =>
              e.status === "incomplete_coverage"
                ? e.missing.map((m) => m.ticker)
                : [],
            ),
          ),
        ],
      };
    return {
      ...base,
      status: "complete" as const,
      current: {
        return: c.portfolioReturn,
        maximumDrawdown: c.maximumDrawdown,
      },
      proposed: {
        return: p.portfolioReturn,
        maximumDrawdown: p.maximumDrawdown,
      },
      benchmark: c.benchmarkReturn,
    };
  });
}

/** True when neither compared portfolio can hold a risky asset: the current
 * allocation has no risky weight and CASH is 100% (risky budget B = 0, so every
 * proposal is all-CASH or infeasible). Zero-weight candidates are then irrelevant to
 * every comparison, and their price history is not a dependency. */
export function zeroRiskyExposure(
  config: PortfolioConfig,
  cash: CashChoice,
): boolean {
  const current = config.holdings.find((h) => h.ticker === "CASH")?.weight ?? 0;
  return (
    (cash.mode === "current" ? current : cash.weight) === 1 &&
    config.holdings.every((h) => h.ticker === "CASH" || h.weight === 0)
  );
}

/** Phase 6 construction on a frozen snapshot. Pure and replayable:
 * `runConstruction({config, constraints, cash, ...result.snapshot, now})`. */
export function runConstruction(
  input: ConstructionInput,
): ConstructionAnalytics {
  const config = parsePortfolio(input.config, marketDate(input.now));
  const universe = config.holdings
    .filter((h) => h.ticker !== "CASH")
    .map((h) => h.ticker);
  for (const c of input.constraints)
    if (!universe.includes(c.ticker))
      fail(
        "INVALID_INPUT",
        `${c.ticker} is not in the eligible universe; add it to the portfolio (0% is allowed) and re-run the analysis.`,
      );
  const currentCash =
    config.holdings.find((h) => h.ticker === "CASH")?.weight ?? 0;
  const cashWeight =
    input.cash.mode === "current" ? currentCash : input.cash.weight;
  const constraints: OptimizationConstraint[] = universe.map(
    (ticker) =>
      input.constraints.find((c) => c.ticker === ticker) ?? {
        ticker,
        minWeight: 0,
        maxWeight: 1,
        required: false,
      },
  );
  // Canonical order: all arithmetic on sorted tickers; display keeps configuration order.
  const canonical = [...universe].sort();
  const at = (t: string) => constraints.find((c) => c.ticker === t)!;
  const lower = canonical.map((t) => at(t).minWeight);
  const upper = canonical.map((t) => at(t).maxWeight);
  const required = canonical.map((t) => at(t).required);
  const currentWeight = (t: string) =>
    config.holdings.find((h) => h.ticker === t)?.weight ?? 0;
  const current: AllocationWeight[] = [
    ...universe.map((ticker) => ({ ticker, weight: currentWeight(ticker) })),
    ...(config.holdings.some((h) => h.ticker === "CASH")
      ? [{ ticker: "CASH", weight: currentCash }]
      : []),
  ];
  const feasibility = checkFeasibility({
    tickers: canonical,
    lower,
    upper,
    required,
    cash: cashWeight,
  });
  const budget = feasibility.ok ? feasibility.budget : 1 - cashWeight;

  // One common estimation sample over EVERY eligible risky asset, zero weights
  // included, under the Phase 1 coverage rules (no forward-fill, no bridging).
  // When neither portfolio can hold a risky asset, no risky history is needed: the
  // window is the session calendar itself (the Phase 1 all-CASH rule) and the
  // comparison is the Treasury CASH path.
  const est = input.estimation;
  const noRisk = zeroRiskyExposure(config, input.cash);
  const estimated = noRisk ? [] : canonical;
  let sessions: Session[] | null = null;
  let coverageReason = "";
  try {
    sessions = portfolioCoverage(
      {
        ...config,
        endDate: est.eligibleEndDate,
        holdings: estimated.map((ticker) => ({ ticker, weight: 1 })),
      },
      est.prices,
      est.sessions,
    ).sessions;
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    coverageReason = error.detail.message;
  }
  const columns = sessions
    ? estimated.map((t) => {
        const p = new Map(
          est.prices
            .find((s) => s.ticker === t)!
            .observations.map((o) => [o.date, o.adjustedClose]),
        );
        return sessions!
          .slice(1)
          .map((s, k) =>
            arithmeticReturn(p.get(sessions![k].date)!, p.get(s.date)!),
          );
      })
    : [];
  const n = sessions ? sessions.length - 1 : 0;
  const sample: Sample | null = sessions ? sampleMetadata(sessions) : null;
  const estimation: ConstructionAnalytics["estimation"] =
    estimated.length && sample && n >= minimumObservations
      ? {
          available: true,
          sample,
          status: n < normalObservations ? "limited" : "normal",
          finalizedCutoff: est.eligibleEndDate,
          notes: [
            ...(n < normalObservations
              ? [
                  `Limited History: ${n} common observations (${minimumObservations}–${normalObservations - 1}); covariance estimates are unstable.`,
                ]
              : []),
            "“Normal” describes sample size only; it does not imply forecasting reliability.",
          ],
        }
      : {
          available: false,
          reason: !canonical.length
            ? "There are no eligible risky assets; an all-CASH allocation needs no risk model."
            : noRisk
              ? "Neither the current allocation nor any proposal holds a risky asset (current all-CASH, 100% CASH fixed); no risky history or risk model is needed."
              : sample
                ? `Only ${n} common daily observations across the eligible universe; the construction risk model requires at least ${minimumObservations}.`
                : coverageReason,
          observationCount: n,
        };
  const zeroVolatility = universe.filter((t) => {
    const c = columns[canonical.indexOf(t)];
    return (
      !!c && c.length >= 2 && isEffectivelyZero(sampleStandardDeviation(c), c)
    );
  });

  // Σ_construction: Ledoit–Wolf shrinkage of the common-sample covariance, annualized.
  let covariance: ConstructionAnalytics["covariance"] = {
    available: false,
    reason: estimation.available ? "" : estimation.reason,
  };
  let sigma: number[][] | null = null;
  if (estimation.available) {
    const lw = ledoitWolf(columns);
    const sampleAnnual = annualizeCovariance(lw.sample);
    const constructionAnnual = annualizeCovariance(lw.shrunk);
    const vs = validateCovariance(sampleAnnual, {
      tolerance: T.matrixRelative,
    });
    const vc = validateCovariance(constructionAnnual, {
      tolerance: T.matrixRelative,
    });
    if (!vs.ok || !vc.ok)
      covariance = {
        available: false,
        reason: `Covariance validation failed: ${(!vs.ok ? vs : !vc.ok ? vc : null)!.reason}`,
      };
    else {
      sigma = constructionAnnual;
      const cond = (d: typeof vs.diagnostics) => ({
        minEigenvalue: d.minEigenvalue,
        maxEigenvalue: d.maxEigenvalue,
        conditionNumber: d.conditionNumber,
      });
      // Display order for the shipped matrix; arithmetic stays canonical.
      const order = universe.map((t) => canonical.indexOf(t));
      covariance = {
        available: true,
        estimator: CONSTRUCTION_METHODOLOGY.covariance.estimator,
        target: CONSTRUCTION_METHODOLOGY.covariance.target,
        version: CONSTRUCTION_METHODOLOGY.covariance.version,
        sampleConvention: CONSTRUCTION_METHODOLOGY.covariance.sampleConvention,
        shrinkage: lw.shrinkage,
        mu: lw.mu * CONSTRUCTION_METHODOLOGY.riskAnnualization,
        construction: order.map((i) =>
          order.map((j) => constructionAnnual[i][j]),
        ),
        standaloneVolatility: order.map((i) =>
          Math.sqrt(constructionAnnual[i][i]),
        ),
        hash: snapshotHash({
          tickers: canonical,
          intervalSetId: sample!.intervalSetId,
          version: CONSTRUCTION_METHODOLOGY.covariance.version,
          matrix: constructionAnnual,
        }),
        conditioning: {
          sample: cond(vs.diagnostics),
          construction: cond(vc.diagnostics),
        },
      };
    }
  }

  // Methods on canonical arrays.
  const riskGate = (): {
    status: MethodResult["status"];
    reason: string;
  } | null =>
    !estimation.available
      ? { status: "insufficient_history", reason: estimation.reason }
      : zeroVolatility.length
        ? {
            status: "invalid_inputs",
            reason: `Zero or undefined empirical volatility for ${zeroVolatility.join(", ")}; risk-based construction is unavailable (shrinkage must not mask unusable data).`,
          }
        : !covariance.available
          ? { status: "invalid_covariance", reason: covariance.reason }
          : null;
  const results = new Map<ConstructionMethod, MethodResult>();
  const gated = (
    status: MethodResult["status"],
    reason: string,
  ): MethodResult => ({
    status,
    reason,
    weights: null,
    constrained: false,
    objective: { name: "", value: null },
    iterations: 0,
    termination: status,
    residuals: {
      budget: null,
      bound: null,
      stationarity: null,
      kkt: null,
      parity: null,
    },
    reference: null,
    starts: [],
    tieRule: null,
    notes: [],
  });
  if (!feasibility.ok)
    for (const m of METHODS)
      results.set(m, gated(feasibility.status, feasibility.reason));
  else if (budget === 0) {
    // Fixed CASH = 100%: every risky weight is 0 by construction. Equal weight, inverse
    // volatility and minimum variance are the all-CASH allocation and need no risky
    // history or covariance; ERC has no risk-budget problem and is unavailable.
    const zeros = canonical.map(() => 0);
    const allCash = (method: string): MethodResult => ({
      status: "success",
      reason: null,
      weights: zeros,
      constrained: false,
      objective: { name: method, value: 0 },
      iterations: 0,
      termination: "zero_budget",
      residuals: { budget: 0, bound: 0, stationarity: 0, kkt: 0, parity: null },
      reference: null,
      starts: [],
      tieRule: null,
      notes: ["The risky budget is zero: the allocation is entirely CASH."],
    });
    results.set("equal_weight", equalWeight({ lower, upper, budget }));
    results.set("inverse_volatility", allCash("no risky allocation (B = 0)"));
    results.set("minimum_variance", allCash("wᵀΣw = 0 (B = 0)"));
    results.set(
      "equal_risk_contribution",
      equalRiskContribution({
        covariance: [],
        lower,
        upper,
        budget,
        starts: [],
        names: canonical,
      }),
    );
  } else {
    const ew = equalWeight({ lower, upper, budget });
    results.set("equal_weight", ew);
    const gate = riskGate();
    if (gate)
      for (const m of METHODS.slice(1))
        results.set(m, gated(gate.status, gate.reason));
    else {
      const iv = inverseVolatility({
        covariance: sigma!,
        lower,
        upper,
        budget,
      });
      results.set("inverse_volatility", iv);
      results.set(
        "minimum_variance",
        minimumVariance({
          covariance: sigma!,
          lower,
          upper,
          budget,
          start: ew.weights!,
        }),
      );
      const currentRisky = canonical.map(currentWeight);
      results.set(
        "equal_risk_contribution",
        equalRiskContribution({
          covariance: sigma!,
          lower,
          upper,
          budget,
          names: canonical,
          starts: [
            { name: "equal_weight", weights: ew.weights, reason: ew.reason },
            {
              name: "inverse_volatility",
              weights: iv.weights,
              reason: iv.weights ? null : iv.reason,
            },
            {
              name: "current",
              weights: allocationFeasible(currentRisky, lower, upper, budget)
                ? currentRisky
                : null,
              reason:
                "The current allocation violates the constraints or the fixed CASH weight.",
            },
          ],
        }),
      );
    }
  }

  const includeCash =
    cashWeight > 0 || config.holdings.some((h) => h.ticker === "CASH");
  const toDisplay = (w: readonly number[]): AllocationWeight[] => [
    ...universe.map((ticker) => ({
      ticker,
      weight: w[canonical.indexOf(ticker)],
    })),
    ...(includeCash ? [{ ticker: "CASH", weight: cashWeight }] : []),
  ];
  const outcomes: ConstructionOutcome[] = METHODS.map((method) => {
    const r = results.get(method)!;
    const binding = r.weights
      ? bindingConstraints(r.weights, lower, upper)
      : { lower: [], upper: [], fixed: [] };
    const names = (idx: number[]) =>
      idx
        .map((i) => canonical[i])
        .sort((a, b) => universe.indexOf(a) - universe.indexOf(b));
    return {
      method,
      status: r.status,
      label: r.weights ? label(method, r, budget) : NAMES[method],
      reason: r.reason,
      weights: r.weights ? toDisplay(r.weights) : null,
      diagnostics: {
        objective: r.objective,
        iterations: r.iterations,
        termination: r.termination,
        residuals: r.residuals,
        binding: {
          lower: names(binding.lower),
          upper: names(binding.upper),
          fixed: names(binding.fixed),
        },
        reference: r.reference ? toDisplay(r.reference) : null,
        starts: r.starts,
        tieRule: r.tieRule,
        notes: r.notes,
      },
    };
  });

  // Comparisons on the SAME frozen data, both portfolios re-initialized at target
  // weights on the same start: the estimation sample's first session.
  const risk = (weights: readonly number[], cash: number): ModelRisk =>
    weights.every((w) => w === 0)
      ? zeroRiskModel({
          tickers: canonical,
          standalone: sigma ? sigma.map((row, i) => Math.sqrt(row[i])) : null,
          cashWeight: cash,
        })
      : sigma
        ? modelRisk({
            covariance: sigma,
            tickers: canonical,
            weights,
            cashWeight: cash,
          })
        : {
            available: false,
            reason: covariance.available ? "" : covariance.reason,
          };
  const displayRisk = (m: ModelRisk): ModelRisk =>
    m.available
      ? {
          ...m,
          holdings: universe.map((t) =>
            m.holdings.find((h) => h.ticker === t)!,
          ),
        }
      : m;
  const window = sessions && sessions.length >= 2 ? sessions : null;
  const simulateTargets = (holdings: AllocationWeight[]) => () =>
    simulate({
      config: {
        ...config,
        holdings,
        requestedStartDate: window![0].date,
        endDate: window!.at(-1)!.date,
      },
      prices: est.prices,
      treasury: est.treasury,
      sessions: est.sessions,
      now: input.now,
      eligibleEndDate: window!.at(-1)!.date,
    });
  const noWindow: HistoricalSide = {
    available: false,
    reason: `No common comparison window: ${coverageReason}`,
  };
  const currentHistorical = window
    ? historical(simulateTargets(config.holdings))
    : noWindow;
  // Never crash the request: a stress failure becomes a typed unavailable comparison.
  const stressFor = (
    holdings: AllocationWeight[],
  ): StressAnalytics | string => {
    try {
      return runStress({
        ...input.stress,
        config: { ...config, holdings },
        now: input.now,
      });
    } catch (error) {
      if (error instanceof LabError) return error.detail.message;
      throw error;
    }
  };
  const stressComparison = (proposed: StressAnalytics | string) =>
    typeof currentStress === "string" || typeof proposed === "string"
      ? input.stress.windows.map((w) => ({
          id: w.id,
          name: w.name,
          startDate: w.startDate,
          endDate: w.endDate,
          status: "unavailable" as const,
          reason:
            typeof currentStress === "string"
              ? currentStress
              : (proposed as string),
        }))
      : compareStress(currentStress, proposed);
  const currentStress = stressFor(config.holdings);
  const proposals: ConstructionProposal[] = outcomes.map((o) => {
    if (!o.weights)
      return {
        ...o,
        turnover: null,
        observations: [],
        modelRisk: { available: false, reason: o.reason ?? "No allocation." },
        historical: { available: false, reason: o.reason ?? "No allocation." },
        stress: [],
      };
    const risky = canonical.map(
      (t) => o.weights!.find((w) => w.ticker === t)!.weight,
    );
    const holdings = o.weights.filter(
      (w) => w.ticker !== "CASH" || includeCash,
    );
    const turnover = oneWayTurnover(current, o.weights);
    const proposedRisk = displayRisk(risk(risky, cashWeight));
    return {
      ...o,
      turnover,
      observations: proposalObservations({
        method: o.method,
        weights: o.weights,
        budget,
        binding: o.diagnostics.binding,
        bounds: constraints,
        turnover,
        negativeRisk: proposedRisk.available
          ? proposedRisk.holdings
              .filter((h) => h.component !== null && h.component < 0)
              .map((h) => h.ticker)
          : [],
      }),
      modelRisk: proposedRisk,
      historical: window ? historical(simulateTargets(holdings)) : noWindow,
      stress: stressComparison(stressFor(holdings)),
    };
  });

  const snapshot = { estimation: input.estimation, stress: input.stress };
  return {
    methodologyVersion: CONSTRUCTION_METHODOLOGY.version,
    config,
    inputs: {
      universe,
      constraints,
      cash: input.cash,
      cashWeight,
      riskyBudget: budget,
      current,
    },
    estimation,
    covariance,
    zeroVolatility,
    current: {
      modelRisk: displayRisk(risk(canonical.map(currentWeight), currentCash)),
      historical: currentHistorical,
    },
    comparison: window
      ? {
          available: true,
          sample: sampleMetadata(window),
          benchmark: config.benchmark,
        }
      : { available: false, reason: noWindow.reason },
    proposals,
    metadata: {
      generatedAt: input.now,
      snapshotHash: snapshotHash({
        config,
        constraints,
        cash: input.cash,
        methodology: {
          engine: METHODOLOGY,
          construction: CONSTRUCTION_METHODOLOGY,
          stress: STRESS_METHODOLOGY,
        },
        windows: STRESS_WINDOWS_VERSION,
        calendar: CALENDAR_VERSION,
        federalCalendar: FEDERAL_CALENDAR_VERSION,
        snapshot,
      }),
      methodologyVersions: {
        engine: METHODOLOGY.version,
        performance: PERFORMANCE_METHODOLOGY.version,
        benchmark: BENCHMARK_METHODOLOGY.version,
        risk: RISK_METHODOLOGY.version,
        rolling: ROLLING_METHODOLOGY.version,
        stress: STRESS_METHODOLOGY.version,
        construction: CONSTRUCTION_METHODOLOGY.version,
        covariance: CONSTRUCTION_METHODOLOGY.covariance.version,
        solver: CONSTRUCTION_METHODOLOGY.solverVersion,
      },
      warnings: [
        "In-sample retrospective analysis: allocations are estimated on the same history they are compared on. This is not an out-of-sample backtest and does not validate any prediction.",
        "Stress comparisons apply allocations estimated later to earlier windows: retrospective scenario applications, not portfolios that could have been known at the time.",
        "Allocation outputs are mathematical results based on selected inputs, assumptions and constraints, not personalized recommendations.",
        "Lower modeled variance does not imply better returns, smaller future drawdowns or suitability.",
        "Results are gross of transaction costs, taxes and trading frictions; turnover is a distance between target allocations, not traded notional.",
      ],
      currentDataUsed: false,
    },
    snapshot,
  };
}
