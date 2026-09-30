import "server-only";
import { z } from "zod";
import type {
  CurrentQuote,
  DataError,
  ErrorCode,
  HistoricalSeries,
  Result,
} from "@/lib/types/data";
import type {
  HistoricalBatchProvider,
  HistoryRequest,
  QuoteBatchProvider,
} from "../types";
import { quoteFromObservation } from "../quoteObservation";
import { addDays, marketDate } from "@/lib/utils/dates";
import { errorResult, fail, LabError } from "@/lib/utils/errors";

/** Portfolio Lab's side of its Market Data API (portfolio-lab-market-data on
 * Render). The browser
 * never calls the service: only these server routes do, with the shared secret in
 * `X-Portfolio-Lab-Service-Key`. The service returns provider-neutral normalized
 * records; everything upstream-specific (today: Yahoo via yfinance) stays behind
 * it, and all finance calculations stay here in the TypeScript engine. */
export type MarketDataServiceConfig = { url: string; key: string };

export const SERVICE_KEY_HEADER = "X-Portfolio-Lab-Service-Key";
const HISTORY_TIMEOUT_MS = 50_000; // inside the routes' 60 s maxDuration
const QUOTE_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 64_000_000;

const CODES = [
  "INVALID_INPUT",
  "TICKER_NOT_FOUND",
  "PROVIDER_ERROR",
  "PERMISSION",
  "RATE_LIMIT",
  "TIMEOUT",
  "MALFORMED_DATA",
  "COVERAGE_GAP",
  "INSUFFICIENT_HISTORY",
  "TREASURY_UNAVAILABLE",
  "UNSUPPORTED_ASSET",
  "UNQUALIFIED_PROVIDER",
] as const satisfies readonly ErrorCode[];
const errorSchema = z.object({
  code: z.enum(CODES).catch("PROVIDER_ERROR"),
  message: z.string().max(500),
  retryable: z.boolean(),
  ticker: z.string().optional(),
});
const provenanceSchema = z.object({
  fetchedAt: z.string(),
  lastSuccessfulRefresh: z.string(),
  cacheAgeSeconds: z.number().nonnegative(),
  observationDate: z.string().nullable(),
  stale: z.boolean(),
  staleReason: z.string().optional(),
});
const historySchema = z.object({
  ok: z.literal(true),
  provider: z.object({
    name: z.string(),
    label: z.string(),
    convention: z.literal("total_return_aware_adjusted"),
  }),
  results: z.array(
    z.union([
      z.object({
        ok: z.literal(true),
        ticker: z.string(),
        currency: z.literal("USD"),
        exchange: z.string(),
        instrument: z.enum(["EQUITY", "ETF"]),
        firstTradeDate: z.string().nullable(),
        dates: z.array(z.string()),
        adjustedClose: z.array(z.number()),
        provenance: provenanceSchema,
      }),
      z.object({ ok: z.literal(false), ticker: z.string(), error: errorSchema }),
    ]),
  ),
});
const quoteSchema = z.object({
  ok: z.literal(true),
  provider: z.object({ name: z.string(), label: z.string() }),
  results: z.array(
    z.union([
      z.object({
        ok: z.literal(true),
        ticker: z.string(),
        currency: z.literal("USD"),
        regularMarketPrice: z.number().nullable(),
        regularMarketTime: z.string().nullable(),
        recentCloses: z.array(z.object({ date: z.string(), close: z.number() })),
        retrievedAt: z.string(),
      }),
      z.object({ ok: z.literal(false), ticker: z.string(), error: errorSchema }),
    ]),
  ),
});
const healthSchema = z
  .object({
    status: z.string(),
    circuit: z.object({ state: z.string(), retryAfterSeconds: z.number() }),
    prewarm: z.object({ state: z.string() }).optional(),
    finalSession: z.string().optional(),
  })
  .passthrough();

/** Service configuration from the server environment, or null when absent. The
 * key never reaches client code: this module is server-only. */
export function marketDataServiceConfig(
  env: Record<string, string | undefined>,
): MarketDataServiceConfig | null {
  const url = env.MARKET_DATA_SERVICE_URL?.trim().replace(/\/+$/, "");
  const key = env.MARKET_DATA_SERVICE_KEY?.trim();
  if (!url || !key) return null;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))
    return null; // TLS required except for a local service during development
  if (key.length < 32) return null;
  return { url, key };
}

const requestId = () =>
  `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class MarketDataServiceProvider
  implements HistoricalBatchProvider, QuoteBatchProvider
{
  /** Also the history cache namespace in Portfolio Lab. Names the upstream plainly. */
  readonly name = "Yahoo Finance via yfinance (market-data service)";
  readonly convention = "total_return_aware_adjusted" as const;
  readonly maxBatch = 21; // 20 risky holdings + one benchmark

  constructor(
    private config: MarketDataServiceConfig,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.url}/api/market-data/${path}`, {
        method: init.method,
        headers: {
          [SERVICE_KEY_HEADER]: this.config.key,
          "X-Request-Id": requestId(),
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted)
        fail("TIMEOUT", "The market-data service did not answer in time.", {
          retryable: true,
        });
      fail("PROVIDER_ERROR", "The market-data service could not be reached.", {
        retryable: true,
      });
    }
    try {
      if (response.status === 401 || response.status === 403)
        fail("PERMISSION", "The market-data service rejected this deployment's credentials.");
      if (response.status === 503 && path !== "health")
        fail("UNQUALIFIED_PROVIDER", "The market-data service is not configured.");
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES)
        fail("MALFORMED_DATA", "Market-data response exceeds the data limit.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        fail("PROVIDER_ERROR", `The market-data service returned HTTP ${response.status}.`, {
          retryable: true,
        });
      }
      if (!response.ok) {
        const e = z.object({ error: errorSchema }).safeParse(body);
        if (e.success) throw new LabError(e.data.error as DataError);
        fail("PROVIDER_ERROR", `The market-data service returned HTTP ${response.status}.`, {
          retryable: response.status >= 500,
        });
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof LabError))
        fail("TIMEOUT", "The market-data service did not answer in time.", {
          retryable: true,
        });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getHistoricalBatch(
    requests: HistoryRequest[],
  ): Promise<Result<HistoricalSeries>[]> {
    if (!requests.length) return [];
    const { startDate, endDate, now } = requests[0];
    if (requests.some((r) => r.startDate !== startDate || r.endDate !== endDate))
      fail("INVALID_INPUT", "A market-data batch covers one date range.");
    const today = marketDate(now);
    // The same 10-session lead-in the direct adapter requests.
    const raw = await this.call("history", {
      method: "POST",
      body: {
        tickers: requests.map((r) => r.ticker),
        startDate: addDays(startDate, -10),
        endDate: endDate < today ? endDate : addDays(today, -1),
      },
      timeoutMs: HISTORY_TIMEOUT_MS,
    });
    const parsed = historySchema.safeParse(raw);
    if (!parsed.success)
      fail("MALFORMED_DATA", "The market-data service returned an unexpected schema.", {
        retryable: true,
      });
    const byTicker = new Map(parsed.data.results.map((r) => [r.ticker, r]));
    return requests.map(({ ticker, endDate: end }) => {
      const r = byTicker.get(ticker);
      if (!r)
        return {
          ok: false,
          error: {
            code: "MALFORMED_DATA",
            message: `The market-data service omitted ${ticker}.`,
            ticker,
            retryable: true,
          },
        };
      if (!r.ok) return { ok: false, error: { ...r.error, ticker } };
      if (r.dates.length !== r.adjustedClose.length)
        return errorResult<HistoricalSeries>(
          new LabError({
            code: "MALFORMED_DATA",
            message: `Misaligned history for ${ticker}.`,
            ticker,
            retryable: true,
          }),
        );
      // Same eligibility as the direct adapter: only prior-market-day sessions.
      const observations = r.dates.flatMap((date, i) =>
        date >= today || date > end
          ? []
          : [{ date, adjustedClose: r.adjustedClose[i] }],
      );
      const p = r.provenance;
      return {
        ok: true,
        value: {
          ticker,
          currency: "USD",
          exchange: r.exchange,
          instrument: r.instrument,
          convention: this.convention,
          firstTradeDate: r.firstTradeDate,
          observations,
          provenance: {
            provider: this.name,
            fetchedAt: p.fetchedAt,
            lastSuccessfulRefresh: p.lastSuccessfulRefresh,
            cacheAgeSeconds: p.cacheAgeSeconds,
            observationDate: observations.at(-1)?.date ?? null,
            fallbackUsed: false,
            warnings: [
              "Unofficial provider; adjusted-close ratios are a total-return-aware proxy.",
              "Current-market-day bars excluded pending finalization.",
              ...(p.stale
                ? [
                    `Served from the market-data cache: the upstream refresh failed (${p.staleReason ?? "provider unavailable"}).`,
                  ]
                : []),
            ],
          },
        },
      };
    });
  }

  async getHistoricalPrices(request: HistoryRequest): Promise<HistoricalSeries> {
    const [r] = await this.getHistoricalBatch([request]);
    if (!r.ok) throw new LabError(r.error);
    return r.value;
  }

  async getCurrentQuotes(
    tickers: string[],
    now: string,
  ): Promise<Result<CurrentQuote>[]> {
    const raw = await this.call("quote", {
      method: "POST",
      body: { tickers },
      timeoutMs: QUOTE_TIMEOUT_MS,
    });
    const parsed = quoteSchema.safeParse(raw);
    if (!parsed.success)
      fail("MALFORMED_DATA", "The market-data service returned an unexpected quote schema.", {
        retryable: true,
      });
    const byTicker = new Map(parsed.data.results.map((r) => [r.ticker, r]));
    return tickers.map((ticker) => {
      const r = byTicker.get(ticker);
      if (!r || !r.ok)
        return {
          ok: false as const,
          error: r
            ? { ...r.error, ticker }
            : {
                code: "MALFORMED_DATA" as const,
                message: `The market-data service omitted ${ticker}.`,
                ticker,
                retryable: true,
              },
        };
      try {
        return {
          ok: true as const,
          value: quoteFromObservation(
            {
              ticker,
              provider: this.name,
              fetchedAt: r.retrievedAt,
              regularMarketPrice: r.regularMarketPrice,
              regularMarketTime: r.regularMarketTime,
              recentCloses: r.recentCloses,
            },
            now,
          ),
        };
      } catch (error) {
        const failure = errorResult<CurrentQuote>(error);
        return failure.ok
          ? failure
          : { ok: false as const, error: { ...failure.error, ticker } };
      }
    });
  }

  async getCurrentQuote(ticker: string, now: string): Promise<CurrentQuote> {
    const [r] = await this.getCurrentQuotes([ticker], now);
    if (!r.ok) throw new LabError(r.error);
    return r.value;
  }

  /** Health, waiting up to `waitMs` for a sleeping instance to wake. A free Render
   * instance may hold the request while it boots, refuse connections or answer a
   * brief 502/503; each of those is retried every 2 s until the deadline. A wrong
   * key is final (it will not fix itself by waiting). */
  async health(
    waitMs: number,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<{
    ready: boolean;
    latencyMs: number;
    circuit?: string;
    retryAfterSeconds?: number;
    prewarm?: string;
    finalSession?: string;
  }> {
    const started = Date.now();
    const deadline = started + waitMs;
    for (;;) {
      const remaining = deadline - Date.now();
      try {
        const body = healthSchema.parse(
          await this.call("health", {
            method: "GET",
            timeoutMs: Math.max(1_000, remaining),
          }),
        );
        return {
          ready: true,
          latencyMs: Date.now() - started,
          circuit: body.circuit.state,
          retryAfterSeconds: body.circuit.retryAfterSeconds,
          prewarm: body.prewarm?.state,
          finalSession: body.finalSession,
        };
      } catch (error) {
        const permanent =
          error instanceof LabError && error.detail.code === "PERMISSION";
        if (permanent || Date.now() + 2_000 >= deadline)
          return { ready: false, latencyMs: Date.now() - started };
        await sleep(2_000);
      }
    }
  }
}
