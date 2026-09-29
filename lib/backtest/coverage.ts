import type { DataCoverage, HistoricalSeries, Session } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { normalizePrices } from "@/lib/market-data/normalize";
import { fail } from "@/lib/utils/errors";
export function portfolioCoverage(
  config: PortfolioConfig,
  prices: HistoricalSeries[],
  sessions: Session[],
) {
  const requested = sessions.filter(
    (s) => s.date >= config.requestedStartDate && s.date <= config.endDate,
  );
  if (requested.length < 2)
    fail(
      "INSUFFICIENT_HISTORY",
      "At least two completed sessions are required.",
    );
  let start = requested[0].date;
  const coverage: DataCoverage[] = [];
  for (const holding of config.holdings.filter(
    (h) => h.weight > 0 && h.ticker !== "CASH",
  )) {
    const source = prices.find((p) => p.ticker === holding.ticker);
    if (!source)
      fail("TICKER_NOT_FOUND", `No history for ${holding.ticker}.`, {
        ticker: holding.ticker,
        retryable: true,
      });
    if (
      source.currency !== "USD" ||
      source.convention !== "total_return_aware_adjusted"
    )
      fail("MALFORMED_DATA", "Incompatible price convention.", {
        ticker: holding.ticker,
      });
    const observations = normalizePrices(source.observations).filter(
      (p) => p.date <= config.endDate,
    );
    const first = observations[0]?.date;
    const last = observations.at(-1)?.date;
    if (!first || !last)
      fail("INSUFFICIENT_HISTORY", `No valid history for ${holding.ticker}.`, {
        ticker: holding.ticker,
      });
    if (first > requested[0].date && source.firstTradeDate !== first)
      fail(
        "COVERAGE_GAP",
        `Unexplained leading gap for ${holding.ticker}; provider coverage cannot be called inception.`,
        { ticker: holding.ticker, retryable: true },
      );
    start = first > start ? first : start;
    coverage.push({
      ticker: holding.ticker,
      firstAvailableDate: first,
      lastAvailableDate: last,
      observationCount: observations.filter(
        (p) => p.date >= config.requestedStartDate,
      ).length,
      status: first > requested[0].date ? "partial" : "complete",
      startReason:
        first > requested[0].date ? "provider_reported_first_trade" : undefined,
      missingDates: [],
    });
  }
  const effective = requested.filter((s) => s.date >= start);
  if (effective.length < 2)
    fail(
      "INSUFFICIENT_HISTORY",
      "Fewer than two sessions remain after coverage alignment.",
    );
  for (const item of coverage) {
    const dates = new Set(
      prices
        .find((p) => p.ticker === item.ticker)!
        .observations.map((p) => p.date),
    );
    const missing = effective
      .filter((s) => !dates.has(s.date))
      .map((s) => s.date);
    if (missing.length)
      fail(
        "COVERAGE_GAP",
        `${item.ticker} is missing scheduled observations; no return is bridged across the gap.`,
        { ticker: item.ticker, dates: missing, retryable: true },
      );
  }
  return {
    sessions: effective,
    coverage,
    limitingHoldings: coverage
      .filter(
        (c) =>
          c.firstAvailableDate === effective[0].date &&
          effective[0].date > requested[0].date,
      )
      .map((c) => c.ticker),
  };
}
