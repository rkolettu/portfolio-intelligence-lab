"use client";
import { useSyncExternalStore } from "react";

// Validated with the dataviz palette checker against the dark chart surface:
// lightness band, chroma floor, CVD ΔE 26.8, normal-vision ΔE 31.8, contrast ≥ 3:1.
// SVG presentation attributes take literal colors, so these are hex, not CSS vars.
export const CHART = {
  portfolio: "#3987e5",
  benchmark: "#d95926",
  /** Construction "Proposed" series (dataviz slot 3; blue/aqua CVD ΔE 19.6 on #1e1e1d). */
  proposed: "#199e70",
  grid: "rgba(244, 241, 234, 0.055)",
  axis: "rgba(244, 241, 234, 0.16)",
  tick: "#969188",
  reference: "rgba(244, 241, 234, 0.3)",
  /** Panel surface the chart sits on (the --surface token). */
  surface: "#181817",
  positive: "#8fcfa9",
  negative: "#f0a08f",
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
