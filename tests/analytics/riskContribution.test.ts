import { expect, it } from "vitest";
import {
  portfolioVariance,
  riskContributions,
} from "@/lib/analytics/riskContribution";
import {
  concentration,
  standaloneVolatility,
  weightedAverageVolatility,
} from "@/lib/analytics/diversification";
import { sampleStandardDeviation } from "@/lib/utils/numerical";

const decompose = (s: number[][], w: number[]) => {
  const r = riskContributions(s, w);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

it("known hand-calculated matrix (plan acceptance): variance 0.004, PCR [−0.1, 1.1], negative kept", () => {
  const s = [
    [0.04, -0.0125],
    [-0.0125, 0.01],
  ];
  const r = decompose(s, [0.2, 0.8]);
  expect(r.variance).toBeCloseTo(0.004, 15);
  expect(r.volatility).toBeCloseTo(Math.sqrt(0.004), 15);
  // Σw = [−0.002, 0.0055]
  expect(r.marginal[0]).toBeCloseTo(-0.002 / Math.sqrt(0.004), 14);
  expect(r.marginal[1]).toBeCloseTo(0.0055 / Math.sqrt(0.004), 14);
  expect(r.component[0]).toBeCloseTo((0.2 * -0.002) / Math.sqrt(0.004), 14);
  expect(r.percentage[0]).toBeCloseTo(-0.1, 13);
  expect(r.percentage[1]).toBeCloseTo(1.1, 13);
  expect(r.component.reduce((a, b) => a + b, 0)).toBeCloseTo(r.volatility, 15);
  expect(r.percentage.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
  expect(r.percentage[0]).toBeLessThan(0); // never clamped
});

it("single risky asset carries 100% of risk; volatility equals its own", () => {
  const r = decompose([[0.0225]], [1]);
  expect(r.volatility).toBeCloseTo(0.15, 15);
  expect(r.percentage).toEqual([1]);
  expect(r.marginal[0]).toBeCloseTo(0.15, 15);
});

it("two assets: perfect correlation gives no diversification; lower correlation does", () => {
  const v1 = 0.2,
    v2 = 0.1,
    w = [0.5, 0.5];
  const cov = (rho: number) => [
    [v1 * v1, rho * v1 * v2],
    [rho * v1 * v2, v2 * v2],
  ];
  expect(decompose(cov(1), w).volatility).toBeCloseTo(0.5 * v1 + 0.5 * v2, 15);
  const wa = weightedAverageVolatility(w, [v1, v2]);
  const diversified = decompose(cov(0.3), w).volatility;
  expect(diversified).toBeLessThan(wa);
  expect(wa / diversified).toBeGreaterThan(1); // diversification ratio > 1
  expect(decompose(cov(-0.5), w).volatility).toBeLessThan(diversified); // negative covariance helps more
});

it("perfectly hedged negative correlation: zero volatility makes contributions unavailable", () => {
  // 1/3 of a 20% asset and 2/3 of a 10% asset at ρ = −1 cancel exactly.
  const s = [
    [0.04, -0.02],
    [-0.02, 0.01],
  ];
  const r = riskContributions(s, [1 / 3, 2 / 3]);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.reason).toMatch(/volatility is zero/);
});

it("zero-volatility risk: an all-zero covariance matrix is unavailable, never NaN", () => {
  const r = riskContributions(
    [
      [0, 0],
      [0, 0],
    ],
    [0.5, 0.5],
  );
  expect(r).toMatchObject({ ok: false, variance: 0 });
});

it("treats roundoff-negative variance as zero but rejects materially negative variance", () => {
  const tiny = [
    [0.04, -0.02 - 1e-18],
    [-0.02 - 1e-18, 0.01],
  ];
  expect(portfolioVariance(tiny, [1 / 3, 2 / 3])).toBe(0);
  expect(() =>
    portfolioVariance(
      [
        [0.04, -0.05],
        [-0.05, 0.01],
      ],
      [0.5, 0.5],
    ),
  ).toThrow(/materially negative/);
  expect(() => portfolioVariance([[0.04]], [0.5, 0.5])).toThrow();
});

it("duplicate assets (singular Σ) still decompose: identical holdings share risk by weight", () => {
  const s = [
    [0.04, 0.04, 0.01],
    [0.04, 0.04, 0.01],
    [0.01, 0.01, 0.0225],
  ];
  const r = decompose(s, [0.3, 0.2, 0.5]);
  expect(r.percentage[0] / r.percentage[1]).toBeCloseTo(0.3 / 0.2, 12);
  expect(r.marginal[0]).toBeCloseTo(r.marginal[1], 15);
});

it("scaling the risky sleeve into riskless CASH scales σ but leaves PCR and the diversification ratio unchanged", () => {
  const s = [
    [0.04, 0.006],
    [0.006, 0.0225],
  ];
  const vols = [0.2, 0.15];
  const full = decompose(s, [0.6, 0.4]);
  // CASH (0.2) is outside Σ: risky weights 0.48/0.32 are not renormalized.
  const scaled = decompose(s, [0.48, 0.32]);
  expect(scaled.volatility).toBeCloseTo(0.8 * full.volatility, 15);
  scaled.percentage.forEach((p, i) =>
    expect(p).toBeCloseTo(full.percentage[i], 14),
  );
  const dr = (w: number[], sigma: number) =>
    weightedAverageVolatility(w, vols) / sigma;
  expect(dr([0.48, 0.32, 0.2].slice(0, 2), scaled.volatility)).toBeCloseTo(
    dr([0.6, 0.4], full.volatility),
    13,
  );
  const withCash = concentration([
    { ticker: "A", weight: 0.48 },
    { ticker: "B", weight: 0.32 },
    { ticker: "CASH", weight: 0.2 },
  ]);
  expect(withCash.hhi).not.toBeCloseTo(
    concentration([
      { ticker: "A", weight: 0.6 },
      { ticker: "B", weight: 0.4 },
    ]).hhi,
    6,
  );
});

it("standalone volatility is sample std × √252; weighted average uses capital weights", () => {
  const r = [0.01, -0.02, 0.015, 0.005, -0.01];
  expect(standaloneVolatility(r)).toBeCloseTo(
    sampleStandardDeviation(r) * Math.sqrt(252),
    15,
  );
  expect(weightedAverageVolatility([0.5, 0.3, 0.2], [0.2, 0.1, 0])).toBeCloseTo(
    0.13,
    15,
  );
  expect(() => weightedAverageVolatility([1], [0.1, 0.2])).toThrow();
});

it("concentration: HHI, effective holdings, largest and top-3 (equal and concentrated)", () => {
  const equal = concentration(
    ["A", "B", "C", "D", "E"].map((ticker) => ({ ticker, weight: 0.2 })),
  );
  expect(equal.hhi).toBeCloseTo(0.2, 15);
  expect(equal.effectiveHoldings).toBeCloseTo(5, 12);
  expect(equal.largest).toEqual({ ticker: "A", weight: 0.2 }); // tie → portfolio order
  expect(equal.top3).toEqual({
    tickers: ["A", "B", "C"],
    weight: expect.closeTo(0.6, 15),
  });
  const sample = concentration([
    { ticker: "SPY", weight: 0.4 },
    { ticker: "QQQ", weight: 0.15 },
    { ticker: "IWM", weight: 0.1 },
    { ticker: "BND", weight: 0.2 },
    { ticker: "GLD", weight: 0.1 },
    { ticker: "CASH", weight: 0.05 },
  ]);
  expect(sample.hhi).toBeCloseTo(
    0.16 + 0.0225 + 0.01 + 0.04 + 0.01 + 0.0025,
    15,
  );
  expect(sample.effectiveHoldings).toBeCloseTo(1 / 0.245, 12);
  expect(sample.largest).toEqual({ ticker: "SPY", weight: 0.4 });
  expect(sample.top3).toEqual({
    tickers: ["SPY", "BND", "QQQ"],
    weight: expect.closeTo(0.75, 15),
  });
  const concentrated = concentration([
    { ticker: "A", weight: 0.9 },
    { ticker: "B", weight: 0.1 },
  ]);
  expect(concentrated.effectiveHoldings).toBeCloseTo(1 / 0.82, 12);
  expect(concentrated.top3.weight).toBeCloseTo(1, 15);
});

it("Euler identities hold on seeded random PSD matrices, including negative contributions", () => {
  let seed = 9;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  let sawNegative = false;
  for (let trial = 0; trial < 200; trial++) {
    const k = 2 + (trial % 7);
    // Σ = A Aᵀ is PSD by construction.
    const A = Array.from({ length: k }, () =>
      Array.from({ length: k }, () => rand() * 0.3),
    );
    const s = A.map((ri) =>
      A.map((rj) => ri.reduce((acc, x, t) => acc + x * rj[t], 0)),
    );
    const raw = Array.from({ length: k }, () => Math.abs(rand()) + 0.01);
    const w = raw.map((x) => x / raw.reduce((a, b) => a + b, 0));
    const r = decompose(s, w);
    expect(r.component.reduce((a, b) => a + b, 0)).toBeCloseTo(
      r.volatility,
      12,
    );
    expect(r.percentage.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    if (r.percentage.some((p) => p < 0)) sawNegative = true;
    for (const v of [...r.marginal, ...r.component, ...r.percentage])
      expect(Number.isFinite(v)).toBe(true);
  }
  expect(sawNegative).toBe(true);
});
