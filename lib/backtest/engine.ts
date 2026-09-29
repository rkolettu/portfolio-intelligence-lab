import type { BacktestResult, LedgerRow } from "@/lib/types/analytics";
import type {
  HistoricalSeries,
  Session,
  TreasurySeries,
} from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { METHODOLOGY } from "@/config/methodology";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { calendarDays, marketDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
import { arithmeticReturn, compoundWealth } from "@/lib/analytics/returns";
import { applyReturns, crossesMonth } from "@/lib/analytics/rebalance";
import { accrueCash, priorKnownRate } from "@/lib/treasury-data/alignment";
import { portfolioCoverage } from "./coverage";
import { alignBenchmark, benchmarkPath } from "./alignment";
import { CALENDAR_VERSION } from "./calendar";
import { summarizePerformance } from "@/lib/analytics/summary";
import { summarizeBenchmark } from "@/lib/analytics/benchmarkSummary";
import { FEDERAL_CALENDAR_VERSION } from "@/lib/treasury-data/normalize";
import { snapshotHash, sampleMetadata } from "./metadata";
export type SimulationInput = {
  config: PortfolioConfig;
  prices: HistoricalSeries[];
  treasury: TreasurySeries | null;
  sessions: Session[];
  now: string;
  eligibleEndDate?: string;
};
export function simulate(input: SimulationInput): BacktestResult {
  const config = parsePortfolio(input.config, marketDate(input.now));
  const { sessions, coverage, limitingHoldings } = portfolioCoverage(
    { ...config, endDate: input.eligibleEndDate ?? config.endDate },
    input.prices,
    input.sessions,
  );
  const holdings = config.holdings.filter((h) => h.weight > 0);
  const targets = holdings.map((h) => h.weight);
  const prices = new Map(
    input.prices.map((p) => [
      p.ticker,
      new Map(p.observations.map((v) => [v.date, v.adjustedClose])),
    ]),
  );
  const rates = sessions
    .slice(0, -1)
    .map((s) => priorKnownRate(input.treasury?.observations ?? [], s));
  const ratesMissing = rates.some((r) => r === null);
  const hasCash = holdings.some((h) => h.ticker === "CASH");
  if (hasCash && ratesMissing && config.cashPolicy === "historical_proxy")
    fail(
      "TREASURY_UNAVAILABLE",
      "Treasury history is incomplete. Retry, remove CASH, or explicitly select whole-run zero-return CASH.",
      { retryable: true },
    );
  if (hasCash && !ratesMissing && config.cashPolicy === "zero_explicit")
    fail(
      "INVALID_INPUT",
      "Zero-return CASH is an outage fallback only; historical Treasury rates are available.",
    );
  let weights = [...targets];
  let wealth: number = METHODOLOGY.initialWealth;
  const ledger: LedgerRow[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const previous = sessions[i - 1];
    const current = sessions[i];
    const rate = rates[i - 1];
    const riskFreeReturn = rate
      ? accrueCash(rate.annualYield, calendarDays(previous.date, current.date))
      : null;
    const holdingReturns = holdings.map((h) =>
      h.ticker === "CASH"
        ? config.cashPolicy === "zero_explicit"
          ? 0
          : riskFreeReturn!
        : arithmeticReturn(
            prices.get(h.ticker)!.get(previous.date)!,
            prices.get(h.ticker)!.get(current.date)!,
          ),
    );
    const state = applyReturns(weights, holdingReturns);
    wealth = compoundWealth(wealth, [state.portfolioReturn])[1];
    const next = input.sessions.find((s) => s.date > current.date);
    const rebalanced = !!next && crossesMonth(current.date, next.date);
    const nextWeights = rebalanced ? [...targets] : state.endWeights;
    ledger.push({
      startDate: previous.date,
      date: current.date,
      return: state.portfolioReturn,
      wealth,
      startWeights: [...weights],
      endWeights: state.endWeights,
      nextWeights: [...nextWeights],
      holdingReturns,
      contributions: state.contributions,
      rebalanced,
      riskFreeReturn,
      rateObservationDate: rate?.date ?? null,
    });
    weights = nextWeights;
  }
  // One canonical portfolio/benchmark/risk-free alignment feeds the growth path,
  // every benchmark-relative metric and benchmark drawdown.
  const alignment = alignBenchmark(
    input.prices.find((p) => p.ticker === config.benchmark),
    sessions,
    ledger,
  );
  const benchmark = benchmarkPath(
    alignment,
    sessions,
    ledger,
    METHODOLOGY.initialWealth,
  );
  const warnings = [
    "Synthetic adjusted-price wealth ledger with fractional units; units are not actual shares.",
    "Results are gross of transaction costs, taxes, and trading frictions.",
    "Configured holdings and targets are retrospective assumptions; selection and survivorship bias can apply.",
    "DGS3MO is an investment-basis yield. ACT/365 exponentiation is synthetic cash accrual, not a Treasury holding-period return.",
    ...input.prices.flatMap((p) => p.provenance.warnings),
    ...(input.treasury?.provenance.warnings ?? []),
  ];
  if (ratesMissing)
    warnings.push(
      "Historical risk-free coverage is incomplete; missing rates remain unavailable.",
    );
  if (hasCash && config.cashPolicy === "zero_explicit")
    warnings.push(
      "Explicit zero-return CASH fallback applies to this entire run. It does not replace missing risk-free observations.",
    );
  if (sessions[0].date !== config.requestedStartDate)
    warnings.push(
      "Start adjusted to the first covered scheduled session; see limiting holdings and per-security coverage.",
    );
  if (sessions.at(-1)!.date !== config.endDate)
    warnings.push(
      "Effective end is the last eligible completed daily session; requested end is preserved.",
    );
  const sample = sampleMetadata(sessions);
  const snapshot = {
    prices: input.prices,
    treasury: input.treasury,
    sessions: input.sessions,
    eligibleEndDate: input.eligibleEndDate ?? config.endDate,
  };
  return {
    config,
    initialWealth: METHODOLOGY.initialWealth,
    initialDate: sessions[0].date,
    ledger,
    coverage,
    benchmark,
    benchmarkAnalytics: summarizeBenchmark({
      ticker: config.benchmark,
      alignment,
      path: benchmark,
    }),
    performance: summarizePerformance({
      initialWealth: METHODOLOGY.initialWealth,
      initialDate: sessions[0].date,
      ledger,
      sample,
    }),
    quality: [
      limitingHoldings.length ? "partial_history" : "complete",
      ...(ratesMissing ? ["treasury_unavailable" as const] : []),
      ...(!benchmark.ok ||
      (benchmark.ok && benchmark.value.sample.returnCount < sample.returnCount)
        ? ["benchmark_partial" as const]
        : []),
    ],
    metadata: {
      version: METHODOLOGY.version,
      engineVersion: METHODOLOGY.engineVersion,
      generatedAt: input.now,
      requestedStartDate: config.requestedStartDate,
      requestedEndDate: config.endDate,
      effectiveStartDate: sessions[0].date,
      effectiveEndDate: sessions.at(-1)!.date,
      limitingHoldings,
      sample,
      cashPolicy: config.cashPolicy,
      warnings: [...new Set(warnings)],
      snapshotHash: snapshotHash({
        config,
        methodology: METHODOLOGY,
        calendar: CALENDAR_VERSION,
        federalCalendar: FEDERAL_CALENDAR_VERSION,
        snapshot,
      }),
      calendarVersion: CALENDAR_VERSION,
      federalCalendarVersion: FEDERAL_CALENDAR_VERSION,
      returnConvention: METHODOLOGY.returnConvention,
      rebalanceConvention: METHODOLOGY.rebalance,
      historicalProviders: [
        ...new Set(input.prices.map((p) => p.provenance.provider)),
      ],
      treasuryProvider: input.treasury?.provenance.provider ?? null,
      currentDataUsed: false,
    },
    snapshot,
  };
}
