import { expect, it } from "vitest";
import { simulate } from "@/lib/backtest/engine";
import { summarizePerformance } from "@/lib/analytics/summary";
import type { Metric } from "@/lib/types/analytics";
import type { TreasuryObservation, TreasurySeries } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

// Wed, Thu, Fri, Mon (weekend gap), Tue.
const dates = ["2024-05-29", "2024-05-30", "2024-05-31", "2024-06-03", "2024-06-04"];
// Each rate is published at 20:15Z on its date, after that session's 20:00Z close,
// so an interval starting at a close can only use the previous day's rate.
const rate = (date: string, annualYield: number, availableAt = `${date}T20:15:00Z`): TreasuryObservation =>
  ({ date, annualYield, availableAt, availability: "published" });
const treasury = (observations: TreasuryObservation[]): TreasurySeries =>
  ({ series: "DGS3MO", observations, provenance });
const base = {
  benchmark: "SPY", requestedStartDate: dates[0], endDate: dates[4],
  rebalanceFrequency: "monthly" as const, cashPolicy: "historical_proxy" as const,
};
const run = (holdings: { ticker: string; weight: number }[], prices: number[], rates: TreasuryObservation[] | null, d = dates) =>
  simulate({
    config: { ...base, requestedStartDate: d[0], endDate: d.at(-1)!, holdings },
    prices: [series("SPY", d, prices)],
    treasury: rates && treasury(rates),
    sessions: sessions(d),
    now: "2024-06-05T12:00:00Z",
  });
const value = (m: Metric) => {
  if (!m.available) throw new Error(m.reason);
  return m.value;
};
const reason = (m: Metric) => (m.available ? "" : m.reason);
const accrue = (y: number, days: number) => Math.pow(1 + y, days / 365) - 1;
const expectClose = (actual: (number | null)[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 15));
};
const sampleStd = (x: number[]) => {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
};

it("single asset [100, 110, 99, …]: ending value, cumulative return, CAGR and drawdown from compounded wealth", () => {
  const d = ["2024-05-30", "2024-05-31", "2024-06-03"];
  const r = run([{ ticker: "SPY", weight: 1 }], [100, 110, 99], null, d);
  const p = r.performance;
  expect(value(p.portfolio.endingValue)).toBeCloseTo(9_900, 9);
  expect(value(p.portfolio.cumulativeReturn)).toBeCloseTo(-0.01, 12);
  expect(value(p.portfolio.cagr)).toBeCloseTo(Math.pow(0.99, 365.25 / 4) - 1, 10);
  expect(p.portfolio.cagr.available && p.portfolio.cagr.notes?.[0]).toMatch(/less than one year/);
  expect(value(p.risk.volatility)).toBeCloseTo(sampleStd([0.1, 9_900 / 11_000 - 1]) * Math.sqrt(252), 10);
  expect(value(p.risk.maximumDrawdown)).toBeCloseTo(-0.1, 12);
  expect(value(p.currentDrawdown)).toBeCloseTo(-0.1, 12);
  expect(p.maximumDrawdownEpisode).toMatchObject({ peakDate: d[1], troughDate: d[2], recoveryDate: null });
  // No Treasury: Sharpe/Sortino unavailable with an explicit reason, not NaN.
  expect(reason(p.risk.sharpe)).toMatch(/missing for 2 of 2 intervals/);
  expect(reason(p.risk.sortino)).toMatch(/missing/);
  expect(p.riskFree).toEqual({ complete: false, available: 0, required: 2 });
  expect(p.growth).toEqual([{ date: d[0], wealth: 10_000 }, ...r.ledger.map((l) => ({ date: l.date, wealth: l.wealth }))]);
  expect(p.risk.volatility.available && p.risk.volatility.sample.returnCount).toBe(2);
});

const flatRates = ["2024-05-28", ...dates].map((d) => rate(d, 0.05));
it("all cash: realized volatility from calendar gaps is nonzero, but Sharpe and Sortino are undefined", () => {
  const r = run([{ ticker: "CASH", weight: 1 }], [100, 101, 102, 103, 104], flatRates);
  const p = r.performance;
  // Weekend interval accrues 3 days, so raw returns vary.
  expectClose(r.ledger.map((l) => l.return), [accrue(0.05, 1), accrue(0.05, 1), accrue(0.05, 3), accrue(0.05, 1)]);
  expect(value(p.risk.volatility)).toBeGreaterThan(0);
  expect(reason(p.risk.sharpe)).toMatch(/identically zero/);
  expect(reason(p.risk.sortino)).toMatch(/identically zero/);
  expect(value(p.risk.maximumDrawdown)).toBe(0);
  expect(p.maximumDrawdownEpisode).toBeNull();
  expect(p.risk.maximumDrawdown.available && p.risk.maximumDrawdown.notes?.[0]).toMatch(/No drawdown/);
  expect(value(p.currentDrawdown)).toBe(0);
});

const steppedRates = [
  rate("2024-05-28", 0.05), rate("2024-05-29", 0.04), rate("2024-05-30", 0.03),
  rate("2024-05-31", 0.02), rate("2024-06-03", 0.01),
];
const spy = [100, 101, 100.5, 102, 101];
it("Sharpe and Sortino use aligned prior-known Treasury returns with weekend accrual (hand-calculated)", () => {
  const r = run([{ ticker: "SPY", weight: 1 }], spy, steppedRates);
  const rf = [accrue(0.05, 1), accrue(0.04, 1), accrue(0.03, 3), accrue(0.02, 1)];
  expectClose(r.ledger.map((l) => l.riskFreeReturn), rf);
  const excess = spy.slice(1).map((p, i) => p / spy[i] - 1 - rf[i]);
  const m = excess.reduce((a, b) => a + b, 0) / 4;
  expect(value(r.performance.risk.sharpe)).toBeCloseTo((m / sampleStd(excess)) * Math.sqrt(252), 10);
  const downside = Math.sqrt(excess.reduce((a, e) => a + Math.min(e, 0) ** 2, 0) / 4);
  expect(value(r.performance.risk.sortino)).toBeCloseTo((m * 252) / (downside * Math.sqrt(252)), 10);
  expect(r.performance.riskFree).toEqual({ complete: true, available: 4, required: 4 });
  // The Friday→Monday interval is one return observation; CAGR spans 6 calendar days.
  expect(r.performance.risk.sharpe.available && r.performance.risk.sharpe.sample.returnCount).toBe(4);
  expect(r.performance.elapsedCalendarDays).toBe(6);
  expect(value(r.performance.portfolio.cagr)).toBeCloseTo(Math.pow(1.01, 365.25 / 6) - 1, 10);
});

it("releases after an interval's starting close cannot change Sharpe or Sortino (no look-ahead)", () => {
  const baseline = run([{ ticker: "SPY", weight: 1 }], spy, steppedRates).performance;
  // A later, extreme observation only funds intervals beyond the sample.
  const future = run([{ ticker: "SPY", weight: 1 }], spy,
    [...steppedRates.slice(0, 4), rate("2024-06-03", 0.9), rate("2024-06-04", 0.9)]).performance;
  expect(future.risk.sharpe).toEqual(baseline.risk.sharpe);
  expect(future.risk.sortino).toEqual(baseline.risk.sortino);
  // Delay Friday's release past Monday's close: Monday's interval must fall back to
  // Thursday's 3% rate, never the unpublished 2%.
  const delayed = run([{ ticker: "SPY", weight: 1 }], spy,
    [...steppedRates.slice(0, 3), rate("2024-05-31", 0.02, "2024-06-03T20:30:00Z")]);
  expect(delayed.ledger.at(-1)!.rateObservationDate).toBe("2024-05-30");
  expect(delayed.ledger.at(-1)!.riskFreeReturn).toBeCloseTo(accrue(0.03, 1), 15);
  expect(value(delayed.performance.risk.sharpe)).not.toBe(value(baseline.risk.sharpe));
});

it("very short history: one return leaves dispersion statistics unavailable but wealth metrics defined", () => {
  const d = ["2024-05-30", "2024-05-31"];
  const p = run([{ ticker: "SPY", weight: 1 }], [100, 102], [rate("2024-05-29", 0.05)], d).performance;
  expect(value(p.portfolio.cumulativeReturn)).toBeCloseTo(0.02, 12);
  expect(p.portfolio.cagr.available && p.portfolio.cagr.notes?.[0]).toMatch(/1 calendar days/);
  for (const m of [p.risk.volatility, p.risk.sharpe, p.risk.sortino])
    expect(reason(m)).toMatch(/at least 2 daily returns; this sample has 1/);
  expect(value(p.risk.maximumDrawdown)).toBe(0);
});

it("zero-volatility portfolio: volatility 0, Sharpe undefined, never Infinity", () => {
  // Constant 1% daily growth; the risk-free rate is identical each weekday interval.
  const p = run([{ ticker: "SPY", weight: 1 }], [100, 101, 102.01, 103.0301, 104.060401],
    ["2024-05-28", ...dates].map((d) => rate(d, 0))).performance;
  expect(value(p.risk.volatility)).toBe(0);
  expect(reason(p.risk.sharpe)).toMatch(/volatility is zero/);
  expect(reason(p.risk.sortino)).toMatch(/No negative excess returns/);
  expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
});

it("ending wealth matches cumulative return and the product of daily returns", () => {
  const r = run([{ ticker: "SPY", weight: 0.6 }, { ticker: "CASH", weight: 0.4 }], spy, steppedRates);
  const p = r.performance;
  const cumulative = value(p.portfolio.cumulativeReturn);
  expect(10_000 * (1 + cumulative)).toBeCloseTo(value(p.portfolio.endingValue), 8);
  expect(r.ledger.reduce((w, l) => w * (1 + l.return), 1) - 1).toBeCloseTo(cumulative, 12);
  expect(p.drawdown.every((x) => x.drawdown <= 0)).toBe(true);
  expect(value(p.risk.maximumDrawdown)).toBe(Math.min(...p.drawdown.map((x) => x.drawdown)));
});

it("replays identical performance from the stored snapshot and composes from the ledger alone", () => {
  const r = run([{ ticker: "SPY", weight: 1 }], spy, steppedRates);
  const replay = simulate({ ...r.snapshot, config: r.config, now: r.metadata.generatedAt });
  expect(replay.performance).toEqual(r.performance);
  expect(summarizePerformance({ initialWealth: r.initialWealth, initialDate: r.initialDate,
    ledger: r.ledger, sample: r.metadata.sample })).toEqual(r.performance);
});
