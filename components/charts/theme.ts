"use client";
import { useSyncExternalStore } from "react";

// Validated with the dataviz palette checker against the #1e1e1d surface (dark):
// lightness band, chroma floor, CVD ΔE 26.8, normal-vision ΔE 31.8, contrast ≥ 3:1.
// SVG presentation attributes take literal colors, so these are hex, not CSS vars.
export const CHART = {
  portfolio: "#3987e5",
  benchmark: "#d95926",
  /** Construction "Proposed" series (dataviz slot 3; blue/aqua CVD ΔE 19.6 on #1e1e1d). */
  proposed: "#199e70",
  grid: "rgba(244, 241, 234, 0.08)",
  axis: "rgba(244, 241, 234, 0.18)",
  tick: "#969188",
  reference: "rgba(244, 241, 234, 0.32)",
  surface: "#1e1e1d",
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
