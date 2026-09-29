"use client";
import { useState } from "react";
import type { CorrelationPair } from "@/lib/types/analytics";
import { DIVERGING, divergingColor, inkFor } from "@/lib/charts/diverging";
import { decimal, fixed } from "@/lib/utils/format";

/** Two decimals; values that round to zero print as 0.00, never "-0.00". */
const cellText = (v: number) => decimal(v);

type Props = {
  tickers: string[];
  matrix: (number | null)[][];
  highest: CorrelationPair | null;
  lowest: CorrelationPair | null;
  undefinedTickers: string[];
};

/** Holding correlation heatmap on the canonical sample. A real table: values are
 * printed in each cell and announced with row/column headers; the hover tooltip
 * adds the pair name and a 4-decimal value. Diverging blue ↔ red around neutral. */
export function CorrelationHeatmap({
  tickers,
  matrix,
  highest,
  lowest,
  undefinedTickers,
}: Props) {
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const dense = tickers.length > 10;
  const cell = hover ? matrix[hover.i][hover.j] : null;
  return (
    <figure
      className="heatmap-figure"
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
      <div
        className="table-wrap heatmap-wrap"
        onMouseLeave={() => setHover(null)}
      >
        <table className={`heatmap${dense ? " heatmap-dense" : ""}`}>
          <caption className="sr-only">
            Correlation matrix of {tickers.join(", ")}
          </caption>
          <thead>
            <tr>
              <td aria-hidden />
              {tickers.map((t) => (
                <th key={t} scope="col">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((row, i) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {matrix[i].map((v, j) => {
                  const background =
                    v === null ? "transparent" : divergingColor(v);
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
                      style={
                        v === null
                          ? undefined
                          : { background, color: inkFor(background) }
                      }
                      onMouseEnter={() => setHover({ i, j })}
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
      <p className="hint heatmap-readout" aria-live="polite">
        {hover
          ? `${tickers[hover.i]} / ${tickers[hover.j]}: ${cell === null ? "undefined (constant returns)" : fixed(cell, 4)}`
          : "Hover a cell for the four-decimal value."}
      </p>
      {undefinedTickers.length > 0 && (
        <p className="hint">
          Correlation is undefined for {undefinedTickers.join(", ")}: constant
          daily returns have zero variance.
        </p>
      )}
    </figure>
  );
}
