import "server-only";
import { z } from "zod";
import type { CurrentQuote, HistoricalSeries } from "@/lib/types/data";
import type {
  HistoryRequest,
  HistoricalProvider,
  QuoteProvider,
} from "../types";
import { normalizePrices } from "../normalize";
import { normalizeQuote, preferRecentQuote } from "../quotes";
import { sessionsBetween } from "@/lib/backtest/calendar";
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
              .array(z.object({ close: z.array(z.number().nullable()) }))
              .optional(),
          }),
        }),
      )
      .nullable(),
  }),
});
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
    !["PCX", "NMS", "NGM", "NCM", "NYQ", "ASE", "BTS", "BATS"].includes(
      result.meta.exchangeName,
    )
  )
    fail(
      "UNSUPPORTED_ASSET",
      `${ticker} is outside the supported USD U.S.-listed equity/ETF universe.`,
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
    );
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
    const observations = normalizePrices(
      timestamps.flatMap((ts, i) => {
        const date = marketDate(new Date(ts * 1000).toISOString());
        // Yahoo daily bars may be partial today. Only prior-market-day bars are eligible.
        if (date >= today || date > endDate) return [];
        if (adjusted[i] === null) return []; // Coverage checks must reject missing scheduled observations.
        return [{ date, adjustedClose: adjusted[i]! }];
      }),
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
    const current =
      data.meta.regularMarketPrice !== undefined &&
      data.meta.regularMarketTime !== undefined
        ? normalizeQuote(
            {
              ticker,
              price: data.meta.regularMarketPrice,
              marketTimestamp: new Date(
                data.meta.regularMarketTime * 1000,
              ).toISOString(),
              fetchedAt,
              provider: this.name,
              session: "regular",
            },
            now,
          )
        : null;
    const closes = data.indicators.quote?.[0]?.close ?? [];
    const candidates = (data.timestamp ?? []).flatMap((ts, i) => {
      const date = marketDate(new Date(ts * 1000).toISOString());
      const price = closes[i];
      if (
        date >= marketDate(now) ||
        price === null ||
        price === undefined ||
        price <= 0
      )
        return [];
      const session = sessionsBetween(date, date, now)[0];
      return session
        ? [
            normalizeQuote(
              {
                ticker,
                price,
                marketTimestamp: session.close,
                fetchedAt,
                provider: this.name,
                session: "regular",
                claimedStatus: "end_of_day",
              },
              now,
            ),
          ]
        : [];
    });
    const close = candidates
      .sort((a, b) => a.marketTimestamp.localeCompare(b.marketTimestamp))
      .at(-1);
    // chartPreviousClose can mean start-of-range close, so day change remains unavailable.
    if (current && close) {
      const chosen = preferRecentQuote(current, close);
      if (chosen === close && current.marketTimestamp !== close.marketTimestamp)
        chosen.provenance = {
          ...chosen.provenance,
          fallbackUsed: true,
          fallbackReason: "Current quote was older than finalized raw close.",
        };
      return chosen;
    }
    if (current) return current;
    if (close) {
      close.provenance = {
        ...close.provenance,
        fallbackUsed: true,
        fallbackReason:
          "Current quote unavailable; latest finalized raw close used.",
      };
      return close;
    }
    fail(
      "PROVIDER_ERROR",
      "No current or finalized raw closing quote is available.",
      { ticker, retryable: true },
    );
  }
}
