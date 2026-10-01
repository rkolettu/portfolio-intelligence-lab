import { describe, expect, it } from "vitest";
import {
  analyzeExposure,
  requiredSectorProxies,
} from "@/lib/analytics/exposure";
import { SECTOR_PROXIES } from "@/config/exposureProfiles";

describe("portfolio exposure", () => {
  it("aggregates a stock directly into its sector and style cell", () => {
    const x = analyzeExposure([{ ticker: "AAPL", weight: 0.4 }]);
    expect(x.sectors.Technology).toBe(0.4);
    expect(x.styles["Large Growth"]).toBe(0.4);
  });
  it("looks through an ETF without forcing it into one sector", () => {
    const x = analyzeExposure([{ ticker: "SPY", weight: 0.2 }]);
    expect(x.sectors.Technology).toBeCloseTo(0.066);
    expect(x.sectors.Financials).toBeCloseTo(0.028);
    expect(x.sectorCoverage).toBeCloseTo(0.2);
  });
  it("sums multiple ETFs and stocks contributing to one sector", () => {
    const x = analyzeExposure([
      { ticker: "SPY", weight: 0.2 },
      { ticker: "QQQ", weight: 0.1 },
      { ticker: "NVDA", weight: 0.08 },
    ]);
    expect(x.sectors.Technology).toBeCloseTo(0.208);
    expect(x.sectorContributions.Technology.map((r) => r.ticker)).toEqual([
      "SPY",
      "QQQ",
      "NVDA",
    ]);
  });
  it("preserves unknown exposure instead of renormalizing classified weight", () => {
    const x = analyzeExposure([
      { ticker: "AAPL", weight: 0.6 },
      { ticker: "MYSTERY", weight: 0.4 },
    ]);
    expect(x.sectorCoverage).toBe(0.6);
    expect(x.unclassifiedSector).toBe(0.4);
    expect(x.sectors.Technology).toBe(0.6);
  });
  it("aggregates ETF and stock style profiles transparently", () => {
    const x = analyzeExposure([
      { ticker: "SPY", weight: 0.5 },
      { ticker: "AAPL", weight: 0.1 },
    ]);
    expect(x.styles["Large Growth"]).toBeCloseTo(0.26);
    expect(x.styleCoverage).toBeCloseTo(0.6);
    expect(x.styleContributions["Large Growth"]).toHaveLength(2);
  });
  it("excludes CASH and bonds from the equity style map", () => {
    const x = analyzeExposure([
      { ticker: "CASH", weight: 0.1 },
      { ticker: "BND", weight: 0.3 },
      { ticker: "SPY", weight: 0.6 },
    ]);
    expect(x.cash).toBe(0.1);
    expect(x.fixedIncome).toBe(0.3);
    expect(x.styleCoverage).toBeCloseTo(0.6);
  });
  it("reports non-equity and unknown style exposure without filling the grid", () => {
    const x = analyzeExposure([
      { ticker: "GLD", weight: 0.25 },
      { ticker: "UNKNOWN", weight: 0.15 },
    ]);
    expect(x.other).toBe(0.25);
    expect(x.unclassifiedStyle).toBe(0.4);
    expect(x.styleCoverage).toBe(0);
  });
  it("maps all eleven sectors to the required proxies", () => {
    expect(Object.keys(SECTOR_PROXIES)).toHaveLength(11);
    expect(SECTOR_PROXIES.Technology).toBe("XLK");
    expect(SECTOR_PROXIES["Communication Services"]).toBe("XLC");
  });
  it("does not compare a broad ETF against an arbitrary sector proxy", () => {
    expect(
      requiredSectorProxies(analyzeExposure([{ ticker: "SPY", weight: 1 }])),
    ).toEqual([]);
    expect(
      requiredSectorProxies(analyzeExposure([{ ticker: "AAPL", weight: 1 }])),
    ).toEqual(["XLK"]);
  });
});
