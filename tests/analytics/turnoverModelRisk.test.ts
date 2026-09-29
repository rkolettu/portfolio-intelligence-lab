import { describe, expect, it } from "vitest";
import { oneWayTurnover } from "@/lib/analytics/turnover";
import { modelRisk } from "@/lib/analytics/construction/modelRisk";

describe("oneWayTurnover", () => {
  it("is half the absolute weight change over the union of holdings, CASH included", () => {
    expect(
      oneWayTurnover(
        [
          { ticker: "SPY", weight: 0.6 },
          { ticker: "BND", weight: 0.3 },
          { ticker: "CASH", weight: 0.1 },
        ],
        [
          { ticker: "SPY", weight: 0.5 },
          { ticker: "GLD", weight: 0.2 },
          { ticker: "CASH", weight: 0.3 },
        ],
      ),
    ).toBeCloseTo(0.5 * (0.1 + 0.3 + 0.2 + 0.2), 15);
  });

  it("is exactly zero for identical allocations", () => {
    const w = [
      { ticker: "A", weight: 0.3 },
      { ticker: "B", weight: 0.7 },
    ];
    expect(oneWayTurnover(w, [...w].reverse())).toBe(0);
  });
});

describe("modelRisk (Construction Model Risk on Σ_construction)", () => {
  const S = [
    [0.04, -0.0125],
    [-0.0125, 0.01],
  ];
  it("keeps the Euler identities and negative contributions (plan acceptance fixture)", () => {
    const r = modelRisk({
      covariance: S,
      tickers: ["A", "B"],
      weights: [0.2, 0.8],
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.variance).toBeCloseTo(0.004, 15);
    expect(r.holdings[0].percentage!).toBeCloseTo(-0.1, 12);
    expect(r.holdings[1].percentage!).toBeCloseTo(1.1, 12);
    const crc = r.holdings.reduce((s, h) => s + h.component!, 0);
    expect(crc).toBeCloseTo(Math.sqrt(0.004), 15);
    expect(r.holdings[0].standaloneVolatility).toBeCloseTo(0.2, 15);
    expect(r.diversificationRatio!).toBeCloseTo(
      (0.2 * 0.2 + 0.8 * 0.1) / Math.sqrt(0.004),
      12,
    );
  });

  it("reports zero volatility (all CASH) with undefined contributions and ratio", () => {
    const r = modelRisk({
      covariance: S,
      tickers: ["A", "B"],
      weights: [0, 0],
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.volatility).toBe(0);
    expect(r.diversificationRatio).toBeNull();
    expect(r.holdings.every((h) => h.percentage === null)).toBe(true);
  });
});
