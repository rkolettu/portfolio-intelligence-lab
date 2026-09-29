import { z } from "zod";
import { draftConfig, type Draft } from "./portfolioReducer";
export const STORAGE_KEY = "portfolio-lab:preferences:v1";
const stored = z.object({
  version: z.literal(1),
  draft: z.object({
    holdings: z
      .array(z.object({ ticker: z.string(), weight: z.string() }))
      .max(20),
    benchmark: z.string(),
    requestedStartDate: z.string(),
    endDate: z.string(),
    period: z.enum(["1Y", "3Y", "5Y", "10Y", "MAX", "Custom"]),
    cashPolicy: z.enum(["historical_proxy", "zero_explicit"]),
  }),
});
export function restoreDraft(
  storage: Pick<Storage, "getItem">,
  fallback: Draft,
  today: string,
): { draft: Draft; notice: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { draft: fallback, notice: null };
    const parsed = stored.parse(JSON.parse(raw));
    draftConfig(parsed.draft, today);
    return { draft: parsed.draft, notice: null };
  } catch {
    return {
      draft: fallback,
      notice:
        "Saved preferences were unavailable or invalid. The sample portfolio has been restored.",
    };
  }
}
export function persistDraft(
  storage: Pick<Storage, "setItem">,
  draft: Draft,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, draft }));
    return true;
  } catch {
    return false;
  }
}
