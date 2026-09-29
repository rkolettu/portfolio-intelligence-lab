import type { AllocationWeight } from "@/lib/types/construction";

/** Estimated One-Way Turnover = 0.5 × Σ_i |proposed_i − current_i| over the union of
 * holdings (missing weight = 0), CASH included. A distance between target
 * allocations, not traded notional or the rebalancing turnover of a backtest. */
export function oneWayTurnover(
  current: readonly AllocationWeight[],
  proposed: readonly AllocationWeight[],
): number {
  const a = new Map(current.map((h) => [h.ticker, h.weight]));
  const b = new Map(proposed.map((h) => [h.ticker, h.weight]));
  const tickers = [...new Set([...a.keys(), ...b.keys()])].sort();
  return (
    0.5 *
    tickers.reduce((s, t) => s + Math.abs((b.get(t) ?? 0) - (a.get(t) ?? 0)), 0)
  );
}
