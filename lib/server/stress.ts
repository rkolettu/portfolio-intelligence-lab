import "server-only";
import { z } from "zod";
import type { StressAnalytics } from "@/lib/types/analytics";
import type {
  DataError,
  HistoricalSeries,
  Result,
  TreasurySeries,
} from "@/lib/types/data";
import { STRESS_WINDOWS } from "@/config/stressWindows";
import { PROVIDER_POLICY } from "@/config/providers";
import { historicalWithFallback } from "@/lib/market-data/fallback";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { customStressWindow } from "@/lib/validation/stress";
import { addDays, marketDate } from "@/lib/utils/dates";
import { errorResult, fail } from "@/lib/utils/errors";
import { CALENDAR_COVERAGE, sessionsBetween } from "@/lib/backtest/calendar";
import { runStress, trimStressSnapshot } from "@/lib/backtest/stress";
import { services, type DataServices } from "./analyze";

const request = z
  .object({
    config: z.unknown(),
    window: z
      .object({ startDate: z.string(), endDate: z.string() })
      .strict()
      .optional(),
  })
  .strict();

/** Historical stress events for a portfolio, independent of the analysis request:
 * the three fixed windows by default, or one validated Custom Historical Window.
 * Every security is fetched once over the span covering the requested windows (the
 * preset span is fixed, so its cache keys are shared across portfolios). A failed
 * fetch is recorded per security and judged per event, never failing the request. */
export async function stress(
  input: unknown,
  now: string,
  data: DataServices = services,
): Promise<Result<StressAnalytics>> {
  try {
    const parsed = request.safeParse(input);
    if (!parsed.success)
      fail(
        "INVALID_INPUT",
        "A stress request contains a portfolio configuration and an optional custom window.",
      );
    const today = marketDate(now);
    const config = parsePortfolio(parsed.data.config, today);
    const windows = parsed.data.window
      ? [
          customStressWindow(
            parsed.data.window.startDate,
            parsed.data.window.endDate,
            today,
          ),
        ]
      : [...STRESS_WINDOWS];
    const risky = config.holdings
      .filter((h) => h.weight > 0 && h.ticker !== "CASH")
      .map((h) => h.ticker);
    if (!data.history.length && risky.length)
      fail(
        "UNQUALIFIED_PROVIDER",
        "Historical equity data is not available in this deployment: no market-data provider has been qualified for it yet. CASH-only portfolios still run.",
      );
    const start = windows.map((w) => w.startDate).sort()[0];
    const requestedEnd = windows
      .map((w) => w.endDate)
      .sort()
      .at(-1)!;
    // Uniform prior-market-day cutoff, as in the analysis.
    const yesterday = addDays(today, -1);
    const end = requestedEnd < today ? requestedEnd : yesterday;
    const lookahead = addDays(end, 7);
    const sessions = sessionsBetween(
      start,
      lookahead < CALENDAR_COVERAGE.end ? lookahead : CALENDAR_COVERAGE.end,
      "2100-01-01T00:00:00Z",
    );
    const tickers = [...new Set([...risky, config.benchmark])];
    const prices: HistoricalSeries[] = [];
    const unavailable: { ticker: string; error: DataError }[] = [];
    const cash = config.holdings.some(
      (h) => h.ticker === "CASH" && h.weight > 0,
    );
    const rateWork: Promise<TreasurySeries | null> = cash
      ? data.cache
          .get(
            `fred:DGS3MO:${start}:${end}:v1`,
            PROVIDER_POLICY.treasuryTtlMs,
            () => data.treasury.getHistoricalRates(start, end, now),
          )
          .then((r) => ({
            ...r.value,
            provenance: {
              ...r.value.provenance,
              cacheAgeSeconds:
                r.value.provenance.cacheAgeSeconds + r.ageSeconds,
            },
          }))
          .catch(() => null)
      : Promise.resolve(null);
    for (
      let offset = 0;
      offset < tickers.length;
      offset += PROVIDER_POLICY.maxConcurrentFetches
    ) {
      await Promise.all(
        tickers
          .slice(offset, offset + PROVIDER_POLICY.maxConcurrentFetches)
          .map(async (ticker) => {
            try {
              const r = await data.cache.get(
                `history:${data.history.map((p) => p.name).join("|")}:${ticker}:${start}:${end}:USD:adjusted:v1`,
                PROVIDER_POLICY.historyTtlMs,
                () =>
                  historicalWithFallback(data.history, {
                    ticker,
                    startDate: start,
                    endDate: end,
                    now,
                  }),
              );
              prices.push({
                ...r.value,
                provenance: {
                  ...r.value.provenance,
                  cacheAgeSeconds:
                    r.value.provenance.cacheAgeSeconds + r.ageSeconds,
                },
              });
            } catch (error) {
              const failure = errorResult<HistoricalSeries>(error);
              if (!failure.ok)
                unavailable.push({
                  ticker,
                  error: { ...failure.error, ticker },
                });
            }
          }),
      );
    }
    // Deterministic order for the snapshot hash, independent of fetch completion.
    prices.sort(
      (a, b) => tickers.indexOf(a.ticker) - tickers.indexOf(b.ticker),
    );
    unavailable.sort(
      (a, b) => tickers.indexOf(a.ticker) - tickers.indexOf(b.ticker),
    );
    const treasury = await rateWork;
    const trimmed = trimStressSnapshot({ windows, prices, treasury, sessions });
    return {
      ok: true,
      value: runStress({ config, windows, ...trimmed, unavailable, now }),
    };
  } catch (error) {
    return errorResult(error);
  }
}
