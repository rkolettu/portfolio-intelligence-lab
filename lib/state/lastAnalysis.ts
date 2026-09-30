import { z } from "zod";
import { parsePortfolio } from "@/lib/validation/portfolio";
import type { PortfolioConfig } from "@/lib/types/portfolio";

/** The last analysis this tab displayed, as a small configuration only (never the
 * result payload). Per tab (sessionStorage): a reload of an analysis route re-runs
 * it; a deep link opened in a new tab has none and is guided to the builder. */
export const LAST_ANALYSIS_KEY = "portfolio-lab:last-analysis:v1";
export type LastAnalysis =
  | { kind: "live"; config: PortfolioConfig }
  | { kind: "cached-sample" };

const stored = z.union([
  z.object({ version: z.literal(1), kind: z.literal("live"), config: z.unknown() }),
  z.object({ version: z.literal(1), kind: z.literal("cached-sample") }),
]);

export function readLastAnalysis(today: string): LastAnalysis | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_ANALYSIS_KEY);
    if (!raw) return null;
    const parsed = stored.parse(JSON.parse(raw));
    return parsed.kind === "live"
      ? { kind: "live", config: parsePortfolio(parsed.config, today) }
      : { kind: "cached-sample" };
  } catch {
    return null;
  }
}

export function writeLastAnalysis(value: LastAnalysis) {
  try {
    window.sessionStorage.setItem(
      LAST_ANALYSIS_KEY,
      JSON.stringify({ version: 1, ...value }),
    );
  } catch {
    // Storage unavailable: a reload simply shows the builder guidance.
  }
}

export function clearLastAnalysis() {
  try {
    window.sessionStorage.removeItem(LAST_ANALYSIS_KEY);
  } catch {
    /* unavailable */
  }
}
