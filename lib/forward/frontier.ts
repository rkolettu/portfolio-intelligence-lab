// V2 efficient frontier (Layer B): min wᵀΣw s.t. Σw = 1, μ_BLᵀw = r, w ≥ 0 over the
// risky universe, on the efficient branch r ∈ [r_GMV, max μ]. The GMV anchor is the
// existing minimumVariance, called exactly as the Constructor calls it; interior
// points use the deterministic active-set QP; the top endpoint is the
// minimum-variance portfolio of the near-tied top set (Q37/Q39). Every point is
// certified independently and failed points carry no weights. Pure and
// browser-safe.
import { CONSTRUCTION_METHODOLOGY, FORWARD_METHODOLOGY } from "@/config/methodology";
import { dot, matVec } from "@/lib/analytics/construction/common";
import { equalWeight } from "@/lib/analytics/construction/equalWeight";
import { minimumVariance } from "@/lib/analytics/construction/minimumVariance";
import { jacobiEigen } from "@/lib/analytics/matrix";
import {
  bindingConstraints,
  kktResidual,
  projectedGradientResidual,
} from "@/lib/analytics/optimization";
import { portfolioVariance } from "@/lib/analytics/riskContribution";
import type {
  BlackLittermanPosterior,
  EfficientFrontierOutcome,
  ForwardRiskModel,
  ForwardSolverResiduals,
  FrontierCertification,
  FrontierFailureCause,
  FrontierPoint,
  FrontierSolveRecord,
  TopEndpointResiduals,
} from "@/lib/types/forward";
import { LabError } from "@/lib/utils/errors";
import { sha256Hex } from "@/lib/utils/sha256";
import { activeSetIterationCap, activeSetQp } from "./qp";

const F = FORWARD_METHODOLOGY.frontier;
const T = F.tolerances;
const { eigenSweeps, minimumVarianceIterations } = CONSTRUCTION_METHODOLOGY.limits;
type Matrix = readonly (readonly number[])[];

/** Smallest achievable KKT violation of w, given g = 2Σw: over the budget and return
 * multipliers (λ, ν), the largest of |g_i − λ − νμ_i| on free weights and of
 * max(0, λ + νμ_j − g_j) on weights at 0%. For a fixed ν the best λ leaves
 * φ(ν) = ½·max over free i and any j of [(g_i − g_j) − ν(μ_i − μ_j)], which is
 * convex and piecewise linear in ν with breakpoints only where two lines g − νμ
 * cross; its minimum is at ν = 0 or one of those breakpoints, and all are evaluated.
 * Working with pairwise differences avoids cancellation at large ν. */
function kktViolation(
  g: readonly number[],
  mu: readonly number[],
  free: readonly number[],
): number {
  const n = g.length;
  const phi = (nu: number) => {
    let worst = 0;
    for (const i of free)
      for (let j = 0; j < n; j++)
        worst = Math.max(worst, g[i] - g[j] - nu * (mu[i] - mu[j]));
    return worst / 2;
  };
  let best = phi(0);
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const nu = (g[a] - g[b]) / (mu[a] - mu[b]);
      if (mu[a] !== mu[b] && Number.isFinite(nu)) best = Math.min(best, phi(nu));
    }
  return best;
}

/** Independent Q34 certification of a candidate w for target r: budget, bound and
 * target-return residuals, and the KKT residual (kktViolation) normalized by
 * 2·λmax(Σ). It uses none of the solver's multipliers or working set: a weight
 * above the binding tolerance is free, any other weight is at its 0% bound. */
export function certifyFrontierPoint(input: {
  weights: readonly number[];
  targetReturn: number;
  covariance: Matrix;
  expectedReturns: readonly number[];
  normalization: number;
}): { residuals: ForwardSolverResiduals; certified: boolean; failures: string[] } {
  const { weights: w, expectedReturns: mu } = input;
  const budget = Math.abs(w.reduce((s, x) => s + x, 0) - 1);
  const bound = Math.max(0, ...w.map((x) => -x));
  const ret = Math.abs(dot(w, mu) - input.targetReturn);
  const g = matVec(input.covariance, w).map((x) => 2 * x);
  const free = w.flatMap((x, i) => (x > T.binding ? [i] : []));
  const kkt = free.length ? kktViolation(g, mu, free) / input.normalization : Infinity;
  const within = (value: number, tolerance: number) =>
    Number.isFinite(value) && value <= tolerance;
  const failures = [
    ...(within(budget, T.budget) ? [] : [`budget residual ${budget}`]),
    ...(within(bound, T.bound) ? [] : [`bound residual ${bound}`]),
    ...(within(ret, T.targetReturn) ? [] : [`target-return residual ${ret}`]),
    ...(within(kkt, T.kkt) ? [] : [`KKT residual ${kkt}`]),
  ];
  return {
    residuals: { budget, return: ret, bound, kkt },
    certified: failures.length === 0,
    failures,
  };
}

/** Q39: certification of the top endpoint as the problem that defines it, the
 * minimum-variance portfolio of the near-tied top set T (max μ − μᵢ ≤ 1e-12):
 * - budget |Σw − 1| ≤ 1e-10 and bound max(0, −min w) ≤ 1e-10;
 * - exactly zero weight outside T;
 * - minimumVariance's own rules on T (100% budget, 0–100% bounds): projected-gradient
 *   stationarity and KKT, each ≤ 1e-8, normalized by 2·λmax(Σ_TT);
 * - max μ − μᵀw ≤ 1e-12 plus a rounding allowance of (n + 2)·ε·(|max μ| + Σ|wᵢμᵢ|),
 *   the standard bound on evaluating that difference.
 * The exact target-return KKT is not applied: it is a different problem. */
export function certifyTopEndpoint(input: {
  weights: readonly number[];
  tieSet: readonly number[];
  covariance: Matrix;
  expectedReturns: readonly number[];
}): {
  residuals: TopEndpointResiduals;
  kktNormalization: number | null;
  returnAllowance: number;
  certified: boolean;
  failures: string[];
} {
  const { weights: w, tieSet, expectedReturns: mu } = input;
  const n = w.length;
  const budget = Math.abs(w.reduce((s, x) => s + x, 0) - 1);
  const bound = Math.max(0, ...w.map((x) => -x));
  const outsideTieSet = Math.max(
    0,
    ...w.map((x, i) => (tieSet.includes(i) ? 0 : Math.abs(x))),
  );
  const sub = tieSet.map((i) => tieSet.map((j) => input.covariance[i][j]));
  const wT = tieSet.map((i) => w[i]);
  const eigen = jacobiEigen(sub, { maxSweeps: eigenSweeps });
  const L = 2 * eigen.values.at(-1)!;
  const scaled = eigen.converged && Number.isFinite(L) && L > 0;
  const lower = tieSet.map(() => 0);
  const upper = tieSet.map(() => 1);
  const g = matVec(sub, wT).map((x) => 2 * x);
  const stationarity = scaled
    ? projectedGradientResidual(wT, g, 1 / L, lower, upper, 1)
    : null;
  const kkt = scaled ? kktResidual(wT, g, lower, upper).residual / L : null;
  const maxMu = Math.max(...mu);
  const returnShortfall = maxMu - dot(w, mu);
  const returnAllowance =
    (n + 2) *
    Number.EPSILON *
    (Math.abs(maxMu) + w.reduce((s, x, i) => s + Math.abs(x * mu[i]), 0));
  const within = (value: number | null, tolerance: number) =>
    value !== null && Number.isFinite(value) && value <= tolerance;
  const failures = [
    ...(within(budget, T.budget) ? [] : [`budget residual ${budget}`]),
    ...(within(bound, T.bound) ? [] : [`bound residual ${bound}`]),
    ...(outsideTieSet === 0 ? [] : [`weight outside the tie set ${outsideTieSet}`]),
    ...(scaled ? [] : ["Σ of the tie set has no positive, finite largest eigenvalue"]),
    ...(within(stationarity, T.kkt) ? [] : [`tie-set stationarity ${stationarity}`]),
    ...(within(kkt, T.kkt) ? [] : [`tie-set KKT residual ${kkt}`]),
    ...(within(returnShortfall, F.topReturnTieTolerance + returnAllowance)
      ? []
      : [`return shortfall ${returnShortfall}`]),
  ];
  return {
    residuals: { budget, bound, outsideTieSet, stationarity, kkt, returnShortfall },
    kktNormalization: scaled ? L : null,
    returnAllowance,
    certified: failures.length === 0,
    failures,
  };
}

const NO_RESIDUALS: ForwardSolverResiduals = {
  budget: null,
  return: null,
  bound: null,
  kkt: null,
};
const NO_TOP_RESIDUALS: TopEndpointResiduals = {
  budget: null,
  bound: null,
  outsideTieSet: null,
  stationarity: null,
  kkt: null,
  returnShortfall: null,
};

type Candidate =
  | { weights: number[]; solver: FrontierSolveRecord }
  | {
      failure: string;
      status: FrontierPoint["status"];
      cause: FrontierFailureCause;
      solver: FrontierSolveRecord;
    };
/** How a point is certified: the target-return KKT, or (top endpoint) Q39. */
type Check = { kind: "target_return" } | { kind: "top_endpoint"; tieSet: number[] };

/** The certified efficient frontier for the risk model's Σ and the BL posterior. */
export function buildEfficientFrontier(input: {
  riskModel: Pick<ForwardRiskModel, "tickers" | "covariance" | "hash">;
  posterior: Pick<
    BlackLittermanPosterior,
    "universeTickers" | "blackLittermanExpectedReturn" | "riskModelHash"
  >;
}): EfficientFrontierOutcome {
  const { tickers, covariance: sigma, hash } = input.riskModel;
  const mu = input.posterior.blackLittermanExpectedReturn;
  const n = tickers.length;
  if (
    input.posterior.riskModelHash !== hash ||
    input.posterior.universeTickers.length !== n ||
    input.posterior.universeTickers.some((t, i) => t !== tickers[i]) ||
    mu.length !== n ||
    sigma.length !== n ||
    sigma.some((row) => row.length !== n) ||
    !mu.every(Number.isFinite) ||
    !sigma.every((row) => row.every(Number.isFinite))
  )
    return {
      available: false,
      code: "invalid_inputs",
      reason:
        "The frontier needs the risk model's Σ and the posterior from that same model, in canonical order, all finite.",
    };
  if (!n)
    return {
      available: false,
      code: "no_risky_assets",
      reason: "No risky assets: there is no risky efficient frontier.",
    };

  // KKT normalization exactly as minimumVariance computes it: L = 2·λmax(Σ).
  const eigen = jacobiEigen(sigma, { maxSweeps: eigenSweeps });
  const normalization = 2 * eigen.values.at(-1)!;
  if (!eigen.converged || !Number.isFinite(normalization) || !(normalization > 0))
    return {
      available: false,
      code: "invalid_inputs",
      reason: "Σ has no positive, finite largest eigenvalue.",
    };

  // GMV anchor: the existing minimumVariance, called as the Constructor calls it
  // (100% risky budget, 0–100% bounds, constrained equal-weight start). Not re-solved.
  const lower = tickers.map(() => 0);
  const upper = tickers.map(() => 1);
  const mv = minimumVariance({
    covariance: sigma,
    lower,
    upper,
    budget: 1,
    start: equalWeight({ lower, upper, budget: 1 }).weights!,
  });
  if (mv.status !== "success" || !mv.weights)
    return {
      available: false,
      code: "gmv_unavailable",
      reason: `Global Minimum Variance is unavailable: ${mv.reason ?? mv.status}.`,
    };
  const gmvWeights = mv.weights;
  const volatility = (w: readonly number[]) => {
    try {
      return Math.sqrt(portfolioVariance(sigma, w));
    } catch (error) {
      if (error instanceof LabError) return NaN;
      throw error;
    }
  };
  const mvRecord = (iterations: number): FrontierSolveRecord => ({
    method: "minimum_variance",
    iterations,
    joins: null,
    releases: null,
    maxIterations: minimumVarianceIterations,
    cycleDetected: false,
  });

  const point = (
    index: number,
    role: FrontierPoint["role"],
    targetReturn: number,
    candidate: Candidate,
    check: Check,
  ): FrontierPoint => {
    const shell = (
      residuals: ForwardSolverResiduals | TopEndpointResiduals,
      extra?: { kktNormalization: number | null; returnAllowance: number },
    ): FrontierCertification =>
      check.kind === "target_return"
        ? { kind: "target_return", residuals: residuals as ForwardSolverResiduals }
        : {
            kind: "top_endpoint",
            tieSet: check.tieSet.map((i) => tickers[i]),
            kktNormalization: extra?.kktNormalization ?? null,
            returnAllowance: extra?.returnAllowance ?? 0,
            residuals: residuals as TopEndpointResiduals,
          };
    const rejected = (
      status: FrontierPoint["status"],
      cause: FrontierFailureCause,
      reason: string,
      certification: FrontierCertification,
    ): FrontierPoint => ({
      index,
      role,
      targetReturn,
      status,
      certified: false,
      reason,
      cause,
      weights: null,
      expectedReturn: null,
      volatility: null,
      binding: { lower: [], upper: [] },
      certification,
      solver: candidate.solver,
    });
    if ("failure" in candidate)
      return rejected(
        candidate.status,
        candidate.cause,
        candidate.failure,
        shell(check.kind === "target_return" ? NO_RESIDUALS : NO_TOP_RESIDUALS),
      );
    const w = candidate.weights;
    let certification: FrontierCertification;
    let failures: string[];
    if (check.kind === "target_return") {
      const c = certifyFrontierPoint({
        weights: w,
        targetReturn,
        covariance: sigma,
        expectedReturns: mu,
        normalization,
      });
      certification = shell(c.residuals);
      failures = c.failures;
    } else {
      const c = certifyTopEndpoint({
        weights: w,
        tieSet: check.tieSet,
        covariance: sigma,
        expectedReturns: mu,
      });
      certification = shell(c.residuals, c);
      failures = c.failures;
    }
    const sigmaP = volatility(w);
    if (failures.length || !Number.isFinite(sigmaP))
      return rejected(
        "numerical_failure",
        "certification_failed",
        `Failed certification (${failures.join("; ") || "non-finite volatility"}); not a valid frontier point, so it is not plotted.`,
        certification,
      );
    const bind = bindingConstraints(w, lower, upper);
    return {
      index,
      role,
      targetReturn,
      status: "success",
      certified: true,
      reason: null,
      cause: null,
      weights: w,
      expectedReturn: dot(w, mu),
      volatility: sigmaP,
      binding: {
        lower: bind.lower.map((i) => tickers[i]),
        upper: bind.upper.map((i) => tickers[i]),
      },
      certification,
      solver: candidate.solver,
    };
  };

  const rGmv = dot(gmvWeights, mu);
  const gmvPoint = point(
    0,
    "gmv",
    rGmv,
    { weights: gmvWeights, solver: mvRecord(mv.iterations) },
    { kind: "target_return" },
  );
  // The frontier's KKT residual never exceeds minimumVariance's own (ν = 0 with the
  // best λ is among the multipliers it minimizes over), so a certified GMV always
  // passes; the check stays as a guard.
  if (!gmvPoint.certified)
    return {
      available: false,
      code: "gmv_unavailable",
      reason: `The Global Minimum Variance anchor failed frontier certification: ${gmvPoint.reason}`,
    };
  const maxMu = Math.max(...mu);
  // Q37: securities within the numerical tie tolerance of max μ are tied for the top
  // point. Their μ are kept as they are.
  const tied = mu.flatMap((m, i) => (maxMu - m <= F.topReturnTieTolerance ? [i] : []));
  // Q35: a range at or below the threshold is a single point (never exact equality).
  const single = maxMu - rGmv <= F.singlePointThreshold;
  const points: FrontierPoint[] = [gmvPoint];
  if (!single) {
    const count = FORWARD_METHODOLOGY.frontierPoints;
    // The first security holding exactly max μ: mixing it with the GMV reaches every
    // target exactly, so each interior start is feasible.
    const k = mu.indexOf(maxMu);
    const cap = activeSetIterationCap(n);
    for (let index = 1; index < count - 1; index++) {
      const target = rGmv + (index / (count - 1)) * (maxMu - rGmv);
      const t = (target - rGmv) / (maxMu - rGmv);
      const start = gmvWeights.map((w, i) => (1 - t) * w + (i === k ? t : 0));
      // Q36: given Σw = 1, μᵀw = r is the same constraint as (μ − r·1)ᵀw = 0. The
      // solve uses that row divided by s = max|μ_i − r|, which keeps it well
      // conditioned when expected returns are nearly equal. Certification below is in
      // original coordinates: |μᵀw − r| ≤ 1e-10.
      const offsets = mu.map((m) => m - target);
      const scale = Math.max(...offsets.map(Math.abs));
      const record = (r: { iterations: number; joins: number; releases: number }, cycle = false): FrontierSolveRecord => ({
        method: "active_set",
        iterations: r.iterations,
        joins: r.joins,
        releases: r.releases,
        maxIterations: cap,
        cycleDetected: cycle,
      });
      let candidate: Candidate;
      if (!(Number.isFinite(scale) && scale > 0))
        candidate = {
          failure: `The return constraint has no positive, finite scale (max|μ_i − r| = ${scale}); the point is not solved.`,
          status: "numerical_failure",
          cause: "invalid_scale",
          solver: record({ iterations: 0, joins: 0, releases: 0 }),
        };
      else {
        const qp = activeSetQp({
          covariance: sigma,
          E: [tickers.map(() => 1), offsets.map((d) => d / scale)],
          f: [1, 0],
          start,
          optimalityTolerance: T.kkt * normalization,
          maxIterations: cap,
        });
        candidate = qp.ok
          ? { weights: qp.x, solver: record(qp) }
          : {
              failure: qp.reason,
              status: qp.status,
              cause: qp.cause,
              solver: record(qp, qp.cause === "active_set_cycle"),
            };
      }
      points.push(point(index, "interior", target, candidate, { kind: "target_return" }));
    }
    // Top endpoint (Q37/Q39): the minimum-variance portfolio of the near-tied top set
    // T. One security in T: 100% in it. Several: the existing minimumVariance on Σ_TT.
    // Certified as that problem (certifyTopEndpoint); it reports its actual μᵀw.
    const top: Check = { kind: "top_endpoint", tieSet: tied };
    if (tied.length === 1)
      points.push(
        point(
          count - 1,
          "max_return",
          maxMu,
          {
            weights: tickers.map((_, i) => (i === tied[0] ? 1 : 0)),
            solver: {
              method: "single_security",
              iterations: 0,
              joins: null,
              releases: null,
              maxIterations: null,
              cycleDetected: false,
            },
          },
          top,
        ),
      );
    else {
      const zero = tied.map(() => 0);
      const one = tied.map(() => 1);
      const tiedMv = minimumVariance({
        covariance: tied.map((i) => tied.map((j) => sigma[i][j])),
        lower: zero,
        upper: one,
        budget: 1,
        start: equalWeight({ lower: zero, upper: one, budget: 1 }).weights!,
      });
      const mix = tiedMv.status === "success" ? tiedMv.weights : null;
      points.push(
        point(
          count - 1,
          "max_return",
          maxMu,
          mix
            ? {
                weights: tickers.map((_, i) =>
                  tied.includes(i) ? mix[tied.indexOf(i)] : 0,
                ),
                solver: mvRecord(tiedMv.iterations),
              }
            : {
                failure: `Minimum variance among the tied top-return securities is unavailable: ${tiedMv.reason ?? tiedMv.status}.`,
                status:
                  tiedMv.status === "non_converged" ? "non_converged" : "numerical_failure",
                cause: "minimum_variance_failed",
                solver: mvRecord(tiedMv.iterations),
              },
          top,
        ),
      );
    }
  }

  const status = single ? "single_point" : "frontier";
  // Canonical economic payload: the risk model it rests on, μ, and every point's
  // target, outcome and weights (no labels, residual diagnostics or display state).
  const payload = {
    kind: "efficient-frontier",
    methodologyVersion: FORWARD_METHODOLOGY.version,
    riskModelHash: hash,
    tickers: [...tickers],
    expectedReturns: [...mu],
    status,
    points: points.map((p) => [p.index, p.role, p.targetReturn, p.status, p.weights]),
  };
  return {
    available: true,
    frontier: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: hash,
      tickers: [...tickers],
      expectedReturns: [...mu],
      status,
      gmv: {
        expectedReturn: rGmv,
        volatility: gmvPoint.volatility!,
        weights: gmvWeights,
        solver: { termination: mv.termination, iterations: mv.iterations },
      },
      maxExpectedReturn: maxMu,
      maxReturnTickers: tied.map((i) => tickers[i]),
      kktNormalization: normalization,
      tolerances: {
        budget: T.budget,
        bound: T.bound,
        targetReturn: T.targetReturn,
        kkt: T.kkt,
      },
      thresholds: {
        singlePoint: F.singlePointThreshold,
        topReturnTie: F.topReturnTieTolerance,
      },
      points,
      certifiedCount: points.filter((p) => p.certified).length,
      frontierHash: sha256Hex(JSON.stringify(payload)),
    },
  };
}
