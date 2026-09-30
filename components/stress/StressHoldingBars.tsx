"use client";
import type { CSSProperties } from "react";
import { TickerChip } from "@/components/observatory/Dossier";
import type { StressHoldingReturn } from "@/lib/types/analytics";
import { capitalRiskScale } from "@/lib/charts/riskDisplay";
import { axisPercent, percent, unsignedPercent } from "@/lib/utils/format";
import {
  focusHandlers,
  focusState,
  isMouse,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";
import { useFlip } from "@/components/ui/useFlip";

/** Each holding's own event return on one zero-anchored axis, ranked best to worst;
 * losses extend left. Direction, the signed value and the best/worst tags carry
 * polarity, so color is never the only cue. Rows glide to their new rank when the
 * selected event changes. */
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
  const holdingFocus = useHoldingFocus();
  const { focus, setFocus } = holdingFocus;
  // Display order only: best return first; ties keep portfolio order.
  const ranked = holdings
    .map((h, order) => ({ h, order }))
    .sort((a, b) => b.h.return - a.h.return || a.order - b.order)
    .map(({ h }) => h);
  const rows = useFlip<HTMLDivElement>(ranked.map((h) => h.ticker).join());
  const scale = capitalRiskScale(holdings.map((h) => h.return));
  const zero = scale.position(0) * 100;
  const bar = (value: number) => {
    const at = scale.position(value) * 100;
    return value >= 0
      ? { left: `${zero}%`, width: `${at - zero}%` }
      : { left: `${at}%`, width: `${zero - at}%` };
  };
  return (
    <figure
      className="capital-risk chart-figure"
      aria-labelledby={`${id}-holdings-title`}
    >
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
      <div
        className="cr-rows sh-rows"
        role="list"
        ref={rows}
        onPointerLeave={(e) => {
          if (isMouse(e)) setFocus(null);
        }}
      >
        {ranked.map((h, i) => (
          <div
            className="cr-row"
            role="listitem"
            key={h.ticker}
            data-flip={h.ticker}
            data-focus={focusState(focus, h.ticker)}
            style={{ ["--i" as string]: i } as CSSProperties}
            {...focusHandlers(holdingFocus, [h.ticker])}
          >
            <span className="cr-ticker">
              <TickerChip ticker={h.ticker} focusable={false} />
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
                className={`cr-bar sh-bar${h.return < 0 ? " cr-negative sh-loss" : " sh-gain"}`}
                style={bar(h.return)}
              />
            </div>
            <span className="cr-values cr-values-2">
              <strong
                className={h.return < 0 ? "is-neg" : h.return > 0 ? "is-pos" : ""}
              >
                {percent(h.return)}
              </strong>
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
                className={t === 0 ? "cr-tick cr-tick-zero" : "cr-tick"}
                style={{ left: `${scale.position(t) * 100}%` }}
              >
                {axisPercent(t)}
              </span>
            ))}
          </div>
          <span className="cr-values cr-values-2 cr-values-head">
            <strong>Return</strong>
            <span>Target</span>
          </span>
        </div>
      </div>
    </figure>
  );
}
