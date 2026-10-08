// Deterministic forward-risk-model fixture: real XNYS sessions, a one-factor return
// model (market factor + idiosyncratic noise) from a seeded generator, so betas,
// correlations and shrinkage are realistic and every run is identical.
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { HistoricalSeries, Session } from "@/lib/types/data";
import { series } from "./helpers";

const FAR = "2100-01-01T00:00:00Z";
export const FORWARD_NOW = "2024-06-04T15:00:00Z"; // NY 2024-06-04, 11:00
export const FORWARD_END = "2024-06-03"; // latest finalized session
export const FORWARD_START_3Y = "2021-06-03";
/** Price history runs from a little before the 5Y window to the end session. */
export const fixtureSessions: Session[] = sessionsBetween(
  "2019-05-15",
  FORWARD_END,
  FAR,
);
export const fixtureDates = fixtureSessions.map((s) => s.date);

function gaussian(seed: number) {
  let state = seed;
  const uniform = () => (state = (state * 48271) % 2147483647) / 2147483647;
  return () =>
    Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Market factor shared by every security (daily). */
const factorDraw = gaussian(12345);
const FACTOR = fixtureDates.map(() => 0.0004 + 0.011 * factorDraw());

/** loading on the factor, idiosyncratic daily vol, seed. */
const SPEC: Record<string, [number, number, number]> = {
  VTI: [1.0, 0.0012, 11],
  SPY: [0.98, 0.0015, 13],
  VT: [0.9, 0.003, 17],
  AAA: [1.3, 0.012, 19],
  BBB: [0.7, 0.008, 23],
  CCC: [0.2, 0.004, 29],
  DDD: [1.1, 0.015, 31],
};

/** Adjusted prices on `dates` (default: every fixture session) from the factor model.
 * A later `from` index makes a security list at that session with a matching
 * provider-reported first trade date. */
export function fixtureSeries(
  ticker: string,
  options: {
    from?: number;
    firstTradeDate?: string | null;
    dropDates?: string[];
    constant?: boolean;
  } = {},
): HistoricalSeries {
  const [loading, idio, seed] = SPEC[ticker] ?? [1, 0.01, ticker.length * 7];
  const noise = gaussian(seed);
  const from = options.from ?? 0;
  const dates = fixtureDates.slice(from);
  let price = 100;
  const prices = dates.map((_, k) => {
    if (k > 0 && !options.constant)
      price *= 1 + loading * FACTOR[from + k] + idio * noise();
    return price;
  });
  const drop = new Set(options.dropDates ?? []);
  const keep = dates.map((d) => !drop.has(d));
  return series(
    ticker,
    dates.filter((_, i) => keep[i]),
    prices.filter((_, i) => keep[i]),
    options.firstTradeDate === undefined
      ? from > 0
        ? dates[0]
        : "2000-01-03"
      : options.firstTradeDate,
  );
}
