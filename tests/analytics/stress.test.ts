import { describe, expect, it } from "vitest";
import { STRESS_WINDOWS, STRESS_WINDOWS_VERSION } from "@/config/stressWindows";
import { sessionsBetween } from "@/lib/backtest/calendar";
import {
  eventActiveReturn,
  eventHoldingReturns,
  extremeHoldings,
} from "@/lib/analytics/stress";
import { simulate } from "@/lib/backtest/engine";
import { series, sessions } from "../fixtures/helpers";

describe("configured stress windows", () => {
  it("are the three locked windows, each bounded by actual XNYS sessions", () => {
    expect(STRESS_WINDOWS_VERSION).toBe("stress-windows-v1");
    expect(STRESS_WINDOWS.map((w) => [w.id, w.startDate, w.endDate])).toEqual([
      ["gfc", "2007-10-09", "2009-03-09"],
      ["covid", "2020-02-19", "2020-03-23"],
      ["rate-shock-2022", "2021-12-31", "2022-12-30"],
    ]);
    for (const w of STRESS_WINDOWS) {
      const days = sessionsBetween(
        w.startDate,
        w.endDate,
        "2100-01-01T00:00:00Z",
      );
      expect(days[0].date).toBe(w.startDate);
      expect(days.at(-1)!.date).toBe(w.endDate);
    }
  });
});

describe("event metrics", () => {
  const dates = ["2024-05-30", "2024-05-31", "2024-06-03"];
  const ledger = simulate({
    config: {
      holdings: [
        { ticker: "SPY", weight: 0.5 },
        { ticker: "QQQ", weight: 0.5 },
      ],
      benchmark: "SPY",
      requestedStartDate: dates[0],
      endDate: dates[2],
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("SPY", dates, [100, 110, 99]),
      series("QQQ", dates, [100, 100, 110]),
    ],
    treasury: null,
    sessions: sessions(dates),
    now: "2024-06-04T10:00:00Z",
  }).ledger;

  it("compounds each holding's own returns over the window (standalone, not contributions)", () => {
    const rows = eventHoldingReturns(
      [
        { ticker: "SPY", weight: 0.5 },
        { ticker: "QQQ", weight: 0.5 },
      ],
      ledger,
    );
    expect(rows.map((r) => r.ticker)).toEqual(["SPY", "QQQ"]);
    expect(rows[0].return).toBeCloseTo(-0.01, 14);
    expect(rows[1].return).toBeCloseTo(0.1, 14);
    expect(rows.map((r) => [r.weight, r.riskless])).toEqual([
      [0.5, false],
      [0.5, false],
    ]);
  });

  it("names every holding tied at the best or worst return, in portfolio order", () => {
    const rows = [
      { ticker: "A", weight: 0.25, return: -0.2, riskless: false },
      { ticker: "B", weight: 0.25, return: 0.05, riskless: false },
      { ticker: "C", weight: 0.25, return: -0.2 + 1e-15, riskless: false },
      { ticker: "CASH", weight: 0.25, return: 0.05, riskless: true },
    ];
    expect(extremeHoldings(rows)).toEqual({
      best: ["B", "CASH"],
      worst: ["A", "C"],
    });
  });

  it("defines event active return as the simple difference of cumulative returns", () => {
    expect(eventActiveReturn(-0.3, -0.34)).toBeCloseTo(0.04, 15);
    expect(eventActiveReturn(0.1, 0.1)).toBe(0);
  });
});
