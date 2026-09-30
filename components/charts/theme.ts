"use client";
import { useSyncExternalStore } from "react";

// Paper theme: the portfolio family's blue for the portfolio, a burnt orange for
// the benchmark and the family green for proposals, each ≥ 3:1 on #fbfaf7.
// SVG presentation attributes take literal colors, so these are hex, not CSS vars.
export const CHART = {
  portfolio: "#1d4ed8",
  benchmark: "#c2552a",
  /** Construction "Proposed" series. */
  proposed: "#287252",
  grid: "rgba(23, 23, 23, 0.06)",
  axis: "rgba(23, 23, 23, 0.18)",
  tick: "#7a766f",
  reference: "rgba(23, 23, 23, 0.3)",
  /** Panel surface the chart sits on (the --surface token). */
  surface: "#fbfaf7",
  positive: "#287252",
  negative: "#a43e39",
  /** Main series 1.75px, secondary series 1.5px: thin marks, clear hierarchy. */
  line: 1.75,
  lineSecondary: 1.5,
  animationMs: 220,
} as const;

const query = "(prefers-reduced-motion: reduce)";
const media = () =>
  typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
/** Chart JS animation honors the same preference as the CSS motion rules. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = media();
      list?.addEventListener("change", notify);
      return () => list?.removeEventListener("change", notify);
    },
    () => media()?.matches ?? false,
    () => true,
  );
}

const narrowQuery = "(max-width: 640px)";
/** Phones trim chart margins and secondary annotations. */
export function useNarrowChart(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(narrowQuery);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(narrowQuery).matches
        : false,
    () => false,
  );
}

/** Chart margins: room on the right for end labels. Phones keep the labels (they
 * carry series identity where there is no hover) and give up a little of it. */
export const chartMargin = (narrow: boolean, top = 24) => ({
  top,
  right: narrow ? 96 : 112,
  bottom: 4,
  left: 4,
});
