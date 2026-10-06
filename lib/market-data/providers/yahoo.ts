import "server-only";
import { z } from "zod";
import type { CurrentQuote, HistoricalSeries } from "@/lib/types/data";
import type {
  HistoryRequest,
  HistoricalProvider,
  QuoteProvider,
} from "../types";
import { normalizePrices } from "../normalize";
import { quoteFromObservation } from "../quoteObservation";
import { addDays, marketDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
import { fetchPublic, type Fetcher } from "@/lib/server/http";
import { symbolSchema } from "@/lib/validation/symbols";
const chartSchema = z.object({
  chart: z.object({
    error: z.unknown().nullable(),
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            currency: z.string(),
            exchangeName: z.string(),
            exchangeTimezoneName: z.string(),
            instrumentType: z.string(),
            firstTradeDate: z.number().optional(),
            regularMarketPrice: z.number().optional(),
            regularMarketTime: z.number().optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            adjclose: z
              .array(z.object({ adjclose: z.array(z.number().nullable()) }))
              .optional(),
            quote: z
              .array(
                z.object({
                  close: z.array(z.number().nullable()),
                  volume: z.array(z.number().nullable()).optional(),
                }),
              )
              .optional(),
          }),
        }),
      )
      .nullable(),
  }),
});
const EXCHANGES = ["PCX", "NMS", "NGM", "NCM", "NYQ", "ASE", "BTS", "BATS"];
/** OTC Markets tiers as Yahoo names them: OTCQX, OTCQB, Pink and OTC ID. Large
 * foreign issuers (Nestlé, Roche, Tencent) trade in the U.S. only here. */
export const OTC_EXCHANGES = ["OQX", "OQB", "PNK", "OID"];
/** An OTC history is refused when more than this share of its sessions (and
 * more than STALE_MIN_SESSIONS) had no trades: Yahoo repeats the last price on
 * those days, which would understate volatility and correlation. Matches the
 * market-data service. */
const STALE_SHARE = 0.1;
const STALE_MIN_SESSIONS = 5;

export function parseYahoo(payload: unknown, ticker: string) {
  const parsed = chartSchema.safeParse(payload);
  if (!parsed.success)
    fail("MALFORMED_DATA", "Yahoo returned an unexpected chart schema.", {
      ticker,
    });
  if (parsed.data.chart.error || !parsed.data.chart.result?.length)
    fail("TICKER_NOT_FOUND", `No history found for ${ticker}.`, { ticker });
  const result = parsed.data.chart.result[0];
  if (
    result.meta.symbol !== ticker ||
    result.meta.currency !== "USD" ||
    result.meta.exchangeTimezoneName !== "America/New_York" ||
    !["EQUITY", "ETF"].includes(result.meta.instrumentType) ||
    ![...EXCHANGES, ...OTC_EXCHANGES].includes(result.meta.exchangeName)
  )
    fail(
      "UNSUPPORTED_ASSET",
      `${ticker} is outside the supported USD U.S.-traded equity/ETF universe.`,
      { ticker },
    );
  return result;
}
export class YahooProvider implements HistoricalProvider, QuoteProvider {
  readonly name = "Yahoo Finance (unofficial chart)";
  readonly convention = "total_return_aware_adjusted" as const;
  constructor(private fetcher: Fetcher = fetch) {}
  private async chart(ticker: string, query: URLSearchParams, ttl: number) {
    const valid = symbolSchema.parse(ticker);
    const response = await fetchPublic(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(valid)}?${query}`,
      ttl,
      this.fetcher,
      undefined,
      [400],
    );
    if (response.status === 400) {
      // Observed: a range entirely before listing is a 400 "Data doesn't exist
      // for startDate = …". That is missing history, not a provider fault.
      const body: unknown = await response.json().catch(() => null);
      const description = z
        .object({
          chart: z.object({ error: z.object({ description: z.string() }) }),
        })
        .safeParse(body).data?.chart.error.description;
      if (description?.startsWith("Data doesn't exist"))
        fail(
          "INSUFFICIENT_HISTORY",
          `${valid} has no history in the requested range; it may have listed later.`,
          { ticker: valid },
        );
      fail("PROVIDER_ERROR", "Provider returned HTTP 400.", {
        ticker: valid,
        retryable: true,
      });
    }
    return {
      data: parseYahoo(await response.json(), valid),
      responseDate: response.headers.get("date"),
    };
  }
  async getHistoricalPrices(
    request: HistoryRequest,
  ): Promise<HistoricalSeries> {
    const { ticker, startDate, endDate, now } = request;
    const query = new URLSearchParams({
      period1: String(
        Date.parse(`${addDays(startDate, -10)}T00:00:00Z`) / 1000,
      ),
      period2: String(Date.parse(`${addDays(endDate, 1)}T00:00:00Z`) / 1000),
      interval: "1d",
      events: "div,splits",
      includeAdjustedClose: "true",
    });
    const { data, responseDate } = await this.chart(ticker, query, 3600);
    const timestamps = data.timestamp ?? [];
    const adjusted = data.indicators.adjclose?.[0]?.adjclose;
    if (!adjusted || adjusted.length !== timestamps.length)
      fail(
        "MALFORMED_DATA",
        "Adjusted history is missing; raw close cannot replace it.",
        { ticker },
      );
    const today = marketDate(now);
    const volume = OTC_EXCHANGES.includes(data.meta.exchangeName)
      ? data.indicators.quote?.[0]?.volume
      : undefined;
    let untraded = 0;
    const observations = normalizePrices(
      timestamps.flatMap((ts, i) => {
        const date = marketDate(new Date(ts * 1000).toISOString());
        // Yahoo daily bars may be partial today. Only prior-market-day bars are eligible.
        if (date >= today || date > endDate) return [];
        if (adjusted[i] === null) return []; // Coverage checks must reject missing scheduled observations.
        if (date >= startDate && volume?.[i] === 0) untraded++;
        return [{ date, adjustedClose: adjusted[i]! }];
      }),
    );
    const inWindow = observations.filter((o) => o.date >= startDate).length;
    if (untraded > Math.max(STALE_MIN_SESSIONS, STALE_SHARE * inWindow))
      fail(
        "UNSUPPORTED_ASSET",
        `${ticker} trades over the counter too thinly for daily analysis: ${untraded} of ${inWindow} sessions in this period had no trades, so its prices are stale.`,
        { ticker },
      );
    const fetchedAt =
      responseDate && Number.isFinite(Date.parse(responseDate))
        ? new Date(responseDate).toISOString()
        : now;
    return {
      ticker,
      currency: "USD",
      exchange: data.meta.exchangeName,
      instrument: data.meta.instrumentType as "EQUITY" | "ETF",
      convention: this.convention,
      firstTradeDate: data.meta.firstTradeDate
        ? marketDate(new Date(data.meta.firstTradeDate * 1000).toISOString())
        : null,
      observations,
      provenance: {
        provider: this.name,
        fetchedAt,
        lastSuccessfulRefresh: fetchedAt,
        cacheAgeSeconds: Math.max(
          0,
          (Date.parse(now) - Date.parse(fetchedAt)) / 1000,
        ),
        observationDate: observations.at(-1)?.date ?? null,
        fallbackUsed: false,
        warnings: [
          "Unofficial provider; adjusted-close ratios are a total-return-aware proxy.",
          "Current-market-day bars excluded pending finalization.",
        ],
      },
    };
  }
  async getCurrentQuote(ticker: string, now: string): Promise<CurrentQuote> {
    const { data, responseDate } = await this.chart(
      ticker,
      new URLSearchParams({
        range: "5d",
        interval: "1d",
        includeAdjustedClose: "true",
      }),
      60,
    );
    const fetchedAt =
      responseDate && Number.isFinite(Date.parse(responseDate))
        ? new Date(responseDate).toISOString()
        : now;
    const closes = data.indicators.quote?.[0]?.close ?? [];
    return quoteFromObservation(
      {
        ticker,
        provider: this.name,
        fetchedAt,
        regularMarketPrice: data.meta.regularMarketPrice,
        regularMarketTime:
          data.meta.regularMarketTime !== undefined
            ? new Date(data.meta.regularMarketTime * 1000).toISOString()
            : null,
        recentCloses: (data.timestamp ?? []).map((ts, i) => ({
          date: marketDate(new Date(ts * 1000).toISOString()),
          close: closes[i] ?? null,
        })),
      },
      now,
    );
  }
}
