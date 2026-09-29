// Shared construction machinery: feasibility, the exact bounded-budget Euclidean
// projection, and solver-independent certification of a candidate allocation.
// Pure, deterministic, no clipping-and-renormalizing anywhere.
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";

const { weight: WEIGHT_TOL, binding: BINDING_TOL } =
  CONSTRUCTION_METHODOLOGY.tolerances;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export type Feasibility =
  | { ok: true; budget: number }
  | { ok: false; status: "invalid_inputs" | "infeasible"; reason: string };

/** Validate CASH, every bound and required holding, then the risky-budget test
 * Σ lower ≤ B ≤ Σ upper with B = 1 − cash. Constraints are never relaxed. */
export function checkFeasibility(input: {
  tickers: readonly string[];
  lower: readonly number[];
  upper: readonly number[];
  required: readonly boolean[];
  cash: number;
}): Feasibility {
  const { tickers, lower, upper, required, cash } = input;
  if (!Number.isFinite(cash) || cash < 0 || cash > 1)
    return {
      ok: false,
      status: "invalid_inputs",
      reason: "The fixed CASH weight must be between 0% and 100%.",
    };
  for (let i = 0; i < tickers.length; i++) {
    const l = lower[i];
    const u = upper[i];
    if (!Number.isFinite(l) || !Number.isFinite(u) || l < 0 || u > 1 || l > u)
      return {
        ok: false,
        status: "invalid_inputs",
        reason: `${tickers[i]}: bounds must satisfy 0% ≤ minimum ≤ maximum ≤ 100%.`,
      };
    if (required[i] && !(l > 0))
      return {
        ok: false,
        status: "invalid_inputs",
        reason: `${tickers[i]} is required, so it needs a positive minimum weight.`,
      };
  }
  const budget = 1 - cash;
  if (!tickers.length)
    return budget > WEIGHT_TOL
      ? {
          ok: false,
          status: "infeasible",
          reason: `There are no eligible risky assets to hold the ${pct(budget)} risky budget.`,
        }
      : { ok: true, budget: 0 };
  const minimum = lower.reduce((s, x) => s + x, 0);
  const capacity = upper.reduce((s, x) => s + x, 0);
  if (minimum > budget + WEIGHT_TOL)
    return {
      ok: false,
      status: "infeasible",
      reason: `Minimum weights sum to ${pct(minimum)}, above the ${pct(budget)} risky budget left after ${pct(cash)} CASH.`,
    };
  if (capacity < budget - WEIGHT_TOL)
    return {
      ok: false,
      status: "infeasible",
      reason: `Maximum weights allow only ${pct(capacity)} of risky capacity, below the ${pct(budget)} risky budget left after ${pct(cash)} CASH.`,
    };
  return { ok: true, budget };
}

const clip = (x: number, l: number, u: number) => Math.min(u, Math.max(l, x));

/** argmin ‖w − r‖² subject to Σw = B and l ≤ w ≤ u. The solution has the exact
 * form w_i = clip(r_i − τ, l_i, u_i); s(τ) = Σ clip(r_i − τ) is continuous,
 * piecewise linear and nonincreasing, so τ is found on its breakpoints and solved
 * in closed form on the crossing segment. The caller checks feasibility first. */
export function projectBudgetBox(
  reference: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
): number[] {
  const n = reference.length;
  const sumLower = lower.reduce((s, x) => s + x, 0);
  const sumUpper = upper.reduce((s, x) => s + x, 0);
  if (budget <= sumLower) return [...lower];
  if (budget >= sumUpper) return [...upper];
  if (
    reference.every((r, i) => r >= lower[i] && r <= upper[i]) &&
    reference.reduce((s, x) => s + x, 0) === budget
  )
    return [...reference];
  const sum = (tau: number) =>
    reference.reduce((s, r, i) => s + clip(r - tau, lower[i], upper[i]), 0);
  const points = [
    ...new Set(reference.flatMap((r, i) => [r - upper[i], r - lower[i]])),
  ].sort((a, b) => a - b);
  // s(−∞) = Σu ≥ B ≥ Σl = s(+∞): find consecutive breakpoints bracketing B.
  let lo = 0;
  while (lo < points.length - 1 && sum(points[lo + 1]) >= budget) lo++;
  const tauLo = points[lo];
  // On (tauLo, next) the free set is fixed; solve Σ_free (r_i − τ) + Σ_bound = B.
  const probe =
    lo < points.length - 1 ? (tauLo + points[lo + 1]) / 2 : tauLo + 1;
  let freeSum = 0;
  let freeCount = 0;
  let boundSum = 0;
  for (let i = 0; i < n; i++) {
    const x = reference[i] - probe;
    if (x > lower[i] && x < upper[i]) {
      freeSum += reference[i];
      freeCount++;
    } else boundSum += x <= lower[i] ? lower[i] : upper[i];
  }
  const tau = freeCount ? (freeSum + boundSum - budget) / freeCount : tauLo;
  return reference.map((r, i) => clip(r - tau, lower[i], upper[i]));
}

/** Budget and bound violations of a candidate allocation (absolute, decimal weights). */
export function allocationResiduals(
  weights: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
): { budget: number; bound: number; finite: boolean } {
  const finite = weights.every(Number.isFinite);
  let bound = 0;
  weights.forEach((w, i) => {
    bound = Math.max(bound, lower[i] - w, w - upper[i]);
  });
  return {
    budget: Math.abs(weights.reduce((s, x) => s + x, 0) - budget),
    bound: Math.max(0, bound),
    finite,
  };
}

/** True when the allocation meets the locked budget/bound tolerance and is finite. */
export function allocationFeasible(
  weights: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
): boolean {
  const r = allocationResiduals(weights, lower, upper, budget);
  return r.finite && r.budget <= WEIGHT_TOL && r.bound <= WEIGHT_TOL;
}

/** Multiplier-based KKT residual for min f over {Σw = B, l ≤ w ≤ u} given ∇f = g:
 * free assets need g_i = ν, assets at a lower bound g_i ≥ ν, at an upper bound
 * g_i ≤ ν. Returns the largest violation (unnormalized; callers scale it). */
export function kktResidual(
  weights: readonly number[],
  gradient: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
): { residual: number; multiplier: number } {
  const free: number[] = [];
  const atLower: number[] = [];
  const atUpper: number[] = [];
  weights.forEach((w, i) => {
    if (upper[i] - lower[i] <= BINDING_TOL) return;
    if (w - lower[i] <= BINDING_TOL) atLower.push(i);
    else if (upper[i] - w <= BINDING_TOL) atUpper.push(i);
    else free.push(i);
  });
  let nu: number;
  if (free.length) nu = free.reduce((s, i) => s + gradient[i], 0) / free.length;
  else {
    const hi = Math.min(...atLower.map((i) => gradient[i]));
    const lo = Math.max(...atUpper.map((i) => gradient[i]));
    if (Number.isFinite(hi) && Number.isFinite(lo) && lo > hi)
      return { residual: lo - hi, multiplier: (lo + hi) / 2 };
    nu =
      Number.isFinite(hi) && Number.isFinite(lo)
        ? (lo + hi) / 2
        : Number.isFinite(hi)
          ? hi
          : Number.isFinite(lo)
            ? lo
            : 0;
  }
  let residual = 0;
  for (const i of free)
    residual = Math.max(residual, Math.abs(gradient[i] - nu));
  for (const i of atLower) residual = Math.max(residual, nu - gradient[i]);
  for (const i of atUpper) residual = Math.max(residual, gradient[i] - nu);
  return { residual: Math.max(0, residual), multiplier: nu };
}

/** Gradient-mapping residual ‖w − P(w − s·g)‖∞ / B: zero exactly at KKT points,
 * for any positive step s. Callers choose a scale-free step. */
export function projectedGradientResidual(
  weights: readonly number[],
  gradient: readonly number[],
  step: number,
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
): number {
  const moved = projectBudgetBox(
    weights.map((w, i) => w - step * gradient[i]),
    lower,
    upper,
    budget,
  );
  let r = 0;
  moved.forEach((x, i) => (r = Math.max(r, Math.abs(x - weights[i]))));
  return budget > 0 ? r / budget : r;
}

/** Indices at a binding lower bound (the long-only 0% floor included) or upper bound
 * (tolerance-based), and fixed positions. */
export function bindingConstraints(
  weights: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
): { lower: number[]; upper: number[]; fixed: number[] } {
  const out = {
    lower: [] as number[],
    upper: [] as number[],
    fixed: [] as number[],
  };
  weights.forEach((w, i) => {
    if (upper[i] - lower[i] <= BINDING_TOL) out.fixed.push(i);
    else if (w - lower[i] <= BINDING_TOL) out.lower.push(i);
    else if (upper[i] - w <= BINDING_TOL) out.upper.push(i);
  });
  return out;
}
