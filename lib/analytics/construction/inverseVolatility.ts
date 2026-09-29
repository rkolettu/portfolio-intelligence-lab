import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import { projectBudgetBox } from "@/lib/analytics/optimization";
import {
  emptyResiduals,
  failed,
  residualsOf,
  type MethodResult,
} from "./common";

const TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;

/** σ_i = √Σ_construction[i,i]; reference w_i = B (1/σ_i) / Σ_j (1/σ_j); with bounds,
 * the same exact projection as equal weight. Not risk parity. */
export function inverseVolatility(input: {
  covariance: readonly (readonly number[])[];
  lower: readonly number[];
  upper: readonly number[];
  budget: number;
}): MethodResult {
  const { covariance, lower, upper, budget } = input;
  const sigma = covariance.map((row, i) => Math.sqrt(row[i]));
  if (sigma.some((s) => !Number.isFinite(s) || !(s > 0)))
    return failed(
      "invalid_inputs",
      "Inverse volatility needs a positive, finite volatility for every eligible asset.",
    );
  const scores = sigma.map((s) => 1 / s);
  const total = scores.reduce((s, x) => s + x, 0);
  const reference = scores.map((s) => (budget * s) / total);
  const inside = reference.every((r, i) => r >= lower[i] && r <= upper[i]);
  const weights = inside
    ? reference
    : projectBudgetBox(reference, lower, upper, budget);
  const res = residualsOf(weights, lower, upper, budget);
  const base = {
    constrained: !inside,
    objective: {
      name: "‖w − inverse-volatility reference‖²",
      value: weights.reduce((s, w, i) => s + (w - reference[i]) ** 2, 0),
    },
    iterations: 0,
    termination: inside ? "closed_form" : "exact_projection",
    reference,
    starts: [],
    tieRule: null,
    notes: [],
  };
  if (!res.finite || res.budget > TOL || res.bound > TOL)
    return failed(
      "numerical_failure",
      "The inverse-volatility projection violated the budget or bounds beyond tolerance.",
      base,
    );
  return {
    ...base,
    status: "success",
    reason: null,
    weights,
    residuals: { ...emptyResiduals(), budget: res.budget, bound: res.bound },
  };
}
