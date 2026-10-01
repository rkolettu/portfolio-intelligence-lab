import "server-only";
import type { BacktestResult } from "@/lib/types/analytics";
import type {
  CurrentQuote,
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
import {
  FallbackTreasuryProvider,
  TreasuryGovProvider,
} from "@/lib/treasury-data/treasuryGov";
import { DataCache } from "./cache";
import { PROVIDER_POLICY } from "@/config/providers";
import {
  assertQualified,
  configuredMarketDataService,
  deployedHistoryProviders,
  deployedQuoteProvider,
} from "@/config/deployed-providers";
import { isQuoteBatch } from "@/lib/market-data/types";
import { microBatcher } from "@/lib/market-data/batch";
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
import { loadHistories } from "./history";
export type DataServices = {
  history: HistoricalProvider[];
  quotes: QuoteProvider | null;
  treasury: TreasuryProvider;
  cache: DataCache;
};
const yahoo = new YahooProvider();
// Precedence: the configured market-data service (deployments, and local runs that
// point at it); else the direct Yahoo adapter for local research only; else any
// registered provider. On Vercel without the service, equity history is unavailable.
const marketDataService = configuredMarketDataService();
export const services: DataServices = {
  history: marketDataService
    ? [marketDataService]
    : PROVIDER_POLICY.yahooEnabled
      ? [yahoo]
      : deployedHistoryProviders.map(assertQualified),
  quotes: marketDataService
    ? marketDataService
    : PROVIDER_POLICY.yahooEnabled
      ? yahoo
      : deployedQuoteProvider && assertQualified(deployedQuoteProvider),
  treasury: new FallbackTreasuryProvider(
    new FredProvider(),
    new TreasuryGovProvider(),
  ),
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
    const { prices, failures } = await loadHistories(
      data,
      tickers,
      config.requestedStartDate,
      end,
      now,
    );
    // A risky holding that fails ends the analysis with its exact failure; it is
    // never silently removed. A benchmark failure leaves the benchmark unavailable.
    const failed = failures.find((f) => risky.includes(f.ticker));
    if (failed) return { ok: false, error: failed.error };
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
  // 20 risky holdings, CASH and the benchmark.
  if (!Array.isArray(tickers) || tickers.length > 22)
    fail("INVALID_INPUT", "Request at most 22 current quotes.");
  const normalized = [
    ...new Set(tickers.map((t) => symbolSchema.parse(t))),
  ].filter((t) => t !== "CASH");
  const output: Result<CurrentQuote>[] = [];
  const provider = data.quotes;
  // One upstream request for every uncached quote when the provider batches.
  const batched =
    provider && isQuoteBatch(provider)
      ? microBatcher<string, CurrentQuote>(provider.maxBatch, (tickers) =>
          provider.getCurrentQuotes(tickers, now),
        )
      : null;
  const step = batched ? normalized.length || 1 : 4;
  for (let offset = 0; offset < normalized.length; offset += step) {
    const batch = await Promise.all(
      normalized.slice(offset, offset + step).map(async (ticker) => {
        try {
          if (!data.quotes)
            fail("UNQUALIFIED_PROVIDER", "Current quotes are unavailable.", {
              ticker,
            });
          const r = await data.cache.get(
            `quote:${data.quotes.name}:${ticker}:v1`,
            PROVIDER_POLICY.quoteTtlMs,
            () =>
              batched ? batched(ticker) : data.quotes!.getCurrentQuote(ticker, now),
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
