import type { CurrentQuote } from "@/lib/types/data";
import { normalizeQuote, preferRecentQuote } from "./quotes";
import { sessionsBetween } from "@/lib/backtest/calendar";
import { marketDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";

/** Provider-neutral quote observation: the latest regular-market print and recent
 * raw (unadjusted) daily closes, as any upstream reports them. */
export type QuoteObservation = {
  ticker: string;
  provider: string;
  fetchedAt: string;
  regularMarketPrice?: number | null;
  /** ISO timestamp of the regular-market print. */
  regularMarketTime?: string | null;
  recentCloses: { date: string; close: number | null }[];
};

/** Current quote from an observation. The latest print is Latest Available (never
 * Live: no provider here qualifies live data); a finalized raw close is End of Day
 * at that session's close. The more recent of the two wins; when the close wins,
 * provenance records why. Freshness is classified by `normalizeQuote` alone. */
export function quoteFromObservation(
  obs: QuoteObservation,
  now: string,
): CurrentQuote {
  const { ticker, provider, fetchedAt } = obs;
  const current =
    typeof obs.regularMarketPrice === "number" && obs.regularMarketTime
      ? normalizeQuote(
          {
            ticker,
            price: obs.regularMarketPrice,
            marketTimestamp: obs.regularMarketTime,
            fetchedAt,
            provider,
            session: "regular",
          },
          now,
        )
      : null;
  const candidates = obs.recentCloses.flatMap(({ date, close }) => {
    if (
      date >= marketDate(now) ||
      close === null ||
      close === undefined ||
      close <= 0
    )
      return [];
    const session = sessionsBetween(date, date, now)[0];
    return session
      ? [
          normalizeQuote(
            {
              ticker,
              price: close,
              marketTimestamp: session.close,
              fetchedAt,
              provider,
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
  // A range's previous close can mean start-of-range close, so day change remains unavailable.
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
