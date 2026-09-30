"use client";
import type { Metric, RiskAnalytics } from "@/lib/types/analytics";
import { decimal, fixed, unsignedPercent } from "@/lib/utils/format";
import { KpiStrip } from "@/components/metrics/KpiStrip";
import { DotRow, PairBars, PairDots, WeightBlocks } from "@/components/ui/motifs";
import { Unavailable } from "@/components/ui/StatusNotice";
import { CorrelationHeatmap } from "./CorrelationHeatmap";

/** Diversification & correlation: concentration of capital, the correlation
 * benefit and the common-sample correlation matrix. Precomputed values only. */
export function DiversificationSection({ risk }: { risk: RiskAnalytics }) {
  const s = risk.sample;
  const p = risk.portfolio;
  const c = risk.concentration;
  const corr = risk.correlation;
  const sample = s.available ? s.sample : risk.returnContribution.sample;
  const pair = (
    which: "highest" | "lowest",
  ): { metric: Metric; foot: string } => {
    const v = corr.available ? corr[which] : null;
    return v
      ? {
          metric: { available: true, value: v.correlation, sample },
          foot: `${v.a} / ${v.b}`,
        }
      : {
          metric: {
            available: false,
            reason: corr.available
              ? "A correlation pair needs at least two risky holdings with non-constant returns."
              : corr.reason,
          },
          foot: "",
        };
  };
  const high = pair("highest");
  const low = pair("lowest");
  return (
    <>
      <KpiStrip
        label="Diversification overview"
        items={[
          {
            label: "Weighted standalone volatility",
            metric: p.weightedAverageVolatility,
            format: unsignedPercent,
            formula:
              "Volatility the portfolio would have if every risky holding moved in lockstep: the weight-averaged standalone volatilities.",
            footnote: () => "Before diversification",
          },
          {
            label: "Diversification ratio",
            metric: p.diversificationRatio,
            format: (v) => `${decimal(v)}×`,
            formula:
              "Weighted standalone volatility ÷ portfolio volatility. Above 1 means correlations below +1 reduce risk.",
            footnote: () => "Correlation benefit",
            viz:
              p.weightedAverageVolatility.available && p.volatility.available ? (
                <PairBars
                  a={p.weightedAverageVolatility.value}
                  b={p.volatility.value}
                />
              ) : undefined,
          },
          {
            label: "Effective holdings",
            metric: {
              available: true,
              value: c.effectiveHoldings,
              sample,
            },
            format: (v) => fixed(v, 1),
            formula:
              "1 ÷ HHI of capital weights, CASH included. Measures capital concentration only, not correlation diversification.",
            footnote: () => `HHI ${fixed(c.hhi, 3)}`,
            viz: (
              <DotRow
                effective={c.effectiveHoldings}
                count={risk.holdings.length}
              />
            ),
          },
          {
            label: "Top-3 concentration",
            metric: { available: true, value: c.top3.weight, sample },
            format: unsignedPercent,
            formula: "Combined capital weight of the three largest positions.",
            footnote: () =>
              `Largest ${c.largest.ticker} ${unsignedPercent(c.largest.weight)}`,
            viz: (
              <WeightBlocks
                weights={c.top3.tickers.map(
                  (t) => risk.holdings.find((h) => h.ticker === t)?.weight ?? 0,
                )}
              />
            ),
          },
          {
            label: "Highest correlation",
            metric: high.metric,
            format: decimal,
            formula:
              "The most correlated pair of holdings on the common sample.",
            footnote: () => high.foot,
            viz: high.metric.available ? (
              <PairDots rho={high.metric.value} />
            ) : undefined,
          },
          {
            label: "Lowest correlation",
            metric: low.metric,
            format: decimal,
            formula:
              "The least correlated pair of holdings on the common sample.",
            footnote: () => low.foot,
            viz: low.metric.available ? (
              <PairDots rho={low.metric.value} />
            ) : undefined,
          },
        ]}
      />
      {corr.available ? (
        corr.tickers.length > 1 ? (
          <CorrelationHeatmap
            tickers={corr.tickers}
            matrix={corr.matrix}
            highest={corr.highest}
            lowest={corr.lowest}
            undefinedTickers={corr.undefinedTickers}
          />
        ) : (
          <Unavailable kind="matrix" title="Nothing to correlate">
            A correlation matrix needs at least two risky holdings.
          </Unavailable>
        )
      ) : (
        <Unavailable kind="matrix" title="Correlation not defined">
          Correlation matrix unavailable: {corr.reason}
        </Unavailable>
      )}
      <p className="hint">
        Effective holdings and top-3 concentration describe how capital is
        spread; the diversification ratio and correlations describe how risky
        holdings move together. Neither is a complete diversification score.
      </p>
    </>
  );
}
