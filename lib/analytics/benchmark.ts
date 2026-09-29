import { BENCHMARK_METHODOLOGY } from "@/config/methodology";
import {
  isEffectivelyZero,
  mean,
  sampleCovariance,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";
import { fail } from "@/lib/utils/errors";
import type { Computed } from "./performance";

// Pure benchmark-relative statistics over ALREADY-ALIGNED arrays. Alignment (which
// intervals count) lives only in lib/backtest/alignment.ts; nothing here filters.

const {
  riskAnnualization: DAYS,
  minimumReturns,
  minimumRegressionRows,
  shortSampleReturns,
} = BENCHMARK_METHODOLOGY;

function paired(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length)
    fail(
      "INVALID_INPUT",
      "Benchmark statistics require paired aligned returns.",
    );
}
function sampleNotes(count: number): string[] {
  return count < shortSampleReturns
    ? [
        `Based on ${count} aligned daily returns (fewer than ${shortSampleReturns}); the estimate is unstable.`,
      ]
    : [];
}
function tooFew(
  count: number,
  label: string,
  minimum: number = minimumReturns,
): Computed | null {
  return count < minimum
    ? {
        ok: false,
        reason: `${label} requires at least ${minimum} aligned daily returns; the comparison sample has ${count}.`,
      }
    : null;
}
const finite = (value: number, label: string, notes: string[]): Computed =>
  Number.isFinite(value)
    ? { ok: true, value, notes }
    : { ok: false, reason: `${label} is numerically invalid for this sample.` };

/** Cov(Rp, Rb) / Var(Rb), sample (n - 1) moments on raw daily arithmetic returns. */
export function beta(
  portfolio: readonly number[],
  benchmark: readonly number[],
): Computed {
  paired(portfolio, benchmark);
  const short = tooFew(benchmark.length, "Beta");
  if (short) return short;
  if (isEffectivelyZero(sampleStandardDeviation(benchmark), benchmark))
    return {
      ok: false,
      reason:
        "Benchmark returns have zero variance over the comparison sample, so beta is undefined.",
    };
  return finite(
    sampleCovariance(portfolio, benchmark) /
      sampleCovariance(benchmark, benchmark),
    "Beta",
    sampleNotes(benchmark.length),
  );
}

/** Pearson correlation of aligned daily arithmetic returns. */
export function correlation(
  portfolio: readonly number[],
  benchmark: readonly number[],
): Computed {
  paired(portfolio, benchmark);
  const short = tooFew(benchmark.length, "Correlation");
  if (short) return short;
  const sp = sampleStandardDeviation(portfolio);
  const sb = sampleStandardDeviation(benchmark);
  if (isEffectivelyZero(sp, portfolio) || isEffectivelyZero(sb, benchmark))
    return {
      ok: false,
      reason: `${isEffectivelyZero(sb, benchmark) ? "Benchmark" : "Portfolio"} returns have zero variance over the comparison sample, so correlation is undefined.`,
    };
  const r = sampleCovariance(portfolio, benchmark) / (sp * sb);
  // Floating-point roundoff can push |r| a few ulps past 1; clamp only that.
  return finite(
    Math.max(-1, Math.min(1, r)),
    "Correlation",
    sampleNotes(benchmark.length),
  );
}

/** active_t = portfolioReturn_t - benchmarkReturn_t on the aligned intervals. */
export function activeReturns(
  portfolio: readonly number[],
  benchmark: readonly number[],
): number[] {
  paired(portfolio, benchmark);
  return portfolio.map((p, i) => p - benchmark[i]);
}

/** mean(active_t) × 252 — arithmetic, never a CAGR difference. */
export function annualizedActiveReturn(active: readonly number[]): Computed {
  const short = tooFew(active.length, "Annualized active return");
  if (short) return short;
  return finite(
    mean(active) * DAYS,
    "Annualized active return",
    sampleNotes(active.length),
  );
}

/** sampleStdDev(active_t) × sqrt(252). Zero when the portfolio tracks exactly. */
export function trackingError(active: readonly number[]): Computed {
  const short = tooFew(active.length, "Tracking error");
  if (short) return short;
  const deviation = sampleStandardDeviation(active);
  if (isEffectivelyZero(deviation, active))
    return {
      ok: true,
      value: 0,
      notes: [
        ...sampleNotes(active.length),
        "Active returns are constant: zero tracking error.",
      ],
    };
  return finite(
    deviation * Math.sqrt(DAYS),
    "Tracking error",
    sampleNotes(active.length),
  );
}

/** mean(active_t) / sampleStdDev(active_t) × sqrt(252). */
export function informationRatio(active: readonly number[]): Computed {
  const short = tooFew(active.length, "Information ratio");
  if (short) return short;
  const deviation = sampleStandardDeviation(active);
  if (isEffectivelyZero(deviation, active))
    return {
      ok: false,
      reason:
        "Tracking error is zero (active returns are constant), so the information ratio is undefined.",
    };
  return finite(
    (mean(active) / deviation) * Math.sqrt(DAYS),
    "Information ratio",
    sampleNotes(active.length),
  );
}

export type CapmRegression = {
  alpha: Computed;
  slope: Computed;
  rSquared: Computed;
};

/** OLS with intercept: (Rp - Rf) = alphaDaily + slope × (Rb - Rf) + e.
 * Annualized alpha = alphaDaily × 252 (linear; the intercept is never compounded).
 * Guarded on EXCESS-benchmark variance, which can differ from raw-benchmark
 * variance when the risk-free rate varies. */
export function capmRegression(
  portfolioExcess: readonly number[],
  benchmarkExcess: readonly number[],
): CapmRegression {
  paired(portfolioExcess, benchmarkExcess);
  const short = tooFew(
    benchmarkExcess.length,
    "CAPM alpha",
    minimumRegressionRows,
  );
  if (short) return { alpha: short, slope: short, rSquared: short };
  if (
    isEffectivelyZero(sampleStandardDeviation(benchmarkExcess), benchmarkExcess)
  ) {
    const reason =
      "Benchmark excess returns have zero variance over the comparison sample, so the CAPM regression is undefined.";
    return {
      alpha: { ok: false, reason },
      slope: { ok: false, reason },
      rSquared: { ok: false, reason },
    };
  }
  const notes = sampleNotes(benchmarkExcess.length);
  const sxx = sampleCovariance(benchmarkExcess, benchmarkExcess);
  const slope = sampleCovariance(benchmarkExcess, portfolioExcess) / sxx;
  const intercept = mean(portfolioExcess) - slope * mean(benchmarkExcess);
  const syy = sampleCovariance(portfolioExcess, portfolioExcess);
  let rSquared: Computed;
  if (isEffectivelyZero(Math.sqrt(syy), portfolioExcess))
    rSquared = {
      ok: false,
      reason:
        "Portfolio excess returns have zero variance, so R² is undefined.",
    };
  else {
    const r =
      sampleCovariance(benchmarkExcess, portfolioExcess) / Math.sqrt(sxx * syy);
    rSquared = finite(Math.min(1, r * r), "R²", notes);
  }
  return {
    alpha: finite(intercept * DAYS, "CAPM alpha", notes),
    slope: finite(slope, "Regression beta", notes),
    rSquared,
  };
}
