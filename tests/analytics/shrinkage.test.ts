import { describe, expect, it } from "vitest";
import { ledoitWolf } from "@/lib/analytics/shrinkage";
import { sampleCovarianceMatrix } from "@/lib/analytics/covariance";

// Independent fixture, generated in Python from Ledoit & Wolf (2004) directly:
// per-observation outer products and the paper's normalized Frobenius norm, with
// S_n on the n denominator. A second, aggregated formulation (the one scikit-learn
// uses) agreed to 2e-16. Returns: 12 observations × 3 assets.
const R = [
  [0.002161209223472559, 0.008603386095849468, 0.01201570652335716],
  [0.014673344309269707, 0.010676369232428023, 0.0005049094396636657],
  [0.01236504885053458, -0.00029752039525973543, -0.008016635060819503],
  [0.0012685175512571444, -0.007344340243551952, -0.004349934747206238],
  [-0.0012175527727748825, 0.0012684078049115107, 0.0017587941911984405],
  [0.007903241968974453, 0.01436219060028031, 0.00663312730209191],
  [0.012993362725577811, 0.012804330849626875, 0.005110629056965814],
  [0.0032474934808283612, -0.0036651805891325653, -0.006750141629904105],
  [-0.010657870439231549, -0.0158429602978228, -0.010747062515319945],
  [-0.011323807321708344, -0.011312108868998125, 0.004771901864796392],
  [0.000609333943760137, -5.0284341200022495e-5, 0.01361139623823945],
  [0.00779568691279634, 0.001887921044145014, -0.0014027414654912101],
];
const DELTA = 0.35854311296390456;
const S_STAR_N = [
  [6.651681164422963e-5, 3.7606738062099717e-5, 2.0184947844469365e-6],
  [3.7606738062099717e-5, 7.779247694986451e-5, 2.307016947677548e-5],
  [2.0184947844469365e-6, 2.307016947677548e-5, 5.9518323468444204e-5],
];
const columns = [0, 1, 2].map((j) => R.map((row) => row[j]));
const n = R.length;

describe("ledoitWolf", () => {
  it("matches the independent Ledoit–Wolf reference shrinkage coefficient", () => {
    const e = ledoitWolf(columns);
    expect(e.shrinkage).toBeCloseTo(DELTA, 14);
    expect(e.target).toBe("scaled_identity");
    expect(e.observations).toBe(n);
  });

  it("applies δ to the n − 1 sample covariance: the estimate equals the reference × n/(n − 1)", () => {
    const e = ledoitWolf(columns);
    expect(e.sample).toEqual(sampleCovarianceMatrix(columns));
    const trace = e.sample.reduce((s, row, i) => s + row[i], 0);
    expect(e.mu).toBeCloseTo(trace / 3, 18);
    e.shrunk.forEach((row, i) =>
      row.forEach((x, j) => {
        const reference = (S_STAR_N[i][j] * n) / (n - 1);
        expect(Math.abs(x - reference) / Math.abs(reference)).toBeLessThan(
          1e-12,
        );
        expect(x).toBe(
          (1 - e.shrinkage) * e.sample[i][j] +
            (i === j ? e.shrinkage * e.mu : 0),
        );
      }),
    );
  });

  it("is deterministic and invariant in δ to rescaling returns", () => {
    const a = ledoitWolf(columns);
    expect(ledoitWolf(columns)).toEqual(a);
    const b = ledoitWolf(columns.map((c) => c.map((x) => x * 8)));
    expect(b.shrinkage).toBeCloseTo(a.shrinkage, 14);
    b.shrunk.forEach((row, i) =>
      row.forEach((x, j) => expect(x).toBeCloseTo(a.shrunk[i][j] * 64, 16)),
    );
  });

  it("does not shrink when the sample is already a scaled identity or has one asset", () => {
    const orthogonal = ledoitWolf([
      [1, -1, 1, -1],
      [1, 1, -1, -1],
    ]);
    expect(orthogonal.shrinkage).toBe(0);
    expect(orthogonal.shrunk).toEqual(orthogonal.sample);
    const single = ledoitWolf([columns[0]]);
    expect(single.shrinkage).toBe(0);
    expect(single.shrunk).toEqual(single.sample);
  });

  it("requires at least two observations of equal length", () => {
    expect(() => ledoitWolf([[0.01]])).toThrow(/two observations/);
    expect(() => ledoitWolf([[0.01, 0.02], [0.01]])).toThrow(
      /one aligned sample/,
    );
  });
});
