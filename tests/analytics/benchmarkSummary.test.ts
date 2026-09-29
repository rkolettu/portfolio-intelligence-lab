import { expect, it } from "vitest";
import { simulate } from "@/lib/backtest/engine";
import { beta, capmRegression } from "@/lib/analytics/benchmark";
import { accrueCash } from "@/lib/treasury-data/alignment";
import { calendarDays } from "@/lib/utils/dates";
import type { BacktestResult, Metric } from "@/lib/types/analytics";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

// Twelve weekday sessions spanning two weekends (irregular calendar gaps).
const dates = [
  "2024-05-28",
  "2024-05-29",
  "2024-05-30",
  "2024-05-31",
  "2024-06-03",
  "2024-06-04",
  "2024-06-05",
  "2024-06-06",
  "2024-06-07",
  "2024-06-10",
  "2024-06-11",
  "2024-06-12",
];
// Published 20:15Z on its date, after that session's 20:00Z close.
const rate = (
  date: string,
  y: number,
  availableAt = `${date}T20:15:00Z`,
): TreasuryObservation => ({
  date,
  annualYield: y,
  availableAt,
  availability: "published",
});
const flatRates = (y = 0.05) => ["2024-05-24", ...dates].map((d) => rate(d, y));
const pricesFrom = (returns: number[], start = 100) =>
  returns.reduce((acc, r) => [...acc, acc.at(-1)! * (1 + r)], [start]);
const qqq = pricesFrom([
  0.012, -0.008, 0.004, -0.015, 0.02, 0.001, -0.006, 0.009, 0.003, -0.011,
  0.007,
]);
const spy = pricesFrom([
  0.008, -0.004, 0.006, -0.01, 0.012, -0.002, -0.003, 0.005, 0.004, -0.006,
  0.002,
]);

type Build = {
  holdings?: { ticker: string; weight: number }[];
  benchmark?: string;
  series?: ReturnType<typeof series>[];
  rates?: TreasuryObservation[] | null;
  dates?: string[];
};
function build(o: Build = {}): BacktestResult {
  const d = o.dates ?? dates;
  return simulate({
    config: {
      holdings: o.holdings ?? [{ ticker: "QQQ", weight: 1 }],
      benchmark: o.benchmark ?? "SPY",
      requestedStartDate: d[0],
      endDate: d.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: o.series ?? [series("QQQ", dates, qqq), series("SPY", dates, spy)],
    treasury:
      o.rates === null
        ? null
        : {
            series: "DGS3MO",
            observations: o.rates ?? flatRates(),
            provenance,
          },
    sessions: sessions(d),
    now: "2024-06-13T12:00:00Z",
  });
}
const v = (m: Metric) => {
  if (!m.available) throw new Error(m.reason);
  return m.value;
};
const why = (m: Metric) => (m.available ? "" : m.reason);
function assertFinite(value: unknown, path = "result"): void {
  if (typeof value === "number")
    expect(Number.isFinite(value), path).toBe(true);
  else if (value && typeof value === "object")
    for (const [k, x] of Object.entries(value)) assertFinite(x, `${path}.${k}`);
}
const relativeMetrics = (r: BacktestResult) =>
  Object.values(r.benchmarkAnalytics.relative);

it("identical portfolio and benchmark: β 1, ρ 1, TE 0, active 0, IR undefined, α 0, equal drawdowns", () => {
  const r = build({ holdings: [{ ticker: "SPY", weight: 1 }] });
  const rel = r.benchmarkAnalytics.relative;
  expect(v(rel.beta)).toBe(1);
  expect(v(rel.correlation)).toBe(1);
  expect(v(rel.trackingError)).toBe(0);
  expect(v(rel.annualizedActiveReturn)).toBe(0);
  expect(why(rel.informationRatio)).toMatch(/Tracking error is zero/);
  expect(v(rel.alpha)).toBeCloseTo(0, 15);
  expect(v(rel.regressionBeta)).toBeCloseTo(1, 14);
  const g = r.benchmarkAnalytics.geometric;
  expect(v(g.portfolioCumulativeReturn)).toBeCloseTo(
    v(g.benchmarkCumulativeReturn),
    14,
  );
  expect(v(g.portfolioCagr)).toBeCloseTo(v(g.benchmarkCagr), 12);
  const dd = r.benchmarkAnalytics.drawdown;
  expect(dd.available && dd.series.map((p) => p.drawdown)).toEqual(
    r.performance.drawdown.map((p) => expect.closeTo(p.drawdown, 14)),
  );
  assertFinite(r.benchmarkAnalytics);
});

it("every benchmark-relative metric, the geometric comparison and benchmark drawdown share ONE sample", () => {
  const r = build();
  const c = r.benchmarkAnalytics.comparison;
  if (!c.available) throw new Error(c.reason);
  expect(c.sample).toMatchObject({
    startDate: dates[0],
    endDate: dates[11],
    returnCount: 11,
    excludedIntervalCount: 0,
  });
  const all = [
    ...relativeMetrics(r),
    ...Object.values(r.benchmarkAnalytics.geometric),
  ];
  const dd = r.benchmarkAnalytics.drawdown;
  if (dd.available) all.push(dd.maximumDrawdown, dd.currentDrawdown);
  for (const m of all) {
    if (!m.available) throw new Error(m.reason);
    expect(m.sample).toEqual(c.sample);
  }
  // The Phase 1 growth path covers the identical interval set.
  expect(r.benchmark.ok && r.benchmark.value.sample.intervalSetId).toBe(
    c.sample.intervalSetId,
  );
});

it("benchmark starting later: relative analytics begin later; absolute portfolio analytics are unchanged", () => {
  const full = build();
  const late = build({
    series: [
      series("QQQ", dates, qqq),
      series("SPY", dates.slice(4), spy.slice(4), dates[4]),
    ],
  });
  const c = late.benchmarkAnalytics.comparison;
  if (!c.available) throw new Error(c.reason);
  expect(c.sample).toMatchObject({
    startDate: "2024-06-03",
    endDate: "2024-06-12",
    returnCount: 7,
  });
  expect(c.leadingIntervalsExcluded).toBe(4);
  expect(c.notes[0]).toMatch(
    /4 earlier portfolio intervals are outside the comparison/,
  );
  expect(late.performance).toEqual(full.performance);
  // Geometric CAGR uses the comparison period's own dates and rebased wealth.
  const pts = late.benchmark.ok ? late.benchmark.value.points : [];
  expect(v(late.benchmarkAnalytics.geometric.benchmarkCagr)).toBeCloseTo(
    Math.pow(
      pts.at(-1)!.benchmarkWealth / 10_000,
      365.25 / calendarDays("2024-06-03", "2024-06-12"),
    ) - 1,
    12,
  );
  expect(
    v(late.benchmarkAnalytics.geometric.portfolioCumulativeReturn),
  ).toBeCloseTo(
    late.ledger.at(-1)!.wealth /
      late.ledger.find((l) => l.date === "2024-06-03")!.wealth -
      1,
    12,
  );
});

it("portfolio starting later than the benchmark: comparison begins at the portfolio's effective start", () => {
  const r = build({
    series: [
      series("QQQ", dates.slice(2), qqq.slice(2), dates[2]),
      series("SPY", dates, spy),
    ],
  });
  expect(r.initialDate).toBe(dates[2]);
  const c = r.benchmarkAnalytics.comparison;
  expect(c.available && c.sample).toMatchObject({
    startDate: dates[2],
    returnCount: 9,
  });
  expect(c.available && c.leadingIntervalsExcluded).toBe(0);
});

it("missing benchmark dates: metrics use exactly the aligned intervals; compounded comparisons are unavailable", () => {
  const keep = dates.filter((d) => d !== "2024-06-05");
  const r = build({
    series: [
      series("QQQ", dates, qqq),
      series(
        "SPY",
        keep,
        spy.filter((_, i) => dates[i] !== "2024-06-05"),
      ),
    ],
  });
  const c = r.benchmarkAnalytics.comparison;
  if (!c.available) throw new Error(c.reason);
  expect(c.continuous).toBe(false);
  expect(c.sample).toMatchObject({ returnCount: 9, excludedIntervalCount: 2 });
  // Beta equals a direct computation on the aligned intervals only (no 06-04→06-06 bridge).
  const idx = [0, 1, 2, 3, 4, 7, 8, 9, 10];
  const p = idx.map((i) => qqq[i + 1] / qqq[i] - 1);
  const b = idx.map((i) => spy[i + 1] / spy[i] - 1);
  const direct = beta(p, b);
  expect(v(r.benchmarkAnalytics.relative.beta)).toBeCloseTo(
    direct.ok ? direct.value : NaN,
    12,
  );
  for (const m of Object.values(r.benchmarkAnalytics.geometric))
    expect(why(m)).toMatch(/interior gaps/);
  const dd = r.benchmarkAnalytics.drawdown;
  expect(!dd.available && dd.reason).toMatch(/interior gaps/);
  expect(r.ledger).toHaveLength(11);
});

it("recovers a known synthetic CAPM alpha end to end through prices and prior-known Treasury accruals", () => {
  // Design excess returns, then add each interval's actual prior-known accrual (5%, ACT/365,
  // 1- or 3-day gaps) to build prices. OLS must recover alphaDaily = 0.0002 and slope 1.3.
  const be = [
    -0.02, -0.01, 0, 0.01, 0.02, -0.015, 0.005, 0.012, -0.004, 0.008, -0.006,
  ];
  const beMean = be.reduce((a, x) => a + x, 0) / be.length;
  const raw = [
    0.001, -0.002, 0.0015, 0.0005, -0.001, 0.002, -0.0012, 0.0003, -0.0007,
    0.0011, -0.0004,
  ];
  // Residuals orthogonal to be and summing to zero (Gram–Schmidt on a fixed vector).
  const rm = raw.reduce((a, x) => a + x, 0) / raw.length;
  const c0 = raw.map((x) => x - rm);
  const bc = be.map((x) => x - beMean);
  const k =
    c0.reduce((a, x, i) => a + x * bc[i], 0) /
    bc.reduce((a, x) => a + x * x, 0);
  const e = c0.map((x, i) => x - k * bc[i]);
  const rf = dates
    .slice(1)
    .map((d, i) => accrueCash(0.05, calendarDays(dates[i], d)));
  const pe = be.map((x, i) => 0.0002 + 1.3 * x + e[i]);
  const r = build({
    series: [
      series("QQQ", dates, pricesFrom(pe.map((x, i) => x + rf[i]))),
      series("SPY", dates, pricesFrom(be.map((x, i) => x + rf[i]))),
    ],
  });
  expect(r.ledger.map((l) => l.riskFreeReturn)).toEqual(
    rf.map((x) => expect.closeTo(x, 16)),
  );
  expect(v(r.benchmarkAnalytics.relative.alpha)).toBeCloseTo(0.0002 * 252, 10);
  expect(v(r.benchmarkAnalytics.relative.regressionBeta)).toBeCloseTo(1.3, 9);
});

const spyAlpha = (rates: TreasuryObservation[]) =>
  build({ rates }).benchmarkAnalytics.relative.alpha;
const stepped = ["2024-05-24", ...dates].map((d, i) =>
  rate(d, 0.02 + 0.004 * i),
);
it("alpha uses only Treasury observations available before each interval's starting close", () => {
  const r = build({ rates: stepped });
  const byDate = new Map(stepped.map((x) => [x.date, x]));
  const close = new Map(r.snapshot.sessions.map((s) => [s.date, s.close]));
  const ledger = new Map(r.ledger.map((l) => [l.date, l]));
  for (const l of ledger.values()) {
    const used = byDate.get(l.rateObservationDate!)!;
    expect(Date.parse(used.availableAt)).toBeLessThan(
      Date.parse(close.get(l.startDate)!),
    );
  }
  // Alpha equals the regression on exactly those ledger accruals.
  const reg = capmRegression(
    r.ledger.map((l, i) => qqq[i + 1] / qqq[i] - 1 - l.riskFreeReturn!),
    r.ledger.map((l, i) => spy[i + 1] / spy[i] - 1 - l.riskFreeReturn!),
  );
  expect(v(r.benchmarkAnalytics.relative.alpha)).toBeCloseTo(
    reg.alpha.ok ? reg.alpha.value : NaN,
    14,
  );
});

it("later-published Treasury data cannot change earlier alpha observations", () => {
  const baseline = spyAlpha(stepped);
  // Extreme rates dated on or after the final session fund no interval in this sample.
  expect(
    spyAlpha([
      ...stepped.filter((x) => x.date < "2024-06-12"),
      rate("2024-06-12", 0.95),
    ]),
  ).toEqual(baseline);
  // Revising a rate's value but publishing it only after the sample ends changes nothing either:
  // the earlier observation for that date is what was known at each interval start.
  const revised = [...stepped, rate("2024-06-03", 0.9, "2024-06-12T21:00:00Z")];
  expect(spyAlpha(revised)).toEqual(baseline);
  // Delaying a release past later interval starts forces the prior-known fallback.
  const delayed = stepped.map((x) =>
    x.date === "2024-06-06"
      ? rate(x.date, x.annualYield, "2024-06-11T20:30:00Z")
      : x,
  );
  const r = build({ rates: delayed });
  expect(
    r.ledger.find((l) => l.startDate === "2024-06-07")!.rateObservationDate,
  ).toBe("2024-06-05");
  expect(v(r.benchmarkAnalytics.relative.alpha)).not.toBe(v(baseline));
});

it("incomplete Treasury coverage makes alpha unavailable instead of shrinking its sample", () => {
  const r = build({ rates: null });
  const rel = r.benchmarkAnalytics.relative;
  for (const m of [rel.alpha, rel.regressionBeta, rel.rSquared])
    expect(why(m)).toMatch(
      /missing for 11 of 11 comparison intervals; alpha is not estimated on a shorter sample/,
    );
  for (const m of [
    rel.beta,
    rel.correlation,
    rel.trackingError,
    rel.informationRatio,
    rel.annualizedActiveReturn,
  ])
    expect(m.available).toBe(true);
  expect(r.benchmarkAnalytics.riskFree).toEqual({
    complete: false,
    available: 0,
    required: 11,
  });
});

it("constant benchmark: beta and correlation undefined; alpha follows excess-benchmark variance", () => {
  const flat = dates.map(() => 50);
  const noRates = build({
    series: [series("QQQ", dates, qqq), series("SPY", dates, flat)],
    rates: flatRates(0),
  });
  expect(why(noRates.benchmarkAnalytics.relative.beta)).toMatch(
    /zero variance/,
  );
  expect(why(noRates.benchmarkAnalytics.relative.correlation)).toMatch(
    /zero variance/,
  );
  expect(why(noRates.benchmarkAnalytics.relative.alpha)).toMatch(
    /excess returns have zero variance/,
  );
  // 5% with weekend gaps makes Rb − Rf vary even though Rb is constant.
  const withRates = build({
    series: [series("QQQ", dates, qqq), series("SPY", dates, flat)],
  });
  expect(withRates.benchmarkAnalytics.relative.beta.available).toBe(false);
  expect(withRates.benchmarkAnalytics.relative.alpha.available).toBe(true);
  assertFinite(noRates.benchmarkAnalytics);
  assertFinite(withRates.benchmarkAnalytics);
});

it("benchmark drawdown uses the rebased benchmark wealth path, with recovery and current drawdown", () => {
  const bench = [100, 110, 99, 104, 111, 108, 106, 109, 112, 107, 105, 106];
  const r = build({
    series: [series("QQQ", dates, qqq), series("SPY", dates, bench)],
  });
  const dd = r.benchmarkAnalytics.drawdown;
  if (!dd.available) throw new Error(dd.reason);
  expect(dd.series[0]).toEqual({ date: dates[0], drawdown: 0 });
  expect(v(dd.maximumDrawdown)).toBeCloseTo(99 / 110 - 1, 12);
  expect(dd.maximumDrawdownEpisode).toMatchObject({
    peakDate: dates[1],
    troughDate: dates[2],
    recoveryDate: dates[4],
    calendarDaysToRecovery: 5,
    tradingDaysToRecovery: 3,
  });
  // Later unrecovered episode from the 112 peak; current drawdown 106/112 − 1.
  expect(v(dd.currentDrawdown)).toBeCloseTo(106 / 112 - 1, 12);
  expect(
    dd.episodes.find((e) => e.peakDate === dates[8])?.recoveryDate,
  ).toBeNull();
  expect(dd.series.every((p) => p.drawdown <= 0)).toBe(true);
  // Portfolio drawdown methodology is untouched.
  expect(r.performance).toEqual(build().performance);
});

it("snapshot replay reproduces benchmark analytics exactly", () => {
  for (const r of [
    build(),
    build({ rates: stepped }),
    build({ rates: null }),
  ]) {
    const replay = simulate({
      ...r.snapshot,
      config: r.config,
      now: r.metadata.generatedAt,
    });
    expect(replay.benchmarkAnalytics).toEqual(r.benchmarkAnalytics);
    expect(replay.metadata.snapshotHash).toBe(r.metadata.snapshotHash);
  }
});

it("no benchmark at all leaves every benchmark metric unavailable with the Phase 1 reason", () => {
  const r = build({ series: [series("QQQ", dates, qqq)], benchmark: "VT" });
  expect(r.benchmarkAnalytics.comparison).toEqual({
    available: false,
    reason:
      "Benchmark history is unavailable; portfolio history is unaffected.",
  });
  for (const m of [
    ...relativeMetrics(r),
    ...Object.values(r.benchmarkAnalytics.geometric),
  ])
    expect(why(m)).toMatch(/Benchmark history is unavailable/);
  expect(r.performance).toEqual(build().performance);
});
