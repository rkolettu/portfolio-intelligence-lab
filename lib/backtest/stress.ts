import { METHODOLOGY, STRESS_METHODOLOGY } from "@/config/methodology";
import { STRESS_WINDOWS_VERSION } from "@/config/stressWindows";
import type {
  Metric,
  Sample,
  StressAnalytics,
  StressCoverageIssue,
  StressSnapshot,
  StressTestResult,
  StressWindowDefinition,
} from "@/lib/types/analytics";
import type {
  DataError,
  HistoricalSeries,
  Session,
  TreasurySeries,
} from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { addDays, marketDate } from "@/lib/utils/dates";
import { LabError } from "@/lib/utils/errors";
import { annualizedVolatility } from "@/lib/analytics/risk";
import {
  eventActiveReturn,
  eventHoldingReturns,
  extremeHoldings,
} from "@/lib/analytics/stress";
import { FEDERAL_CALENDAR_VERSION } from "@/lib/treasury-data/normalize";
import { CALENDAR_VERSION } from "./calendar";
import { simulate } from "./engine";
import { snapshotHash } from "./metadata";

export type StressInput = {
  config: PortfolioConfig;
  windows: StressWindowDefinition[];
  prices: HistoricalSeries[];
  treasury: TreasurySeries | null;
  sessions: Session[];
  unavailable: { ticker: string; error: DataError }[];
  now: string;
};

const na = (reason: string): Metric => ({ available: false, reason });
const ok = (value: number, sample: Sample, notes: string[] = []): Metric => ({
  available: true,
  value,
  sample,
  ...(notes.length ? { notes } : {}),
});
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MISSING_HISTORY = new Set<DataError["code"]>([
  "INSUFFICIENT_HISTORY",
  "TICKER_NOT_FOUND",
]);

/** Every window session must carry an adjusted price. A holding is never shortened
 * into the event, bridged across a gap or replaced; the event is rejected instead. */
function coverageIssue(
  ticker: string,
  windowSessions: readonly Session[],
  prices: readonly HistoricalSeries[],
  unavailable: StressInput["unavailable"],
): StressCoverageIssue | { failed: DataError } | null {
  const source = prices.find((p) => p.ticker === ticker);
  const start = windowSessions[0].date;
  const end = windowSessions.at(-1)!.date;
  if (!source) {
    // Over a historical span, "not found" and "no history" both mean the security
    // has no data there (e.g. it listed later): a coverage gap, not a fault.
    const error = unavailable.find((u) => u.ticker === ticker)?.error;
    if (error && !MISSING_HISTORY.has(error.code)) return { failed: error };
    return {
      ticker,
      firstAvailableDate: null,
      firstTradeDate: null,
      missingSessions: windowSessions.length,
      reason: "No adjusted history was returned for this window.",
    };
  }
  const priced = new Set(source.observations.map((o) => o.date));
  const missing = windowSessions.filter((s) => !priced.has(s.date)).length;
  if (!missing) return null;
  const inside = source.observations.find(
    (o) => o.date >= start && o.date <= end,
  )?.date;
  const firstTrade = source.firstTradeDate;
  const reason =
    firstTrade && firstTrade > start
      ? `Provider-reported first trade ${firstTrade} is after the event start; no earlier history exists to cover the window.`
      : inside === undefined
        ? "No adjusted prices inside this window."
        : inside > start
          ? `Provider history begins ${inside}, after the event start; a provider coverage limit cannot be treated as inception.`
          : `${plural(missing, "scheduled session")} inside the window lack an adjusted price; no return is bridged across the gap.`;
  return {
    ticker,
    firstAvailableDate: inside ?? null,
    firstTradeDate: firstTrade,
    missingSessions: missing,
    reason,
  };
}

function runEvent(
  window: StressWindowDefinition,
  config: PortfolioConfig,
  input: StressInput,
): StressTestResult {
  const today = marketDate(input.now);
  // Today's daily bar is not final: the uniform prior-market-day cutoff applies.
  const windowSessions = input.sessions.filter(
    (s) =>
      s.date >= window.startDate && s.date <= window.endDate && s.date < today,
  );
  const base = {
    id: window.id,
    name: window.name,
    description: window.description,
    kind: window.kind,
    requestedStartDate: window.startDate,
    requestedEndDate: window.endDate,
    startDate: windowSessions[0]?.date ?? null,
    endDate: windowSessions.at(-1)?.date ?? null,
    notes: [] as string[],
  };
  if (windowSessions.length < 2)
    return {
      ...base,
      status: "unavailable",
      reason:
        "The window contains fewer than two completed sessions, so no event return exists.",
    };
  const start = windowSessions[0].date;
  const end = windowSessions.at(-1)!.date;
  if (start !== window.startDate || end !== window.endDate)
    base.notes.push(
      `Requested ${window.startDate} → ${window.endDate}; resolved to the first session on or after the start (${start}) and the last completed session on or before the end (${end}).`,
    );

  const holdings = config.holdings.filter((h) => h.weight > 0);
  const missing: StressCoverageIssue[] = [];
  for (const h of holdings.filter((x) => x.ticker !== "CASH")) {
    const issue = coverageIssue(
      h.ticker,
      windowSessions,
      input.prices,
      input.unavailable,
    );
    if (issue && "failed" in issue)
      return {
        ...base,
        status: "unavailable",
        reason: `${h.ticker}: ${issue.failed.message}`,
      };
    if (issue) missing.push(issue);
  }
  if (missing.length)
    return { ...base, status: "incomplete_coverage", missing };

  const bench = coverageIssue(
    config.benchmark,
    windowSessions,
    input.prices,
    input.unavailable,
  );
  const benchReason = !bench
    ? null
    : "failed" in bench
      ? `Benchmark ${config.benchmark} history unavailable: ${bench.failed.message}`
      : `Benchmark ${config.benchmark}: ${bench.reason} Benchmark and active results are not computed on a shorter window.`;

  let result: ReturnType<typeof simulate>;
  try {
    // The unchanged Phase 1 simulation on the window: target weights at the start
    // close, the first return ending at the next session, monthly closing resets.
    result = simulate({
      config: { ...config, requestedStartDate: start, endDate: end },
      prices: input.prices,
      treasury: input.treasury,
      sessions: input.sessions,
      now: input.now,
      eligibleEndDate: end,
    });
  } catch (error) {
    if (error instanceof LabError)
      return { ...base, status: "unavailable", reason: error.detail.message };
    throw error;
  }
  const sample = result.metadata.sample;
  const perf = result.performance;
  const portfolioReturn = perf.portfolio.cumulativeReturn;
  const path =
    result.benchmark.ok && !benchReason ? result.benchmark.value : null;
  let benchmarkReturn: Metric;
  let benchmarkVolatility: Metric;
  if (benchReason) benchmarkReturn = benchmarkVolatility = na(benchReason);
  else if (!path)
    benchmarkReturn = benchmarkVolatility = na(
      result.benchmark.ok
        ? "Benchmark path unavailable."
        : result.benchmark.error.message,
    );
  else {
    benchmarkReturn =
      result.benchmarkAnalytics.geometric.benchmarkCumulativeReturn;
    const vol = annualizedVolatility(path.intervals.map((i) => i.return));
    benchmarkVolatility = vol.ok
      ? ok(vol.value, sample, vol.notes)
      : na(vol.reason);
  }
  const activeReturn =
    portfolioReturn.available && benchmarkReturn.available
      ? ok(
          eventActiveReturn(portfolioReturn.value, benchmarkReturn.value),
          sample,
          [
            "Portfolio cumulative return minus benchmark cumulative return over the event; a simple difference, not annualized.",
          ],
        )
      : na(
          benchmarkReturn.available
            ? "Portfolio event return unavailable."
            : benchmarkReturn.reason,
        );
  const holdingReturns = eventHoldingReturns(holdings, result.ledger);
  const benchmarkWealth = new Map(
    path?.points.map((p) => [p.date, p.benchmarkWealth]) ?? [],
  );
  return {
    ...base,
    status: "complete",
    sample,
    firstReturnDate: result.ledger[0].date,
    portfolioReturn,
    benchmarkReturn,
    activeReturn,
    maximumDrawdown: perf.risk.maximumDrawdown,
    maximumDrawdownEpisode: perf.maximumDrawdownEpisode,
    portfolioVolatility: perf.risk.volatility,
    benchmarkVolatility,
    holdings: holdingReturns,
    ...extremeHoldings(holdingReturns),
    rebalances: result.ledger.slice(0, -1).filter((r) => r.rebalanced).length,
    path: perf.growth.map((g) => ({
      date: g.date,
      portfolio: g.wealth,
      benchmark: benchmarkWealth.get(g.date) ?? null,
    })),
  };
}

/** Run each stress window independently from the supplied data. Pure: the same
 * input (for example the returned snapshot) reproduces every event and the hash. */
export function runStress(input: StressInput): StressAnalytics {
  const config = parsePortfolio(input.config, marketDate(input.now));
  const snapshot: StressSnapshot = {
    windows: input.windows,
    prices: input.prices,
    treasury: input.treasury,
    sessions: input.sessions,
    unavailable: input.unavailable,
  };
  return {
    methodologyVersion: STRESS_METHODOLOGY.version,
    windowsVersion: STRESS_WINDOWS_VERSION,
    config,
    benchmark: config.benchmark,
    events: input.windows.map((w) => runEvent(w, config, input)),
    metadata: {
      generatedAt: input.now,
      snapshotHash: snapshotHash({
        config,
        methodology: METHODOLOGY,
        stress: STRESS_METHODOLOGY,
        windows: STRESS_WINDOWS_VERSION,
        calendar: CALENDAR_VERSION,
        federalCalendar: FEDERAL_CALENDAR_VERSION,
        snapshot,
      }),
      engineMethodologyVersion: METHODOLOGY.version,
      calendarVersion: CALENDAR_VERSION,
      federalCalendarVersion: FEDERAL_CALENDAR_VERSION,
      historicalProviders: [
        ...new Set(input.prices.map((p) => p.provenance.provider)),
      ],
      treasuryProvider: input.treasury?.provenance.provider ?? null,
      warnings: [
        ...new Set([
          "Each event re-initializes at target weights on its start-session close; no result depends on another backtest's drifted weights.",
          "Results are gross of transaction costs, taxes, and trading frictions.",
          "Today's configured holdings are applied retrospectively to historical windows; selection and survivorship bias can apply.",
          "Holding returns are each holding's standalone compounded return, not its contribution to the portfolio.",
          ...input.prices.flatMap((p) => p.provenance.warnings),
          ...(input.treasury?.provenance.warnings ?? []),
        ]),
      ],
      currentDataUsed: false,
    },
    snapshot,
  };
}

/** Keep only what the windows use: prices on window sessions, Treasury observations
 * from a context span before each window, and window sessions plus the next session
 * (which decides whether the final close was a month-end reset). Running on the
 * trimmed data reproduces the untrimmed events. */
export function trimStressSnapshot(input: {
  windows: readonly StressWindowDefinition[];
  prices: readonly HistoricalSeries[];
  treasury: TreasurySeries | null;
  sessions: readonly Session[];
}): Pick<StressSnapshot, "prices" | "treasury" | "sessions"> {
  const inWindow = (date: string) =>
    input.windows.some((w) => date >= w.startDate && date <= w.endDate);
  const nextAfter = new Set(
    input.windows
      .map((w) => input.sessions.find((s) => s.date > w.endDate)?.date)
      .filter((d): d is string => !!d),
  );
  const context = STRESS_METHODOLOGY.treasuryContextDays;
  return {
    prices: input.prices.map((p) => ({
      ...p,
      observations: p.observations.filter((o) => inWindow(o.date)),
    })),
    treasury: input.treasury && {
      ...input.treasury,
      observations: input.treasury.observations.filter((o) =>
        input.windows.some(
          (w) =>
            o.date >= addDays(w.startDate, -context) && o.date <= w.endDate,
        ),
      ),
    },
    sessions: input.sessions.filter(
      (s) => inWindow(s.date) || nextAfter.has(s.date),
    ),
  };
}
