"use client";
import type { CSSProperties, ReactNode } from "react";
import type { Metric } from "@/lib/types/analytics";
import { InfoTip } from "./InfoTip";

export type Kpi = {
  label: string;
  metric: Metric;
  format: (value: number) => string;
  formula: string;
  footnote: (m: Extract<Metric, { available: true }>) => string;
  /** Color the value by sign: positive and negative read at a glance. */
  signed?: boolean;
  /** Optional decorative micro-visualization under the footnote (aria-hidden). */
  viz?: ReactNode;
  /** Lead metric of a strip: larger value with an accent rule. */
  emphasis?: boolean;
};

/** Dense strip of precomputed metrics: N/A carries its reason in the tooltip. */
export function KpiStrip({ items, label }: { items: Kpi[]; label?: string }) {
  return (
    <dl
      className="kpi-strip"
      aria-label={label}
      style={
        {
          "--kpi-cols": items.length,
          // Mid widths: six items sit in two even rows of three, others in fours.
          "--kpi-cols-md": items.length === 6 ? 3 : Math.min(items.length, 4),
        } as CSSProperties
      }
    >
      {items.map((k) => (
        <div className={`kpi${k.emphasis ? " kpi-lead" : ""}`} key={k.label}>
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
                <span
                  key={k.format(k.metric.value)}
                  className={`kpi-value${
                    k.signed && k.metric.value !== 0
                      ? k.metric.value > 0
                        ? " is-pos"
                        : " is-neg"
                      : ""
                  }`}
                >
                  {k.format(k.metric.value)}
                </span>
                <span className="kpi-foot">{k.footnote(k.metric)}</span>
                {k.viz && (
                  <span className="kpi-viz" aria-hidden>
                    {k.viz}
                  </span>
                )}
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
