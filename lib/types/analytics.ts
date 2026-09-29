import type { CashPolicy, PortfolioConfig } from "./portfolio";
import type {
  DataCoverage,
  DataQualityState,
  HistoricalSeries,
  Result,
  ReturnInterval,
  Session,
  TreasurySeries,
} from "./data";
export type Sample = {
  startDate: string;
  endDate: string;
  returnCount: number;
  intervalSetId: string;
  excludedIntervalCount: number;
  excludedReasons: string[];
};
export type Metric =
  | { available: true; value: number; sample: Sample; notes?: string[] }
  | { available: false; reason: string };
export type PortfolioMetrics = {
  endingValue: Metric;
  cumulativeReturn: Metric;
  cagr: Metric;
};
export type RiskMetrics = {
  volatility: Metric;
  sharpe: Metric;
  sortino: Metric;
  maximumDrawdown: Metric;
};
export type BenchmarkMetrics = {
  beta: Metric;
  alpha: Metric;
  correlation: Metric;
  trackingError: Metric;
  informationRatio: Metric;
  annualizedActiveReturn: Metric;
};
export type RiskContribution = {
  ticker: string;
  marginal: Metric;
  component: Metric;
  percentage: Metric;
};
/** A peak-to-recovery episode on the compounded daily-close wealth series. */
export type DrawdownEpisode = {
  /** Last date at the high-water mark before wealth fell below it. */
  peakDate: string;
  peakWealth: number;
  /** First date of the episode's minimum wealth. */
  troughDate: string;
  troughWealth: number;
  /** First date wealth returned to or above the peak; null if not recovered in-window. */
  recoveryDate: string | null;
  /** troughWealth / peakWealth - 1 (non-positive). */
  depth: number;
  /** Peak → recovery, calendar days; null when not recovered. */
  calendarDaysToRecovery: number | null;
  /** Peak → recovery, session return intervals; null when not recovered. */
  tradingDaysToRecovery: number | null;
  /** Peak → recovery, or peak → effective end when unrecovered. */
  underwaterCalendarDays: number;
  underwaterTradingDays: number;
};
export type DrawdownPoint = { date: string; drawdown: number };
export type WealthPoint = { date: string; wealth: number };
/** Phase 2 performance layer, derived deterministically from the ledger. */
export type PerformanceSummary = {
  methodologyVersion: string;
  initialWealth: number;
  portfolio: PortfolioMetrics;
  risk: RiskMetrics;
  currentDrawdown: Metric;
  maximumDrawdownEpisode: DrawdownEpisode | null;
  /** Deepest episodes first (ties: earliest), at most PERFORMANCE_METHODOLOGY.episodeLimit. */
  episodes: DrawdownEpisode[];
  episodeCount: number;
  /** Growth of $10,000: initial point plus one point per ledger row. */
  growth: WealthPoint[];
  drawdown: DrawdownPoint[];
  /** Excess-return sample coverage for Sharpe/Sortino. */
  riskFree: { complete: boolean; available: number; required: number };
  elapsedCalendarDays: number;
  /** elapsedCalendarDays / 365.25, the CAGR time basis. */
  elapsedYears: number;
};
export type StressTestResult = {
  name: string;
  startDate: string;
  endDate: string;
  portfolioReturn: Metric;
  benchmarkReturn: Metric;
  activeReturn: Metric;
  coverage: DataCoverage[];
};
export type LedgerRow = ReturnInterval & {
  wealth: number;
  startWeights: number[];
  endWeights: number[];
  nextWeights: number[];
  holdingReturns: number[];
  contributions: number[];
  rebalanced: boolean;
  riskFreeReturn: number | null;
  rateObservationDate: string | null;
};
export type BenchmarkPath = {
  sample: Sample;
  points: { date: string; portfolioWealth: number; benchmarkWealth: number }[];
  intervals: ReturnInterval[];
};
export type MethodologyMetadata = {
  version: string;
  engineVersion: string;
  generatedAt: string;
  requestedStartDate: string;
  requestedEndDate: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  limitingHoldings: string[];
  sample: Sample;
  cashPolicy: CashPolicy;
  warnings: string[];
  snapshotHash: string;
  calendarVersion: string;
  /** Federal calendar used to model Treasury release availability. */
  federalCalendarVersion: string;
  returnConvention: string;
  rebalanceConvention: string;
  historicalProviders: string[];
  treasuryProvider: string | null;
  currentDataUsed: false;
};
export type BacktestResult = {
  config: PortfolioConfig;
  initialWealth: number;
  initialDate: string;
  ledger: LedgerRow[];
  coverage: DataCoverage[];
  quality: DataQualityState[];
  benchmark: Result<BenchmarkPath>;
  performance: PerformanceSummary;
  metadata: MethodologyMetadata;
  snapshot: {
    prices: HistoricalSeries[];
    treasury: TreasurySeries | null;
    sessions: Session[];
    eligibleEndDate: string;
  };
};
