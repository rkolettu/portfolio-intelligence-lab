import type { CurrentQuote, HistoricalSeries, Result } from "@/lib/types/data";
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
/** Optional capability: many securities over one range in one upstream request.
 * Results are returned in request order; each carries its own typed failure. */
export interface HistoricalBatchProvider extends HistoricalProvider {
  maxBatch: number;
  getHistoricalBatch(
    requests: HistoryRequest[],
  ): Promise<Result<HistoricalSeries>[]>;
}
export interface QuoteBatchProvider extends QuoteProvider {
  maxBatch: number;
  getCurrentQuotes(
    tickers: string[],
    now: string,
  ): Promise<Result<CurrentQuote>[]>;
}
export const isHistoricalBatch = (
  p: HistoricalProvider,
): p is HistoricalBatchProvider =>
  typeof (p as HistoricalBatchProvider).getHistoricalBatch === "function";
export const isQuoteBatch = (p: QuoteProvider): p is QuoteBatchProvider =>
  typeof (p as QuoteBatchProvider).getCurrentQuotes === "function";
