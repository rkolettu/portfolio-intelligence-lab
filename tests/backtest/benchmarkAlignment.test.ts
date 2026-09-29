import { expect, it } from "vitest";
import { alignBenchmark, benchmarkPath } from "@/lib/backtest/alignment";
import { simulate } from "@/lib/backtest/engine";
import { arithmeticReturn, compoundWealth } from "@/lib/analytics/returns";
import { normalizePrices } from "@/lib/market-data/normalize";
import { sampleMetadata } from "@/lib/backtest/metadata";
import { errorResult, fail } from "@/lib/utils/errors";
import type { BenchmarkPath, LedgerRow } from "@/lib/types/analytics";
import type { HistoricalSeries, Result, Session } from "@/lib/types/data";
import { series, sessions } from "../fixtures/helpers";

// Verbatim Phase 1 implementation (commit 3bf96b9), kept as the reference that
// the alignment-derived benchmarkPath must reproduce exactly.
function phase1BenchmarkPath(
  benchmark: HistoricalSeries | undefined,
  sessions: Session[],
  ledger: LedgerRow[],
  initialWealth: number,
): Result<BenchmarkPath> {
  try {
    if (!benchmark)
      fail(
        "INSUFFICIENT_HISTORY",
        "Benchmark history is unavailable; portfolio history is unaffected.",
      );
    if (
      benchmark.convention !== "total_return_aware_adjusted" ||
      benchmark.currency !== "USD"
    )
      fail(
        "MALFORMED_DATA",
        "Benchmark return convention differs from portfolio.",
      );
    const prices = new Map(
      normalizePrices(benchmark.observations).map((p) => [
        p.date,
        p.adjustedClose,
      ]),
    );
    const valid = sessions.filter((s) => prices.has(s.date));
    if (valid.length < 2)
      fail(
        "INSUFFICIENT_HISTORY",
        "Benchmark has fewer than two common observations.",
      );
    const overlap = sessions.filter(
      (s) => s.date >= valid[0].date && s.date <= valid.at(-1)!.date,
    );
    if (overlap.some((s) => !prices.has(s.date)))
      fail(
        "COVERAGE_GAP",
        "Benchmark has interior gaps; continuous comparison wealth is unavailable.",
      );
    const intervals = overlap.slice(1).map((s, i) => ({
      date: s.date,
      startDate: overlap[i].date,
      return: arithmeticReturn(
        prices.get(overlap[i].date)!,
        prices.get(s.date)!,
      ),
    }));
    const values = compoundWealth(
      initialWealth,
      intervals.map((i) => i.return),
    );
    const portfolioValues = new Map([
      [sessions[0].date, initialWealth],
      ...ledger.map((r) => [r.date, r.wealth] as [string, number]),
    ]);
    const base = portfolioValues.get(overlap[0].date)!;
    return {
      ok: true,
      value: {
        sample: sampleMetadata(
          overlap,
          sessions.length - overlap.length,
          overlap.length < sessions.length
            ? ["Benchmark coverage shortens comparison."]
            : [],
        ),
        intervals,
        points: overlap.map((s, i) => ({
          date: s.date,
          portfolioWealth:
            (portfolioValues.get(s.date)! / base) * initialWealth,
          benchmarkWealth: values[i],
        })),
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

const days = [
  "2024-05-28",
  "2024-05-29",
  "2024-05-30",
  "2024-05-31",
  "2024-06-03",
  "2024-06-04",
  "2024-06-05",
  "2024-06-06",
];
function run(
  benchmarkDates: string[] | null,
  portfolioDates = days,
  benchmarkPrices?: number[],
) {
  const portfolio = series(
    "QQQ",
    portfolioDates,
    portfolioDates.map((_, i) => 100 + i * (i % 2 ? 1.5 : -0.7)),
  );
  const prices = [portfolio];
  if (benchmarkDates)
    prices.push(
      series(
        "VT",
        benchmarkDates,
        benchmarkPrices ??
          benchmarkDates.map((_, i) => 50 + i * (i % 3 ? 0.9 : -1.1)),
      ),
    );
  return simulate({
    config: {
      holdings: [{ ticker: "QQQ", weight: 1 }],
      benchmark: "VT",
      requestedStartDate: portfolioDates[0],
      endDate: portfolioDates.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices,
    treasury: null,
    sessions: sessions(portfolioDates),
    now: "2024-06-07T12:00:00Z",
  });
}
const sessionList = (r: ReturnType<typeof run>) =>
  r.snapshot.sessions.filter(
    (s) => s.date >= r.initialDate && s.date <= r.metadata.effectiveEndDate,
  );

it("alignment-derived benchmarkPath reproduces the Phase 1 implementation exactly", () => {
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const r = run(null);
  const s = sessionList(r);
  const cases: (HistoricalSeries | undefined)[] = [
    undefined,
    {
      ...series(
        "VT",
        days,
        days.map(() => 1),
      ),
      currency: "EUR" as "USD",
    },
  ];
  for (let trial = 0; trial < 300; trial++) {
    const kept = days.filter(() => rand() < 0.75);
    cases.push(
      series(
        "VT",
        kept,
        kept.map(() => 10 + rand() * 90),
      ),
    );
  }
  cases.push(
    series(
      "VT",
      days,
      days.map((_, i) => 100 + i),
    ),
    series("VT", [days[0], days[7]], [1, 2]),
    series("VT", [days[3]], [5]),
  );
  for (const bench of cases) {
    const expected = phase1BenchmarkPath(bench, s, r.ledger, 10_000);
    const actual = benchmarkPath(
      alignBenchmark(bench, s, r.ledger),
      s,
      r.ledger,
      10_000,
    );
    expect(actual).toEqual(expected);
  }
});

it("aligns only intervals with benchmark prices at BOTH endpoints; a missing session is never bridged", () => {
  // Benchmark lacks 05-31: intervals 05-30→05-31 and 05-31→06-03 drop; no 05-30→06-03 return is invented.
  const kept = days.filter((d) => d !== "2024-05-31");
  const r = run(kept);
  const a = alignBenchmark(r.snapshot.prices[1], sessionList(r), r.ledger);
  expect(a.ok).toBe(true);
  if (!a.ok) return;
  expect(a.value.observations.map((o) => [o.startDate, o.date])).toEqual([
    ["2024-05-28", "2024-05-29"],
    ["2024-05-29", "2024-05-30"],
    ["2024-06-03", "2024-06-04"],
    ["2024-06-04", "2024-06-05"],
    ["2024-06-05", "2024-06-06"],
  ]);
  expect(a.value.missingSessions).toEqual(["2024-05-31"]);
  expect(a.value.sample).toMatchObject({
    startDate: days[0],
    endDate: days[7],
    returnCount: 5,
    excludedIntervalCount: 2,
  });
  expect(a.value.sample!.excludedReasons[0]).toMatch(
    /2 intervals inside the comparison period/,
  );
  // Each benchmark return is exactly the price ratio on that interval's own endpoints.
  const px = new Map(
    r.snapshot.prices[1].observations.map((p) => [p.date, p.adjustedClose]),
  );
  for (const o of a.value.observations)
    expect(o.benchmarkReturn).toBe(px.get(o.date)! / px.get(o.startDate)! - 1);
  // The portfolio side is the ledger, untouched.
  const ledger = new Map(r.ledger.map((l) => [l.date, l]));
  for (const o of a.value.observations) {
    expect(o.portfolioReturn).toBe(ledger.get(o.date)!.return);
    expect(o.riskFreeReturn).toBe(ledger.get(o.date)!.riskFreeReturn);
  }
});

it("benchmark starting later shortens only the comparison, with exact overlap dates and counts", () => {
  const r = run(days.slice(3));
  const a = alignBenchmark(r.snapshot.prices[1], sessionList(r), r.ledger);
  if (!a.ok) throw new Error(a.error.message);
  expect(a.value.sample).toMatchObject({
    startDate: "2024-05-31",
    endDate: "2024-06-06",
    returnCount: 4,
    excludedIntervalCount: 0,
  });
  expect(a.value.leadingIntervalsExcluded).toBe(3);
  expect(a.value.trailingIntervalsExcluded).toBe(0);
  expect(r.ledger).toHaveLength(7); // absolute portfolio history is not shortened
});

it("portfolio starting later than the benchmark begins the comparison at the portfolio start", () => {
  const benchDates = ["2024-05-22", "2024-05-23", "2024-05-24", ...days];
  const r = run(benchDates, days);
  const a = alignBenchmark(r.snapshot.prices[1], sessionList(r), r.ledger);
  if (!a.ok) throw new Error(a.error.message);
  expect(a.value.sample).toMatchObject({
    startDate: days[0],
    endDate: days[7],
    returnCount: 7,
  });
  expect(a.value.leadingIntervalsExcluded).toBe(0);
  expect(a.value.pricedSessions).toEqual(days);
});

it("benchmark ending early excludes trailing intervals and reports them", () => {
  const r = run(days.slice(0, 5));
  const a = alignBenchmark(r.snapshot.prices[1], sessionList(r), r.ledger);
  if (!a.ok) throw new Error(a.error.message);
  expect(a.value.sample).toMatchObject({
    startDate: days[0],
    endDate: days[4],
    returnCount: 4,
  });
  expect(a.value.trailingIntervalsExcluded).toBe(3);
});

it("reports no sample (not a zero-length one) when no interval aligns", () => {
  const r = run([days[0], days[2], days[4]]);
  const a = alignBenchmark(r.snapshot.prices[1], sessionList(r), r.ledger);
  if (!a.ok) throw new Error(a.error.message);
  expect(a.value.observations).toEqual([]);
  expect(a.value.sample).toBeNull();
  expect(alignBenchmark(undefined, sessionList(r), r.ledger)).toMatchObject({
    ok: false,
    error: { code: "INSUFFICIENT_HISTORY" },
  });
});
