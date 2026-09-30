"use client";
import { useState, type CSSProperties } from "react";
import type { HoldingRisk } from "@/lib/types/analytics";
import { capitalRiskScale } from "@/lib/charts/riskDisplay";
import { percentagePoints, unsignedPercent } from "@/lib/utils/format";
import {
  focusHandlers,
  focusState,
  isMouse,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";
import { Segmented } from "@/components/ui/Segmented";
import { useFlip } from "@/components/ui/useFlip";
import { Constellation, type Correlation } from "@/components/observatory/Constellation";
import { TickerChip, useDossier } from "@/components/observatory/Dossier";

/** Capital is warm paper, risk the family blue: the Risk Shadow pair. */
const CAPITAL = "#d9d3c7";
const RISK = "#8fb0ff";

type View = "both" | "capital" | "risk";
const VIEWS: { value: View; label: string }[] = [
  { value: "both", label: "Shadow" },
  { value: "capital", label: "Capital" },
  { value: "risk", label: "Risk" },
];

/** Hero: capital weight vs percentage risk contribution on one zero-anchored axis.
 * Negative contributions extend left of zero. Every value is precomputed; the only
 * arithmetic here is the difference between two displayed values (risk − capital).
 * Switching the view morphs one bar between the two values while a dashed outline
 * keeps the other in place, so the gap reads as a movement, not two charts. */
export function CapitalVsRisk({
  holdings,
  correlation = null,
}: {
  holdings: HoldingRisk[];
  correlation?: Correlation;
}) {
  const [view, setView] = useState<View>("both");
  const dossier = useDossier();
  const holdingFocus = useHoldingFocus();
  const { focus, setFocus } = holdingFocus;
  const rows = useFlip<HTMLDivElement>(holdings.map((h) => h.ticker).join());
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
  // The headline: where risk most exceeds capital (display selection only).
  const lead = holdings
    .filter((h) => h.percentage.available && !h.riskless)
    .map((h) => ({
      h,
      risk: h.percentage.available ? h.percentage.value : 0,
    }))
    .reduce<{ h: HoldingRisk; risk: number } | null>(
      (best, c) =>
        !best || c.risk - c.h.weight > best.risk - best.h.weight ? c : best,
      null,
    );
  const leadGap = lead ? lead.risk - lead.h.weight : 0;
  return (
    <figure
      className="capital-risk chart-figure"
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
      <div className="cr-toolbar">
        {lead && leadGap > 0.005 ? (
          <p className="cr-insight" aria-hidden>
            <span className="cr-insight-ticker">{lead.h.ticker}</span>
            <span>
              <b>{unsignedPercent(lead.h.weight)}</b> of capital
            </span>
            <i className="cr-insight-arrow" />
            <span>
              <b>{unsignedPercent(lead.risk)}</b> of risk
            </span>
            <em>{percentagePoints(leadGap)}</em>
          </p>
        ) : (
          <p className="cr-insight cr-insight-flat" aria-hidden>
            Risk contribution tracks capital weight closely.
          </p>
        )}
        <Segmented
          legend="Chart view"
          name="capital-risk-view"
          options={VIEWS}
          value={view}
          onChange={setView}
        />
      </div>
      <div className="cr-body">
      <div
        className="cr-rows"
        role="list"
        data-view={view}
        ref={rows}
        onPointerLeave={(e) => {
          if (isMouse(e)) setFocus(null);
        }}
      >
        {holdings.map((h, i) => {
          const p = h.percentage;
          const risk = p.available ? p.value : null;
          const delta = risk === null ? null : risk - h.weight;
          const main = view === "risk" && risk !== null ? risk : h.weight;
          const ghost =
            view === "risk" ? h.weight : risk !== null ? risk : null;
          return (
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
                {h.riskless && <span className="cr-tag">riskless</span>}
                {risk !== null && risk < 0 && (
                  <span className="cr-tag cr-tag-hedge">hedge</span>
                )}
              </span>
              <div className="cr-track" aria-hidden>
                {scale.ticks.map((t) => (
                  <span
                    key={t}
                    className={t === 0 ? "cr-grid cr-zero" : "cr-grid"}
                    style={{ left: `${scale.position(t) * 100}%` }}
                  />
                ))}
                {delta !== null && (
                  <span
                    className="cr-gap"
                    data-label={percentagePoints(delta)}
                    data-dir={delta >= 0 ? "up" : "down"}
                    style={{
                      left: `${Math.min(scale.position(h.weight), scale.position(risk!)) * 100}%`,
                      width: `${Math.abs(scale.position(risk!) - scale.position(h.weight)) * 100}%`,
                    }}
                  />
                )}
                <span
                  className="cr-bar cr-capital"
                  style={{ ...bar(h.weight), backgroundColor: CAPITAL }}
                />
                {p.available && p.value !== 0 && (
                  <span
                    className={`cr-bar cr-risk${p.value < 0 ? " cr-negative" : ""}`}
                    style={{ ...bar(p.value), backgroundColor: RISK }}
                  />
                )}
                <span
                  className={`cr-bar cr-main${main < 0 ? " cr-negative" : ""}`}
                  style={{
                    ...bar(main),
                    backgroundColor: view === "risk" ? RISK : CAPITAL,
                  }}
                />
                {ghost !== null && (
                  <span
                    className={`cr-ghost${ghost < 0 ? " cr-negative" : ""}`}
                    style={
                      {
                        ...bar(ghost),
                        borderColor:
                          view === "risk"
                            ? "rgba(244,241,234,0.55)"
                            : "rgba(96,160,255,0.75)",
                        ["--ghost" as string]:
                          view === "risk" ? "#f4f1ea" : "#7db2ff",
                      } as CSSProperties
                    }
                  />
                )}
              </div>
              <span className="cr-values">
                <span className="cr-v-capital">{unsignedPercent(h.weight)}</span>
                <strong className="cr-v-risk">
                  {p.available ? unsignedPercent(p.value) : "N/A"}
                </strong>
                <span
                  className="cr-v-delta"
                  data-dir={
                    delta === null
                      ? undefined
                      : Math.abs(delta) < 0.005
                        ? "flat"
                        : delta > 0
                          ? "up"
                          : "down"
                  }
                >
                  {delta === null ? "—" : percentagePoints(delta)}
                </span>
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
                className={t === 0 ? "cr-tick cr-tick-zero" : "cr-tick"}
                style={{ left: `${scale.position(t) * 100}%` }}
              >
                {unsignedPercent(t).replace(".00", "")}
              </span>
            ))}
          </div>
          <span className="cr-values cr-values-head">
            <span>Weight</span>
            <strong>Risk</strong>
            <span>Δ</span>
          </span>
        </div>
      </div>
      <div className="cr-object" aria-hidden={false}>
        <Constellation
          nodes={holdings.map((h) => ({
            ticker: h.ticker,
            weight: h.weight,
            risk: h.percentage.available ? Math.max(0, h.percentage.value) : null,
            riskless: h.riskless,
          }))}
          width={520}
          height={420}
          fill={0.16}
          mode={view === "risk" ? "risk" : "capital"}
          correlation={correlation}
          linked
          annotate={false}
          onSelect={(t, el) => dossier?.(t, el)}
          label={`Constellation of capital and risk. ${view === "risk" ? "Risk contribution is solid, capital outlined." : "Capital is solid, risk contribution is the offset outline."}`}
        />
        <p className="cr-object-key" aria-hidden>
          <span>
            <i data-k="cap" /> Capital
          </span>
          <span>
            <i data-k="risk" /> Risk share
          </span>
          <span>Offset ∝ |risk − capital|</span>
        </p>
      </div>
      </div>
    </figure>
  );
}
