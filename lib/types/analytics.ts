import type { CashPolicy, PortfolioConfig } from "./portfolio";
import type {
  DataCoverage,
  DataError,
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
/** One rolling statistic at one window length, aligned to RollingAnalytics.dates.
 * A value exists only where the N intervals ending on that date are consecutive
 * scheduled sessions that are all valid for the statistic. */
export type RollingSeries = {
  window: number;
  /** null: fewer than N consecutive valid intervals, or undefined on a full window. */
  values: (number | null)[];
  /** Full windows with a defined value. */
  validCount: number;
  /** Date of the first defined value. */
  firstDate: string | null;
  /** Full windows on which the statistic is undefined (e.g. zero variance). */
  undefinedCount: number;
  undefinedReasons: string[];
};
export type RollingMetric =
  | { available: true; series: RollingSeries[] }
  | { available: false; reason: string };
/** Phase 5 rolling layer: realized portfolio volatility, and beta / correlation
 * against the benchmark on the Phase 3 aligned intervals. */
export type RollingAnalytics = {
  methodologyVersion: string;
  benchmarkTicker: string;
  /** Window lengths in session returns; series arrays follow this order. */
  windows: number[];
  defaultWindow: number;
  /** Ledger interval end dates; every series' values align to these. */
  dates: string[];
  volatility: RollingMetric;
  beta: RollingMetric;
  correlation: RollingMetric;
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
/** A fixed preset stress window or a user-selected Custom Historical Window. */
export type StressWindowDefinition = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  kind: "preset" | "custom";
};
/** Why one holding cannot cover an event window. */
export type StressCoverageIssue = {
  ticker: string;
  /** First adjusted price inside the window, if any. */
  firstAvailableDate: string | null;
  firstTradeDate: string | null;
  /** Window sessions without an adjusted price. */
  missingSessions: number;
  reason: string;
};
export type StressPathPoint = {
  date: string;
  /** Wealth from $10,000 at the event start close. */
  portfolio: number;
  benchmark: number | null;
};
type StressEventBase = {
  id: string;
  name: string;
  description: string;
  kind: "preset" | "custom";
  requestedStartDate: string;
  requestedEndDate: string;
  /** Initialization session (first on/after the requested start), if any. */
  startDate: string | null;
  /** Last completed session on/before the requested end, if any. */
  endDate: string | null;
  notes: string[];
};
export type StressTestResult = StressEventBase &
  (
    | {
        status: "complete";
        sample: Sample;
        /** End of the first earned return (the session after the start close). */
        firstReturnDate: string;
        portfolioReturn: Metric;
        benchmarkReturn: Metric;
        /** Portfolio cumulative − benchmark cumulative return; not annualized. */
        activeReturn: Metric;
        /** Within-window: the start close is the first peak. */
        maximumDrawdown: Metric;
        maximumDrawdownEpisode: DrawdownEpisode | null;
        portfolioVolatility: Metric;
        benchmarkVolatility: Metric;
        holdings: StressHoldingReturn[];
        best: string[];
        worst: string[];
        /** Monthly closing resets applied before the window's final session. */
        rebalances: number;
        path: StressPathPoint[];
      }
    | { status: "incomplete_coverage"; missing: StressCoverageIssue[] }
    | { status: "unavailable"; reason: string }
  );
export type StressSnapshot = {
  windows: StressWindowDefinition[];
  prices: HistoricalSeries[];
  treasury: TreasurySeries | null;
  sessions: Session[];
  /** Securities whose history could not be fetched, with the typed error. */
  unavailable: { ticker: string; error: DataError }[];
};
/** Phase 5 stress layer, returned by its own request with its own snapshot. */
export type StressAnalytics = {
  methodologyVersion: string;
  windowsVersion: string;
  config: PortfolioConfig;
  benchmark: string;
  events: StressTestResult[];
  metadata: {
    generatedAt: string;
    snapshotHash: string;
    engineMethodologyVersion: string;
    calendarVersion: string;
    federalCalendarVersion: string;
    historicalProviders: string[];
    treasuryProvider: string | null;
    warnings: string[];
    currentDataUsed: false;
  };
  snapshot: StressSnapshot;
};
/** Standalone compounded return of one holding over an event window. */
export type StressHoldingReturn = {
  ticker: string;
  weight: number;
  /** prod(1 + r_t) − 1 over the event: the holding's own return, not a contribution. */
  return: number;
  riskless: boolean;
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
  rollingAnalytics: RollingAnalytics;
  metadata: MethodologyMetadata;
  snapshot: {
    prices: HistoricalSeries[];
    treasury: TreasurySeries | null;
    sessions: Session[];
    eligibleEndDate: string;
  };
};
