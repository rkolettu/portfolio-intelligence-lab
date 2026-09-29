import { describe, expect, it } from "vitest";
import { runStress, trimStressSnapshot } from "@/lib/backtest/stress";
import { simulate } from "@/lib/backtest/engine";
import { sessionsBetween } from "@/lib/backtest/calendar";
import { STRESS_METHODOLOGY } from "@/config/methodology";
import type {
  StressTestResult,
  StressWindowDefinition,
} from "@/lib/types/analytics";
import type { TreasurySeries } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { provenance, series } from "../fixtures/helpers";

const FAR = "2100-01-01T00:00:00Z";
const NOW = "2020-06-01T12:00:00Z";
const calendar = sessionsBetween("2020-02-03", "2020-04-09", FAR);
const ds = calendar.map((s) => s.date);
const path = (daily: number) => ds.map((_, i) => 100 * (1 + daily) ** i);
const COVID: StressWindowDefinition = {
  id: "covid",
  name: "COVID Crash",
  startDate: "2020-02-19",
  endDate: "2020-03-23",
  description: "fixture",
  kind: "preset",
};
const config: PortfolioConfig = {
  holdings: [
    { ticker: "AAA", weight: 0.6 },
    { ticker: "BBB", weight: 0.4 },
  ],
  benchmark: "BMK",
  requestedStartDate: "2019-06-03",
  endDate: "2020-05-29",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
// Daily 2% yield, modeled available at 23:59 ET the next day.
const treasury: TreasurySeries = {
  series: "DGS3MO",
  observations: sessionsBetween("2020-01-02", "2020-04-09", FAR).map((s) => ({
    date: s.date,
    annualYield: 0.02,
    availableAt: `${s.date}T23:59:00-05:00`,
    availability: "modeled",
  })),
  provenance,
};
function input(overrides: Partial<Parameters<typeof runStress>[0]> = {}) {
  return {
    config,
    windows: [COVID],
    prices: [
      series("AAA", ds, path(-0.01)),
      series("BBB", ds, path(0.002)),
      series("BMK", ds, path(-0.015)),
    ],
    treasury: null,
    sessions: calendar,
    unavailable: [],
    now: NOW,
    ...overrides,
  };
}
function complete(e: StressTestResult) {
  if (e.status !== "complete")
    throw new Error(`expected complete, got ${e.status}`);
  return e;
}
const valueOf = (m: { available: boolean; value?: number }) =>
  m.available ? m.value : undefined;

describe("stress events", () => {
  it("initializes at the start-session close and reuses the unchanged simulation", () => {
    const e = complete(runStress(input()).events[0]);
    expect(e.startDate).toBe("2020-02-19");
    expect(e.endDate).toBe("2020-03-23");
    expect(e.firstReturnDate).toBe("2020-02-20");
    expect(e.sample.returnCount).toBe(23);
    const direct = simulate({
      config: {
        ...config,
        requestedStartDate: "2020-02-19",
        endDate: "2020-03-23",
      },
      prices: input().prices,
      treasury: null,
      sessions: calendar,
      now: NOW,
      eligibleEndDate: "2020-03-23",
    });
    expect(valueOf(e.portfolioReturn)).toBe(
      valueOf(direct.performance.portfolio.cumulativeReturn),
    );
    expect(e.path[0]).toEqual({
      date: "2020-02-19",
      portfolio: 10_000,
      benchmark: 10_000,
    });
    expect(e.path).toHaveLength(24);
  });

  it("does not depend on prices or drifted weights before the event", () => {
    const base = complete(runStress(input()).events[0]);
    const shifted = input();
    for (const s of shifted.prices)
      s.observations = s.observations.map((o) =>
        o.date < COVID.startDate
          ? { ...o, adjustedClose: o.adjustedClose * 3.7 }
          : o,
      );
    const other = complete(runStress(shifted).events[0]);
    expect(other.portfolioReturn).toEqual(base.portfolioReturn);
    expect(other.holdings).toEqual(base.holdings);
  });

  it("applies monthly closing resets inside the window", () => {
    const e = complete(runStress(input()).events[0]);
    expect(e.rebalances).toBe(1); // after the 2020-02-28 close
  });

  it("computes event active return as a simple difference and within-window drawdown", () => {
    const e = complete(runStress(input()).events[0]);
    const p = valueOf(e.portfolioReturn)!;
    const b = valueOf(e.benchmarkReturn)!;
    expect(b).toBeCloseTo(0.985 ** 23 - 1, 12);
    expect(valueOf(e.activeReturn)).toBe(p - b);
    // Monotonic decline: the start close is the peak, so max drawdown is the loss.
    expect(valueOf(e.maximumDrawdown)).toBeCloseTo(p, 12);
    expect(e.maximumDrawdownEpisode?.peakDate).toBe("2020-02-19");
  });

  it("reports standalone holding returns with best and worst", () => {
    const e = complete(runStress(input()).events[0]);
    expect(e.holdings.map((h) => h.ticker)).toEqual(["AAA", "BBB"]);
    expect(e.holdings[0].return).toBeCloseTo(0.99 ** 23 - 1, 12);
    expect(e.holdings[1].return).toBeCloseTo(1.002 ** 23 - 1, 12);
    expect(e.best).toEqual(["BBB"]);
    expect(e.worst).toEqual(["AAA"]);
  });

  it("includes CASH at its prior-known Treasury accrual among best/worst", () => {
    const e = complete(
      runStress(
        input({
          config: {
            ...config,
            holdings: [
              { ticker: "AAA", weight: 0.9 },
              { ticker: "CASH", weight: 0.1 },
            ],
          },
          treasury,
        }),
      ).events[0],
    );
    const cash = e.holdings.find((h) => h.ticker === "CASH")!;
    expect(cash.riskless).toBe(true);
    expect(cash.return).toBeGreaterThan(0);
    expect(e.best).toEqual(["CASH"]);
  });

  it("returns Incomplete Historical Coverage for pre-inception holdings instead of shortening", () => {
    const i = input();
    const late = ds.indexOf("2020-03-02");
    i.prices[1] = series(
      "BBB",
      ds.slice(late),
      path(0.002).slice(late),
      "2020-03-02",
    );
    const e = runStress(i).events[0];
    expect(e.status).toBe("incomplete_coverage");
    if (e.status !== "incomplete_coverage") return;
    expect(e.missing).toEqual([
      {
        ticker: "BBB",
        firstAvailableDate: "2020-03-02",
        firstTradeDate: "2020-03-02",
        missingSessions: 8,
        reason:
          "Provider-reported first trade 2020-03-02 is after the event start; no earlier history exists to cover the window.",
      },
    ]);
    expect("portfolioReturn" in e).toBe(false);
  });

  it("returns Incomplete Historical Coverage for an interior missing session", () => {
    const i = input();
    i.prices[0].observations = i.prices[0].observations.filter(
      (o) => o.date !== "2020-03-05",
    );
    const e = runStress(i).events[0];
    expect(e.status).toBe("incomplete_coverage");
    if (e.status === "incomplete_coverage")
      expect(e.missing[0]).toMatchObject({ ticker: "AAA", missingSessions: 1 });
  });

  it("disables only benchmark and active results when the benchmark lacks event coverage", () => {
    const i = input();
    const late = ds.indexOf("2020-03-02");
    i.prices[2] = series(
      "BMK",
      ds.slice(late),
      path(-0.015).slice(late),
      "2020-03-02",
    );
    const e = complete(runStress(i).events[0]);
    expect(e.portfolioReturn.available).toBe(true);
    expect(e.benchmarkReturn.available).toBe(false);
    expect(e.activeReturn.available).toBe(false);
    expect(e.benchmarkVolatility.available).toBe(false);
    expect(e.path[0].benchmark).toBeNull();
    if (!e.benchmarkReturn.available)
      expect(e.benchmarkReturn.reason).toMatch(/BMK.*event start/);
  });

  it("marks CASH events unavailable when Treasury history is missing", () => {
    const e = runStress(
      input({
        config: {
          ...config,
          holdings: [
            { ticker: "AAA", weight: 0.9 },
            { ticker: "CASH", weight: 0.1 },
          ],
        },
      }),
    ).events[0];
    expect(e.status).toBe("unavailable");
    if (e.status === "unavailable") expect(e.reason).toMatch(/Treasury/);
  });

  it("separates provider failure (unavailable) from missing history (coverage)", () => {
    const i = input();
    i.prices = [i.prices[0], i.prices[2]];
    const failed = runStress({
      ...i,
      unavailable: [
        {
          ticker: "BBB",
          error: {
            code: "TIMEOUT",
            message: "Upstream timed out.",
            retryable: true,
          },
        },
      ],
    }).events[0];
    expect(failed.status).toBe("unavailable");
    if (failed.status === "unavailable")
      expect(failed.reason).toBe("BBB: Upstream timed out.");
    const missing = runStress({
      ...i,
      unavailable: [
        {
          ticker: "BBB",
          error: {
            code: "INSUFFICIENT_HISTORY",
            message: "No adjusted history is available.",
            retryable: false,
          },
        },
      ],
    }).events[0];
    expect(missing.status).toBe("incomplete_coverage");
  });

  it("treats a not-found response over a historical span as missing history, not a provider fault", () => {
    const i = input();
    const e = runStress({
      ...i,
      prices: [i.prices[0], i.prices[2]],
      unavailable: [
        {
          ticker: "BBB",
          error: {
            code: "TICKER_NOT_FOUND",
            message: "No history found for BBB.",
            retryable: false,
          },
        },
      ],
    }).events[0];
    expect(e.status).toBe("incomplete_coverage");
    if (e.status === "incomplete_coverage")
      expect(e.missing[0]).toMatchObject({
        ticker: "BBB",
        missingSessions: 24,
        reason: "No adjusted history was returned for this window.",
      });
  });

  it("resolves custom non-session bounds to sessions and discloses both", () => {
    const e = complete(
      runStress(
        input({
          windows: [
            {
              id: "custom",
              name: "Custom Historical Window",
              startDate: "2020-02-15", // Saturday; Monday 17th is a holiday
              endDate: "2020-03-22", // Sunday
              description: "User-selected window.",
              kind: "custom",
            },
          ],
        }),
      ).events[0],
    );
    expect([e.requestedStartDate, e.startDate]).toEqual([
      "2020-02-15",
      "2020-02-18",
    ]);
    expect([e.requestedEndDate, e.endDate]).toEqual([
      "2020-03-22",
      "2020-03-20",
    ]);
    expect(e.notes).toContain(
      "Requested 2020-02-15 → 2020-03-22; resolved to the first session on or after the start (2020-02-18) and the last completed session on or before the end (2020-03-20).",
    );
  });

  it("excludes today's unfinalized session from a window ending today", () => {
    const e = complete(
      runStress(
        input({
          config: { ...config, endDate: "2020-03-23" },
          now: "2020-03-23T18:00:00Z",
        }),
      ).events[0],
    );
    expect(e.endDate).toBe("2020-03-20");
  });

  it("replays from its own snapshot and is unchanged by trimming unused data", () => {
    const full = runStress(input());
    const trimmed = trimStressSnapshot(input());
    expect(trimmed.prices[0].observations[0].date).toBe("2020-02-19");
    expect(trimmed.sessions.at(-1)!.date).toBe("2020-03-24");
    const fromTrimmed = runStress({ ...input(), ...trimmed });
    expect(fromTrimmed.events).toEqual(full.events);
    const replay = runStress({
      ...fromTrimmed.snapshot,
      config: fromTrimmed.config,
      now: fromTrimmed.metadata.generatedAt,
    });
    expect(replay.events).toEqual(fromTrimmed.events);
    expect(replay.metadata.snapshotHash).toBe(
      fromTrimmed.metadata.snapshotHash,
    );
    expect(fromTrimmed.methodologyVersion).toBe(STRESS_METHODOLOGY.version);
  });
});
