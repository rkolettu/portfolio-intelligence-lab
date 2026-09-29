import type { CorrelationPair } from "@/lib/types/analytics";
import { fail } from "@/lib/utils/errors";

/** Pearson correlation matrix derived from ONE covariance matrix (so it shares the
 * canonical sample exactly). A holding whose variance is zero within tolerance has
 * an undefined row and column (null), including its diagonal; defined diagonals are
 * exactly 1. Roundoff overshoot past ±1 is clamped; anything larger is an error. */
export function correlationMatrix(
  covariance: readonly (readonly number[])[],
  constant: readonly boolean[],
): (number | null)[][] {
  const n = covariance.length;
  return covariance.map((row, i) =>
    row.map((cij, j) => {
      if (constant[i] || constant[j]) return null;
      if (i === j) return 1;
      const r = cij / Math.sqrt(covariance[i][i] * covariance[j][j]);
      if (!Number.isFinite(r) || Math.abs(r) > 1 + 1e-9)
        fail(
          "MALFORMED_DATA",
          `Correlation outside [-1, 1] for holdings ${i} and ${j} of ${n}.`,
        );
      return Math.max(-1, Math.min(1, r));
    }),
  );
}

/** Highest and lowest off-diagonal correlation. Self-pairs and undefined cells are
 * excluded; ties resolve to the earliest pair in (row, column) portfolio order. */
export function extremePairs(
  tickers: readonly string[],
  matrix: readonly (readonly (number | null)[])[],
): { highest: CorrelationPair | null; lowest: CorrelationPair | null } {
  let highest: CorrelationPair | null = null;
  let lowest: CorrelationPair | null = null;
  for (let i = 0; i < tickers.length; i++)
    for (let j = i + 1; j < tickers.length; j++) {
      const correlation = matrix[i][j];
      if (correlation === null) continue;
      const pair = { a: tickers[i], b: tickers[j], correlation };
      if (!highest || correlation > highest.correlation) highest = pair;
      if (!lowest || correlation < lowest.correlation) lowest = pair;
    }
  return { highest, lowest };
}
