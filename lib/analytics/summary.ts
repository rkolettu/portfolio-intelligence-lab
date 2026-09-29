import { PERFORMANCE_METHODOLOGY } from "@/config/methodology";
import type {
  LedgerRow,
  Metric,
  PerformanceSummary,
  Sample,
  WealthPoint,
} from "@/lib/types/analytics";
import { calendarDays } from "@/lib/utils/dates";
import {
  drawdownEpisodes,
  drawdownSeries,
  maximumDrawdown,
  rankEpisodes,
} from "./drawdown";
import {
  cagr,
  cumulativeReturn,
  elapsedYears,
  type Computed,
} from "./performance";
import {
  annualizedVolatility,
  excessReturns,
  sharpeRatio,
  sortinoRatio,
} from "./risk";

function metric(result: Computed, sample: Sample): Metric {
  return result.ok
    ? {
        available: true,
        value: result.value,
        sample,
        ...(result.notes.length ? { notes: result.notes } : {}),
      }
    : { available: false, reason: result.reason };
}
const value = (v: number, notes: string[] = []): Computed => ({
  ok: true,
  value: v,
  notes,
});

/** Derive every Phase 2 metric from the Phase 1 ledger. Pure: no network, clock or
 * current data. Sharpe/Sortino use the ledger's prior-known risk-free returns. */
export function summarizePerformance(input: {
  initialWealth: number;
  initialDate: string;
  ledger: readonly LedgerRow[];
  sample: Sample;
}): PerformanceSummary {
  const { initialWealth, initialDate, ledger, sample } = input;
  const growth: WealthPoint[] = [
    { date: initialDate, wealth: initialWealth },
    ...ledger.map((r) => ({ date: r.date, wealth: r.wealth })),
  ];
  const end = growth.at(-1)!;
  const returns = ledger.map((r) => r.return);
  const drawdown = drawdownSeries(growth);
  const chronological = drawdownEpisodes(growth);
  const ranked = rankEpisodes(chronological);
  const deepest = maximumDrawdown(drawdown);
  const excess = excessReturns(ledger);
  const available = ledger.filter((r) => r.riskFreeReturn !== null).length;
  const missingRates: Computed = {
    ok: false,
    reason: `Historical risk-free returns are missing for ${ledger.length - available} of ${ledger.length} intervals; the ratio is not computed on a partial sample.`,
  };
  const current = drawdown.at(-1)!.drawdown;
  return {
    methodologyVersion: PERFORMANCE_METHODOLOGY.version,
    initialWealth,
    portfolio: {
      endingValue: metric(value(end.wealth), sample),
      cumulativeReturn: metric(
        value(cumulativeReturn(initialWealth, end.wealth)),
        sample,
      ),
      cagr: metric(
        cagr(initialWealth, end.wealth, initialDate, end.date),
        sample,
      ),
    },
    risk: {
      volatility: metric(annualizedVolatility(returns), sample),
      sharpe: metric(excess ? sharpeRatio(excess) : missingRates, sample),
      sortino: metric(excess ? sortinoRatio(excess) : missingRates, sample),
      maximumDrawdown: metric(
        value(
          deepest,
          deepest === 0
            ? ["No drawdown: wealth never closed below a prior peak."]
            : ["Daily-close drawdown; intraday losses can be larger."],
        ),
        sample,
      ),
    },
    currentDrawdown: metric(
      value(current, current === 0 ? ["At the high-water mark."] : []),
      sample,
    ),
    maximumDrawdownEpisode: deepest < 0 ? ranked[0] : null,
    episodes: ranked.slice(0, PERFORMANCE_METHODOLOGY.episodeLimit),
    episodeCount: chronological.length,
    growth,
    drawdown,
    riskFree: { complete: excess !== null, available, required: ledger.length },
    elapsedCalendarDays: calendarDays(initialDate, end.date),
    elapsedYears: elapsedYears(initialDate, end.date),
  };
}
