"use client";
import type { Metric, PerformanceSummary } from "@/lib/types/analytics";
import {
  percent,
  ratio,
  unsignedPercent,
  wholeMoney,
} from "@/lib/utils/format";
import { InfoTip } from "./InfoTip";

type Kpi = {
  label: string;
  metric: Metric;
  format: (value: number) => string;
  formula: string;
  footnote: (m: Extract<Metric, { available: true }>) => string;
};

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
      formula: `Indexed ${wholeMoney(performance.initialWealth)} compounded geometrically through every daily portfolio return.`,
      footnote: (m) =>
        `From ${wholeMoney(performance.initialWealth)} · ${m.sample.startDate}`,
    },
    {
      label: "Cumulative return",
      metric: portfolio.cumulativeReturn,
      format: percent,
      formula: "Ending value ÷ starting value − 1.",
      footnote: (m) => `${m.sample.startDate} → ${m.sample.endDate}`,
    },
    {
      label: "CAGR",
      metric: portfolio.cagr,
      format: percent,
      formula:
        "(Ending ÷ starting)^(1 ÷ years) − 1, where years = actual calendar days ÷ 365.25.",
      footnote: (m) =>
        m.notes?.length
          ? "Annualized from < 1 year"
          : `${performance.elapsedYears.toFixed(2)} calendar years`,
    },
    {
      label: "Annualized volatility",
      metric: risk.volatility,
      format: unsignedPercent,
      formula:
        "Sample standard deviation (n − 1) of daily arithmetic returns × √252.",
      footnote: (m) =>
        `${m.sample.returnCount.toLocaleString()} daily returns${m.notes?.length ? " · short sample" : ""}`,
    },
    {
      label: "Sharpe ratio",
      metric: risk.sharpe,
      format: ratio,
      formula:
        "Mean daily excess return ÷ its sample standard deviation × √252. Excess return = portfolio return − that interval's prior-known DGS3MO accrual (actual days ÷ 365). The current Treasury curve is never used.",
      footnote: (m) =>
        `n = ${m.sample.returnCount.toLocaleString()} · historical DGS3MO`,
    },
    {
      label: "Sortino ratio",
      metric: risk.sortino,
      format: ratio,
      formula:
        "(Mean daily excess × 252) ÷ (√mean(min(excess, 0)²) × √252). Downside deviation uses every day in the sample, with non-negative days counted as zero.",
      footnote: () => "Full-sample downside",
    },
    {
      label: "Maximum drawdown",
      metric: risk.maximumDrawdown,
      format: percent,
      formula:
        "Deepest decline of compounded daily-close wealth below its running peak: min(wealth ÷ running peak − 1).",
      footnote: () =>
        performance.maximumDrawdownEpisode
          ? `Peak ${performance.maximumDrawdownEpisode.peakDate}`
          : "No drawdown",
    },
  ];
  return (
    <dl className="kpi-strip">
      {kpis.map((k) => (
        <div className="kpi" key={k.label}>
          <dt>
            {k.label}
            <InfoTip label={k.label}>
              {k.formula}
              {k.metric.available ? (
                k.metric.notes?.map((n) => (
                  <span className="tip-note" key={n}>
                    {n}
                  </span>
                ))
              ) : (
                <span className="tip-note">
                  Not available: {k.metric.reason}
                </span>
              )}
            </InfoTip>
          </dt>
          <dd>
            {k.metric.available ? (
              <>
                <span className="kpi-value">{k.format(k.metric.value)}</span>
                <span className="kpi-foot">{k.footnote(k.metric)}</span>
              </>
            ) : (
              <>
                <span className="kpi-value kpi-na">N/A</span>
                <span className="kpi-foot">
                  Undefined for this sample · see ⓘ
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
