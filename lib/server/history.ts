import "server-only";
import type { DataError, HistoricalSeries } from "@/lib/types/data";
import { PROVIDER_POLICY } from "@/config/providers";
import {
  historicalWithFallback,
  validatedSeries,
} from "@/lib/market-data/fallback";
import { microBatcher } from "@/lib/market-data/batch";
import {
  isHistoricalBatch,
  type HistoryRequest,
} from "@/lib/market-data/types";
import { errorResult } from "@/lib/utils/errors";
import type { DataServices } from "./analyze";

/** Adjusted histories for `tickers` over one range, shared by the analysis, Stress
 * Lab and Portfolio Constructor so all three use the same cache keys, TTL and
 * validation. Every ticker is looked up in the process cache (single-flight per
 * key); the misses go upstream together: one batch request when the provider
 * supports batches, otherwise bounded per-ticker fetches. Results and failures are
 * returned in `tickers` order, independent of completion order, so snapshot hashes
 * stay deterministic. A failure is reported per security, never dropped. */
export async function loadHistories(
  data: DataServices,
  tickers: string[],
  start: string,
  end: string,
  now: string,
): Promise<{
  prices: HistoricalSeries[];
  failures: { ticker: string; error: DataError }[];
}> {
  const names = data.history.map((p) => p.name).join("|");
  const key = (t: string) =>
    `history:${names}:${t}:${start}:${end}:USD:adjusted:v1`;
  const primary = data.history.length === 1 ? data.history[0] : null;
  const batched =
    primary && isHistoricalBatch(primary)
      ? microBatcher<HistoryRequest, HistoricalSeries>(
          primary.maxBatch,
          async (requests) =>
            (await primary.getHistoricalBatch(requests)).map((r, k) => {
              if (!r.ok) return r;
              try {
                return {
                  ok: true as const,
                  value: validatedSeries(primary, requests[k], r.value),
                };
              } catch (error) {
                return errorResult<HistoricalSeries>(error);
              }
            }),
        )
      : null;
  const load = (ticker: string) => {
    const request = { ticker, startDate: start, endDate: end, now };
    return batched
      ? batched(request)
      : historicalWithFallback(data.history, request);
  };
  const outcomes = new Map<
    string,
    { ok: true; value: HistoricalSeries } | { ok: false; error: DataError }
  >();
  const fetchOne = async (ticker: string) => {
    try {
      const r = await data.cache.get(
        key(ticker),
        PROVIDER_POLICY.historyTtlMs,
        () => load(ticker),
      );
      outcomes.set(ticker, {
        ok: true,
        value: {
          ...r.value,
          provenance: {
            ...r.value.provenance,
            cacheAgeSeconds:
              r.value.provenance.cacheAgeSeconds + r.ageSeconds,
          },
        },
      });
    } catch (error) {
      const failure = errorResult<HistoricalSeries>(error);
      if (!failure.ok)
        outcomes.set(ticker, {
          ok: false,
          error: { ...failure.error, ticker },
        });
    }
  };
  if (batched) await Promise.all(tickers.map(fetchOne));
  else
    for (let i = 0; i < tickers.length; i += PROVIDER_POLICY.maxConcurrentFetches)
      await Promise.all(
        tickers.slice(i, i + PROVIDER_POLICY.maxConcurrentFetches).map(fetchOne),
      );
  const prices: HistoricalSeries[] = [];
  const failures: { ticker: string; error: DataError }[] = [];
  for (const t of tickers) {
    const o = outcomes.get(t);
    if (!o) continue;
    if (o.ok) prices.push(o.value);
    else failures.push({ ticker: t, error: o.error });
  }
  return { prices, failures };
}
