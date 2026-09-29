import { expect, it } from "vitest";
import {
  annualizeCovariance,
  covarianceDiagnostics,
  sampleCovarianceMatrix,
  symmetricEigenvalues,
} from "@/lib/analytics/covariance";
import { correlationMatrix, extremePairs } from "@/lib/analytics/correlation";
import {
  sampleCovariance,
  sampleStandardDeviation,
} from "@/lib/utils/numerical";

const a = [0.01, -0.02, 0.015, 0.005, -0.01];
const b = [0.002, 0.004, -0.001, 0.003, 0.001];

it("known two-asset sample covariance (hand-calculated) and 252 annualization", () => {
  // mean(a) = 0; mean(b) = 0.0018.
  // Σ(a−ā)(b−b̄) = 0.01·0.0002 + (−0.02)(0.0022) + 0.015(−0.0028) + 0.005(0.0012) + (−0.01)(−0.0008)
  //             = 0.000002 − 0.000044 − 0.000042 + 0.000006 + 0.000008 = −0.00007
  const m = sampleCovarianceMatrix([a, b]);
  expect(m[0][1]).toBeCloseTo(-0.00007 / 4, 15);
  expect(m[0][0]).toBeCloseTo(
    (0.0001 + 0.0004 + 0.000225 + 0.000025 + 0.0001) / 4,
    15,
  );
  const annual = annualizeCovariance(m);
  expect(annual[0][1]).toBeCloseTo((252 * -0.00007) / 4, 15);
});

it("is exactly symmetric, and the diagonal equals each holding's sample variance", () => {
  const c = [0.003, -0.001, 0.002, 0.004, -0.002];
  const m = sampleCovarianceMatrix([a, b, c]);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) expect(m[i][j]).toBe(m[j][i]);
  [a, b, c].forEach((x, i) => {
    expect(m[i][i]).toBeCloseTo(sampleStandardDeviation(x) ** 2, 18);
    expect(m[i][i]).toBe(sampleCovariance(x, x));
  });
});

it("identical assets give equal variance and covariance; mirrored assets give negative covariance", () => {
  const same = sampleCovarianceMatrix([a, a]);
  expect(same[0][1]).toBe(same[0][0]);
  const neg = sampleCovarianceMatrix([a, a.map((x) => -x)]);
  expect(neg[0][1]).toBe(-neg[0][0]);
});

it("rejects misaligned or too-short samples", () => {
  expect(() => sampleCovarianceMatrix([a, b.slice(1)])).toThrow(
    /one aligned sample/,
  );
  expect(() => sampleCovarianceMatrix([[0.01]])).toThrow();
  expect(() => sampleCovarianceMatrix([])).toThrow();
});

it("computes eigenvalues of known symmetric matrices", () => {
  expect(
    symmetricEigenvalues([
      [2, 1],
      [1, 2],
    ]).map((v) => +v.toFixed(12)),
  ).toEqual([1, 3]);
  const e = symmetricEigenvalues([
    [4, 1, 0],
    [1, 3, 1],
    [0, 1, 2],
  ]);
  expect(e.reduce((s, v) => s + v, 0)).toBeCloseTo(9, 12); // trace
  expect(e[0] * e[1] * e[2]).toBeCloseTo(18, 10); // determinant 4(6−1) − 1(2) = 18
});

it("diagnoses singular (duplicate) matrices and rejects materially non-PSD input", () => {
  const dup = covarianceDiagnostics(
    annualizeCovariance(sampleCovarianceMatrix([a, a, b])),
  );
  expect(dup.symmetric).toBe(true);
  expect(dup.singular).toBe(true);
  expect(Math.abs(dup.minEigenvalue)).toBeLessThan(1e-15);
  const full = covarianceDiagnostics(
    annualizeCovariance(sampleCovarianceMatrix([a, b])),
  );
  expect(full.singular).toBe(false);
  expect(() =>
    covarianceDiagnostics([
      [0.04, 0.05],
      [0.05, 0.01],
    ]),
  ).toThrow(/not positive semidefinite/);
  expect(() =>
    covarianceDiagnostics([
      [0.04, 0.01],
      [0.02, 0.01],
    ]),
  ).toThrow(/not symmetric/);
});

it("correlation: +1, −1, near zero, exact diagonal 1, symmetric", () => {
  const scaled = a.map((x) => 3 * x + 0.001);
  const orth = [0.01, 0.01, -0.01, -0.01, 0];
  const base = [0.01, -0.01, 0.01, -0.01, 0];
  const m = correlationMatrix(
    sampleCovarianceMatrix([a, scaled, a.map((x) => -x)]),
    [false, false, false],
  );
  expect(m[0][1]).toBeCloseTo(1, 14);
  expect(m[0][2]).toBe(-1);
  expect(m.map((row, i) => row[i])).toEqual([1, 1, 1]);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) expect(m[i][j]).toBe(m[j][i]);
  const z = correlationMatrix(sampleCovarianceMatrix([base, orth]), [
    false,
    false,
  ]);
  expect(z[0][1]).toBeCloseTo(0, 15);
});

it("constant series make their whole row and column undefined (not a forced 1)", () => {
  const flat = [0.001, 0.001, 0.001, 0.001, 0.001];
  const m = correlationMatrix(sampleCovarianceMatrix([a, flat, b]), [
    false,
    true,
    false,
  ]);
  expect(m[1]).toEqual([null, null, null]);
  expect(m.map((r) => r[1])).toEqual([null, null, null]);
  expect(m[0][0]).toBe(1);
});

it("highest and lowest pairs exclude self-pairs and undefined cells; ties resolve in portfolio order", () => {
  const tickers = ["AAA", "BBB", "CCC", "DDD"];
  const m = [
    [1, 0.6, -0.3, null],
    [0.6, 1, 0.6, null],
    [-0.3, 0.6, 1, null],
    [null, null, null, null],
  ];
  const { highest, lowest } = extremePairs(tickers, m);
  expect(highest).toEqual({ a: "AAA", b: "BBB", correlation: 0.6 }); // tie with BBB–CCC → earlier pair
  expect(lowest).toEqual({ a: "AAA", b: "CCC", correlation: -0.3 });
  expect(extremePairs(["AAA"], [[1]])).toEqual({ highest: null, lowest: null });
});
