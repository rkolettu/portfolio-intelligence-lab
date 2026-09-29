import { ROLLING_METHODOLOGY } from "@/config/methodology";
import type {
  BenchmarkAlignment,
  LedgerRow,
  RollingAnalytics,
  RollingMetric,
} from "@/lib/types/analytics";
import type { Result } from "@/lib/types/data";
import { beta, correlation } from "./benchmark";
import { annualizedVolatility } from "./risk";
import { rollingSeries } from "./rolling";

type Pair = { p: number; b: number };
const split = (w: readonly Pair[]) => [w.map((x) => x.p), w.map((x) => x.b)];

/** Rolling 20/60/120-session statistics from the ledger. Volatility uses the
 * portfolio's realized daily returns; beta and correlation use ONLY the Phase 3
 * canonical aligned intervals, so a window touching a missing benchmark session is
 * unavailable rather than compressed. Pure; replayable from the snapshot. */
export function summarizeRolling(input: {
  ticker: string;
  ledger: readonly LedgerRow[];
  alignment: Result<BenchmarkAlignment>;
}): RollingAnalytics {
  const { ticker, ledger, alignment } = input;
  const windows = [...ROLLING_METHODOLOGY.windows];
  const intervals = ledger.map((r) => ({
    startDate: r.startDate,
    date: r.date,
  }));
  const returns = ledger.map((r) => r.return);
  const volatility: RollingMetric = {
    available: true,
    series: windows.map((n) =>
      rollingSeries(intervals, returns, n, annualizedVolatility),
    ),
  };
  let relative: { beta: RollingMetric; correlation: RollingMetric };
  if (!alignment.ok || !alignment.value.sample) {
    const reason = alignment.ok
      ? "The benchmark has no return interval overlapping the portfolio sample."
      : alignment.error.message;
    relative = {
      beta: { available: false, reason },
      correlation: { available: false, reason },
    };
  } else {
    const aligned = new Map(
      alignment.value.observations.map((o) => [
        `${o.startDate}|${o.date}`,
        { p: o.portfolioReturn, b: o.benchmarkReturn },
      ]),
    );
    const pairs = intervals.map(
      (i) => aligned.get(`${i.startDate}|${i.date}`) ?? null,
    );
    const metric = (
      f: (
        p: readonly number[],
        b: readonly number[],
      ) => ReturnType<typeof beta>,
    ): RollingMetric => ({
      available: true,
      series: windows.map((n) =>
        rollingSeries(intervals, pairs, n, (w) => {
          const [p, b] = split(w);
          return f(p, b);
        }),
      ),
    });
    relative = { beta: metric(beta), correlation: metric(correlation) };
  }
  return {
    methodologyVersion: ROLLING_METHODOLOGY.version,
    benchmarkTicker: ticker,
    windows,
    defaultWindow: ROLLING_METHODOLOGY.defaultWindow,
    dates: intervals.map((i) => i.date),
    volatility,
    ...relative,
  };
}
