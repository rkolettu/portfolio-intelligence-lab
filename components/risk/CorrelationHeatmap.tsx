"use client";
import { useRef, useState, type MouseEvent } from "react";
import type { CorrelationPair } from "@/lib/types/analytics";
import { DIVERGING, divergingColor, inkFor } from "@/lib/charts/diverging";
import { decimal, fixed } from "@/lib/utils/format";
import { useHoldingFocus } from "@/components/ui/HoldingFocus";
import { PairDots } from "@/components/ui/motifs";

/** Two decimals; values that round to zero print as 0.00, never "-0.00". */
const cellText = (v: number) => decimal(v);

/** Plain-language read of a coefficient for the hover panel (display only). */
const relation = (v: number) =>
  v <= -0.3
    ? "Moves opposite"
    : Math.abs(v) < 0.3
      ? "Little relationship"
      : v < 0.7
        ? "Moderately together"
        : "Moves together";

type Props = {
  tickers: string[];
  matrix: (number | null)[][];
  highest: CorrelationPair | null;
  lowest: CorrelationPair | null;
  undefinedTickers: string[];
};

/** Holding correlation heatmap on the canonical sample. A real table: values are
 * printed in each cell and announced with row/column headers. Hovering a cell
 * lifts it, lights its row and column, brightens both tickers and opens a compact
 * panel; the same holding focus is shared with the risk and contribution views.
 * Diverging blue ↔ red around neutral, never a rainbow. */
export function CorrelationHeatmap({
  tickers,
  matrix,
  highest,
  lowest,
  undefinedTickers,
}: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const { focus, setFocus } = useHoldingFocus();
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const dense = tickers.length > 10;
  const cell = hover ? matrix[hover.i][hover.j] : null;
  // Hover wins; otherwise mirror a holding focused elsewhere (one ticker lights its
  // row and column, two tickers light that pair).
  const external = !hover && focus ? focus.map((t) => tickers.indexOf(t)) : [];
  const rowOn = hover ? hover.i : (external[0] ?? -1);
  const colOn = hover ? hover.j : (external[1] ?? external[0] ?? -1);
  const active = rowOn >= 0 || colOn >= 0;
  const enter = (e: MouseEvent<HTMLTableCellElement>, i: number, j: number) => {
    setHover({ i, j });
    setFocus([tickers[i], tickers[j]]);
    const box = e.currentTarget.getBoundingClientRect();
    const host = stage.current?.getBoundingClientRect();
    // Upper rows open the panel below the cell so it never covers the column headers.
    const below = i < tickers.length / 2;
    if (host)
      setTip({
        x: box.left - host.left + box.width / 2,
        y: (below ? box.bottom : box.top) - host.top,
        below,
      });
  };
  const leave = () => {
    setHover(null);
    setTip(null);
    setFocus(null);
  };
  return (
    <figure
      className="heatmap-figure chart-figure"
      aria-labelledby="corr-title corr-summary"
    >
      <div className="chart-head">
        <div>
          <h3 id="corr-title">Holding correlation matrix</h3>
          <p id="corr-summary" className="hint">
            Pearson correlation of daily returns on the same common sample as
            the covariance matrix.
            {highest &&
              ` Highest: ${highest.a}/${highest.b} ${decimal(highest.correlation)}.`}
            {lowest &&
              ` Lowest: ${lowest.a}/${lowest.b} ${decimal(lowest.correlation)}.`}
          </p>
        </div>
        <div className="diverging-legend" aria-hidden>
          <span>−1</span>
          <span
            className="diverging-ramp"
            style={{
              background: `linear-gradient(90deg, ${DIVERGING.negative}, ${DIVERGING.midpoint}, ${DIVERGING.positive})`,
            }}
          />
          <span>+1</span>
        </div>
      </div>
      <div className="heat-stage" ref={stage} data-active={active ? "" : undefined}>
        <div className="table-wrap heatmap-wrap" onMouseLeave={leave}>
          <table className={`heatmap${dense ? " heatmap-dense" : ""}`}>
            <caption className="sr-only">
              Correlation matrix of {tickers.join(", ")}
            </caption>
            <thead>
              <tr>
                <td aria-hidden />
                {tickers.map((t, j) => (
                  <th
                    key={t}
                    scope="col"
                    data-on={j === colOn ? "" : undefined}
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((row, i) => (
                <tr key={row}>
                  <th scope="row" data-on={i === rowOn ? "" : undefined}>
                    {row}
                  </th>
                  {matrix[i].map((v, j) => {
                    const background =
                      v === null ? "transparent" : divergingColor(v);
                    const line = active && (i === rowOn || j === colOn);
                    return (
                      <td
                        key={tickers[j]}
                        className={
                          v === null
                            ? "heat-undefined"
                            : i === j
                              ? "heat-diagonal"
                              : undefined
                        }
                        data-line={line ? "" : undefined}
                        data-cell={
                          active && i === rowOn && j === colOn ? "" : undefined
                        }
                        style={
                          v === null
                            ? undefined
                            : { background, color: inkFor(background) }
                        }
                        onMouseEnter={(e) => enter(e, i, j)}
                      >
                        {v === null ? "—" : cellText(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="heat-side">
          {[
            { label: "Most correlated pair", pair: highest },
            { label: "Least correlated pair", pair: lowest },
          ].map(
            ({ label, pair }) =>
              pair && (
                <button
                  type="button"
                  className="heat-pair"
                  key={label}
                  onPointerEnter={() => setFocus([pair.a, pair.b])}
                  onPointerLeave={() => setFocus(null)}
                  onFocus={() => setFocus([pair.a, pair.b])}
                  onBlur={() => setFocus(null)}
                >
                  <span>{label}</span>
                  <b>
                    {pair.a} · {pair.b}
                  </b>
                  <strong>{cellText(pair.correlation)}</strong>
                  <PairDots rho={pair.correlation} />
                </button>
              ),
          )}
          <p className="heat-guide">
            Hover a cell or a pair: both holdings light up here and in the risk
            and return views.
          </p>
        </div>
        {hover && tip && (
          <div
            className="heat-tip"
            aria-hidden
            data-below={tip.below ? "" : undefined}
            style={{ left: tip.x, top: tip.y }}
          >
            <b>
              {tickers[hover.i]} / {tickers[hover.j]}
            </b>
            <strong>{cell === null ? "—" : cellText(cell)}</strong>
            {cell !== null && (
              <>
                <PairDots rho={cell} />
                <small>{relation(cell)}</small>
              </>
            )}
          </div>
        )}
      </div>
      <p className="hint heatmap-readout" aria-live="polite">
        {hover
          ? `${tickers[hover.i]} / ${tickers[hover.j]}: ${cell === null ? "undefined (constant returns)" : fixed(cell, 4)}`
          : "Hover a cell for the four-decimal value."}
      </p>
      {undefinedTickers.length > 0 && (
        <p className="hint heat-note">
          Correlation is undefined for {undefinedTickers.join(", ")}: constant
          daily returns have zero variance.
        </p>
      )}
    </figure>
  );
}
