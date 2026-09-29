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
  | { available: true; value: number; sample: Sample }
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
export type DrawdownEpisode = {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  depth: number;
  calendarDaysToRecovery: number | null;
  tradingDaysToRecovery: number | null;
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
  metadata: MethodologyMetadata;
  snapshot: {
    prices: HistoricalSeries[];
    treasury: TreasurySeries | null;
    sessions: Session[];
    eligibleEndDate: string;
  };
};
