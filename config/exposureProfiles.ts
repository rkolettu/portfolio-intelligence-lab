/**
 * Rounded, static classification snapshots used for transparent look-through.
 * They are deliberately local: these are not live constituent files and are
 * never used by the return, risk, or construction engines.
 */
export const SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Materials",
  "Real Estate",
  "Technology",
  "Utilities",
] as const;
export type Sector = (typeof SECTORS)[number];

export const STYLE_CELLS = [
  "Large Value",
  "Large Blend",
  "Large Growth",
  "Mid Value",
  "Mid Blend",
  "Mid Growth",
  "Small Value",
  "Small Blend",
  "Small Growth",
] as const;
export type StyleCell = (typeof STYLE_CELLS)[number];

export const SECTOR_PROXIES: Record<Sector, string> = {
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Energy: "XLE",
  Financials: "XLF",
  "Health Care": "XLV",
  Industrials: "XLI",
  Materials: "XLB",
  "Real Estate": "XLRE",
  Technology: "XLK",
  Utilities: "XLU",
};

export type ExposureProfile = {
  ticker: string;
  profileDate: string;
  sectorWeights?: Partial<Record<Sector, number>>;
  styleWeights?: Partial<Record<StyleCell, number>>;
  sourceDescription: string;
  assetClass: "equity" | "fixed-income" | "other";
  sectorSpecific?: Sector;
};

const source =
  "Rounded issuer fact-sheet category snapshot; stored locally, not live holdings";
const broad = (
  ticker: string,
  sectorWeights: number[],
  styleWeights: number[],
): ExposureProfile => ({
  ticker,
  profileDate: "2026-06",
  sourceDescription: source,
  assetClass: "equity",
  sectorWeights: Object.fromEntries(
    SECTORS.map((s, i) => [s, sectorWeights[i] || 0]),
  ),
  styleWeights: Object.fromEntries(
    STYLE_CELLS.map((s, i) => [s, styleWeights[i] || 0]),
  ),
});
const sp = [9, 10, 6, 3, 14, 10, 9, 2, 2, 33, 2];
const largeBlend = [22, 40, 32, 1, 2, 2, 0, 1, 0];
const total = [9, 10, 6, 3, 13, 10, 10, 2, 3, 31, 3];
const world = [8, 11, 7, 4, 17, 10, 12, 4, 3, 21, 3];
const growth = [4, 14, 3, 1, 6, 10, 7, 1, 1, 52, 1];
const value = [7, 5, 9, 7, 21, 15, 14, 4, 4, 7, 7];

export const ETF_EXPOSURE_PROFILES: Record<string, ExposureProfile> =
  Object.fromEntries(
    [
      broad("SPY", sp, largeBlend),
      broad("VOO", sp, largeBlend),
      broad("IVV", sp, largeBlend),
      broad("VTI", total, [18, 34, 27, 4, 5, 5, 2, 3, 2]),
      broad("VT", world, [19, 35, 27, 4, 5, 4, 2, 2, 2]),
      broad(
        "QQQ",
        [10, 13, 3, 1, 1, 5, 4, 0, 0, 62, 1],
        [2, 23, 71, 0, 1, 3, 0, 0, 0],
      ),
      broad(
        "DIA",
        [4, 13, 5, 3, 24, 16, 14, 2, 0, 17, 2],
        [28, 48, 22, 1, 1, 0, 0, 0, 0],
      ),
      broad("IWM", total, [0, 0, 0, 3, 5, 3, 25, 35, 29]),
      broad("IJH", total, [0, 0, 0, 24, 43, 28, 1, 2, 2]),
      broad("VO", total, [0, 0, 0, 22, 45, 29, 1, 2, 1]),
      broad("IJR", total, [0, 0, 0, 2, 3, 2, 26, 39, 28]),
      broad("VB", total, [0, 0, 0, 2, 4, 3, 23, 39, 29]),
      broad("VUG", growth, [0, 8, 89, 0, 1, 2, 0, 0, 0]),
      broad("SCHG", growth, [0, 7, 91, 0, 1, 1, 0, 0, 0]),
      broad("IWF", growth, [0, 8, 89, 0, 1, 2, 0, 0, 0]),
      broad("VTV", value, [82, 16, 0, 2, 0, 0, 0, 0, 0]),
      broad("IWD", value, [79, 18, 0, 2, 1, 0, 0, 0, 0]),
      broad("SCHD", value, [72, 27, 0, 1, 0, 0, 0, 0, 0]),
      broad("SCHF", world, [32, 38, 22, 2, 2, 2, 1, 1, 0]),
      broad("VXUS", world, [25, 35, 22, 4, 4, 3, 2, 3, 2]),
      broad("VEA", world, [32, 38, 20, 3, 3, 2, 1, 1, 0]),
      broad("VWO", world, [19, 31, 31, 4, 5, 5, 1, 2, 2]),
      ...(["BND", "AGG"] as const).map((ticker) => ({
        ticker,
        profileDate: "2026-06",
        sourceDescription: "Fund mandate: broad investment-grade bonds",
        assetClass: "fixed-income" as const,
      })),
      {
        ticker: "GLD",
        profileDate: "2026-06",
        sourceDescription: "Fund mandate: physically backed gold",
        assetClass: "other" as const,
      },
      ...SECTORS.map((sector) => ({
        ticker: SECTOR_PROXIES[sector],
        profileDate: "2026-06",
        sourceDescription: "Sector Select/SPDR fund mandate",
        assetClass: "equity" as const,
        sectorSpecific: sector,
        sectorWeights: { [sector]: 1 },
      })),
    ].map((p) => [p.ticker, p]),
  );

/** Conservative local stock metadata. Unknown tickers remain unclassified. */
export const STOCK_CLASSIFICATIONS: Record<
  string,
  { sector: Sector; style: StyleCell }
> = {
  AAPL: { sector: "Technology", style: "Large Growth" },
  MSFT: { sector: "Technology", style: "Large Growth" },
  NVDA: { sector: "Technology", style: "Large Growth" },
  AVGO: { sector: "Technology", style: "Large Growth" },
  GOOGL: { sector: "Communication Services", style: "Large Growth" },
  GOOG: { sector: "Communication Services", style: "Large Growth" },
  META: { sector: "Communication Services", style: "Large Growth" },
  AMZN: { sector: "Consumer Discretionary", style: "Large Growth" },
  TSLA: { sector: "Consumer Discretionary", style: "Large Growth" },
  JPM: { sector: "Financials", style: "Large Value" },
  BRK_B: { sector: "Financials", style: "Large Value" },
  JNJ: { sector: "Health Care", style: "Large Value" },
  LLY: { sector: "Health Care", style: "Large Growth" },
  XOM: { sector: "Energy", style: "Large Value" },
  CVX: { sector: "Energy", style: "Large Value" },
  WMT: { sector: "Consumer Staples", style: "Large Blend" },
  PG: { sector: "Consumer Staples", style: "Large Value" },
  CAT: { sector: "Industrials", style: "Large Value" },
  BA: { sector: "Industrials", style: "Large Blend" },
  LIN: { sector: "Materials", style: "Large Blend" },
  AMT: { sector: "Real Estate", style: "Large Blend" },
  NEE: { sector: "Utilities", style: "Large Blend" },
};
