import type {
  AlignedInterval,
  BenchmarkAlignment,
  BenchmarkPath,
  HoldingAlignment,
  LedgerRow,
} from "@/lib/types/analytics";
import type { PortfolioHolding } from "@/lib/types/portfolio";
import type { HistoricalSeries, Result, Session } from "@/lib/types/data";
import { arithmeticReturn, compoundWealth } from "@/lib/analytics/returns";
import { normalizePrices } from "@/lib/market-data/normalize";
import { sampleMetadata, snapshotHash } from "./metadata";
import { errorResult, fail } from "@/lib/utils/errors";

/** The ONE place portfolio intervals are paired with benchmark prices. An interval
 * (prior session close → session close) is aligned only when the benchmark has an
 * adjusted price at both endpoints; a missing session is never bridged or filled.
 * Every benchmark-relative metric, the growth path and benchmark drawdown derive
 * from this result. */
export function alignBenchmark(
  benchmark: HistoricalSeries | undefined,
  sessions: Session[],
  ledger: readonly LedgerRow[],
): Result<BenchmarkAlignment> {
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
    const priced = sessions.filter((s) => prices.has(s.date));
    const span = priced.length
      ? sessions.filter(
          (s) => s.date >= priced[0].date && s.date <= priced.at(-1)!.date,
        )
      : [];
    const observations: AlignedInterval[] = ledger.flatMap((row) =>
      prices.has(row.startDate) && prices.has(row.date)
        ? [
            {
              startDate: row.startDate,
              date: row.date,
              portfolioReturn: row.return,
              benchmarkReturn: arithmeticReturn(
                prices.get(row.startDate)!,
                prices.get(row.date)!,
              ),
              riskFreeReturn: row.riskFreeReturn,
            },
          ]
        : [],
    );
    const first = observations[0];
    const last = observations.at(-1);
    const inside = first
      ? ledger.filter((r) => r.date > first.startDate && r.date <= last!.date)
      : [];
    const interior = inside.length - observations.length;
    const leading = first
      ? ledger.filter((r) => r.date <= first.startDate).length
      : ledger.length;
    const trailing = last
      ? ledger.filter((r) => r.startDate >= last.date).length
      : 0;
    const available = observations.filter(
      (o) => o.riskFreeReturn !== null,
    ).length;
    return {
      ok: true,
      value: {
        ticker: benchmark.ticker,
        observations,
        sample: first
          ? {
              startDate: first.startDate,
              endDate: last!.date,
              returnCount: observations.length,
              // Same identity construction as sampleMetadata for consecutive sessions.
              intervalSetId: snapshotHash(
                observations.map((o) => [o.startDate, o.date]),
              ),
              excludedIntervalCount: interior,
              excludedReasons: interior
                ? [
                    `${interior} interval${interior === 1 ? "" : "s"} inside the comparison period lack a benchmark price at one endpoint and are excluded, not bridged.`,
                  ]
                : [],
            }
          : null,
        pricedSessions: priced.map((s) => s.date),
        missingSessions: span
          .filter((s) => !prices.has(s.date))
          .map((s) => s.date),
        leadingIntervalsExcluded: leading,
        trailingIntervalsExcluded: trailing,
        riskFree: {
          complete: available === observations.length,
          available,
          required: observations.length,
        },
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

/** Phase 1 continuous-overlap growth path, derived from the canonical alignment.
 * Requires continuous coverage; interior gaps make compounded comparison wealth
 * unavailable rather than joining across them. */
export function benchmarkPath(
  alignment: Result<BenchmarkAlignment>,
  sessions: Session[],
  ledger: readonly LedgerRow[],
  initialWealth: number,
): Result<BenchmarkPath> {
  try {
    if (!alignment.ok) return alignment;
    const a = alignment.value;
    if (a.pricedSessions.length < 2)
      fail(
        "INSUFFICIENT_HISTORY",
        "Benchmark has fewer than two common observations.",
      );
    if (a.missingSessions.length)
      fail(
        "COVERAGE_GAP",
        "Benchmark has interior gaps; continuous comparison wealth is unavailable.",
      );
    const overlap = sessions.filter(
      (s) =>
        s.date >= a.pricedSessions[0] && s.date <= a.pricedSessions.at(-1)!,
    );
    const intervals = a.observations.map((o) => ({
      date: o.date,
      startDate: o.startDate,
      return: o.benchmarkReturn,
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

/** Canonical risky-holding sample: the one common valid-interval set that drives
 * covariance, correlation, standalone volatility and risk contribution. Holding
 * returns come from the ledger (adjusted-price ratios on consecutive covered
 * sessions); an interval is kept only when EVERY risky holding has a finite return
 * on it, so no matrix cell ever uses a different or pairwise sample. CASH stays
 * outside the risky matrix. `holdings` must be the ledger's positive-weight list. */
export function alignHoldings(
  holdings: readonly PortfolioHolding[],
  ledger: readonly LedgerRow[],
): HoldingAlignment {
  const risky = holdings
    .map((h, index) => ({ ...h, index }))
    .filter((h) => h.ticker !== "CASH" && h.weight > 0);
  const rows = ledger.flatMap((row) => {
    const returns = risky.map((h) => row.holdingReturns[h.index]);
    return risky.length && returns.every((r) => Number.isFinite(r))
      ? [{ startDate: row.startDate, date: row.date, returns }]
      : [];
  });
  const first = rows[0];
  const last = rows.at(-1);
  const inside = first
    ? ledger.filter((r) => r.date > first.startDate && r.date <= last!.date)
    : [];
  const excluded = inside.length - rows.length;
  return {
    tickers: risky.map((h) => h.ticker),
    weights: risky.map((h) => h.weight),
    cashWeight: holdings
      .filter((h) => h.ticker === "CASH")
      .reduce((a, h) => a + h.weight, 0),
    rows,
    sample: first
      ? {
          startDate: first.startDate,
          endDate: last!.date,
          returnCount: rows.length,
          intervalSetId: snapshotHash(rows.map((r) => [r.startDate, r.date])),
          excludedIntervalCount: excluded,
          excludedReasons: excluded
            ? [
                `${excluded} interval${excluded === 1 ? "" : "s"} lack a valid return for at least one risky holding and are excluded from every matrix cell.`,
              ]
            : [],
        }
      : null,
  };
}
