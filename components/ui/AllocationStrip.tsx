import type { CSSProperties } from "react";

/** One-hue ramp by position, lightest first, so a row's weight bar and its strip
 * segment share a color without a rainbow. CASH is hatched instead. */
export const allocationColor = (index: number, count: number) => {
  const t = count <= 1 ? 0 : index / (count - 1);
  return `hsl(221 ${72 - t * 14}% ${56 - t * 26}%)`;
};

export type StripHolding = { ticker: string; weight: number };

/** The whole portfolio as proportional segments. Weights are percent points.
 * Under 100 the remainder shows as an open dashed track; over 100 an overweight
 * hatch appears. Segments slide when weights change. */
export function AllocationStrip({
  holdings,
  label,
  format,
}: {
  holdings: StripHolding[];
  label?: string;
  format: (weight: number) => string;
}) {
  const live = holdings
    .map((h, i) => ({ ...h, i }))
    .filter((h) => Number.isFinite(h.weight) && h.weight > 0);
  const total = live.reduce((s, h) => s + h.weight, 0);
  const state =
    Math.abs(total - 100) <= 0.0001 ? "ok" : total > 100 ? "over" : "open";
  return (
    <div
      className="alloc-strip"
      data-state={state}
      role="img"
      aria-label={label ?? "Allocation strip"}
    >
      {live.map((h) => (
        <span
          key={`${h.ticker}-${h.i}`}
          className="alloc-seg"
          data-cash={h.ticker === "CASH" ? "" : undefined}
          data-tip={`${h.ticker || "—"} · ${format(h.weight)}`}
          style={
            {
              flexGrow: h.weight,
              ["--seg" as string]: allocationColor(h.i, holdings.length),
            } as CSSProperties
          }
        />
      ))}
      {state === "open" && (
        <span className="alloc-open" style={{ flexGrow: 100 - total }} />
      )}
      {state === "over" && <span className="alloc-over" />}
    </div>
  );
}
