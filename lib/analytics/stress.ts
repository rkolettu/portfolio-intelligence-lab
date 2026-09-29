import { STRESS_METHODOLOGY } from "@/config/methodology";
import type { LedgerRow, StressHoldingReturn } from "@/lib/types/analytics";
import type { PortfolioHolding } from "@/lib/types/portfolio";

/** Each holding's own compounded return over an event ledger, prod(1 + r_t) − 1,
 * CASH included (its accrual column). These are standalone holding returns, not
 * weighted contributions. `holdings` must be the ledger's positive-weight list. */
export function eventHoldingReturns(
  holdings: readonly PortfolioHolding[],
  ledger: readonly LedgerRow[],
): StressHoldingReturn[] {
  return holdings.map((h, i) => ({
    ticker: h.ticker,
    weight: h.weight,
    return: ledger.reduce((w, row) => w * (1 + row.holdingReturns[i]), 1) - 1,
    riskless: h.ticker === "CASH",
  }));
}

/** Every holding at the highest and at the lowest event return; ties within the
 * documented tolerance are all named, in portfolio order. */
export function extremeHoldings(rows: readonly StressHoldingReturn[]): {
  best: string[];
  worst: string[];
} {
  const values = rows.map((r) => r.return);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const near = (x: number, y: number) =>
    Math.abs(x - y) <= STRESS_METHODOLOGY.tieTolerance;
  return {
    best: rows.filter((r) => near(r.return, hi)).map((r) => r.ticker),
    worst: rows.filter((r) => near(r.return, lo)).map((r) => r.ticker),
  };
}

/** Event active return: portfolio cumulative return minus benchmark cumulative
 * return over the same window, in return units. A simple difference; it is not
 * the annualized arithmetic active return of the benchmark section. */
export function eventActiveReturn(
  portfolioCumulative: number,
  benchmarkCumulative: number,
): number {
  return portfolioCumulative - benchmarkCumulative;
}
