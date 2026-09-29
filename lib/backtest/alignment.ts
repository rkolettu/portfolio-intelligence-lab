import type { BenchmarkPath, LedgerRow } from "@/lib/types/analytics";
import type { HistoricalSeries, Result, Session } from "@/lib/types/data";
import { arithmeticReturn, compoundWealth } from "@/lib/analytics/returns";
import { normalizePrices } from "@/lib/market-data/normalize";
import { sampleMetadata } from "./metadata";
import { errorResult, fail } from "@/lib/utils/errors";
export function benchmarkPath(
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
    const intervals = overlap
      .slice(1)
      .map((s, i) => ({
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
