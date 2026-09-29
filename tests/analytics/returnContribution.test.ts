import { expect, it } from "vitest";
import { simulate } from "@/lib/backtest/engine";
import { returnContribution } from "@/lib/analytics/returnContribution";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

// Month-end 2024-05-31 (Friday) resets to targets before the 06-03 interval.
const dates = [
  "2024-05-28",
  "2024-05-29",
  "2024-05-30",
  "2024-05-31",
  "2024-06-03",
  "2024-06-04",
];
const rates: TreasuryObservation[] = ["2024-05-24", ...dates].map((date) => ({
  date,
  annualYield: 0.05,
  availableAt: `${date}T20:15:00Z`,
  availability: "published",
}));
const run = (holdings: { ticker: string; weight: number }[]) =>
  simulate({
    config: {
      holdings,
      benchmark: "SPY",
      requestedStartDate: dates[0],
      endDate: dates.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("SPY", dates, [100, 110, 110, 121, 121, 133.1]),
      series("QQQ", dates, [100, 100, 90, 90, 99, 99]),
    ],
    treasury: { series: "DGS3MO", observations: rates, provenance },
    sessions: sessions(dates),
    now: "2024-06-05T12:00:00Z",
  });

it("daily contributions use beginning-of-interval drifted weights and sum to the portfolio return", () => {
  const r = run([
    { ticker: "SPY", weight: 0.5 },
    { ticker: "QQQ", weight: 0.5 },
  ]);
  const [d1, d2] = r.ledger;
  expect(d1.startWeights).toEqual([0.5, 0.5]);
  expect(d1.contributions).toEqual([expect.closeTo(0.05, 15), 0]); // 0.5 × 10%, 0.5 × 0%
  // After SPY +10%, weights drift to 55/105 and 50/105 for the next interval.
  expect(d2.startWeights[0]).toBeCloseTo(55 / 105, 15);
  expect(d2.contributions[1]).toBeCloseTo((50 / 105) * -0.1, 15);
  for (const row of r.ledger)
    expect(row.contributions.reduce((a, b) => a + b, 0)).toBe(row.return);
  expect(r.riskAnalytics.returnContribution.maxIdentityResidual).toBe(0);
});

it("the interval after a month-end close earns at reset target weights (rebalance-day behavior)", () => {
  const r = run([
    { ticker: "SPY", weight: 0.5 },
    { ticker: "QQQ", weight: 0.5 },
  ]);
  const may31 = r.ledger.find((l) => l.date === "2024-05-31")!;
  const jun3 = r.ledger.find((l) => l.date === "2024-06-03")!;
  expect(may31.rebalanced).toBe(true);
  expect(may31.startWeights[0]).not.toBeCloseTo(0.5, 6); // drifted going into month-end
  expect(jun3.startWeights).toEqual([0.5, 0.5]); // reset after the close
  expect(jun3.contributions).toEqual([0, 0.5 * (99 / 90 - 1)]);
});

it("period arithmetic contribution sums daily contributions: totals the sum of daily returns, not cumulative", () => {
  const r = run([
    { ticker: "SPY", weight: 0.5 },
    { ticker: "QQQ", weight: 0.5 },
  ]);
  const rc = r.riskAnalytics.returnContribution;
  const perHolding = [0, 1].map((i) =>
    r.ledger.reduce((s, l) => s + l.contributions[i], 0),
  );
  expect(rc.rows.map((x) => x.periodContribution)).toEqual(perHolding);
  const sumDaily = r.ledger.reduce((s, l) => s + l.return, 0);
  expect(rc.sumOfDailyReturns).toBeCloseTo(sumDaily, 15);
  expect(perHolding[0] + perHolding[1]).toBeCloseTo(sumDaily, 15);
  const cumulative = r.ledger.at(-1)!.wealth / 10_000 - 1;
  expect(Math.abs(sumDaily - cumulative)).toBeGreaterThan(1e-4); // arithmetic ≠ geometric
  expect(rc.rows[0].averageWeight).toBeCloseTo(
    r.ledger.reduce((s, l) => s + l.startWeights[0], 0) / r.ledger.length,
    15,
  );
  expect(rc.sample).toEqual(r.metadata.sample);
});

it("single asset contributes the full daily return; CASH contributes weight × prior-known accrual", () => {
  const single = run([{ ticker: "SPY", weight: 1 }]);
  single.ledger.forEach((l) => expect(l.contributions).toEqual([l.return]));
  const cash = run([
    { ticker: "SPY", weight: 0.8 },
    { ticker: "CASH", weight: 0.2 },
  ]);
  for (const l of cash.ledger)
    expect(l.contributions[1]).toBe(l.startWeights[1] * l.riskFreeReturn!);
  const rows = cash.riskAnalytics.returnContribution.rows;
  expect(rows.map((x) => x.ticker)).toEqual(["SPY", "CASH"]);
  expect(rows[1].periodContribution).toBeGreaterThan(0);
});

it("rejects a ledger whose contributions do not match the holdings", () => {
  const r = run([{ ticker: "SPY", weight: 1 }]);
  expect(() =>
    returnContribution(
      [
        { ticker: "SPY", weight: 0.5 },
        { ticker: "QQQ", weight: 0.5 },
      ],
      r.ledger,
    ),
  ).toThrow();
  expect(() =>
    returnContribution([{ ticker: "SPY", weight: 1 }], []),
  ).toThrow();
});
