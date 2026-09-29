import { PERFORMANCE_METHODOLOGY } from "@/config/methodology";
import {
  isEffectivelyZero,
  mean,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";
import type { Computed } from "./performance";

const {
  riskAnnualization: DAYS,
  minimumReturns,
  shortSampleReturns,
} = PERFORMANCE_METHODOLOGY;

function sampleNotes(count: number): string[] {
  return count < shortSampleReturns
    ? [
        `Based on ${count} daily returns (fewer than ${shortSampleReturns}); the annualized estimate is unstable.`,
      ]
    : [];
}

function tooFew(count: number, label: string): Computed | null {
  return count < minimumReturns
    ? {
        ok: false,
        reason: `${label} requires at least ${minimumReturns} daily returns; this sample has ${count}.`,
      }
    : null;
}

/** sampleStdDev(daily arithmetic returns) × sqrt(252). */
export function annualizedVolatility(returns: readonly number[]): Computed {
  const short = tooFew(returns.length, "Volatility");
  if (short) return short;
  const daily = sampleStandardDeviation(returns);
  const constant = isEffectivelyZero(daily, returns);
  return {
    ok: true,
    value: constant ? 0 : daily * Math.sqrt(DAYS),
    notes: [
      ...sampleNotes(returns.length),
      ...(constant
        ? ["Constant daily return series: zero sample volatility."]
        : []),
    ],
  };
}

/** Aligned excess_t = portfolioReturn_t - riskFreeReturn_t, or null when any
 * interval lacks a prior-known risk-free return. A favorable subset is never used. */
export function excessReturns(
  rows: readonly { return: number; riskFreeReturn: number | null }[],
): number[] | null {
  const excess: number[] = [];
  for (const row of rows) {
    if (row.riskFreeReturn === null) return null;
    excess.push(row.return - row.riskFreeReturn);
  }
  return excess;
}

function identicallyZero(values: readonly number[]) {
  return values.every((v) => v === 0);
}

/** mean(excess) / sampleStdDev(excess) × sqrt(252). */
export function sharpeRatio(excess: readonly number[]): Computed {
  const short = tooFew(excess.length, "Sharpe ratio");
  if (short) return short;
  const deviation = sampleStandardDeviation(excess);
  if (isEffectivelyZero(deviation, excess))
    return {
      ok: false,
      reason: identicallyZero(excess)
        ? "Excess returns are identically zero (the portfolio earns exactly the risk-free proxy), so Sharpe is undefined."
        : "Excess-return volatility is zero, so Sharpe is undefined.",
    };
  return {
    ok: true,
    value: (mean(excess) / deviation) * Math.sqrt(DAYS),
    notes: sampleNotes(excess.length),
  };
}

/** sqrt(mean(min(excess_t, 0)^2)) over the FULL aligned sample (not negative rows only). */
export function downsideDeviation(excess: readonly number[]): number {
  return Math.sqrt(mean(excess.map((e) => Math.min(e, 0) ** 2)));
}

/** (mean(excess) × 252) / (downsideDeviation × sqrt(252)). */
export function sortinoRatio(excess: readonly number[]): Computed {
  const short = tooFew(excess.length, "Sortino ratio");
  if (short) return short;
  const daily = downsideDeviation(excess);
  if (isEffectivelyZero(daily, excess))
    return {
      ok: false,
      reason: identicallyZero(excess)
        ? "Excess returns are identically zero (the portfolio earns exactly the risk-free proxy), so Sortino is undefined."
        : "No negative excess returns: downside deviation is zero, so Sortino is undefined.",
    };
  return {
    ok: true,
    value: (mean(excess) * DAYS) / (daily * Math.sqrt(DAYS)),
    notes: sampleNotes(excess.length),
  };
}
