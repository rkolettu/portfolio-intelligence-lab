// V2 constrained risky tangency (Layer B): the long-only, fully invested risky
// portfolio of maximum Forward Model Sharpe (μ_BLᵀw − Rf)/√(wᵀΣw) over the WHOLE
// risky universe (no security is filtered out by its own excess return; CASH is not
// in the problem and is combined later on the Model CAL). It is solved as the
// homogeneous convex problem min yᵀΣy s.t. (a/s)ᵀy = 1, y ≥ 0 with a = μ_BL − Rf·1
// and s = max aᵢ, by the Task 8 active-set QP (one equality row; releases, the cycle
// guard and the max(50, 2n²) cap), then w = y / Σᵢ yᵢ. The scaled y-problem and the
// final portfolio are each certified independently. Pure and browser-safe.
import { CONSTRUCTION_METHODOLOGY, FORWARD_METHODOLOGY } from "@/config/methodology";
import { dot, matVec } from "@/lib/analytics/construction/common";
import { jacobiEigen } from "@/lib/analytics/matrix";
import { bindingConstraints } from "@/lib/analytics/optimization";
import { portfolioVariance } from "@/lib/analytics/riskContribution";
import type {
  BlackLittermanPosterior,
  CapmPrior,
  ForwardRiskModel,
  TangencyEconomicCertification,
  TangencyOutcome,
  TangencyScaledCertification,
  TangencySolveRecord,
} from "@/lib/types/forward";
import { LabError } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/utils/sha256";
import { activeSetIterationCap, activeSetQp } from "./qp";

const TG = FORWARD_METHODOLOGY.tangency;
const T = TG.tolerances;
type Matrix = readonly (readonly number[])[];

/** Smallest achievable KKT violation of y for min yᵀΣy s.t. cᵀy = 1, y ≥ 0, given
 * g = 2Σy: over the one multiplier ν, the largest of |gᵢ − νcᵢ| on free entries and
 * of max(0, νcⱼ − gⱼ) on entries at 0. That is the maximum of the lines gᵢ − νcᵢ,
 * νcᵢ − gᵢ (free i), νcⱼ − gⱼ (bound j) and 0 — convex and piecewise linear in ν —
 * so its minimum is at ν = 0 or where two of those lines cross, all of which are
 * evaluated. */
function oneMultiplierKkt(
  g: readonly number[],
  c: readonly number[],
  free: readonly number[],
): number {
  // Each line is value(ν) = intercept − slope·ν.
  const lines: [number, number][] = [[0, 0]];
  g.forEach((gi, i) => {
    if (free.includes(i)) lines.push([gi, c[i]]);
    lines.push([-gi, -c[i]]);
  });
  const at = (nu: number) =>
    lines.reduce((worst, [b, m]) => Math.max(worst, b - m * nu), 0);
  let best = at(0);
  for (let p = 0; p < lines.length; p++)
    for (let q = p + 1; q < lines.length; q++) {
      const nu = (lines[p][0] - lines[q][0]) / (lines[p][1] - lines[q][1]);
      if (lines[p][1] !== lines[q][1] && Number.isFinite(nu)) best = Math.min(best, at(nu));
    }
  return best;
}

const within = (value: number | null, tolerance: number) =>
  value !== null && Number.isFinite(value) && value <= tolerance;

/** Independent certification of the scaled y-problem: the scaled equality, the
 * bounds and the KKT residual over 2·λmax(Σ)·1ᵀy (minimumVariance's L·B with
 * B = 1ᵀy). No solver multipliers or working set are used. */
export function certifyTangencyY(input: {
  y: readonly number[];
  scaledExcessReturns: readonly number[];
  covariance: Matrix;
  /** 2·λmax(Σ). */
  normalization: number;
}): { certification: TangencyScaledCertification; failures: string[] } {
  const { y, scaledExcessReturns: c } = input;
  const scaledEquality = Math.abs(dot(c, y) - 1);
  const bound = Math.max(0, ...y.map((v) => -v));
  const ySum = y.reduce((s, v) => s + v, 0);
  const kktNormalization = input.normalization * ySum;
  const g = matVec(input.covariance, y).map((v) => 2 * v);
  const free = y.flatMap((v, i) => (v > T.binding ? [i] : []));
  const kkt =
    free.length && kktNormalization > 0
      ? oneMultiplierKkt(g, c, free) / kktNormalization
      : Infinity;
  const failures = [
    ...(within(scaledEquality, T.scaledEquality) ? [] : [`scaled equality residual ${scaledEquality}`]),
    ...(within(bound, T.bound) ? [] : [`y bound residual ${bound}`]),
    ...(within(kkt, T.kkt) ? [] : [`y KKT residual ${kkt}`]),
  ];
  return {
    certification: {
      scaledEquality,
      bound,
      kkt: Number.isFinite(kkt) ? kkt : null,
      kktNormalization: Number.isFinite(kktNormalization) ? kktNormalization : null,
    },
    failures,
  };
}

/** Independent certification of the final portfolio in original economics: budget,
 * bounds, the scale identity aᵀy/s = 1, a positive excess return, and the Sharpe
 * identity Sharpe(w) = s/√(yᵀΣy) within a bound derived from the 1e-10 equality and
 * budget tolerances: Sharpe(w) − s/√(yᵀΣy) = Sharpe_y·((a/s)ᵀy − 1) + Rf·(Σw − 1)/σ,
 * plus a floating-point allowance (n + 2)·ε·(2·|Sharpe_y| + (Σ|wᵢμᵢ| + |Rf|)/σ)
 * for evaluating both sides. */
export function certifyTangencyEconomics(input: {
  weights: readonly number[];
  y: readonly number[];
  excessReturns: readonly number[];
  excessReturnScale: number;
  expectedReturns: readonly number[];
  riskFreeRate: number;
  volatility: number;
  ySharpe: number;
}): { certification: TangencyEconomicCertification; failures: string[] } {
  const { weights: w, expectedReturns: mu, riskFreeRate: rf, volatility: sigmaP } = input;
  const n = w.length;
  const budget = Math.abs(w.reduce((s, x) => s + x, 0) - 1);
  const bound = Math.max(0, ...w.map((x) => -x));
  const scaleIdentity = Math.abs(dot(input.excessReturns, input.y) / input.excessReturnScale - 1);
  const excess = dot(w, mu) - rf;
  const positiveExcessReturn = excess > 0;
  const sharpe = excess / sigmaP;
  const sharpeIdentity = Math.abs(sharpe - input.ySharpe);
  const eps = (n + 2) * Number.EPSILON;
  const sharpeIdentityTolerance =
    (T.scaledEquality + 2 * eps) * Math.abs(input.ySharpe) +
    (T.budget * Math.abs(rf) +
      eps * (w.reduce((s, x, i) => s + Math.abs(x * mu[i]), 0) + Math.abs(rf))) /
      sigmaP;
  const failures = [
    ...(within(budget, T.budget) ? [] : [`budget residual ${budget}`]),
    ...(within(bound, T.bound) ? [] : [`bound residual ${bound}`]),
    ...(within(scaleIdentity, T.scaledEquality) ? [] : [`scale identity residual ${scaleIdentity}`]),
    ...(positiveExcessReturn ? [] : [`excess return ${excess} is not positive`]),
    ...(Number.isFinite(sigmaP) && sigmaP > 0 ? [] : [`volatility ${sigmaP} is not positive`]),
    ...(within(sharpeIdentity, sharpeIdentityTolerance)
      ? []
      : [`Sharpe identity discrepancy ${sharpeIdentity} (bound ${sharpeIdentityTolerance})`]),
  ];
  return {
    certification: {
      budget,
      bound,
      scaleIdentity,
      positiveExcessReturn,
      sharpeIdentity: Number.isFinite(sharpeIdentity) ? sharpeIdentity : null,
      sharpeIdentityTolerance: Number.isFinite(sharpeIdentityTolerance)
        ? sharpeIdentityTolerance
        : null,
    },
    failures,
  };
}

/** The certified constrained risky tangency portfolio for one forward model: the risk
 * model's Σ, the CAPM prior's Rf, and the BL posterior's μ_BL, all from the same risk
 * model. Inputs are put in canonical (sorted ticker) order first, so any equivalent
 * ordering gives the same result and hash. */
export function buildTangencyPortfolio(input: {
  riskModel: Pick<ForwardRiskModel, "tickers" | "covariance" | "hash">;
  capmPrior: Pick<
    CapmPrior,
    "riskModelHash" | "riskFreeRate" | "riskFreeObservationDate" | "marketProxy" | "riskWindow"
  >;
  posterior: Pick<
    BlackLittermanPosterior,
    | "riskModelHash"
    | "universeTickers"
    | "blackLittermanExpectedReturn"
    | "marketProxy"
    | "riskWindow"
    | "cash"
  >;
  /** Test seam: the linear solve inside the active-set QP (default solveLinear). */
  solve?: (A: number[][], b: number[]) => number[] | null;
}): TangencyOutcome {
  const { riskModel, capmPrior: prior, posterior } = input;
  const rf = prior.riskFreeRate;
  const unavailable = (
    code: Extract<TangencyOutcome, { available: false }>["code"],
    reason: string,
    extra: Partial<Extract<TangencyOutcome, { available: false }>> = {},
  ): TangencyOutcome => ({
    available: false,
    code,
    reason,
    cause: null,
    riskModelHash: riskModel.hash,
    riskFreeRate: Number.isFinite(rf) ? rf : null,
    maxExcessReturn: null,
    solver: null,
    certification: null,
    ...extra,
  });
  const n0 = riskModel.tickers.length;
  const mu0 = posterior.blackLittermanExpectedReturn;
  if (
    prior.riskModelHash !== riskModel.hash ||
    posterior.riskModelHash !== riskModel.hash ||
    prior.marketProxy !== posterior.marketProxy ||
    prior.riskWindow !== posterior.riskWindow ||
    posterior.cash.expectedReturn !== rf ||
    !Number.isFinite(rf) ||
    posterior.universeTickers.length !== n0 ||
    posterior.universeTickers.some((t, i) => t !== riskModel.tickers[i]) ||
    new Set(riskModel.tickers).size !== n0 ||
    mu0.length !== n0 ||
    riskModel.covariance.length !== n0 ||
    riskModel.covariance.some((row) => row.length !== n0) ||
    !mu0.every(Number.isFinite) ||
    !riskModel.covariance.every((row) => row.every(Number.isFinite))
  )
    return unavailable(
      "invalid_inputs",
      "Tangency needs the risk model's Σ, the CAPM prior's Rf and the posterior's μ_BL from that same model (one hash, proxy, window and Rf), in one order, all finite.",
    );
  if (!n0) return unavailable("no_risky_assets", "No risky assets");

  // Canonical (sorted ticker) order.
  const order = riskModel.tickers.map((_, i) => i).sort((p, q) =>
    riskModel.tickers[p] < riskModel.tickers[q] ? -1 : 1,
  );
  const tickers = order.map((i) => riskModel.tickers[i]);
  const sigma = order.map((i) => order.map((j) => riskModel.covariance[i][j]));
  const mu = order.map((i) => mu0[i]);
  const n = tickers.length;

  // Existence (whatever the sign of the MRP): some security clears Rf by > 1e-12.
  const a = mu.map((m) => m - rf);
  const s = Math.max(...a);
  if (!(s > TG.positiveExcessReturnTolerance))
    return unavailable(
      "no_positive_excess_return",
      `No risky security's 12M expected return exceeds the forward risk-free rate by more than ${TG.positiveExcessReturnTolerance}; there is no tangency portfolio.`,
      { maxExcessReturn: s },
    );

  // KKT normalization exactly as minimumVariance computes it: L = 2·λmax(Σ).
  const eigen = jacobiEigen(sigma, { maxSweeps: CONSTRUCTION_METHODOLOGY.limits.eigenSweeps });
  const L = 2 * eigen.values.at(-1)!;
  if (!eigen.converged || !Number.isFinite(L) || !(L > 0))
    return unavailable("invalid_inputs", "Σ has no positive, finite largest eigenvalue.", {
      maxExcessReturn: s,
    });

  // The scaled constraint (a/s)ᵀy = 1: the top security's coefficient is exactly 1,
  // so 100% in it (lowest index on an exact tie) is a feasible start.
  const scaled = a.map((x) => x / s);
  const k = a.indexOf(s);
  const cap = activeSetIterationCap(n);
  let y: number[];
  let record: TangencySolveRecord;
  if (n === 1) {
    y = [1];
    record = {
      method: "single_security",
      iterations: 0,
      joins: null,
      releases: null,
      maxIterations: null,
      cycleDetected: false,
      excessReturnScale: s,
      startTicker: tickers[k],
      ySum: 1,
    };
  } else {
    const qp = activeSetQp({
      covariance: sigma,
      E: [scaled],
      f: [1],
      start: tickers.map((_, i) => (i === k ? 1 : 0)),
      // Strictest form of the certified KKT tolerance: 1ᵀy ≥ 1 always.
      optimalityTolerance: T.kkt * L,
      maxIterations: cap,
      solve: input.solve,
    });
    const base = {
      method: "active_set" as const,
      iterations: qp.iterations,
      joins: qp.joins,
      releases: qp.releases,
      maxIterations: cap,
      cycleDetected: !qp.ok && qp.cause === "active_set_cycle",
      excessReturnScale: s,
      startTicker: tickers[k],
    };
    if (!qp.ok)
      return unavailable(qp.status === "non_converged" ? "non_converged" : "numerical_failure", qp.reason, {
        cause: qp.cause,
        maxExcessReturn: s,
        solver: { ...base, ySum: null },
      });
    y = qp.x;
    record = { ...base, ySum: y.reduce((t, v) => t + v, 0) };
  }

  // w = y / Σᵢ yᵢ: each yᵢ divided by the sum of all y components.
  const ySum = record.ySum!;
  if (!(Number.isFinite(ySum) && ySum > 0))
    return unavailable("numerical_failure", `The solved y has no positive, finite sum (${ySum}).`, {
      cause: "certification_failed",
      maxExcessReturn: s,
      solver: record,
    });
  const w = y.map((v) => v / ySum);

  let variance: number;
  let yVariance: number;
  try {
    variance = portfolioVariance(sigma, w);
    yVariance = portfolioVariance(sigma, y);
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    return unavailable("numerical_failure", error.detail.message, {
      cause: "certification_failed",
      maxExcessReturn: s,
      solver: record,
    });
  }
  const volatility = Math.sqrt(variance);
  const expectedReturn = dot(w, mu);
  const excessReturn = expectedReturn - rf;
  const yIdentitySharpe = s / Math.sqrt(yVariance);
  const scaledCheck = certifyTangencyY({ y, scaledExcessReturns: scaled, covariance: sigma, normalization: L });
  const economicCheck = certifyTangencyEconomics({
    weights: w,
    y,
    excessReturns: a,
    excessReturnScale: s,
    expectedReturns: mu,
    riskFreeRate: rf,
    volatility,
    ySharpe: yIdentitySharpe,
  });
  const certification = {
    scaled: scaledCheck.certification,
    economic: economicCheck.certification,
  };
  const failures = [...scaledCheck.failures, ...economicCheck.failures];
  if (failures.length)
    return unavailable(
      "numerical_failure",
      `Failed certification (${failures.join("; ")}); no tangency portfolio is reported.`,
      { cause: "certification_failed", maxExcessReturn: s, solver: record, certification },
    );

  const lower = tickers.map(() => 0);
  const upper = tickers.map(() => 1);
  const bind = bindingConstraints(w, lower, upper);
  const expectedReturnsHash = sha256Hex(
    JSON.stringify({
      kind: "bl-expected-returns",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: riskModel.hash,
      tickers,
      expectedReturns: mu,
    }),
  );
  // Canonical economic payload: lineage, Rf, μ_BL and the weights (no labels,
  // timestamps, solver diagnostics or display state).
  const tangencyHash = sha256Hex(
    JSON.stringify({
      kind: "tangency",
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: riskModel.hash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      riskFree: {
        series: "DGS1",
        observationDate: prior.riskFreeObservationDate,
        annualYield: rf,
      },
      tickers,
      expectedReturns: mu,
      weights: w,
    }),
  );
  return {
    available: true,
    tangency: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: riskModel.hash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      riskFreeRate: rf,
      riskFreeObservationDate: prior.riskFreeObservationDate,
      tickers,
      expectedReturns: mu,
      expectedReturnsHash,
      weights: w,
      expectedReturn,
      excessReturn,
      variance,
      volatility,
      forwardModelSharpe: excessReturn / volatility,
      yIdentitySharpe,
      binding: {
        lower: bind.lower.map((i) => tickers[i]),
        upper: bind.upper.map((i) => tickers[i]),
      },
      solver: record,
      certification,
      tangencyHash,
    },
  };
}
