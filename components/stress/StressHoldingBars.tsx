"use client";
import type { StressHoldingReturn } from "@/lib/types/analytics";
import { capitalRiskScale } from "@/lib/charts/riskDisplay";
import { axisPercent, percent, unsignedPercent } from "@/lib/utils/format";

const BAR = "#8d8880";

/** Each holding's own event return on one zero-anchored axis; losses extend left.
 * Direction and the signed value carry polarity, so color is never the only cue. */
export function StressHoldingBars({
  id,
  holdings,
  best,
  worst,
}: {
  id: string;
  holdings: StressHoldingReturn[];
  best: string[];
  worst: string[];
}) {
  const scale = capitalRiskScale(holdings.map((h) => h.return));
  const zero = scale.position(0) * 100;
  const bar = (value: number) => {
    const at = scale.position(value) * 100;
    return value >= 0
      ? { left: `${zero}%`, width: `${at - zero}%` }
      : { left: `${at}%`, width: `${zero - at}%` };
  };
  return (
    <figure className="capital-risk" aria-labelledby={`${id}-holdings-title`}>
      <div className="chart-head">
        <div>
          <h3 id={`${id}-holdings-title`}>Holding returns over the event</h3>
          <p className="hint">
            Standalone: each holding&apos;s own compounded return, not its
            contribution to the portfolio. Best: {best.join(", ")} · Worst:{" "}
            {worst.join(", ")}.
          </p>
        </div>
      </div>
      <div className="cr-rows" role="list">
        {holdings.map((h) => (
          <div className="cr-row" role="listitem" key={h.ticker}>
            <span className="cr-ticker">
              {h.ticker}
              {best.includes(h.ticker) && <span className="cr-tag">best</span>}
              {worst.includes(h.ticker) && (
                <span className="cr-tag">worst</span>
              )}
              {h.riskless && <span className="cr-tag">riskless</span>}
            </span>
            <div className="cr-track" aria-hidden>
              {scale.ticks.map((t) => (
                <span
                  key={t}
                  className={t === 0 ? "cr-grid cr-zero" : "cr-grid"}
                  style={{ left: `${scale.position(t) * 100}%` }}
                />
              ))}
              <span
                className={`cr-bar sh-bar${h.return < 0 ? " cr-negative" : ""}`}
                style={{ ...bar(h.return), background: BAR }}
              />
            </div>
            <span className="cr-values">
              <strong>{percent(h.return)}</strong>
              <span>wt {unsignedPercent(h.weight)}</span>
            </span>
          </div>
        ))}
        <div className="cr-row cr-axis sh-axis" aria-hidden>
          <span />
          <div className="cr-track">
            {scale.ticks.map((t) => (
              <span
                key={t}
                className="cr-tick"
                style={{ left: `${scale.position(t) * 100}%` }}
              >
                {axisPercent(t)}
              </span>
            ))}
          </div>
          <span className="cr-values cr-values-head">
            <strong>Return</strong>
            <span>Target</span>
          </span>
        </div>
      </div>
    </figure>
  );
}
