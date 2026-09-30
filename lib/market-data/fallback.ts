import type { HistoricalSeries } from "@/lib/types/data";
import type { HistoricalProvider, HistoryRequest } from "./types";
import { normalizePrices } from "./normalize";
import { fail, LabError } from "@/lib/utils/errors";
/** The identity/convention checks every provider result must pass, singly or in a
 * batch: requested ticker, USD, the total-return-aware convention (declared by both
 * provider and series), clean ascending observations, and at least one of them. */
export function validatedSeries(
  provider: HistoricalProvider,
  request: HistoryRequest,
  value: HistoricalSeries,
): HistoricalSeries {
  if (
    value.ticker !== request.ticker ||
    value.currency !== "USD" ||
    value.convention !== "total_return_aware_adjusted" ||
    provider.convention !== value.convention
  )
    fail("MALFORMED_DATA", "Provider identity or return convention mismatch.");
  const observations = normalizePrices(value.observations);
  if (!observations.length)
    fail("INSUFFICIENT_HISTORY", "No adjusted history is available.", {
      ticker: request.ticker,
    });
  return { ...value, observations };
}

export async function historicalWithFallback(
  providers: HistoricalProvider[],
  request: HistoryRequest,
): Promise<HistoricalSeries> {
  const failures: string[] = [];
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const value = validatedSeries(
        provider,
        request,
        await provider.getHistoricalPrices(request),
      );
      return {
        ...value,
        provenance: {
          ...value.provenance,
          fallbackUsed: failures.length > 0,
          fallbackReason: failures.length ? failures.join("; ") : undefined,
        },
      };
    } catch (error) {
      lastError = error;
      failures.push(
        `${provider.name}: ${error instanceof LabError ? error.detail.code : "provider failure"}`,
      );
    }
  }
  if (lastError instanceof LabError) throw lastError;
  fail(
    "PROVIDER_ERROR",
    `No qualified historical provider succeeded for ${request.ticker}.`,
    { ticker: request.ticker, retryable: true },
  );
}
