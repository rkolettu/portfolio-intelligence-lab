// Display-only ordering and scaling for the Capital vs Risk view. No finance math:
// values are taken verbatim from RiskAnalytics.
import type { HoldingRisk } from "@/lib/types/analytics";

export type RiskSortKey = "weight" | "risk" | "volatility" | "beta";

const keyValue = (h: HoldingRisk, key: RiskSortKey): number | null => {
  if (key === "weight") return h.weight;
  const m =
    key === "risk"
      ? h.percentage
      : key === "volatility"
        ? h.volatility
        : h.beta;
  return m.available ? m.value : null;
};

/** Descending by the chosen key; unavailable values last; ties keep portfolio order. */
export function sortHoldings(
  holdings: readonly HoldingRisk[],
  key: RiskSortKey,
): HoldingRisk[] {
  return holdings
    .map((h, order) => ({ h, order, v: keyValue(h, key) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null)
        return a.v === null ? (b.v === null ? a.order - b.order : 1) : -1;
      return b.v - a.v || a.order - b.order;
    })
    .map(({ h }) => h);
}

/** Shared axis for capital weight and PCR: always includes 0, extends left for
 * negative contributions, and uses a clean 5/10/20/25/50% step. */
export function capitalRiskScale(values: readonly number[]): {
  min: number;
  max: number;
  ticks: number[];
  position: (v: number) => number;
} {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values, 0.05);
  const span = hi - lo;
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => span / s <= 6) ?? 1;
  // Nudge toward zero so exact multiples (including 0) do not gain an extra step.
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step)
    ticks.push(Number(t.toFixed(10)));
  return { min, max, ticks, position: (v) => (v - min) / (max - min) };
}
