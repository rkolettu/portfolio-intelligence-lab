import type { ReactNode } from "react";

export type TooltipRow = {
  color: string;
  label: string;
  value: string;
  /** Secondary line under the label (e.g. the window a value covers). */
  sub?: string;
};

/** Compact terminal data panel: date header, one aligned row per series with a
 * color key, label on the left and a tabular value on the right. */
export function ChartTooltip({
  date,
  rows,
  foot,
}: {
  date: string;
  rows: TooltipRow[];
  foot?: ReactNode;
}) {
  return (
    <div className="chart-tooltip">
      <div className="tt-head">{date}</div>
      <div className="tt-body">
        {rows.map((r) => (
          <div className="tooltip-row" key={r.label}>
            <span
              className="line-key"
              style={{ background: r.color }}
              aria-hidden
            />
            <span className="tt-label">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </span>
            <strong>{r.value}</strong>
          </div>
        ))}
        {foot}
      </div>
    </div>
  );
}
