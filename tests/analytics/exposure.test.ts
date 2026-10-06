import { describe, expect, it } from "vitest";
import {
  analyzeExposure,
  requiredSectorProxies,
} from "@/lib/analytics/exposure";
import {
  ETF_EXPOSURE_PROFILES,
  SECTOR_PROXIES,
} from "@/config/exposureProfiles";

const sectorShare = (ticker: string, sector: "Technology" | "Financials") =>
  ETF_EXPOSURE_PROFILES[ticker].sectorWeights![sector]!;

describe("portfolio exposure", () => {
  it("aggregates a stock directly into its sector and style cell", () => {
    const x = analyzeExposure([{ ticker: "AAPL", weight: 0.4 }]);
    expect(x.sectors.Technology).toBe(0.4);
    expect(x.styles["Large Growth"]).toBe(0.4);
  });
  it("looks through an ETF without forcing it into one sector", () => {
    const x = analyzeExposure([{ ticker: "SPY", weight: 0.2 }]);
    expect(x.sectors.Technology).toBeCloseTo(
      0.2 * sectorShare("SPY", "Technology"),
    );
    expect(x.sectors.Financials).toBeCloseTo(
      0.2 * sectorShare("SPY", "Financials"),
    );
    expect(x.sectors.Technology).toBeGreaterThan(x.sectors.Financials);
    expect(x.sectorCoverage).toBeGreaterThan(0.19);
    expect(x.sectorCoverage).toBeLessThanOrEqual(0.2 + 1e-9);
  });
  it("sums multiple ETFs and stocks contributing to one sector", () => {
    const x = analyzeExposure([
      { ticker: "SPY", weight: 0.2 },
      { ticker: "QQQ", weight: 0.1 },
      { ticker: "NVDA", weight: 0.08 },
    ]);
    expect(x.sectors.Technology).toBeCloseTo(
      0.2 * sectorShare("SPY", "Technology") +
        0.1 * sectorShare("QQQ", "Technology") +
        0.08,
    );
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
  it("classifies class shares by their dash ticker (BRK-B)", () => {
    const x = analyzeExposure([{ ticker: "BRK-B", weight: 0.1 }]);
    expect(x.sectors.Financials).toBe(0.1);
    expect(x.unclassified).toEqual([]);
  });
  it("classifies a diversified single-stock portfolio from the stored snapshot", () => {
    const stocks = [
      ["JPM", 8],
      ["DLTR", 2],
      ["DUK", 4],
      ["CCL", 2],
      ["LLY", 8],
      ["AZN", 4],
      ["CRWD", 4],
      ["NKE", 4],
      ["VZ", 4],
      ["MRK", 4],
      ["AMD", 4],
      ["CAT", 4],
      ["META", 2],
      ["RBLX", 5],
      ["NET", 4],
      ["TGT", 5],
      ["BLK", 4],
      ["BRK-B", 4],
      ["AAL", 4],
    ] as const;
    const x = analyzeExposure([
      { ticker: "CASH", weight: 0.05 },
      { ticker: "AGG", weight: 0.15 },
      ...stocks.map(([ticker, w]) => ({ ticker, weight: w / 100 })),
    ]);
    expect(x.sectorCoverage).toBeCloseTo(0.8);
    expect(x.styleCoverage).toBeCloseTo(0.8);
    expect(x.fixedIncome).toBeCloseTo(0.15);
    expect(x.cash).toBeCloseTo(0.05);
    expect(x.unclassified).toEqual([]);
    expect(x.sectors.Technology).toBeCloseTo(0.12);
  });
  it("names unclassified holdings with what is missing, largest first", () => {
    const x = analyzeExposure([
      { ticker: "MYSTERY", weight: 0.1 },
      { ticker: "EEM", weight: 0.3 },
      { ticker: "TLT", weight: 0.2 },
      { ticker: "SLV", weight: 0.05 },
    ]);
    expect(x.unclassified).toEqual([
      { ticker: "EEM", weight: 0.3, missing: "style" },
      { ticker: "MYSTERY", weight: 0.1, missing: "both" },
    ]);
    expect(x.fixedIncome).toBe(0.2);
    expect(x.other).toBe(0.05);
  });
  it("profiles the largest ETFs, counting a balanced fund's bonds as fixed income", () => {
    for (const t of ["VTI", "VOO", "VXUS", "VWO", "SCHD", "XLK"])
      expect(ETF_EXPOSURE_PROFILES[t]?.sectorWeights).toBeTruthy();
    const balanced = Object.values(ETF_EXPOSURE_PROFILES).find(
      (p) => (p.fixedIncomeShare ?? 0) > 0.3,
    );
    expect(balanced).toBeTruthy();
    const x = analyzeExposure([{ ticker: balanced!.ticker, weight: 1 }]);
    expect(x.fixedIncome).toBeCloseTo(balanced!.fixedIncomeShare!);
    expect(x.sectorCoverage + x.fixedIncome).toBeGreaterThan(0.9);
    for (const row of x.unclassified)
      expect(row.weight).toBeCloseTo(1 - balanced!.fixedIncomeShare!);
  });
  it("leaves leveraged and inverse funds unclassified rather than long", () => {
    for (const t of ["TQQQ", "SQQQ"])
      expect(ETF_EXPOSURE_PROFILES[t]?.sectorWeights).toBeUndefined();
  });
  it("classifies foreign companies through their U.S.-listed ADRs", () => {
    const x = analyzeExposure([
      { ticker: "TSM", weight: 0.5 },
      { ticker: "NVO", weight: 0.5 },
    ]);
    expect(x.sectors.Technology).toBe(0.5);
    expect(x.sectors["Health Care"]).toBe(0.5);
  });
  it("classifies liquid OTC-traded foreign companies (Nestlé, Roche)", () => {
    const x = analyzeExposure([
      { ticker: "NSRGY", weight: 0.5 },
      { ticker: "RHHBY", weight: 0.5 },
    ]);
    expect(x.sectors["Consumer Staples"]).toBe(0.5);
    expect(x.sectors["Health Care"]).toBe(0.5);
    expect(x.unclassified).toEqual([]);
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
