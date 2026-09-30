import type { BacktestResult, Metric, StressAnalytics } from "@/lib/types/analytics";
import { monthlyCandles, type Candle } from "./geometry";

/** A small, read-only projection of the cached sample analysis for the landing
 * page's chapters. Every number is copied from the engine's stored result; the
 * only transformation is grouping the stored wealth path into monthly candles for
 * drawing. */
export type SampleDigest = {
  refreshedAt: string;
  provider: string;
  benchmark: string;
  start: string;
  end: string;
  observations: number;
  holdings: {
    ticker: string;
    weight: number;
    risk: number | null;
    riskless: boolean;
  }[];
  correlation: { tickers: string[]; matrix: (number | null)[][] } | null;
  candles: Candle[];
  metrics: {
    cagr: number | null;
    volatility: number | null;
    maxDrawdown: number | null;
    benchmarkCagr: number | null;
  };
  stress: {
    id: string;
    name: string;
    start: string;
    end: string;
    portfolio: number | null;
    benchmark: number | null;
    holdings: { ticker: string; return: number }[];
  }[];
};

const v = (m: Metric | undefined) => (m && m.available ? m.value : null);

export function toDigest(
  refreshedAt: string,
  provider: string,
  a: BacktestResult,
  s: StressAnalytics | null,
): SampleDigest {
  const r = a.riskAnalytics;
  const g = a.benchmarkAnalytics.geometric;
  return {
    refreshedAt,
    provider,
    benchmark: a.config.benchmark,
    start: a.initialDate,
    end: a.metadata.effectiveEndDate,
    observations: a.ledger.length,
    holdings: r.holdings.map((h) => ({
      ticker: h.ticker,
      weight: h.weight,
      risk: h.percentage.available ? h.percentage.value : null,
      riskless: h.riskless,
    })),
    correlation: r.correlation.available
      ? { tickers: r.correlation.tickers, matrix: r.correlation.matrix }
      : null,
    candles: monthlyCandles(
      a.performance.growth.map((p) => ({ date: p.date, value: p.wealth })),
    ),
    metrics: {
      cagr: v(a.performance.portfolio.cagr),
      volatility: v(a.performance.risk.volatility),
      maxDrawdown: v(a.performance.risk.maximumDrawdown),
      benchmarkCagr: g.benchmarkCagr.available ? g.benchmarkCagr.value : null,
    },
    stress: (s?.events ?? [])
      .filter((e) => e.kind === "preset")
      .map((e) => ({
        id: e.id,
        name: e.name,
        start: e.startDate ?? e.requestedStartDate,
        end: e.endDate ?? e.requestedEndDate,
        portfolio: e.status === "complete" ? v(e.portfolioReturn) : null,
        benchmark: e.status === "complete" ? v(e.benchmarkReturn) : null,
        holdings:
          e.status === "complete"
            ? e.holdings.map((h) => ({ ticker: h.ticker, return: h.return }))
            : [],
      })),
  };
}
