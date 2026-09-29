import type { LedgerRow, ReturnContributionRow } from "@/lib/types/analytics";
import type { PortfolioHolding } from "@/lib/types/portfolio";
import { fail } from "@/lib/utils/errors";

/** Arithmetic return contribution from the historical ledger, separate from risk.
 * contribution_(i,t) = w_(i,t−1) × r_(i,t) uses each interval's ACTUAL beginning
 * weight — drifted within a month, reset to targets after a month-end close — as
 * recorded by the engine (never static targets). Period contribution is the plain
 * sum over intervals: it adds up to the sum of daily portfolio returns, not to the
 * compounded cumulative return, and is not Brinson or linked attribution. */
export function returnContribution(
  holdings: readonly PortfolioHolding[],
  ledger: readonly LedgerRow[],
): {
  rows: ReturnContributionRow[];
  sumOfDailyReturns: number;
  maxIdentityResidual: number;
} {
  if (!ledger.length)
    fail("INVALID_INPUT", "Return contribution requires intervals.");
  if (ledger.some((r) => r.contributions.length !== holdings.length))
    fail("MALFORMED_DATA", "Ledger contributions do not match the holdings.");
  let maxIdentityResidual = 0;
  let sumOfDailyReturns = 0;
  const totals = holdings.map(() => 0);
  const weights = holdings.map(() => 0);
  for (const row of ledger) {
    const daily = row.contributions.reduce((a, b) => a + b, 0);
    maxIdentityResidual = Math.max(
      maxIdentityResidual,
      Math.abs(daily - row.return),
    );
    sumOfDailyReturns += row.return;
    row.contributions.forEach((c, i) => (totals[i] += c));
    row.startWeights.forEach((w, i) => (weights[i] += w));
  }
  return {
    rows: holdings.map((h, i) => ({
      ticker: h.ticker,
      periodContribution: totals[i],
      averageWeight: weights[i] / ledger.length,
    })),
    sumOfDailyReturns,
    maxIdentityResidual,
  };
}
