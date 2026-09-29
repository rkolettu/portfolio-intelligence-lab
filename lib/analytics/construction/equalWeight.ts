import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import { projectBudgetBox } from "@/lib/analytics/optimization";
import {
  emptyResiduals,
  failed,
  residualsOf,
  type MethodResult,
} from "./common";

const TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;

/** Reference w_i = B/N; with bounds, its exact Euclidean projection onto
 * {Σw = B, l ≤ w ≤ u}. Needs no covariance. */
export function equalWeight(input: {
  lower: readonly number[];
  upper: readonly number[];
  budget: number;
}): MethodResult {
  const { lower, upper, budget } = input;
  const n = lower.length;
  const reference = n ? new Array<number>(n).fill(budget / n) : [];
  const inside = reference.every((r, i) => r >= lower[i] && r <= upper[i]);
  const weights = inside
    ? reference
    : projectBudgetBox(reference, lower, upper, budget);
  const res = residualsOf(weights, lower, upper, budget);
  const base = {
    constrained: !inside,
    objective: {
      name: "‖w − B/N‖² (distance from equal weight)",
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
      "The equal-weight projection violated the budget or bounds beyond tolerance.",
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
