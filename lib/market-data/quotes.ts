import type { CurrentQuote, QuoteStatus } from "@/lib/types/data";
import { marketDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export type RawQuote = {
  ticker: string;
  price: number;
  previousClose?: number;
  marketTimestamp: string;
  fetchedAt: string;
  provider: string;
  claimedStatus?: string;
  delaySeconds?: number;
  session?: "regular" | "pre" | "post" | "unknown";
  liveQualified?: boolean;
};
export function normalizeQuote(raw: RawQuote, now: string): CurrentQuote {
  const observationAgeSeconds =
    (Date.parse(now) - Date.parse(raw.marketTimestamp)) / 1000;
  if (
    !Number.isFinite(raw.price) ||
    raw.price <= 0 ||
    !Number.isFinite(observationAgeSeconds) ||
    observationAgeSeconds < 0 ||
    !Number.isFinite(Date.parse(raw.fetchedAt)) ||
    (raw.previousClose !== undefined &&
      (!Number.isFinite(raw.previousClose) || raw.previousClose <= 0))
  )
    fail("MALFORMED_DATA", "Invalid quote, price basis, or timestamp.");
  let status: QuoteStatus = "latest_available";
  if (raw.claimedStatus === "end_of_day") status = "end_of_day";
  else if (raw.delaySeconds !== undefined && raw.delaySeconds > 0)
    status = "delayed";
  else if (
    raw.claimedStatus === "live" &&
    raw.liveQualified &&
    raw.delaySeconds === 0 &&
    observationAgeSeconds <= LIVE_TOLERANCE_SECONDS &&
    raw.session === "regular"
  )
    status = "live";
  return {
    ticker: raw.ticker,
    price: raw.price,
    previousClose: raw.previousClose,
    change:
      raw.previousClose === undefined
        ? undefined
        : raw.price - raw.previousClose,
    changePercent:
      raw.previousClose === undefined
        ? undefined
        : raw.price / raw.previousClose - 1,
    marketTimestamp: raw.marketTimestamp,
    marketDate: marketDate(raw.marketTimestamp),
    fetchedAt: raw.fetchedAt,
    status,
    provider: raw.provider,
    delaySeconds: raw.delaySeconds,
    session: raw.session ?? "unknown",
    observationAgeSeconds,
    statusExpiresAt:
      status === "live" || status === "delayed"
        ? new Date(
            Date.parse(raw.marketTimestamp) +
              ((raw.delaySeconds ?? 0) + LIVE_TOLERANCE_SECONDS) * 1000,
          ).toISOString()
        : undefined,
    provenance: {
      provider: raw.provider,
      fetchedAt: raw.fetchedAt,
      lastSuccessfulRefresh: raw.fetchedAt,
      // fetchedAt is the upstream response time; a framework fetch cache can serve
      // (and revalidate behind) an older response, so its age is not assumed zero.
      cacheAgeSeconds: Math.max(0, (Date.parse(now) - Date.parse(raw.fetchedAt)) / 1000),
      observationDate: marketDate(raw.marketTimestamp),
      fallbackUsed: false,
      warnings:
        status === "latest_available"
          ? ["Provider latency is unqualified; this is not a real-time claim."]
          : [],
    },
  };
}
export function preferRecentQuote(
  quote: CurrentQuote,
  close: CurrentQuote,
): CurrentQuote {
  if (quote.ticker !== close.ticker)
    fail("MALFORMED_DATA", "Cannot compare quotes for different securities.");
  return Date.parse(quote.marketTimestamp) >= Date.parse(close.marketTimestamp)
    ? quote
    : close;
}

/** Seconds a live claim, or a delayed claim beyond its stated delay, remains valid. */
export const LIVE_TOLERANCE_SECONDS = 120;
const STALE_WARNING =
  "A newer market close exists; this quote is stale. Market timestamp remains authoritative.";

/** Reassess on every cache read and while displayed. Never upgrades a status. */
export function refreshQuoteFreshness(quote: CurrentQuote, now: string): CurrentQuote {
  const at = Date.parse(now);
  const age = (at - Date.parse(quote.marketTimestamp)) / 1000;
  if (!Number.isFinite(age) || age < 0)
    fail("MALFORMED_DATA", "Invalid quote freshness clock.");
  const expired =
    (quote.status === "live" || quote.status === "delayed") &&
    (quote.statusExpiresAt === undefined || at >= Date.parse(quote.statusExpiresAt));
  // Without session knowledge (staleAfter undefined) fall back to one elapsed day.
  const stale =
    quote.staleAfter === null ||
    (quote.staleAfter !== undefined && at >= Date.parse(quote.staleAfter)) ||
    (quote.staleAfter === undefined && age > 86400);
  const warnings = [
    ...quote.provenance.warnings,
    ...(expired
      ? ["Live/delayed claim expired by elapsed time; shown as Latest Available."]
      : []),
    ...(stale ? [STALE_WARNING] : []),
  ];
  return {
    ...quote,
    status: expired ? "latest_available" : quote.status,
    observationAgeSeconds: age,
    stale,
    provenance: { ...quote.provenance, warnings: [...new Set(warnings)] },
  };
}

/** Client-side re-evaluation, immune to browser clock skew: advance the server's
 * assessment clock by the time elapsed since the response was received. */
export function quoteAfterElapsed(quote: CurrentQuote, elapsedMs: number): CurrentQuote {
  const serverNow =
    Date.parse(quote.marketTimestamp) + quote.observationAgeSeconds * 1000;
  return refreshQuoteFreshness(
    quote,
    new Date(serverNow + Math.max(0, elapsedMs)).toISOString(),
  );
}
