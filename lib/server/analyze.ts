import "server-only";
import type { BacktestResult } from "@/lib/types/analytics";
import type {
  CurrentQuote,
  HistoricalSeries,
  Result,
  TreasuryCurve,
  TreasurySeries,
} from "@/lib/types/data";
import type {
  HistoricalProvider,
  QuoteProvider,
} from "@/lib/market-data/types";
import type { TreasuryProvider } from "@/lib/treasury-data/types";
import { YahooProvider } from "@/lib/market-data/providers/yahoo";
import { FredProvider } from "@/lib/treasury-data/historical";
import { historicalWithFallback } from "@/lib/market-data/fallback";
import { DataCache } from "./cache";
import { PROVIDER_POLICY } from "@/config/providers";
import {
  assertQualified,
  deployedHistoryProviders,
  deployedQuoteProvider,
} from "@/config/deployed-providers";
import { refreshQuoteFreshness } from "@/lib/market-data/quotes";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { symbolSchema } from "@/lib/validation/symbols";
import { addDays, marketDate } from "@/lib/utils/dates";
import { errorResult, fail } from "@/lib/utils/errors";
import {
  CALENDAR_COVERAGE,
  nextCloseAfter,
  sessionsBetween,
} from "@/lib/backtest/calendar";
import { simulate } from "@/lib/backtest/engine";
export type DataServices = {
  history: HistoricalProvider[];
  quotes: QuoteProvider | null;
  treasury: TreasuryProvider;
  cache: DataCache;
};
const yahoo = new YahooProvider();
export const services: DataServices = {
  history: PROVIDER_POLICY.yahooEnabled
    ? [yahoo]
    : deployedHistoryProviders.map(assertQualified),
  quotes: PROVIDER_POLICY.yahooEnabled
    ? yahoo
    : deployedQuoteProvider && assertQualified(deployedQuoteProvider),
  treasury: new FredProvider(),
  cache: new DataCache(),
};
export async function analyze(
  input: unknown,
  now: string,
  data: DataServices = services,
): Promise<Result<BacktestResult>> {
  try {
    const config = parsePortfolio(input, marketDate(now));
    const risky = config.holdings
      .filter((h) => h.weight > 0 && h.ticker !== "CASH")
      .map((h) => h.ticker);
    if (!data.history.length && risky.length)
      fail(
        "UNQUALIFIED_PROVIDER",
        "Historical equity data is not available in this deployment: no market-data provider has been qualified for it yet. CASH-only portfolios still run.",
      );
    // Uniform prior-market-day cutoff: Yahoo's same-day chart bar is not qualified final data.
    const end =
      config.endDate < marketDate(now)
        ? config.endDate
        : addDays(marketDate(now), -1);
    const lookahead = addDays(end, 7);
    const fullCalendar = sessionsBetween(
      config.requestedStartDate,
      lookahead < CALENDAR_COVERAGE.end ? lookahead : CALENDAR_COVERAGE.end,
      "2100-01-01T00:00:00Z",
    );
    const tickers = [...new Set([...risky, config.benchmark])];
    const prices: HistoricalSeries[] = [];
    const failures = new Map<string, Result<HistoricalSeries>>();
    const rateWork = data.cache
      .get(
        `fred:DGS3MO:${config.requestedStartDate}:${end}:v1`,
        PROVIDER_POLICY.treasuryTtlMs,
        () =>
          data.treasury.getHistoricalRates(config.requestedStartDate, end, now),
      )
      .then((r) => ({
        ...r.value,
        provenance: {
          ...r.value.provenance,
          cacheAgeSeconds: r.value.provenance.cacheAgeSeconds + r.ageSeconds,
        },
      }))
      .catch(() => null);
    for (
      let offset = 0;
      offset < tickers.length;
      offset += PROVIDER_POLICY.maxConcurrentFetches
    ) {
      const batch = await Promise.all(
        tickers
          .slice(offset, offset + PROVIDER_POLICY.maxConcurrentFetches)
          .map(async (ticker) => {
            try {
              const result = await data.cache.get(
                `history:${data.history.map((p) => p.name).join("|")}:${ticker}:${config.requestedStartDate}:${end}:USD:adjusted:v1`,
                PROVIDER_POLICY.historyTtlMs,
                () =>
                  historicalWithFallback(data.history, {
                    ticker,
                    startDate: config.requestedStartDate,
                    endDate: end,
                    now,
                  }),
              );
              return {
                ok: true as const,
                value: {
                  ...result.value,
                  provenance: {
                    ...result.value.provenance,
                    cacheAgeSeconds:
                      result.value.provenance.cacheAgeSeconds +
                      result.ageSeconds,
                  },
                },
              };
            } catch (error) {
              const failure = errorResult<HistoricalSeries>(error);
              failures.set(ticker, failure);
              return failure;
            }
          }),
      );
      for (const item of batch) if (item.ok) prices.push(item.value);
    }
    for (const ticker of risky) {
      const failure = failures.get(ticker);
      if (failure && !failure.ok)
        return { ok: false, error: { ...failure.error, ticker } };
    }
    const treasury: TreasurySeries | null = await rateWork;
    const result = simulate({
      config,
      prices,
      treasury,
      sessions: fullCalendar,
      now,
      eligibleEndDate: end,
    });
    if (config.endDate !== end)
      result.metadata.warnings.push(
        "Today’s historical bar is excluded until the next market date; current quotes remain separate.",
      );
    return { ok: true, value: result };
  } catch (error) {
    return errorResult(error);
  }
}
export async function currentQuotes(
  tickers: unknown,
  now: string,
  data: DataServices = services,
): Promise<Result<CurrentQuote>[]> {
  if (!Array.isArray(tickers) || tickers.length > 21)
    fail("INVALID_INPUT", "Request at most 21 current quotes.");
  const normalized = [
    ...new Set(tickers.map((t) => symbolSchema.parse(t))),
  ].filter((t) => t !== "CASH");
  const output: Result<CurrentQuote>[] = [];
  for (let offset = 0; offset < normalized.length; offset += 4) {
    const batch = await Promise.all(
      normalized.slice(offset, offset + 4).map(async (ticker) => {
        try {
          if (!data.quotes)
            fail("UNQUALIFIED_PROVIDER", "Current quotes are unavailable.", {
              ticker,
            });
          const r = await data.cache.get(
            `quote:${data.quotes.name}:${ticker}:v1`,
            PROVIDER_POLICY.quoteTtlMs,
            () => data.quotes!.getCurrentQuote(ticker, now),
          );
          // Re-derived per read from the immutable cached value; never mutate it.
          const fresh = refreshQuoteFreshness(
            {
              ...r.value,
              staleAfter: nextCloseAfter(r.value.marketTimestamp),
            },
            now,
          );
          return {
            ok: true as const,
            value: {
              ...fresh,
              provenance: {
                ...fresh.provenance,
                cacheAgeSeconds:
                  r.value.provenance.cacheAgeSeconds + r.ageSeconds,
              },
            },
          };
        } catch (error) {
          const r = errorResult<CurrentQuote>(error);
          return r.ok ? r : { ...r, error: { ...r.error, ticker } };
        }
      }),
    );
    output.push(...batch);
  }
  return output;
}
export async function currentTreasury(
  now: string,
  data: DataServices = services,
): Promise<Result<TreasuryCurve>> {
  try {
    const r = await data.cache.get(
      "fred:current-curve:v1",
      PROVIDER_POLICY.treasuryTtlMs,
      () => data.treasury.getCurrentCurve(now),
    );
    return {
      ok: true,
      value: {
        ...r.value,
        provenance: {
          ...r.value.provenance,
          cacheAgeSeconds: r.value.provenance.cacheAgeSeconds + r.ageSeconds,
        },
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}
