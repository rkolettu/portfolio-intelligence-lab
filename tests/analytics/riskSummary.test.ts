import { expect, it } from "vitest";
import { simulate } from "@/lib/backtest/engine";
import type { BacktestResult, Metric } from "@/lib/types/analytics";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

function weekdays(count: number, from = "2023-01-02"): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T12:00:00Z`);
    out.length < count;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  return out;
}
const pricesFrom = (returns: number[]) =>
  returns.reduce((acc, r) => [...acc, acc.at(-1)! * (1 + r)], [100]);
// Deterministic, mutually correlated daily return streams.
const stream = (n: number, a: number, b: number, c: number) =>
  Array.from(
    { length: n },
    (_, t) => 0.01 * Math.sin(t * a + c) + 0.006 * Math.cos(t * b) + 0.0004,
  );
const ratesFor = (d: string[]): TreasuryObservation[] =>
  ["2022-12-29", ...d].map((date) => ({
    date,
    annualYield: 0.04,
    availableAt: `${date}T20:15:00Z`,
    availability: "published",
  }));

function build(
  holdings: { ticker: string; weight: number }[],
  sessionsCount = 300,
  returns: Record<string, number[]> = {},
): BacktestResult {
  const d = weekdays(sessionsCount);
  const n = d.length - 1;
  const r: Record<string, number[]> = {
    AAA: stream(n, 0.9, 0.31, 0),
    BBB: stream(n, 0.9, 0.47, 1.1),
    CCC: stream(n, 0.37, 1.3, 2),
    SPY: stream(n, 0.9, 0.31, 0.4),
    ...returns,
  };
  return simulate({
    config: {
      holdings,
      benchmark: "SPY",
      requestedStartDate: d[0],
      endDate: d.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: Object.entries(r).map(([t, x]) =>
      series(t, d, pricesFrom(x.slice(0, n))),
    ),
    treasury: { series: "DGS3MO", observations: ratesFor(d), provenance },
    sessions: sessions(d),
    now: "2030-01-01T00:00:00Z",
  });
}
const v = (m: Metric) => {
  if (!m.available) throw new Error(m.reason);
  return m.value;
};
const why = (m: Metric) => (m.available ? "" : m.reason);
function assertFinite(value: unknown, path = "risk"): void {
  if (typeof value === "number")
    expect(Number.isFinite(value), path).toBe(true);
  else if (value && typeof value === "object")
    for (const [k, x] of Object.entries(value))
      if (x !== null) assertFinite(x, `${path}.${k}`);
}
const three = [
  { ticker: "AAA", weight: 0.5 },
  { ticker: "BBB", weight: 0.3 },
  { ticker: "CCC", weight: 0.2 },
];

it("enforces 59 / 60 / 251 / 252 common-observation thresholds", () => {
  const status = (obs: number) => build(three, obs + 1).riskAnalytics.sample;
  const s59 = status(59);
  expect(s59).toMatchObject({ available: false, observationCount: 59 });
  expect(!s59.available && s59.reason).toMatch(
    /Only 59 common daily observations.*at least 60/,
  );
  expect(status(60)).toMatchObject({ available: true, status: "limited" });
  expect(status(251)).toMatchObject({ available: true, status: "limited" });
  expect(status(252)).toMatchObject({ available: true, status: "normal" });
  const r = build(three, 60);
  expect(why(r.riskAnalytics.portfolio.volatility)).toMatch(/at least 60/);
  expect(r.riskAnalytics.concentration.hhi).toBeCloseTo(0.38, 15); // capital metrics survive
});

it("one canonical sample drives every covariance cell and every risk metric", () => {
  const r = build([
    ...three.map((h) => ({ ...h, weight: h.weight * 0.9 })),
    { ticker: "CASH", weight: 0.1 },
  ]);
  const ra = r.riskAnalytics;
  if (
    !ra.sample.available ||
    !ra.covariance.available ||
    !ra.correlation.available
  )
    throw new Error("unavailable");
  expect(ra.sample.tickers).toEqual(["AAA", "BBB", "CCC"]); // portfolio order, CASH outside Σ
  expect(ra.sample.cashWeight).toBeCloseTo(0.1, 15);
  expect(ra.sample.sample).toMatchObject({
    startDate: r.initialDate,
    endDate: r.metadata.effectiveEndDate,
    returnCount: r.ledger.length,
  });
  expect(ra.covariance.annual).toHaveLength(3);
  // Diagonal of Σ_annual equals each standalone volatility squared.
  ra.holdings
    .filter((h) => !h.riskless)
    .forEach((h, i) =>
      expect(ra.covariance.available && ra.covariance.annual[i][i]).toBeCloseTo(
        v(h.volatility) ** 2,
        14,
      ),
    );
  const metrics = [
    ra.portfolio.volatility,
    ra.portfolio.weightedAverageVolatility,
    ra.portfolio.diversificationRatio,
    ...ra.holdings.flatMap((h) => [
      h.volatility,
      h.marginal,
      h.component,
      h.percentage,
    ]),
  ];
  for (const m of metrics)
    expect(m.available && m.sample).toEqual(ra.sample.sample);
  // Identities and the CASH row.
  const crc = ra.holdings.reduce((s, h) => s + v(h.component), 0);
  expect(crc).toBeCloseTo(v(ra.portfolio.volatility), 14);
  expect(ra.holdings.reduce((s, h) => s + v(h.percentage), 0)).toBeCloseTo(
    1,
    13,
  );
  const cash = ra.holdings.find((h) => h.ticker === "CASH")!;
  expect(cash).toMatchObject({ riskless: true });
  expect([
    v(cash.volatility),
    v(cash.marginal),
    v(cash.component),
    v(cash.percentage),
  ]).toEqual([0, 0, 0, 0]);
  expect(ra.portfolio.identityResiduals!.pcr).toBeLessThan(1e-12);
  assertFinite(ra);
});

it("all CASH: zero target volatility, contributions and diversification ratio unavailable, full concentration", () => {
  const ra = build([{ ticker: "CASH", weight: 1 }], 120).riskAnalytics;
  expect(v(ra.portfolio.volatility)).toBe(0);
  expect(why(ra.portfolio.diversificationRatio)).toMatch(
    /undefined when target-weight volatility is zero/,
  );
  expect(why(ra.holdings[0].percentage)).toMatch(/volatility is zero/);
  expect(ra.covariance).toMatchObject({ available: false });
  expect(ra.concentration).toEqual({
    hhi: 1,
    effectiveHoldings: 1,
    largest: { ticker: "CASH", weight: 1 },
    top3: { tickers: ["CASH"], weight: 1 },
  });
  assertFinite(ra);
});

it("one risky asset plus CASH: the risky holding carries 100% of risk and σ = w × vol", () => {
  const ra = build([
    { ticker: "AAA", weight: 0.7 },
    { ticker: "CASH", weight: 0.3 },
  ]).riskAnalytics;
  const aaa = ra.holdings[0];
  expect(v(aaa.percentage)).toBeCloseTo(1, 14);
  expect(v(ra.portfolio.volatility)).toBeCloseTo(0.7 * v(aaa.volatility), 14);
  expect(v(ra.portfolio.diversificationRatio)).toBeCloseTo(1, 13);
  expect(ra.correlation.available && ra.correlation.highest).toBeNull();
});

it("a constant holding has zero volatility and undefined correlations; the singular matrix is disclosed", () => {
  const n = 299;
  const ra = build(
    [
      { ticker: "AAA", weight: 0.6 },
      { ticker: "FLAT", weight: 0.4 },
    ],
    300,
    { FLAT: Array(n).fill(0) },
  ).riskAnalytics;
  if (
    !ra.correlation.available ||
    !ra.covariance.available ||
    !ra.sample.available
  )
    throw new Error("unavailable");
  expect(ra.correlation.undefinedTickers).toEqual(["FLAT"]);
  expect(ra.correlation.matrix[1]).toEqual([null, null]);
  expect(v(ra.holdings[1].volatility)).toBe(0);
  expect(ra.covariance.diagnostics.singular).toBe(true);
  expect(ra.sample.notes.join()).toMatch(/singular/);
  expect(v(ra.holdings[0].percentage)).toBeCloseTo(1, 12);
  expect(ra.correlation.highest).toBeNull();
});

it("duplicate holdings: correlation +1, singular Σ, risk shared in proportion to weight", () => {
  const n = 299;
  const ra = build(
    [
      { ticker: "AAA", weight: 0.3 },
      { ticker: "DUP", weight: 0.2 },
      { ticker: "CCC", weight: 0.5 },
    ],
    300,
    { DUP: stream(n, 0.9, 0.31, 0) },
  ).riskAnalytics;
  if (!ra.correlation.available || !ra.covariance.available)
    throw new Error("unavailable");
  expect(ra.correlation.matrix[0][1]).toBeCloseTo(1, 12);
  expect(ra.correlation.highest).toMatchObject({ a: "AAA", b: "DUP" });
  expect(ra.covariance.diagnostics.singular).toBe(true);
  expect(
    v(ra.holdings[0].percentage) / v(ra.holdings[1].percentage),
  ).toBeCloseTo(1.5, 10);
});

it("a perfect negative-correlation hedge has zero target volatility and never produces Infinity", () => {
  const n = 299;
  const base = stream(n, 0.9, 0.31, 0);
  // HEDGE returns are exactly −AAA; equal weights cancel.
  const r = build(
    [
      { ticker: "AAA", weight: 0.5 },
      { ticker: "HEDGE", weight: 0.5 },
    ],
    300,
    { HEDGE: base.map((x) => -x) },
  );
  const ra = r.riskAnalytics;
  if (!ra.correlation.available) throw new Error("unavailable");
  expect(ra.correlation.matrix[0][1]).toBeCloseTo(-1, 12);
  expect(v(ra.portfolio.volatility)).toBe(0);
  expect(why(ra.portfolio.diversificationRatio)).toMatch(/volatility is zero/);
  expect(why(ra.holdings[0].percentage)).toMatch(/volatility is zero/);
  assertFinite(ra);
});

it("negative risk contribution: a hedge sleeve with negative covariance shows negative PCR, unclamped", () => {
  const n = 299;
  const base = stream(n, 0.9, 0.31, 0);
  const ra = build(
    [
      { ticker: "AAA", weight: 0.8 },
      { ticker: "HEDGE", weight: 0.2 },
    ],
    300,
    { HEDGE: base.map((x, t) => -0.5 * x + 0.002 * Math.sin(t * 2.3)) },
  ).riskAnalytics;
  expect(v(ra.holdings[1].percentage)).toBeLessThan(0);
  expect(v(ra.holdings[1].component)).toBeLessThan(0);
  expect(v(ra.holdings[0].percentage)).toBeGreaterThan(1);
  expect(ra.holdings.reduce((s, h) => s + v(h.percentage), 0)).toBeCloseTo(
    1,
    13,
  );
});

it("holding beta uses Phase 3's beta on the benchmark-aligned sample (single holding = portfolio beta)", () => {
  const r = build([{ ticker: "AAA", weight: 1 }]);
  expect(v(r.riskAnalytics.holdings[0].beta)).toBe(
    v(r.benchmarkAnalytics.relative.beta),
  );
  const b = r.riskAnalytics.holdings[0].beta;
  expect(b.available && b.notes?.[0]).toMatch(/Benchmark-aligned sample/);
  const cash = build([
    { ticker: "AAA", weight: 0.9 },
    { ticker: "CASH", weight: 0.1 },
  ]).riskAnalytics.holdings[1];
  expect(why(cash.beta)).toMatch(/locally riskless/);
});

it("target-weight σ is a model quantity distinct from realized (drifted, CASH-accruing) volatility", () => {
  const r = build([
    { ticker: "AAA", weight: 0.6 },
    { ticker: "CCC", weight: 0.3 },
    { ticker: "CASH", weight: 0.1 },
  ]);
  const target = v(r.riskAnalytics.portfolio.volatility);
  const realized = v(r.performance.risk.volatility);
  expect(target).not.toBeCloseTo(realized, 6);
  expect(Math.abs(target / realized - 1)).toBeLessThan(0.2); // same order of magnitude
  expect(r.riskAnalytics.label).toBe(
    "Risk Contribution at Target Weights — CASH treated as locally riskless",
  );
});

it("a later-starting holding moves the canonical sample to the common effective start", () => {
  const d = weekdays(300);
  const n = d.length - 1;
  const r = simulate({
    config: {
      holdings: [
        { ticker: "AAA", weight: 0.5 },
        { ticker: "LATE", weight: 0.5 },
      ],
      benchmark: "SPY",
      requestedStartDate: d[0],
      endDate: d.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("AAA", d, pricesFrom(stream(n, 0.9, 0.31, 0))),
      series(
        "LATE",
        d.slice(40),
        pricesFrom(stream(n - 40, 0.4, 0.8, 1)),
        d[40],
      ),
      series("SPY", d, pricesFrom(stream(n, 0.9, 0.31, 0.4))),
    ],
    treasury: { series: "DGS3MO", observations: ratesFor(d), provenance },
    sessions: sessions(d),
    now: "2030-01-01T00:00:00Z",
  });
  const s = r.riskAnalytics.sample;
  expect(s.available && s.sample).toMatchObject({
    startDate: d[40],
    returnCount: n - 40,
  });
});

it("snapshot replay reproduces risk analytics exactly", () => {
  for (const r of [
    build(three),
    build([{ ticker: "CASH", weight: 1 }], 70),
    build(three, 50),
  ]) {
    const replay = simulate({
      ...r.snapshot,
      config: r.config,
      now: r.metadata.generatedAt,
    });
    expect(replay.riskAnalytics).toEqual(r.riskAnalytics);
  }
});
