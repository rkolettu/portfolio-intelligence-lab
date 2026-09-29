export type ErrorCode =
  | "INVALID_INPUT"
  | "TICKER_NOT_FOUND"
  | "PROVIDER_ERROR"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "MALFORMED_DATA"
  | "COVERAGE_GAP"
  | "INSUFFICIENT_HISTORY"
  | "TREASURY_UNAVAILABLE"
  | "UNSUPPORTED_ASSET"
  | "UNQUALIFIED_PROVIDER";
export type DataError = {
  code: ErrorCode;
  message: string;
  ticker?: string;
  dates?: string[];
  retryable: boolean;
};
export type Result<T> =
  { ok: true; value: T } | { ok: false; error: DataError };
export type PriceObservation = { date: string; adjustedClose: number };
export type ReturnObservation = { date: string; return: number };
export type ReturnInterval = ReturnObservation & { startDate: string };
export type TreasuryObservation = {
  date: string;
  annualYield: number;
  availableAt: string;
  availability: "modeled" | "published";
};
export type Session = { date: string; close: string };
export type DataCoverage = {
  ticker: string;
  firstAvailableDate: string | null;
  lastAvailableDate: string | null;
  observationCount: number;
  status: "complete" | "partial" | "insufficient" | "unavailable";
  startReason?: "provider_reported_first_trade" | "provider_limit";
  missingDates: string[];
};
export type DataQualityState =
  | "complete"
  | "partial_history"
  | "insufficient_history"
  | "benchmark_partial"
  | "treasury_unavailable"
  | "ticker_not_found"
  | "provider_error"
  | "stale_cached_data"
  | "optimizer_failed";
export type Provenance = {
  provider: string;
  fetchedAt: string;
  lastSuccessfulRefresh: string;
  cacheAgeSeconds: number;
  observationDate: string | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
  warnings: string[];
};
export type HistoricalSeries = {
  ticker: string;
  currency: "USD";
  exchange: string;
  instrument: "EQUITY" | "ETF";
  convention: "total_return_aware_adjusted";
  firstTradeDate: string | null;
  observations: PriceObservation[];
  provenance: Provenance;
};
export type TreasurySeries = {
  series: "DGS3MO";
  observations: TreasuryObservation[];
  provenance: Provenance;
};
export type QuoteStatus =
  "live" | "delayed" | "end_of_day" | "latest_available";
export type CurrentQuote = {
  ticker: string;
  price: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  marketTimestamp: string;
  marketDate: string;
  fetchedAt: string;
  status: QuoteStatus;
  provider: string;
  delaySeconds?: number;
  session: "regular" | "pre" | "post" | "unknown";
  observationAgeSeconds: number;
  /** When a live/delayed claim lapses to Latest Available (market time + tolerance). */
  statusExpiresAt?: string;
  /** Close of the next session after the observation; null when beyond calendar coverage. */
  staleAfter?: string | null;
  stale?: boolean;
  provenance: Provenance;
};
export type TreasuryMaturity = "3M" | "1Y" | "3Y" | "5Y" | "10Y";
export type TreasuryCurve = {
  points: { maturity: TreasuryMaturity; date: string; annualYield: number }[];
  mixedDates: boolean;
  provenance: Provenance;
};
