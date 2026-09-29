import type { HistoricalSeries, Provenance, Session } from "@/lib/types/data";
export const provenance: Provenance = {
  provider: "fixture",
  fetchedAt: "2024-06-05T00:00:00Z",
  lastSuccessfulRefresh: "2024-06-05T00:00:00Z",
  cacheAgeSeconds: 0,
  observationDate: "2024-06-04",
  fallbackUsed: false,
  warnings: [],
};
export function series(
  ticker: string,
  dates: string[],
  prices: number[],
  firstTradeDate: string | null = "2000-01-03",
): HistoricalSeries {
  return {
    ticker,
    currency: "USD",
    exchange: "NYSEArca",
    instrument: "ETF",
    convention: "total_return_aware_adjusted",
    firstTradeDate,
    observations: dates.map((date, i) => ({ date, adjustedClose: prices[i] })),
    provenance,
  };
}
export function sessions(dates: string[]): Session[] {
  return dates.map((date) => ({ date, close: `${date}T20:00:00Z` }));
}
