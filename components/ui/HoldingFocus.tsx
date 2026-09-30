"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

type Focus = readonly string[] | null;
type Value = {
  focus: Focus;
  setFocus: (tickers: Focus) => void;
  /** Touch: tap a holding to pin its highlight, tap it again to release. */
  toggleFocus: (tickers: readonly string[]) => void;
};

const same = (a: Focus, b: Focus) =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((t, i) => t === b[i]));

const HoldingFocusContext = createContext<Value>({
  focus: null,
  setFocus: () => {},
  toggleFocus: () => {},
});

/** Cross-component highlight state: hovering (mouse), focusing (keyboard) or
 * tapping (touch) a holding or a correlation pair highlights it in every related
 * analytic. Display state only. A tap outside any focusable holding releases a
 * pinned touch highlight. */
export function HoldingFocusProvider({ children }: { children: ReactNode }) {
  const [focus, set] = useState<Focus>(null);
  const setFocus = useCallback((next: Focus) => {
    set((prev) => (same(prev, next) ? prev : next));
  }, []);
  const toggleFocus = useCallback((next: readonly string[]) => {
    set((prev) => (same(prev, next) ? null : next));
  }, []);
  useEffect(() => {
    if (!focus) return;
    const release = (e: globalThis.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (!(e.target as Element | null)?.closest?.("[data-focusable]"))
        set(null);
    };
    document.addEventListener("pointerdown", release);
    return () => document.removeEventListener("pointerdown", release);
  }, [focus]);
  const value = useMemo(
    () => ({ focus, setFocus, toggleFocus }),
    [focus, setFocus, toggleFocus],
  );
  return (
    <HoldingFocusContext.Provider value={value}>
      {children}
    </HoldingFocusContext.Provider>
  );
}

export function useHoldingFocus() {
  return useContext(HoldingFocusContext);
}

/** "on" for a focused holding, "dim" for the rest while something is focused. */
export function focusState(focus: Focus, ticker: string) {
  return !focus ? undefined : focus.includes(ticker) ? "on" : "dim";
}

/** A real hover: a mouse pointer on a device that can hover. Touch browsers also
 * emit synthetic mouse boundary events at the last tap point after a scroll;
 * `(hover: hover)` excludes those so no phantom highlight appears. Hybrid laptops
 * report hover and keep mouse hover plus touch taps. */
export const canHover = () =>
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(hover: hover)").matches;
export const isMouse = (e: PointerEvent) =>
  e.pointerType === "mouse" && canHover();

/** Handlers that focus `tickers`: mouse hover, keyboard focus, and touch tap
 * (toggle). Touch pointers fire enter and leave around every tap, so hover
 * handlers ignore them; a scroll gesture cancels the pointer and never toggles. */
export function focusHandlers(
  { setFocus, toggleFocus }: Pick<Value, "setFocus" | "toggleFocus">,
  tickers: readonly string[],
) {
  return {
    "data-focusable": "",
    onPointerEnter: (e: PointerEvent) => {
      if (isMouse(e)) setFocus(tickers);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (isMouse(e)) setFocus(null);
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") toggleFocus(tickers);
    },
    onFocus: () => setFocus(tickers),
    onBlur: () => setFocus(null),
  };
}
