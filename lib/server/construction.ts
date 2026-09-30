import "server-only";
import type { ConstructionAnalytics } from "@/lib/types/construction";
import type {
  Result,
  TreasurySeries,
} from "@/lib/types/data";
import { STRESS_WINDOWS } from "@/config/stressWindows";
import { PROVIDER_POLICY } from "@/config/providers";
import { parseConstructionRequest } from "@/lib/validation/construction";
import { addDays, marketDate } from "@/lib/utils/dates";
import { errorResult, fail } from "@/lib/utils/errors";
import { CALENDAR_COVERAGE, sessionsBetween } from "@/lib/backtest/calendar";
import { trimStressSnapshot } from "@/lib/backtest/stress";
import {
  runConstruction,
  zeroRiskyExposure,
} from "@/lib/backtest/construction";
import { services, type DataServices } from "./analyze";
import { loadHistories } from "./history";

async function rates(
  data: DataServices,
  start: string,
  end: string,
  now: string,
): Promise<TreasurySeries | null> {
  return data.cache
    .get(`fred:DGS3MO:${start}:${end}:v1`, PROVIDER_POLICY.treasuryTtlMs, () =>
      data.treasury.getHistoricalRates(start, end, now),
    )
    .then((r) => ({
      ...r.value,
      provenance: {
        ...r.value.provenance,
        cacheAgeSeconds: r.value.provenance.cacheAgeSeconds + r.ageSeconds,
      },
    }))
    .catch(() => null);
}

/** Portfolio construction on its own request. The estimation data reuse the
 * analysis's window and cache keys but include zero-weight eligible assets; the
 * stress comparison reuses the Stress Lab's fixed preset span and keys. Current
 * quotes are never read. */
export async function construct(
  input: unknown,
  now: string,
  data: DataServices = services,
): Promise<Result<ConstructionAnalytics>> {
  try {
    const today = marketDate(now);
    const request = parseConstructionRequest(input, today);
    const config = request.config;
    const universe = config.holdings
      .filter((h) => h.ticker !== "CASH")
      .map((h) => h.ticker);
    if (!data.history.length && universe.length)
      fail(
        "UNQUALIFIED_PROVIDER",
        "Historical equity data is not available in this deployment: no market-data provider has been qualified for it yet.",
      );
    const end = config.endDate < today ? config.endDate : addDays(today, -1);
    const lookahead = addDays(end, 7);
    const sessions = sessionsBetween(
      config.requestedStartDate,
      lookahead < CALENDAR_COVERAGE.end ? lookahead : CALENDAR_COVERAGE.end,
      "2100-01-01T00:00:00Z",
    );
    const tickers = [...new Set([...universe, config.benchmark])];
    const cashHeld =
      config.holdings.some((h) => h.ticker === "CASH" && h.weight > 0) ||
      (request.cash.mode === "fixed" && request.cash.weight > 0);
    const estimationRates = rates(data, config.requestedStartDate, end, now);
    const estimation = await loadHistories(
      data,
      tickers,
      config.requestedStartDate,
      end,
      now,
    );
    // Every eligible asset must have history: none is dropped for convenience. The
    // one exception is a problem where neither portfolio can hold a risky asset
    // (current all-CASH, 100% CASH), where candidate history is never used.
    const missing = estimation.failures.find((f) =>
      universe.includes(f.ticker),
    );
    if (missing && !zeroRiskyExposure(config, request.cash))
      return { ok: false, error: missing.error };
    const presetStart = STRESS_WINDOWS.map((w) => w.startDate).sort()[0];
    const presetEnd = STRESS_WINDOWS.map((w) => w.endDate)
      .sort()
      .at(-1)!;
    const stressSessions = sessionsBetween(
      presetStart,
      addDays(presetEnd, 7),
      "2100-01-01T00:00:00Z",
    );
    const stressRates = cashHeld
      ? rates(data, presetStart, presetEnd, now)
      : null;
    const stress = await loadHistories(
      data,
      tickers,
      presetStart,
      presetEnd,
      now,
    );
    const windows = [...STRESS_WINDOWS];
    const trimmed = trimStressSnapshot({
      windows,
      prices: stress.prices,
      treasury: await stressRates,
      sessions: stressSessions,
    });
    return {
      ok: true,
      value: runConstruction({
        config,
        constraints: request.constraints,
        cash: request.cash,
        estimation: {
          prices: estimation.prices,
          treasury: await estimationRates,
          sessions,
          eligibleEndDate: end,
        },
        stress: { windows, ...trimmed, unavailable: stress.failures },
        now,
      }),
    };
  } catch (error) {
    return errorResult(error);
  }
}
