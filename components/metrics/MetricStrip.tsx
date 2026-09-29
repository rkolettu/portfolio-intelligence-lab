"use client";
import type { PerformanceSummary } from "@/lib/types/analytics";
import {
  count,
  fixed,
  percent,
  ratio,
  unsignedPercent,
  wholeMoney,
} from "@/lib/utils/format";
import { KpiStrip, type Kpi } from "./KpiStrip";

/** Dense overview strip. Pure presentation: every number is precomputed. */
export function MetricStrip({
  performance,
}: {
  performance: PerformanceSummary;
}) {
  const { portfolio, risk } = performance;
  const kpis: Kpi[] = [
    {
      label: "Ending value",
      metric: portfolio.endingValue,
      format: wholeMoney,
      formula: `What ${wholeMoney(performance.initialWealth)} invested at the start grew to, compounding every daily return.`,
      footnote: () => `From ${wholeMoney(performance.initialWealth)}`,
    },
    {
      label: "Cumulative return",
      metric: portfolio.cumulativeReturn,
      format: percent,
      formula: "Total compounded return over the effective period.",
      footnote: (m) => `Since ${m.sample.startDate}`,
    },
    {
      label: "CAGR",
      metric: portfolio.cagr,
      format: percent,
      formula:
        "Compound annual growth rate: the steady yearly return that reaches the same ending value.",
      footnote: (m) =>
        m.notes?.length
          ? "Annualized from < 1 year"
          : `${fixed(performance.elapsedYears, 2)} calendar years`,
    },
    {
      label: "Annualized volatility",
      metric: risk.volatility,
      format: unsignedPercent,
      formula:
        "How widely daily returns vary, scaled to one year (standard deviation × √252).",
      footnote: (m) =>
        `${count(m.sample.returnCount, "daily return")}${m.notes?.length ? " · Limited History" : ""}`,
    },
    {
      label: "Sharpe ratio",
      metric: risk.sharpe,
      format: ratio,
      formula:
        "Annualized return above the Historical Risk-Free rate per unit of volatility. Uses historical 3-month Treasury yields, never today's curve.",
      footnote: () => "Historical Risk-Free · DGS3MO",
    },
    {
      label: "Sortino ratio",
      metric: risk.sortino,
      format: ratio,
      formula:
        "Like Sharpe, but divides by downside deviation only. Downside deviation uses every day in the sample, counting non-negative days as zero.",
      footnote: () => "Full-sample downside deviation",
    },
    {
      label: "Maximum drawdown",
      metric: risk.maximumDrawdown,
      format: percent,
      formula:
        "Largest peak-to-trough fall in daily-close wealth. Intraday losses can be larger.",
      footnote: () =>
        performance.maximumDrawdownEpisode
          ? `Peak ${performance.maximumDrawdownEpisode.peakDate}`
          : "No drawdown",
    },
  ];
  return <KpiStrip items={kpis} label="Performance overview" />;
}
