import {
  ETF_EXPOSURE_PROFILES,
  SECTORS,
  SECTOR_PROXIES,
  STOCK_CLASSIFICATIONS,
  STYLE_CELLS,
  type Sector,
  type StyleCell,
} from "@/config/exposureProfiles";
import type { PortfolioHolding } from "@/lib/types/portfolio";

export type Contribution = {
  ticker: string;
  portfolioWeight: number;
  profileWeight: number;
  contribution: number;
  kind: "stock" | "etf";
};
/** A holding the stored snapshots cannot place: no sector, no style cell, or
 * neither. Bonds, CASH and other non-equity assets are reported separately. */
export type UnclassifiedHolding = {
  ticker: string;
  weight: number;
  missing: "sector" | "style" | "both";
};
export type ExposureAnalysis = {
  sectors: Record<Sector, number>;
  sectorContributions: Record<Sector, Contribution[]>;
  styles: Record<StyleCell, number>;
  styleContributions: Record<StyleCell, Contribution[]>;
  sectorCoverage: number;
  styleCoverage: number;
  unclassifiedSector: number;
  unclassifiedStyle: number;
  cash: number;
  fixedIncome: number;
  other: number;
  /** Equity (or unknown) holdings left out of the sector bars or style grid. */
  unclassified: UnclassifiedHolding[];
};

export function analyzeExposure(
  holdings: readonly PortfolioHolding[],
): ExposureAnalysis {
  const sectors = Object.fromEntries(SECTORS.map((s) => [s, 0])) as Record<
    Sector,
    number
  >;
  const styles = Object.fromEntries(STYLE_CELLS.map((s) => [s, 0])) as Record<
    StyleCell,
    number
  >;
  const sectorContributions = Object.fromEntries(
    SECTORS.map((s) => [s, []]),
  ) as unknown as Record<Sector, Contribution[]>;
  const styleContributions = Object.fromEntries(
    STYLE_CELLS.map((s) => [s, []]),
  ) as unknown as Record<StyleCell, Contribution[]>;
  let cash = 0,
    fixedIncome = 0,
    other = 0,
    unclassifiedSector = 0,
    unclassifiedStyle = 0;
  const unclassified: UnclassifiedHolding[] = [];
  for (const holding of holdings.filter((h) => h.weight > 0)) {
    const ticker = holding.ticker.toUpperCase();
    if (ticker === "CASH") {
      cash += holding.weight;
      continue;
    }
    const etf = ETF_EXPOSURE_PROFILES[ticker];
    if (etf?.assetClass === "fixed-income") {
      fixedIncome += holding.weight;
      unclassifiedSector += holding.weight;
      continue;
    }
    if (etf?.assetClass === "other") {
      other += holding.weight;
      unclassifiedSector += holding.weight;
      unclassifiedStyle += holding.weight;
      continue;
    }
    const stock = etf ? undefined : STOCK_CLASSIFICATIONS[ticker];
    const noSector = !etf?.sectorWeights && !stock;
    const noStyle = !etf?.styleWeights && !stock?.style;
    if (noSector || noStyle)
      unclassified.push({
        ticker,
        weight: holding.weight,
        missing: noSector && noStyle ? "both" : noSector ? "sector" : "style",
      });
    if (etf?.sectorWeights) {
      let classified = 0;
      for (const sector of SECTORS) {
        const profileWeight =
          (etf.sectorWeights[sector] ?? 0) /
          (Object.values(etf.sectorWeights).some((v) => (v ?? 0) > 1)
            ? 100
            : 1);
        const contribution = holding.weight * profileWeight;
        sectors[sector] += contribution;
        classified += contribution;
        if (contribution)
          sectorContributions[sector].push({
            ticker,
            portfolioWeight: holding.weight,
            profileWeight,
            contribution,
            kind: "etf",
          });
      }
      unclassifiedSector += Math.max(0, holding.weight - classified);
    } else if (stock) {
      sectors[stock.sector] += holding.weight;
      sectorContributions[stock.sector].push({
        ticker,
        portfolioWeight: holding.weight,
        profileWeight: 1,
        contribution: holding.weight,
        kind: "stock",
      });
    } else unclassifiedSector += holding.weight;
    if (etf?.styleWeights) {
      let classified = 0;
      for (const cell of STYLE_CELLS) {
        const profileWeight =
          (etf.styleWeights[cell] ?? 0) /
          (Object.values(etf.styleWeights).some((v) => (v ?? 0) > 1) ? 100 : 1);
        const contribution = holding.weight * profileWeight;
        styles[cell] += contribution;
        classified += contribution;
        if (contribution)
          styleContributions[cell].push({
            ticker,
            portfolioWeight: holding.weight,
            profileWeight,
            contribution,
            kind: "etf",
          });
      }
      unclassifiedStyle += Math.max(0, holding.weight - classified);
    } else if (stock?.style) {
      styles[stock.style] += holding.weight;
      styleContributions[stock.style].push({
        ticker,
        portfolioWeight: holding.weight,
        profileWeight: 1,
        contribution: holding.weight,
        kind: "stock",
      });
    } else unclassifiedStyle += holding.weight;
  }
  const sectorCoverage = SECTORS.reduce((s, k) => s + sectors[k], 0);
  const styleCoverage = STYLE_CELLS.reduce((s, k) => s + styles[k], 0);
  return {
    sectors,
    sectorContributions,
    styles,
    styleContributions,
    sectorCoverage,
    styleCoverage,
    unclassifiedSector,
    unclassifiedStyle,
    cash,
    fixedIncome,
    other,
    unclassified: unclassified.sort((a, b) => b.weight - a.weight),
  };
}

/** Broad ETFs need decomposition, not a misleading single-sector comparison. */
export function requiredSectorProxies(exposure: ExposureAnalysis) {
  return SECTORS.filter((sector) =>
    exposure.sectorContributions[sector].some(
      (row) =>
        row.kind === "stock" ||
        ETF_EXPOSURE_PROFILES[row.ticker]?.sectorSpecific === sector,
    ),
  ).map((sector) => SECTOR_PROXIES[sector]);
}
