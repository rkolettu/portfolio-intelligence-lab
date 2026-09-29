import type { CurrentQuote, HistoricalSeries } from "@/lib/types/data";
export type HistoryRequest = {
  ticker: string;
  startDate: string;
  endDate: string;
  now: string;
};
export interface HistoricalProvider {
  name: string;
  convention: "total_return_aware_adjusted";
  getHistoricalPrices(request: HistoryRequest): Promise<HistoricalSeries>;
}
export interface QuoteProvider {
  name: string;
  getCurrentQuote(ticker: string, now: string): Promise<CurrentQuote>;
}
