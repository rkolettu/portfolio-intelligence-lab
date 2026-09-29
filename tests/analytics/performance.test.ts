import { expect, it } from "vitest";
import { cagr, cumulativeReturn, elapsedYears } from "@/lib/analytics/performance";
import {
  annualizedVolatility,
  downsideDeviation,
  excessReturns,
  sharpeRatio,
  sortinoRatio,
} from "@/lib/analytics/risk";
import {
  isEffectivelyZero,
  mean,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";

const ok = (r: ReturnType<typeof cagr>) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

it("computes sample (n - 1) statistics and rejects non-finite input", () => {
  expect(mean([1, 2, 3, 4])).toBe(2.5);
  expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 14);
  expect(() => sampleStandardDeviation([1])).toThrow();
  expect(() => mean([1, NaN])).toThrow();
  expect(() => mean([])).toThrow();
  expect(isEffectivelyZero(0, [0, 0])).toBe(true);
  expect(isEffectivelyZero(1e-18, [0.01, 0.01])).toBe(true);
  expect(isEffectivelyZero(1e-6, [0.01, 0.01])).toBe(false);
});

it("cumulative return is ending / starting - 1 on the compounded path", () => {
  expect(cumulativeReturn(10_000, 9_900)).toBeCloseTo(-0.01, 14);
  expect(cumulativeReturn(10_000, 16_781.49)).toBeCloseTo(0.678149, 12);
  expect(() => cumulativeReturn(0, 1)).toThrow();
  expect(() => cumulativeReturn(1, Infinity)).toThrow();
});

it("CAGR uses actual elapsed calendar days / 365.25, not an integer year count", () => {
  // 2021-09-28 → 2026-09-25 is 1,823 days = 4.991 years, not 5.
  expect(elapsedYears("2021-09-28", "2026-09-25")).toBeCloseTo(1823 / 365.25, 14);
  const five = ok(cagr(10_000, 16_781.49, "2021-09-28", "2026-09-25"));
  expect(five.value).toBeCloseTo(Math.pow(1.678149, 365.25 / 1823) - 1, 12);
  expect(five.notes).toEqual([]);
  // Leap-year span: exactly 366 days is slightly more than one 365.25-day year.
  expect(ok(cagr(100, 110, "2024-01-01", "2025-01-01")).value).toBeCloseTo(Math.pow(1.1, 365.25 / 366) - 1, 14);
});

it("keeps short-period CAGR with an explicit annualized-from-less-than-a-year note", () => {
  const short = ok(cagr(10_000, 9_900, "2024-05-30", "2024-06-03"));
  expect(short.value).toBeCloseTo(Math.pow(0.99, 365.25 / 4) - 1, 12);
  expect(short.notes[0]).toMatch(/less than one year \(4 calendar days\)/);
  expect(cagr(100, 100, "2024-06-03", "2024-06-03")).toEqual({
    ok: false, reason: "CAGR requires positive elapsed calendar time.",
  });
  // Annualizing a huge one-day move overflows: unavailable, never Infinity.
  const extreme = cagr(1, 1e300, "2024-06-03", "2024-06-04");
  expect(extreme.ok).toBe(false);
});

it("annualized volatility is the sample daily deviation × sqrt(252)", () => {
  const v = annualizedVolatility([0.1, -0.1]);
  expect(v.ok && v.value).toBeCloseTo(Math.sqrt(0.02 * 252), 14);
  expect(v.ok && v.notes[0]).toMatch(/2 daily returns/);
  expect(annualizedVolatility([0.01])).toEqual({
    ok: false, reason: "Volatility requires at least 2 daily returns; this sample has 1.",
  });
});

it("reports zero volatility for a constant series, absorbing floating-point roundoff", () => {
  const exact = annualizedVolatility([0.01, 0.01, 0.01]);
  expect(exact.ok && exact.value).toBe(0);
  // Three "10%" returns that differ only by floating-point roundoff.
  const roundoff = [0.1 + 0.2 - 0.2, 0.1, 0.3 - 0.2];
  expect(new Set(roundoff).size).toBeGreaterThan(1);
  const v = annualizedVolatility(roundoff);
  expect(v.ok && v.value).toBe(0);
  expect(v.ok && v.notes.join()).toMatch(/Constant daily return series/);
});

it("builds aligned excess returns and refuses a partial risk-free sample", () => {
  expect(excessReturns([{ return: 0.02, riskFreeReturn: 0.0005 }, { return: -0.01, riskFreeReturn: 0.0001 }]))
    .toEqual([0.02 - 0.0005, -0.01 - 0.0001]);
  expect(excessReturns([{ return: 0.02, riskFreeReturn: 0.0005 }, { return: -0.01, riskFreeReturn: null }])).toBeNull();
});

const excess = [0.01, 0.03, -0.02, 0.02];
it("Sharpe = mean(excess) / sampleStdDev(excess) × sqrt(252) (hand-calculated)", () => {
  // mean 0.01; squared deviations 0, 4e-4, 9e-4, 1e-4 → variance 0.0014 / 3.
  const s = sharpeRatio(excess);
  expect(s.ok && s.value).toBeCloseTo(0.01 * Math.sqrt((3 * 252) / 0.0014), 10);
  expect(s.ok && s.value).toBeCloseTo(7.348469228, 8);
});

it("Sortino uses root-mean-square downside over the FULL sample, not negative rows only", () => {
  // downside = [0, 0, -0.02, 0] → sqrt(4e-4 / 4) = 0.01 (negative-rows-only would be 0.02).
  expect(downsideDeviation(excess)).toBeCloseTo(0.01, 15);
  const s = sortinoRatio(excess);
  // (0.01 × 252) / (0.01 × sqrt(252)) = sqrt(252).
  expect(s.ok && s.value).toBeCloseTo(Math.sqrt(252), 10);
  const negativeRowsOnly = (0.01 * 252) / (0.02 * Math.sqrt(252));
  expect(s.ok && s.value).not.toBeCloseTo(negativeRowsOnly, 2);
});

it("returns reasons, never NaN or Infinity, for undefined Sharpe and Sortino", () => {
  const zero = [0, 0, 0];
  for (const r of [sharpeRatio(zero), sortinoRatio(zero)]) {
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/identically zero/);
  }
  const constant = sharpeRatio([0.001, 0.001, 0.001]);
  expect(!constant.ok && constant.reason).toMatch(/volatility is zero/);
  const noDownside = sortinoRatio([0.01, 0.02, 0]);
  expect(!noDownside.ok && noDownside.reason).toMatch(/No negative excess returns/);
  expect(sharpeRatio([0.01]).ok).toBe(false);
  expect(sortinoRatio([0.01]).ok).toBe(false);
});

it("undefined ratios on a zero-volatility portfolio stay reasons (no division by zero)", () => {
  const constant = [0.0004, 0.0004, 0.0004, 0.0004];
  expect(annualizedVolatility(constant)).toMatchObject({ ok: true, value: 0 });
  expect(sharpeRatio(constant).ok).toBe(false);
  expect(sortinoRatio(constant).ok).toBe(false);
});
