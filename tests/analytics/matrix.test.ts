import { describe, expect, it } from "vitest";
import { jacobiEigen, validateCovariance } from "@/lib/analytics/matrix";
import { covarianceDiagnostics } from "@/lib/analytics/covariance";

const scaled = (m: number[][], s: number) => m.map((r) => r.map((x) => x * s));
const indefinite = [
  [1, 2],
  [2, 1],
];
const code = (m: number[][]) => {
  const v = validateCovariance(m);
  return v.ok ? "ok" : v.code;
};

describe("validateCovariance", () => {
  it("rejects non-finite entries", () => {
    expect(code([[NaN]])).toBe("non_finite");
    expect(
      code([
        [0.04, Infinity],
        [Infinity, 0.01],
      ]),
    ).toBe("non_finite");
    expect(
      code([
        [NaN, 0],
        [0, 1],
      ]),
    ).toBe("non_finite");
  });

  it("rejects malformed dimensions", () => {
    expect(code([])).toBe("malformed");
    expect(code([[1, 0]])).toBe("malformed");
    expect(code([[1, 0], [0]])).toBe("malformed");
  });

  it("rejects asymmetry beyond a scale-aware tolerance but accepts roundoff", () => {
    expect(
      code([
        [0.04, 0.01],
        [0.02, 0.01],
      ]),
    ).toBe("asymmetric");
    expect(
      code([
        [0.04, 0.01],
        [0.01 * (1 + 1e-14), 0.01],
      ]),
    ).toBe("ok");
    // The same relative asymmetry is judged identically at any scale.
    for (const s of [1e-20, 1e20])
      expect(
        code(
          scaled(
            [
              [0.04, 0.01],
              [0.02, 0.01],
            ],
            s,
          ),
        ),
      ).toBe("asymmetric");
  });

  it("rejects an indefinite matrix at every scale", () => {
    for (const s of [1e-20, 1e-8, 1, 1e8, 1e20])
      expect(code(scaled(indefinite, s))).toBe("indefinite");
  });

  it("gives the same verdict at extreme finite scales (normalized before Jacobi)", () => {
    const psd = [
      [2, 1],
      [1, 2],
    ];
    for (const s of [1e-300, 1e-200, 1e-100, 1, 1e100, 1e200, 1e300]) {
      expect(code(scaled(indefinite, s))).toBe("indefinite");
      const v = validateCovariance(scaled(psd, s));
      expect(v.ok).toBe(true);
      if (!v.ok) continue;
      expect(v.diagnostics.minEigenvalue / s).toBeCloseTo(1, 12);
      expect(v.diagnostics.maxEigenvalue / s).toBeCloseTo(3, 12);
      expect(v.diagnostics.conditionNumber!).toBeCloseTo(3, 12);
      expect(v.diagnostics.singular).toBe(false);
    }
  });

  it("keeps singular PSD matrices singular, PSD and correctly ranked at every finite scale", () => {
    const cases: { m: number[][]; rank: number; max: number }[] = [
      // Duplicate assets: eigenvalues {0, 2}.
      {
        m: [
          [1, 1],
          [1, 1],
        ],
        rank: 1,
        max: 2,
      },
      // Perfect hedge: eigenvalues {0, 2}.
      {
        m: [
          [1, -1],
          [-1, 1],
        ],
        rank: 1,
        max: 2,
      },
      // Rank 2 of 3: the third asset is the sum of the first two (Σ = AAᵀ).
      {
        m: [
          [1, 0, 1],
          [0, 1, 1],
          [1, 1, 2],
        ],
        rank: 2,
        max: 3,
      },
    ];
    for (const s of [
      1e-300, 1e-200, 1e-100, 1e-20, 1, 1e20, 1e100, 1e200, 1e300,
    ])
      for (const c of cases) {
        const v = validateCovariance(scaled(c.m, s));
        expect(v.ok).toBe(true);
        if (!v.ok) continue;
        expect(v.diagnostics.singular).toBe(true);
        expect(v.diagnostics.rank).toBe(c.rank);
        expect(v.diagnostics.conditionNumber).toBeNull();
        expect(v.diagnostics.maxEigenvalue / s).toBeCloseTo(c.max, 12);
        expect(Math.abs(v.diagnostics.minEigenvalue / s)).toBeLessThan(1e-12);
      }
    // The zero matrix stays PSD and singular (rank 0).
    const zero = validateCovariance([
      [0, 0],
      [0, 0],
    ]);
    expect(zero.ok && zero.diagnostics.rank).toBe(0);
  });

  it("reports eigenvalues of extreme-scale matrices without underflow or overflow", () => {
    for (const s of [1e-250, 1e250]) {
      const e = jacobiEigen(scaled(indefinite, s));
      expect(e.converged).toBe(true);
      expect(e.values[0] / s).toBeCloseTo(-1, 12);
      expect(e.values[1] / s).toBeCloseTo(3, 12);
    }
  });

  it("accepts singular PSD matrices (duplicate assets, perfect hedge, zero matrix)", () => {
    for (const m of [
      [
        [0.04, 0.04],
        [0.04, 0.04],
      ],
      [
        [0.04, -0.04],
        [-0.04, 0.04],
      ],
      [
        [0, 0],
        [0, 0],
      ],
    ]) {
      const v = validateCovariance(m);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.diagnostics.singular).toBe(true);
        expect(v.diagnostics.conditionNumber).toBeNull();
      }
    }
  });

  it("accepts a near-singular positive definite matrix and reports its conditioning", () => {
    const v = validateCovariance([
      [1, 0.999999],
      [0.999999, 1],
    ]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.diagnostics.singular).toBe(false);
    expect(v.diagnostics.minEigenvalue).toBeCloseTo(1e-6, 12);
    expect(v.diagnostics.conditionNumber).toBeCloseTo(1.999999e6, 0);
    expect(v.diagnostics.rank).toBe(2);
  });

  it("fails explicitly when the eigensolver does not converge", () => {
    const m = [
      [4, 1, 0.5],
      [1, 3, 1],
      [0.5, 1, 2],
    ];
    const e = jacobiEigen(m, { maxSweeps: 1 });
    expect(e.converged).toBe(false);
    const v = validateCovariance(m, { maxSweeps: 1 });
    expect(v.ok ? "ok" : v.code).toBe("eigensolver_failed");
    const full = jacobiEigen(m);
    expect(full.converged).toBe(true);
    // Eigen-decomposition reproduces the matrix: A v = λ v.
    full.vectors.forEach((vec, k) => {
      const av = m.map((row) => row.reduce((s, x, j) => s + x * vec[j], 0));
      av.forEach((x, i) => expect(x).toBeCloseTo(full.values[k] * vec[i], 12));
    });
  });
});

describe("Phase 4 covarianceDiagnostics hardening", () => {
  it("no longer accepts a NaN diagonal", () => {
    expect(() =>
      covarianceDiagnostics([
        [NaN, 0],
        [0, 0.01],
      ]),
    ).toThrow(/invalid/i);
  });

  it("no longer accepts a tiny-scale indefinite matrix", () => {
    expect(() => covarianceDiagnostics(scaled(indefinite, 1e-20))).toThrow(
      /not positive semidefinite/,
    );
  });

  it("no longer accepts a non-square matrix", () => {
    expect(() => covarianceDiagnostics([[0.04, 0.01]])).toThrow(/invalid/i);
  });
});
