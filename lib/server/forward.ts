import "server-only";
import type {
  DataError,
  HistoricalSeries,
  LatestTreasuryYield,
  Result,
  Session,
} from "@/lib/types/data";
import type {
  ForwardAssumptions,
  ForwardRiskModelOutcome,
} from "@/lib/types/forward";
import { PROVIDER_POLICY } from "@/config/providers";
import { oneYearStaleness } from "@/lib/treasury-data/latest";
import {
  forwardRiskSessions,
  forwardRiskWindowDates,
} from "@/lib/forward/sample";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardAssumptionsSchema } from "@/lib/validation/forward";
import { symbolSchema } from "@/lib/validation/symbols";
import { marketDate } from "@/lib/utils/dates";
import { errorResult, fail } from "@/lib/utils/errors";
import { services, type DataServices } from "./analyze";
import { loadHistories } from "./history";

/** Cache key of the forward 1Y read. Separate from the current curve's
 * `fred:current-curve:v1`, which is unchanged; both share the Treasury TTL. */
export const FORWARD_RISK_FREE_CACHE_KEY = "fred:latest-DGS1:v1";

/** The latest available official 1-year Treasury observation for the V2 forward
 * model: the later of FRED's and the U.S. Treasury file's (FRED on equal dates),
 * through the existing Treasury providers and the shared process cache. Reads only
 * DGS1; never the curve, never another maturity. Staleness (more than seven
 * calendar days before the New York date) is judged on every read, so a cached
 * reading that ages past the limit becomes TREASURY_UNAVAILABLE. */
export async function forwardRiskFreeReading(
  now: string,
  data: DataServices = services,
): Promise<Result<LatestTreasuryYield>> {
  try {
    const r = await data.cache.get(
      FORWARD_RISK_FREE_CACHE_KEY,
      PROVIDER_POLICY.treasuryTtlMs,
      () => data.treasury.getLatestOneYearYield(now),
    );
    const stale = oneYearStaleness(r.value.observationDate, marketDate(now));
    if (stale) fail("TREASURY_UNAVAILABLE", stale, { retryable: true });
    return {
      ok: true,
      value: {
        ...r.value,
        provenance: {
          ...r.value.provenance,
          cacheAgeSeconds: r.value.provenance.cacheAgeSeconds + r.ageSeconds,
        },
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

/** The data a forward risk model was estimated from: replaying
 * `buildForwardRiskModel({...snapshot, universe, marketProxy, riskWindow})`
 * reproduces it exactly. */
export type ForwardRiskSnapshot = {
  requestedStartDate: string;
  endDate: string;
  prices: HistoricalSeries[];
  sessions: Session[];
  unavailable: { ticker: string; error: DataError }[];
};

/** Load the risk window for the forward risky universe plus the market proxy (one
 * batch, the shared history cache keys and validation) and estimate the forward
 * risk model. Never fails the caller: every problem is a typed unavailable model. */
export async function loadForwardRiskModel(
  input: { universe: readonly string[]; assumptions: ForwardAssumptions },
  now: string,
  data: DataServices = services,
): Promise<{
  outcome: ForwardRiskModelOutcome;
  snapshot: ForwardRiskSnapshot | null;
}> {
  const parsed = forwardAssumptionsSchema.safeParse(input.assumptions);
  const canonical = input.universe.every((t) => {
    const s = symbolSchema.safeParse(t);
    return s.success && s.data === t && t !== "CASH";
  });
  if (
    !parsed.success ||
    !canonical ||
    new Set(input.universe).size !== input.universe.length
  )
    return {
      outcome: {
        available: false,
        code: "invalid_inputs",
        reason: !parsed.success
          ? parsed.error.issues.map((i) => i.message).join("; ")
          : "The forward risky universe must list distinct canonical U.S. tickers; CASH is not a risky security.",
        tickers: [],
        riskWindow: input.assumptions.riskWindow,
        requestedStartDate: null,
        endDate: null,
        alignedReturns: null,
      },
      snapshot: null,
    };
  const { riskWindow, marketProxy } = parsed.data;
  const { endDate, requestedStartDate } = forwardRiskWindowDates(riskWindow, now);
  const sessions = forwardRiskSessions(requestedStartDate, endDate);
  const tickers = [...new Set([...input.universe, marketProxy])].sort();
  const { prices, failures } = data.history.length
    ? await loadHistories(data, tickers, requestedStartDate, endDate, now)
    : {
        prices: [],
        failures: tickers.map((ticker) => ({
          ticker,
          error: {
            code: "UNQUALIFIED_PROVIDER" as const,
            message:
              "Historical market data is not available in this deployment: no market-data provider has been qualified for it yet.",
            ticker,
            retryable: false,
          },
        })),
      };
  const snapshot: ForwardRiskSnapshot = {
    requestedStartDate,
    endDate,
    prices,
    sessions,
    unavailable: failures,
  };
  return {
    outcome: buildForwardRiskModel({
      ...snapshot,
      universe: input.universe,
      marketProxy,
      riskWindow,
    }),
    snapshot,
  };
}
