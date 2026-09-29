"use client";
import type { HoldingRisk } from "@/lib/types/analytics";
import { capitalRiskScale } from "@/lib/charts/riskDisplay";
import { unsignedPercent } from "@/lib/utils/format";

const CAPITAL = "#8d8880";
const RISK = "#3987e5";

/** Hero: capital weight vs percentage risk contribution on one zero-anchored axis.
 * Negative contributions extend left of zero. Every value is precomputed. */
export function CapitalVsRisk({ holdings }: { holdings: HoldingRisk[] }) {
  const pcr = holdings.map((h) =>
    h.percentage.available ? h.percentage.value : 0,
  );
  const scale = capitalRiskScale([...holdings.map((h) => h.weight), ...pcr]);
  const zero = scale.position(0) * 100;
  const bar = (value: number) => {
    const at = scale.position(value) * 100;
    return value >= 0
      ? { left: `${zero}%`, width: `${at - zero}%` }
      : { left: `${at}%`, width: `${zero - at}%` };
  };
  return (
    <figure
      className="capital-risk"
      aria-labelledby="capital-risk-title capital-risk-summary"
    >
      <div className="chart-head">
        <div>
          <h3 id="capital-risk-title">
            Capital allocation vs risk contribution
          </h3>
          <p id="capital-risk-summary" className="hint">
            {holdings
              .filter((h) => h.percentage.available)
              .map(
                (h) =>
                  `${h.ticker} ${unsignedPercent(h.weight)} of capital, ${unsignedPercent(h.percentage.available ? h.percentage.value : 0)} of risk`,
              )
              .join("; ")}
            .
          </p>
        </div>
        <div className="chart-legend" aria-label="Series">
          <span className="legend-item">
            <span
              className="bar-key"
              style={{ background: CAPITAL }}
              aria-hidden
            />
            Capital weight
          </span>
          <span className="legend-item">
            <span
              className="bar-key"
              style={{ background: RISK }}
              aria-hidden
            />
            Risk contribution (PCR)
          </span>
        </div>
      </div>
      <div className="cr-rows" role="list">
        {holdings.map((h) => {
          const p = h.percentage;
          return (
            <div className="cr-row" role="listitem" key={h.ticker}>
              <span className="cr-ticker">
                {h.ticker}
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
                  className="cr-bar cr-capital"
                  style={{ ...bar(h.weight), background: CAPITAL }}
                />
                {p.available && p.value !== 0 && (
                  <span
                    className={`cr-bar cr-risk${p.value < 0 ? " cr-negative" : ""}`}
                    style={{ ...bar(p.value), background: RISK }}
                  />
                )}
              </div>
              <span className="cr-values">
                <span>{unsignedPercent(h.weight)}</span>
                <strong>
                  {p.available ? unsignedPercent(p.value) : "N/A"}
                </strong>
              </span>
            </div>
          );
        })}
        <div className="cr-row cr-axis" aria-hidden>
          <span />
          <div className="cr-track">
            {scale.ticks.map((t) => (
              <span
                key={t}
                className="cr-tick"
                style={{ left: `${scale.position(t) * 100}%` }}
              >
                {unsignedPercent(t).replace(".00", "")}
              </span>
            ))}
          </div>
          <span className="cr-values cr-values-head">
            <span>Weight</span>
            <strong>Risk</strong>
          </span>
        </div>
      </div>
    </figure>
  );
}
