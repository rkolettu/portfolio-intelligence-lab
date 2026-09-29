import type {
  AllocationWeight,
  ConstructionMethod,
  OptimizationConstraint,
} from "@/lib/types/construction";

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const list = (xs: string[]) => xs.join(", ");

/** Plain statements about what shaped a mathematically valid allocation: binding
 * floors and caps, concentration, hedges, turnover. They explain; they never judge
 * the allocation, and nothing is replaced by a more pleasing portfolio. */
export function proposalObservations(input: {
  method: ConstructionMethod;
  weights: readonly AllocationWeight[];
  budget: number;
  binding: { lower: string[]; upper: string[]; fixed: string[] };
  bounds: readonly OptimizationConstraint[];
  turnover: number | null;
  negativeRisk: string[];
}): string[] {
  const { method, weights, budget, binding, bounds, turnover, negativeRisk } =
    input;
  const minOf = (t: string) =>
    bounds.find((b) => b.ticker === t)?.minWeight ?? 0;
  const out: string[] = [];
  const floors = binding.lower.filter((t) => minOf(t) === 0);
  const minimums = binding.lower.filter((t) => minOf(t) > 0);
  if (floors.length)
    out.push(
      `${list(floors)} ${floors.length === 1 ? "is" : "are"} held at the long-only 0% floor (binding).`,
    );
  if (minimums.length)
    out.push(
      `${list(minimums)} ${minimums.length === 1 ? "is" : "are"} held at ${minimums.length === 1 ? "its" : "their"} minimum weight (binding).`,
    );
  if (binding.upper.length)
    out.push(
      `${list(binding.upper)} ${binding.upper.length === 1 ? "is" : "are"} held at ${binding.upper.length === 1 ? "its" : "their"} maximum weight (binding cap).`,
    );
  if (binding.fixed.length)
    out.push(
      `${list(binding.fixed)} ${binding.fixed.length === 1 ? "is" : "are"} fixed by equal minimum and maximum bounds.`,
    );
  const risky = weights.filter((w) => w.ticker !== "CASH");
  if (budget > 0 && risky.length > 1) {
    const top = risky.reduce((a, b) => (b.weight > a.weight ? b : a));
    if (top.weight / budget > 0.5)
      out.push(
        `${top.ticker} receives ${pct(top.weight / budget)} of the risky budget.`,
      );
  }
  for (const t of negativeRisk)
    out.push(
      `${t} has a negative risk contribution under Σ_construction (a hedge); it is shown, never clamped.`,
    );
  if (turnover !== null && turnover > 0.5)
    out.push(
      `High one-way turnover: ${pct(turnover)} of the portfolio would change.`,
    );
  if (method === "minimum_variance")
    out.push(
      "Lower modeled variance does not imply better returns, smaller future drawdowns or suitability.",
    );
  return out;
}

/** One-line binding summary, wording a 0% lower bound as the long-only floor. */
export function bindingSummary(
  binding: { lower: string[]; upper: string[]; fixed: string[] },
  bounds: readonly OptimizationConstraint[],
): string {
  const minOf = (t: string) =>
    bounds.find((b) => b.ticker === t)?.minWeight ?? 0;
  const parts = [
    ...binding.lower.map(
      (t) => `${t} ${minOf(t) === 0 ? "0% floor" : "minimum"}`,
    ),
    ...binding.upper.map((t) => `${t} maximum`),
    ...binding.fixed.map((t) => `${t} fixed`),
  ];
  return parts.join(", ") || "None";
}
