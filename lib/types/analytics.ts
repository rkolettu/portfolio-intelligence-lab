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
/** One portfolio interval on which the benchmark also has a valid return: the
 * benchmark has adjusted prices at BOTH interval endpoints (no forward-fill). */
export type AlignedInterval = {
  startDate: string;
  date: string;
  portfolioReturn: number;
  benchmarkReturn: number;
  /** The ledger's prior-known Treasury accrual for this interval, or null. */
  riskFreeReturn: number | null;
};
/** Canonical portfolio / benchmark / risk-free comparison sample (server-side). */
export type BenchmarkAlignment = {
  ticker: string;
  observations: AlignedInterval[];
  /** Null when no interval aligns. */
  sample: Sample | null;
  /** Portfolio sessions carrying a benchmark price. */
  pricedSessions: string[];
  /** Portfolio sessions inside the benchmark's priced span that lack a price. */
  missingSessions: string[];
  /** Portfolio intervals before / after the comparison period (shorter benchmark). */
  leadingIntervalsExcluded: number;
  trailingIntervalsExcluded: number;
  riskFree: { complete: boolean; available: number; required: number };
};
export type ComparisonPeriod =
  | {
      available: true;
      sample: Sample;
      /** No interior gaps: geometric (compounded) comparison is valid. */
      continuous: boolean;
      leadingIntervalsExcluded: number;
      trailingIntervalsExcluded: number;
      notes: string[];
    }
  | { available: false; reason: string };
export type SeriesDrawdown =
  | {
      available: true;
      series: DrawdownPoint[];
      maximumDrawdown: Metric;
      currentDrawdown: Metric;
      maximumDrawdownEpisode: DrawdownEpisode | null;
      episodes: DrawdownEpisode[];
      episodeCount: number;
    }
  | { available: false; reason: string };
/** Phase 3 benchmark-relative layer. Every `relative` metric shares one sample. */
export type BenchmarkAnalytics = {
  methodologyVersion: string;
  ticker: string;
  comparison: ComparisonPeriod;
  relative: BenchmarkMetrics & {
    /** OLS slope of portfolio excess on benchmark excess (alpha regression). */
    regressionBeta: Metric;
    rSquared: Metric;
  };
  /** Geometric comparison over the continuous comparison period. */
  geometric: {
    portfolioCumulativeReturn: Metric;
    benchmarkCumulativeReturn: Metric;
    portfolioCagr: Metric;
    benchmarkCagr: Metric;
  };
  riskFree: { complete: boolean; available: number; required: number };
  drawdown: SeriesDrawdown;
};
export type RiskContribution = {
  ticker: string;
  marginal: Metric;
  component: Metric;
  percentage: Metric;
};
/** Canonical risky-holding return sample (server-side; rows are not shipped). */
export type HoldingAlignment = {
  /** Positive-weight risky tickers in portfolio order (CASH excluded). */
  tickers: string[];
  /** Target weights of those tickers, NOT renormalized to the risky sleeve. */
  weights: number[];
  cashWeight: number;
  /** One row per interval on which every risky holding has a valid return. */
  rows: { startDate: string; date: string; returns: number[] }[];
  sample: Sample | null;
};
export type RiskSampleStatus = "normal" | "limited" | "insufficient";
export type CovarianceDiagnostics = {
  symmetric: boolean;
  /** Eigenvalues of the annualized matrix (ascending). */
  minEigenvalue: number;
  maxEigenvalue: number;
  /** Rank-deficient within tolerance: duplicate, perfectly correlated or constant holdings. */
  singular: boolean;
};
export type CorrelationPair = { a: string; b: string; correlation: number };
export type HoldingRisk = RiskContribution & {
  weight: number;
  /** CASH is modeled as locally riskless and kept outside the covariance matrix. */
  riskless: boolean;
  volatility: Metric;
  /** Holding beta on the Phase 3 benchmark-aligned sample (may be shorter). */
  beta: Metric;
};
export type ReturnContributionRow = {
  ticker: string;
  /** sum_t w_(i,t-1) × r_(i,t), arithmetic, in return units. */
  periodContribution: number;
  /** Mean beginning-of-interval (drifted/reset) weight over the sample. */
  averageWeight: number;
};
/** Phase 4 risk, diversification and contribution layer. */
export type RiskAnalytics = {
  methodologyVersion: string;
  label: string;
  sample:
    | {
        available: true;
        sample: Sample;
        status: RiskSampleStatus;
        tickers: string[];
        cashWeight: number;
        notes: string[];
      }
    | { available: false; reason: string; observationCount: number };
  covariance:
    | {
        available: true;
        tickers: string[];
        daily: number[][];
        annual: number[][];
        diagnostics: CovarianceDiagnostics;
      }
    | { available: false; reason: string };
  correlation:
    | {
        available: true;
        tickers: string[];
        /** null where a holding's returns are constant (correlation undefined). */
        matrix: (number | null)[][];
        highest: CorrelationPair | null;
        lowest: CorrelationPair | null;
        undefinedTickers: string[];
      }
    | { available: false; reason: string };
  portfolio: {
    /** Target-weight model volatility sqrt(w'Σw), distinct from realized volatility. */
    volatility: Metric;
    variance: Metric;
    weightedAverageVolatility: Metric;
    diversificationRatio: Metric;
    /** |sum(CRC) − σ| and |sum(PCR) − 1| as computed (identity checks). */
    identityResiduals: { crc: number; pcr: number } | null;
  };
  /** Every positive-weight holding, CASH included, in portfolio order. */
  holdings: HoldingRisk[];
  concentration: {
    hhi: number;
    effectiveHoldings: number;
    largest: { ticker: string; weight: number };
    top3: { tickers: string[]; weight: number };
  };
  returnContribution: {
    sample: Sample;
    rows: ReturnContributionRow[];
    /** sum_t portfolioReturn_t — what arithmetic contributions add up to. */
    sumOfDailyReturns: number;
    /** max_t |sum_i contribution_(i,t) − portfolioReturn_t|. */
    maxIdentityResidual: number;
  };
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
  benchmarkAnalytics: BenchmarkAnalytics;
  riskAnalytics: RiskAnalytics;
  metadata: MethodologyMetadata;
  snapshot: {
    prices: HistoricalSeries[];
    treasury: TreasurySeries | null;
    sessions: Session[];
    eligibleEndDate: string;
  };
};
