import { expect, it } from "vitest";
import {
  activeReturns,
  annualizedActiveReturn,
  beta,
  capmRegression,
  correlation,
  informationRatio,
  trackingError,
} from "@/lib/analytics/benchmark";
import type { Computed } from "@/lib/analytics/performance";

const v = (c: Computed) => {
  if (!c.ok) throw new Error(c.reason);
  return c.value;
};
const why = (c: Computed) => (c.ok ? "" : c.reason);
const b = [0.012, -0.008, 0.004, -0.015, 0.02, 0.001, -0.006, 0.009];

it("identical portfolio and benchmark: beta 1, correlation 1, zero TE and active return, IR undefined, alpha 0", () => {
  expect(v(beta(b, b))).toBe(1);
  expect(v(correlation(b, b))).toBe(1);
  const active = activeReturns(b, b);
  expect(v(trackingError(active))).toBe(0);
  expect(v(annualizedActiveReturn(active))).toBe(0);
  expect(why(informationRatio(active))).toMatch(/Tracking error is zero/);
  const reg = capmRegression(b, b);
  expect(v(reg.alpha)).toBe(0);
  expect(v(reg.slope)).toBe(1);
  expect(v(reg.rSquared)).toBe(1);
});

it("known beta > 1, beta ≈ 0 and negative beta", () => {
  // p = 0.0003 + 1.5 b exactly → beta 1.5, correlation 1.
  expect(
    v(
      beta(
        b.map((x) => 0.0003 + 1.5 * x),
        b,
      ),
    ),
  ).toBeCloseTo(1.5, 12);
  // Demeaned [1,1,-1,-1] is orthogonal to [1,-1,1,-1]: beta and correlation exactly 0.
  const x = [0.01, -0.01, 0.01, -0.01];
  const y = [0.02, 0.02, 0, 0];
  expect(v(beta(y, x))).toBeCloseTo(0, 15);
  expect(v(correlation(y, x))).toBeCloseTo(0, 15);
  expect(
    v(
      beta(
        b.map((r) => -0.5 * r),
        b,
      ),
    ),
  ).toBeCloseTo(-0.5, 12);
});

it("perfect positive and perfect negative correlation", () => {
  expect(
    v(
      correlation(
        b.map((x) => 2 * x + 0.001),
        b,
      ),
    ),
  ).toBeCloseTo(1, 14);
  expect(
    v(
      correlation(
        b.map((x) => -x),
        b,
      ),
    ),
  ).toBe(-1);
});

it("beta with noise orthogonal to the benchmark recovers the exact slope", () => {
  const x = [-0.02, -0.01, 0, 0.01, 0.02];
  const e = [0.001, -0.002, 0, 0.002, -0.001]; // Σe = 0 and Σxe = 0
  expect(
    v(
      beta(
        x.map((xi, i) => 1.3 * xi + e[i]),
        x,
      ),
    ),
  ).toBeCloseTo(1.3, 12);
});

it("constant benchmark: beta and correlation undefined; constant portfolio: correlation undefined, beta 0", () => {
  const flat = b.map(() => 0.0004);
  expect(why(beta(b, flat))).toMatch(/Benchmark returns have zero variance/);
  expect(why(correlation(b, flat))).toMatch(
    /Benchmark returns have zero variance/,
  );
  expect(v(beta(flat, b))).toBeCloseTo(0, 15);
  expect(why(correlation(flat, b))).toMatch(
    /Portfolio returns have zero variance/,
  );
});

it("known information-ratio fixture (hand-calculated)", () => {
  // active = [0.01, 0.03, -0.02, 0.02]: mean 0.01, sample variance 0.0014 / 3.
  const bench = [0.001, -0.002, 0.003, 0];
  const port = [0.011, 0.028, -0.017, 0.02];
  const active = activeReturns(port, bench);
  active.forEach((a, i) =>
    expect(a).toBeCloseTo([0.01, 0.03, -0.02, 0.02][i], 15),
  );
  expect(v(annualizedActiveReturn(active))).toBeCloseTo(0.01 * 252, 12);
  expect(v(trackingError(active))).toBeCloseTo(
    Math.sqrt((0.0014 / 3) * 252),
    12,
  );
  expect(v(informationRatio(active))).toBeCloseTo(
    0.01 * Math.sqrt((3 * 252) / 0.0014),
    9,
  );
  expect(v(informationRatio(active))).toBeCloseTo(7.348469228, 8);
});

it("constant active return: zero TE, defined active return, undefined IR (never Infinity)", () => {
  const active = activeReturns(
    b.map((x) => x + 0.0002),
    b,
  );
  expect(v(trackingError(active))).toBe(0);
  expect(v(annualizedActiveReturn(active))).toBeCloseTo(0.0002 * 252, 12);
  expect(informationRatio(active).ok).toBe(false);
});

it("known synthetic CAPM regression: exact intercept, slope and R²", () => {
  const be = [-0.02, -0.01, 0, 0.01, 0.02];
  const e = [0.001, -0.002, 0, 0.002, -0.001];
  const pe = be.map((x, i) => 0.0002 + 1.3 * x + e[i]);
  const reg = capmRegression(pe, be);
  expect(v(reg.alpha)).toBeCloseTo(0.0002 * 252, 12); // linear, not (1.0002)^252 - 1
  expect(v(reg.alpha)).not.toBeCloseTo(Math.pow(1.0002, 252) - 1, 6);
  expect(v(reg.slope)).toBeCloseTo(1.3, 12);
  // SSE = Σe² = 1e-5; SST = 1.69 × Σx² + Σe² = 1.7e-3.
  expect(v(reg.rSquared)).toBeCloseTo(1 - 1e-5 / 1.7e-3, 12);
});

it("guards alpha on EXCESS-benchmark variance, independently of raw-benchmark variance", () => {
  const rf = [0.0001, 0.0002, 0.00015, 0.00005, 0.0003];
  // Constant raw benchmark but varying rates: raw beta undefined, regression defined.
  const rawFlat = rf.map(() => 0.0004);
  const port = [0.003, -0.001, 0.002, 0.004, -0.002];
  expect(beta(port, rawFlat).ok).toBe(false);
  const reg = capmRegression(
    port.map((p, i) => p - rf[i]),
    rawFlat.map((x, i) => x - rf[i]),
  );
  expect(reg.alpha.ok).toBe(true);
  // Benchmark excess constant while the raw benchmark varies: beta defined, alpha undefined.
  const rawMoving = rf.map((r) => r + 0.0004);
  expect(beta(port, rawMoving).ok).toBe(true);
  const flatExcess = capmRegression(
    port.map((p, i) => p - rf[i]),
    rawMoving.map((x, i) => x - rf[i]),
  );
  expect(why(flatExcess.alpha)).toMatch(
    /Benchmark excess returns have zero variance/,
  );
});

it("minimum samples: two returns for beta/correlation/TE/IR/active, three rows for alpha", () => {
  expect(why(beta([0.01], [0.02]))).toMatch(
    /at least 2 aligned daily returns; the comparison sample has 1/,
  );
  expect(why(trackingError([0.01]))).toMatch(/at least 2/);
  expect(beta([0.01, 0.02], [0.02, 0.01]).ok).toBe(true);
  const two = capmRegression([0.01, 0.02], [0.02, 0.01]);
  expect(why(two.alpha)).toMatch(/at least 3 aligned daily returns/);
  expect(() => beta([0.01, 0.02], [0.01])).toThrow();
});

it("statistical identities hold on seeded random samples, and nothing is non-finite", () => {
  let seed = 3;
  const rand = () =>
    ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
  for (let trial = 0; trial < 200; trial++) {
    const n = 3 + Math.floor(Math.abs(rand()) * 5000);
    const bench = Array.from({ length: n }, rand);
    const port = bench.map((x) => rand() + (trial % 3) * x);
    const rf = bench.map(() => Math.abs(rand()) / 100);
    const corr = v(correlation(port, bench));
    expect(Math.abs(corr)).toBeLessThanOrEqual(1);
    const sd = (a: number[]) => {
      const m = a.reduce((s, x) => s + x, 0) / a.length;
      return Math.sqrt(
        a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1),
      );
    };
    expect(v(beta(port, bench))).toBeCloseTo((corr * sd(port)) / sd(bench), 9);
    const active = activeReturns(port, bench);
    const te = v(trackingError(active));
    expect(te).toBeGreaterThanOrEqual(0);
    expect(v(informationRatio(active))).toBeCloseTo(
      v(annualizedActiveReturn(active)) / te,
      9,
    );
    const reg = capmRegression(
      port.map((p, i) => p - rf[i]),
      bench.map((x, i) => x - rf[i]),
    );
    expect(v(reg.rSquared)).toBeCloseTo(
      v(
        correlation(
          port.map((p, i) => p - rf[i]),
          bench.map((x, i) => x - rf[i]),
        ),
      ) ** 2,
      9,
    );
    for (const c of [reg.alpha, reg.slope, reg.rSquared])
      expect(c.ok && Number.isFinite(c.value)).toBe(true);
  }
});
