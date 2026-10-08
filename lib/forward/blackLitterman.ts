// V2 Black–Litterman posterior (Layer B). μ_BL = Π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − PΠ),
// every active view solved simultaneously with the existing solveLinear, then the
// solve certified by its relative backward error (Q32). Pure and free of
// Node-only or server-only imports. No Expected Return Gap, portfolio metric or
// frontier is computed here.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { solveLinear } from "@/lib/analytics/construction/common";
import type {
  BlackLittermanInputs,
  BlackLittermanPosteriorOutcome,
  BlackLittermanSolveCertification,
  CapmPrior,
  ForwardRiskModel,
  PosteriorViewSummary,
} from "@/lib/types/forward";

const TOLERANCE = FORWARD_METHODOLOGY.blackLitterman.solveCertification.tolerance;
type Matrix = readonly (readonly number[])[];

/** ‖v‖∞ = max |v_i| (0 for an empty vector). */
export const vectorInfinityNorm = (v: readonly number[]) =>
  v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** ‖A‖∞ = maximum absolute row sum (0 for an empty matrix). */
export const matrixInfinityNorm = (a: Matrix) =>
  a.reduce((m, row) => Math.max(m, row.reduce((s, x) => s + Math.abs(x), 0)), 0);

const finite = (v: readonly number[]) => v.every(Number.isFinite);
const finiteMatrix = (a: Matrix) => a.every((row) => finite(row));

export type BlackLittermanCore =
  | {
      ok: true;
      mean: number[];
      certification: BlackLittermanSolveCertification;
    }
  | {
      ok: false;
      code: "invalid_inputs" | "singular_view_system" | "numerical_failure";
      reason: string;
      certification: BlackLittermanSolveCertification | null;
    };

/** The posterior mean for prior Π, covariance Σ, views (P, Q, Ω) and τ. With no
 * view, an exact copy of Π (no arithmetic). Otherwise A = PτΣPᵀ + Ω and
 * b = Q − PΠ are solved together by `solve` (solveLinear; injectable only for
 * tests), the solution is certified, and μ = Π + τΣPᵀx. */
export function blackLittermanMean(input: {
  prior: readonly number[];
  covariance: Matrix;
  P: Matrix;
  Q: readonly number[];
  Omega: Matrix;
  tau: number;
  solve?: (A: number[][], b: number[]) => number[] | null;
}): BlackLittermanCore {
  const { prior, covariance: sigma, P, Q, Omega, tau } = input;
  const n = prior.length;
  const m = P.length;
  const invalid = (reason: string): BlackLittermanCore => ({
    ok: false,
    code: "invalid_inputs",
    reason,
    certification: null,
  });
  if (
    sigma.length !== n ||
    sigma.some((row) => row.length !== n) ||
    P.some((row) => row.length !== n) ||
    Q.length !== m ||
    Omega.length !== m ||
    Omega.some((row) => row.length !== m)
  )
    return invalid("Π, Σ, P, Q and Ω have inconsistent dimensions.");
  if (
    !finite(prior) ||
    !finiteMatrix(sigma) ||
    !finiteMatrix(P) ||
    !finite(Q) ||
    !finiteMatrix(Omega) ||
    !Number.isFinite(tau) ||
    !(tau > 0)
  )
    return invalid("Π, Σ, P, Q, Ω and τ must be finite (τ positive).");

  // No active view: the posterior IS the prior, bit for bit.
  if (m === 0)
    return {
      ok: true,
      mean: [...prior],
      certification: { required: false, reason: "no_active_views" },
    };

  // S = τΣPᵀ (n × m), A = P S + Ω (m × m), b = Q − PΠ (m).
  const S = sigma.map((row) =>
    P.map((p) => row.reduce((s, x, j) => s + tau * x * p[j], 0)),
  );
  const A = P.map((p, k) =>
    P.map((_, l) => p.reduce((s, x, i) => s + x * S[i][l], 0) + Omega[k][l]),
  );
  const b = P.map((p, k) => Q[k] - p.reduce((s, x, i) => s + x * prior[i], 0));
  const failure = (
    reason: string,
    certification: BlackLittermanSolveCertification | null = null,
  ): BlackLittermanCore => ({
    ok: false,
    code: "numerical_failure",
    reason,
    certification,
  });
  if (!finiteMatrix(A) || !finite(b))
    return failure("The Black–Litterman system A = PτΣPᵀ + Ω, b = Q − PΠ is not finite.");

  const x = (input.solve ?? solveLinear)(A, b);
  if (!x)
    return {
      ok: false,
      code: "singular_view_system",
      reason:
        "The Black–Litterman view system PτΣPᵀ + Ω is singular under the existing pivot test; no regularization, epsilon or dropped view is applied.",
      certification: null,
    };
  if (x.length !== m || !finite(x))
    return failure("The Black–Litterman solve produced a non-finite solution.");

  // Q32 certification: η = ‖Ax − b‖∞ / (‖A‖∞‖x‖∞ + ‖b‖∞) ≤ 1e-12.
  const residual = A.map((row, k) => row.reduce((s, a, l) => s + a * x[l], 0) - b[k]);
  const residualNorm = vectorInfinityNorm(residual);
  const matrixNorm = matrixInfinityNorm(A);
  const solutionNorm = vectorInfinityNorm(x);
  const rhsNorm = vectorInfinityNorm(b);
  const denominator = matrixNorm * solutionNorm + rhsNorm;
  if (!finite(residual) || ![residualNorm, matrixNorm, solutionNorm, rhsNorm, denominator].every(Number.isFinite))
    return failure("The Black–Litterman solve certification is not finite.");
  const eta = denominator === 0 ? null : residualNorm / denominator;
  if (eta !== null && !Number.isFinite(eta))
    return failure("The Black–Litterman relative backward error is not finite.");
  const certification: BlackLittermanSolveCertification = {
    required: true,
    residualNorm,
    matrixNorm,
    solutionNorm,
    rhsNorm,
    relativeBackwardError: eta,
    tolerance: TOLERANCE,
    passed: eta === null ? residualNorm === 0 : eta <= TOLERANCE,
  };
  if (!certification.passed)
    return failure(
      eta === null
        ? `The Black–Litterman solve failed certification: zero scale with a nonzero residual (${residualNorm}).`
        : `The Black–Litterman solve failed certification: relative backward error ${eta.toExponential(3)} exceeds ${TOLERANCE}.`,
      certification,
    );

  const mean = prior.map((p, i) => p + S[i].reduce((s, v, k) => s + v * x[k], 0));
  if (!finite(mean))
    return failure("The Black–Litterman posterior is not finite.", certification);
  return { ok: true, mean, certification };
}

const summary = (inputs: BlackLittermanInputs): PosteriorViewSummary[] =>
  inputs.activeViews.map((v) => ({
    ticker: v.ticker,
    source: v.source,
    basis: v.basis,
    horizonMonths: v.horizonMonths,
    confidence: v.confidence,
    viewReturn: v.viewReturn,
    label: v.label,
  }));

/** The certified posterior from the Task 4 CAPM prior, the Task 3 risk model and
 * the Task 5 view inputs, which must all describe the same risk model in the same
 * canonical order. A 12-month expected return at or below −100% is an
 * invalid_posterior error naming the security; it is never clamped. */
export function buildBlackLittermanPosterior(input: {
  capmPrior: CapmPrior;
  riskModel: Pick<ForwardRiskModel, "tickers" | "covariance" | "hash">;
  inputs: BlackLittermanInputs;
}): BlackLittermanPosteriorOutcome {
  const { capmPrior: prior, riskModel: model, inputs } = input;
  const views = summary(inputs);
  const fail = (
    code: "invalid_inputs" | "singular_view_system" | "numerical_failure",
    reason: string,
    certification: BlackLittermanSolveCertification | null = null,
  ): BlackLittermanPosteriorOutcome => ({
    available: false,
    code,
    reason,
    activeViews: views,
    certification,
    invalid: [],
  });
  const tickers = model.tickers;
  if (
    prior.riskModelHash !== model.hash ||
    inputs.riskModelHash !== model.hash
  )
    return fail(
      "invalid_inputs",
      "The CAPM prior, the view inputs and the covariance must come from the same forward risk model.",
    );
  if (
    prior.rows.length !== tickers.length ||
    prior.rows.some((r, i) => r.ticker !== tickers[i]) ||
    inputs.universeTickers.length !== tickers.length ||
    inputs.universeTickers.some((t, i) => t !== tickers[i])
  )
    return fail(
      "invalid_inputs",
      "The CAPM prior and the view inputs must follow the risk model's canonical ticker order.",
    );
  if (inputs.tau !== FORWARD_METHODOLOGY.tau)
    return fail(
      "invalid_inputs",
      `The view inputs must use the approved internal τ = ${FORWARD_METHODOLOGY.tau}.`,
    );

  const pi = prior.rows.map((r) => r.capmPrior);
  const core = blackLittermanMean({
    prior: pi,
    covariance: model.covariance,
    P: inputs.P,
    Q: inputs.Q,
    Omega: inputs.Omega,
    tau: inputs.tau,
  });
  if (!core.ok) return fail(core.code, core.reason, core.certification);

  const invalid = tickers
    .map((ticker, i) => ({
      ticker,
      capmPrior: pi[i],
      blackLittermanExpectedReturn: core.mean[i],
    }))
    .filter((r) => !(r.blackLittermanExpectedReturn > -1));
  if (invalid.length)
    return {
      available: false,
      code: "invalid_posterior",
      reason: `A 12-month expected total return cannot be at or below −100%; the posterior is not clamped. ${invalid
        .map(
          (r) =>
            `${r.ticker}: CAPM prior ${(r.capmPrior * 100).toFixed(4)}% → BL ${(r.blackLittermanExpectedReturn * 100).toFixed(4)}%`,
        )
        .join("; ")}. Active views in the solve: ${views
        .map((v) => `${v.ticker} ${(v.viewReturn * 100).toFixed(2)}% at ${(v.confidence * 100).toFixed(0)}% (${v.source})`)
        .join(", ")}.`,
      activeViews: views,
      certification: core.certification,
      invalid,
    };

  return {
    available: true,
    posterior: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: model.hash,
      marketProxy: prior.marketProxy,
      riskWindow: prior.riskWindow,
      tau: inputs.tau,
      universeTickers: [...tickers],
      capmPrior: pi,
      blackLittermanExpectedReturn: core.mean,
      rows: tickers.map((ticker, i) => ({
        ticker,
        capmPrior: pi[i],
        blackLittermanExpectedReturn: core.mean[i],
      })),
      status: inputs.activeViews.length ? "posterior" : "prior_only",
      activeViews: inputs.activeViews,
      certification: core.certification,
      cash: prior.cash,
    },
  };
}
