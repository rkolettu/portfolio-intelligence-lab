import { expect, it } from "vitest";
import { simulate, type SimulationInput } from "@/lib/backtest/engine";
import { series, sessions, provenance } from "../fixtures/helpers";
const dates = ["2024-05-30", "2024-05-31", "2024-06-03"];
function input(): SimulationInput {
  return {
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
      series("SPY", dates, [100, 110, 110]),
      series("QQQ", dates, [100, 100, 110]),
    ],
    treasury: null,
    sessions: sessions(dates),
    now: "2024-06-04T10:00:00Z",
  };
}
it("resets month-end values after earning old-weight returns, then earns at targets", () => {
  const r = simulate(input());
  expect(r.ledger.map((x) => x.wealth)).toEqual([10500, 11025]);
  expect(r.ledger[0].rebalanced).toBe(true);
  expect(r.ledger[0].endWeights[0]).toBeCloseTo(55 / 105, 12);
  expect(r.ledger[0].nextWeights).toEqual([0.5, 0.5]);
  expect(r.ledger[1].startWeights).toEqual([0.5, 0.5]);
  for (const row of r.ledger)
    expect(row.contributions.reduce((a, b) => a + b, 0)).toBeCloseTo(
      row.return,
      12,
    );
});
it("lets weights drift within a month", () => {
  const i = input();
  const ds = ["2024-05-28", "2024-05-29", "2024-05-30"];
  i.config.requestedStartDate = ds[0];
  i.config.endDate = ds[2];
  i.sessions = sessions(ds);
  i.prices = [
    series("SPY", ds, [100, 110, 110]),
    series("QQQ", ds, [100, 100, 110]),
  ];
  expect(simulate(i).ledger.at(-1)?.wealth).toBeCloseTo(11000, 10);
});
it("single asset follows its adjusted prices and ignores zero weight coverage", () => {
  const i = input();
  i.config.holdings = [
    { ticker: "SPY", weight: 1 },
    { ticker: "MISSING", weight: 0 },
  ];
  i.prices = [series("SPY", dates, [100, 110, 99])];
  expect(simulate(i).ledger.at(-1)?.wealth).toBeCloseTo(9900, 10);
});
it("blocks interior and terminal gaps instead of dropping loss-bearing sessions", () => {
  for (const missing of [1, 2]) {
    const i = input();
    i.prices[1].observations.splice(missing, 1);
    expect(() => simulate(i)).toThrow(/missing|gap/i);
  }
});
it("explains late first-trade coverage but rejects unexplained leading gaps", () => {
  const i = input();
  i.prices[1] = series("QQQ", dates.slice(1), [100, 110], dates[1]);
  const r = simulate(i);
  expect(r.initialDate).toBe(dates[1]);
  expect(r.metadata.limitingHoldings).toContain("QQQ");
  expect(r.quality).toContain("partial_history");
  i.prices[1].firstTradeDate = "2000-01-03";
  expect(() => simulate(i)).toThrow(/leading/i);
});
it("all cash uses the configured session calendar, not benchmark availability", () => {
  const i = input();
  i.config.holdings = [{ ticker: "CASH", weight: 1 }];
  i.prices = [];
  i.treasury = {
    series: "DGS3MO",
    provenance,
    observations: [
      {
        date: "2024-05-29",
        annualYield: 0.05,
        availableAt: "2024-05-29T20:15:00Z",
        availability: "published",
      },
    ],
  };
  const r = simulate(i);
  expect(r.ledger).toHaveLength(2);
  expect(r.ledger[1].return).toBeCloseTo(0.000401095465251355, 14);
  expect(r.benchmark.ok).toBe(false);
  expect(r.ledger[1].return).toBe(r.ledger[1].riskFreeReturn);
});
it("blocks unavailable CASH rates unless explicit whole-run fallback is selected; RF stays missing", () => {
  const i = input();
  i.config.holdings = [{ ticker: "CASH", weight: 1 }];
  expect(() => simulate(i)).toThrow(/Treasury/i);
  i.config.cashPolicy = "zero_explicit";
  const r = simulate(i);
  expect(r.ledger.map((x) => x.wealth)).toEqual([10000, 10000]);
  expect(r.ledger.every((x) => x.riskFreeReturn === null)).toBe(true);
  expect(r.metadata.warnings.join(" ")).toMatch(/zero/i);
});
it("applies weekend CASH accrual to the reset month-end allocation", () => {
  const i = input();
  i.config.holdings = [
    { ticker: "SPY", weight: 0.5 },
    { ticker: "CASH", weight: 0.5 },
  ];
  i.treasury = {
    series: "DGS3MO",
    provenance,
    observations: [
      {
        date: "2024-05-29",
        annualYield: 0.05,
        availableAt: "2024-05-29T20:15:00Z",
        availability: "published",
      },
    ],
  };
  const r = simulate(i);
  expect(r.ledger[1].startWeights).toEqual([0.5, 0.5]);
  expect(r.ledger[1].contributions[1]).toBeCloseTo(0.0002005477326256775, 14);
});
it("rebases continuous late benchmark overlap without restarting portfolio weights", () => {
  const i = input();
  i.config.benchmark = "VT";
  i.prices.push(series("VT", dates.slice(1), [100, 110], dates[1]));
  const r = simulate(i);
  expect(r.benchmark.ok).toBe(true);
  if (r.benchmark.ok) {
    expect(r.benchmark.value.points[0]).toEqual({
      date: dates[1],
      portfolioWealth: 10000,
      benchmarkWealth: 10000,
    });
    expect(r.benchmark.value.points[1].portfolioWealth).toBeCloseTo(10500, 10);
    expect(r.benchmark.value.points[1].benchmarkWealth).toBeCloseTo(11000, 10);
  }
});
it("benchmark interior gaps disable continuous wealth but leave absolute wealth intact", () => {
  const i = input();
  i.config.benchmark = "VT";
  i.prices.push(series("VT", [dates[0], dates[2]], [100, 110]));
  const r = simulate(i);
  expect(r.benchmark.ok).toBe(false);
  expect(r.ledger.at(-1)?.wealth).toBe(11025);
});
it("creates deterministic snapshot identity independent of current-quote context", () => {
  const i = input();
  const a = simulate(i);
  const b = simulate({ ...i, ...{ currentQuote: { price: 9999 } } });
  expect(a.metadata.snapshotHash).toBe(b.metadata.snapshotHash);
  expect(a.ledger).toEqual(b.ledger);
  expect(a.metadata.currentDataUsed).toBe(false);
  const modified = structuredClone(i);
  modified.prices[0].observations[1].adjustedClose = 109;
  expect(simulate(modified).metadata.snapshotHash).not.toBe(
    a.metadata.snapshotHash,
  );
});
it("requires at least two covered sessions and refuses convention mismatch", () => {
  const i = input();
  i.sessions = sessions([dates[0]]);
  expect(() => simulate(i)).toThrow();
});
it("replays a snapshot with the original requested end and a distinct finalized-data cutoff", () => {
  const i = { ...input(), eligibleEndDate: "2024-05-31" };
  const a = simulate(i);
  expect(a.config.endDate).toBe("2024-06-03");
  expect(a.metadata.effectiveEndDate).toBe("2024-05-31");
  const b = simulate({ ...a.snapshot, config: a.config, now: i.now });
  expect(b.ledger).toEqual(a.ledger);
  expect(b.metadata.snapshotHash).toBe(a.metadata.snapshotHash);
});
it("zero-CASH outage fallback applies even to intervals with available Treasury rates", () => {
  const i = input();
  i.config.holdings = [{ ticker: "CASH", weight: 1 }];
  i.config.cashPolicy = "zero_explicit";
  i.treasury = {
    series: "DGS3MO",
    provenance,
    observations: [
      {
        date: "2024-05-30",
        annualYield: 0.05,
        availableAt: "2024-05-30T20:15:00Z",
        availability: "published",
      },
    ],
  };
  const result = simulate(i);
  expect(result.ledger.map((r) => r.return)).toEqual([0, 0]);
  expect(result.ledger[0].riskFreeReturn).toBeNull();
  expect(result.ledger[1].riskFreeReturn).toBeCloseTo(0.000401095465251355, 14);
});
