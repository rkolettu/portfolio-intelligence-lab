"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { AllocationStrip } from "@/components/ui/AllocationStrip";

/** False on the first paint, true one frame later: lets a value start at "before"
 * and settle to "after" so the change is seen as movement. Skipped instantly under
 * reduced motion by the global transition rule. */
export function useArrived() {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return arrived;
}

/** Before/after weight for one holding: a dashed outline holds the current weight,
 * the filled bar travels from it to the proposed weight. Unchanged holdings stay
 * quiet (no travel, muted). Weights are fractions; `max` sets the shared scale. */
export function WeightMove({
  current,
  proposed,
  max,
}: {
  current: number;
  proposed: number;
  max: number;
}) {
  const arrived = useArrived();
  const at = (w: number) => `${(Math.max(0, w) / max) * 100}%`;
  const moved = Math.abs(proposed - current) >= 0.0005;
  return (
    <span
      className="wmove"
      aria-hidden
      data-moved={moved ? (proposed > current ? "up" : "down") : "none"}
    >
      <span className="wm-cur" style={{ width: at(current) }} />
      <span
        className="wm-bar"
        style={{ width: at(arrived ? proposed : current) } as CSSProperties}
      />
    </span>
  );
}

/** Current and Proposed allocation as two stacked strips; the proposed strip
 * animates from the current weights, so generating a proposal visibly moves
 * capital between holdings. Weights are fractions. */
export function AllocationCompare({
  rows,
  format,
}: {
  rows: { ticker: string; current: number; proposed: number }[];
  format: (weight: number) => string;
}) {
  const arrived = useArrived();
  return (
    <div className="alloc-compare" aria-hidden>
      <div className="alloc-compare-row">
        <span className="micro">Current</span>
        <AllocationStrip
          label="Current allocation"
          holdings={rows.map((r) => ({ ticker: r.ticker, weight: r.current * 100 }))}
          format={(w) => format(w / 100)}
        />
      </div>
      <div className="alloc-compare-row">
        <span className="micro">Proposed</span>
        <AllocationStrip
          label="Proposed allocation"
          holdings={rows.map((r) => ({
            ticker: r.ticker,
            weight: (arrived ? r.proposed : r.current) * 100,
          }))}
          format={(w) => format(w / 100)}
        />
      </div>
    </div>
  );
}
