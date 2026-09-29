"use client";
import type { CSSProperties } from "react";
import type { Metric } from "@/lib/types/analytics";
import { InfoTip } from "./InfoTip";

export type Kpi = {
  label: string;
  metric: Metric;
  format: (value: number) => string;
  formula: string;
  footnote: (m: Extract<Metric, { available: true }>) => string;
};

/** Dense strip of precomputed metrics: N/A carries its reason in the tooltip. */
export function KpiStrip({ items, label }: { items: Kpi[]; label?: string }) {
  return (
    <dl
      className="kpi-strip"
      aria-label={label}
      style={{ "--kpi-cols": items.length } as CSSProperties}
    >
      {items.map((k) => (
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
