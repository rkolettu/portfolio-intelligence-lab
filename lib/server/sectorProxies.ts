import "server-only";
import { SECTOR_PROXIES } from "@/config/exposureProfiles";
import { services } from "./analyze";
import { loadHistories } from "./history";
import { fail } from "@/lib/utils/errors";
import { marketDate } from "@/lib/utils/dates";
import type { HistoricalSeries } from "@/lib/types/data";

const allowed = new Set(Object.values(SECTOR_PROXIES));

export function exactWindowReturn(
  series: HistoricalSeries | undefined,
  startDate: string,
  endDate: string,
) {
  const first = series?.observations.find((p) => p.date === startDate);
  const last = series?.observations.find((p) => p.date === endDate);
  return first && last ? last.adjustedClose / first.adjustedClose - 1 : null;
}

/** Loads only requested sector proxies through the same cached adjusted-close
 * path as an analysis, then compounds the exact endpoint price ratio. */
export async function sectorProxyReturns(input: unknown, now: string) {
  const body = input as {
    tickers?: unknown;
    startDate?: unknown;
    endDate?: unknown;
  };
  if (
    !Array.isArray(body?.tickers) ||
    typeof body.startDate !== "string" ||
    typeof body.endDate !== "string"
  )
    fail("INVALID_INPUT", "Sector proxy request is invalid.");
  const startDate = body.startDate;
  const endDate = body.endDate;
  const tickers = [
    ...new Set(
      body.tickers.filter(
        (t): t is string => typeof t === "string" && allowed.has(t),
      ),
    ),
  ];
  if (
    tickers.length !== body.tickers.length ||
    tickers.length > 11 ||
    startDate > endDate ||
    endDate > marketDate(now)
  )
    fail(
      "INVALID_INPUT",
      "Sector proxy request is outside the analyzed window.",
    );
  const { prices, failures } = await loadHistories(
    services,
    tickers,
    startDate,
    endDate,
    now,
  );
  return {
    ok: true as const,
    value: tickers.map((ticker) => {
      const series = prices.find((p) => p.ticker === ticker);
      const windowReturn = exactWindowReturn(series, startDate, endDate);
      const failure = failures.find((f) => f.ticker === ticker);
      return windowReturn !== null
        ? {
            ticker,
            available: true as const,
            return: windowReturn,
            startDate,
            endDate,
          }
        : {
            ticker,
            available: false as const,
            reason:
              failure?.error.message ??
              "The proxy has no adjusted close at both analysis endpoints.",
          };
    }),
  };
}
