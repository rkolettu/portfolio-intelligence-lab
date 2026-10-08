// The one local forward-assumption state shared by Portfolio Theory and Stock Lab:
// risk window, market proxy, Market Risk Premium and per-ticker views. Stored only
// in this browser (localStorage), never on the server. Pure functions, so every
// rule is testable without React.
import { z } from "zod";
import type {
  ForwardAssumptionState,
  MarketProxy,
  RiskWindow,
  ViewInput,
} from "@/lib/types/forward";
import {
  DEFAULT_FORWARD_ASSUMPTIONS,
  defaultForwardState,
  defaultView,
} from "@/lib/forward/assumptions";
import {
  forwardStateSchema,
  parseForwardState,
} from "@/lib/validation/forward";

export const FORWARD_STORAGE_KEY = "portfolio-lab:forward-assumptions:v1";

export type ForwardAction =
  | { type: "riskWindow"; value: RiskWindow }
  | { type: "marketProxy"; value: MarketProxy }
  | { type: "marketRiskPremium"; value: number }
  /** Restore the default window, proxy and MRP; views are kept. */
  | { type: "resetAssumptions" }
  /** Merge into the ticker's view (a missing view starts from the defaults). */
  | { type: "view"; ticker: string; patch: Partial<ViewInput> }
  | { type: "clearView"; ticker: string }
  | { type: "replace"; state: ForwardAssumptionState };

/** Every transition is revalidated as a whole state. Editors parse what the user
 * types and dispatch only valid values; an invalid dispatch is a programming error
 * and throws INVALID_INPUT rather than storing a value the model cannot use. */
export function forwardReducer(
  state: ForwardAssumptionState,
  action: ForwardAction,
): ForwardAssumptionState {
  const { assumptions, views } = state;
  switch (action.type) {
    case "riskWindow":
      return parseForwardState({
        views,
        assumptions: { ...assumptions, riskWindow: action.value },
      });
    case "marketProxy":
      return parseForwardState({
        views,
        assumptions: { ...assumptions, marketProxy: action.value },
      });
    case "marketRiskPremium":
      return parseForwardState({
        views,
        assumptions: { ...assumptions, marketRiskPremium: action.value },
      });
    case "resetAssumptions":
      return { views, assumptions: { ...DEFAULT_FORWARD_ASSUMPTIONS } };
    case "view":
      return parseForwardState({
        assumptions,
        views: {
          ...views,
          [action.ticker]: {
            ...(views[action.ticker] ?? defaultView()),
            ...action.patch,
          },
        },
      });
    case "clearView": {
      const next = { ...views };
      delete next[action.ticker];
      return { assumptions, views: next };
    }
    case "replace":
      return parseForwardState(action.state);
  }
}

const stored = z
  .object({ version: z.literal(1), state: forwardStateSchema })
  .strict();

const RESTORED_NOTICE =
  "Saved forward-model assumptions were unavailable or invalid. Defaults have been restored: 3Y risk window, VTI market proxy, 5.00% Market Risk Premium and no views.";

/** Restore the shared assumption state; anything corrupt, unsupported or denied
 * falls back to the defaults with a notice (never a partial state). */
export function restoreForwardState(storage: Pick<Storage, "getItem">): {
  state: ForwardAssumptionState;
  notice: string | null;
} {
  try {
    const raw = storage.getItem(FORWARD_STORAGE_KEY);
    if (!raw) return { state: defaultForwardState(), notice: null };
    return { state: stored.parse(JSON.parse(raw)).state, notice: null };
  } catch {
    return { state: defaultForwardState(), notice: RESTORED_NOTICE };
  }
}

export function persistForwardState(
  storage: Pick<Storage, "setItem">,
  state: ForwardAssumptionState,
): boolean {
  try {
    storage.setItem(
      FORWARD_STORAGE_KEY,
      JSON.stringify({ version: 1, state: parseForwardState(state) }),
    );
    return true;
  } catch {
    return false;
  }
}
