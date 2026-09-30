"use client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Focus = readonly string[] | null;
type Value = { focus: Focus; setFocus: (tickers: Focus) => void };

const HoldingFocusContext = createContext<Value>({
  focus: null,
  setFocus: () => {},
});

/** Cross-component hover state: hovering a holding (or a correlation pair) in one
 * analytic highlights it in every related one. Display state only. */
export function HoldingFocusProvider({ children }: { children: ReactNode }) {
  const [focus, set] = useState<Focus>(null);
  const setFocus = useCallback((next: Focus) => {
    set((prev) =>
      prev === next ||
      (prev && next && prev.length === next.length && prev.every((t, i) => t === next[i]))
        ? prev
        : next,
    );
  }, []);
  const value = useMemo(() => ({ focus, setFocus }), [focus, setFocus]);
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

/** Pointer and keyboard handlers that focus `tickers` while active. */
export function focusHandlers(
  setFocus: (t: Focus) => void,
  tickers: readonly string[],
) {
  return {
    onPointerEnter: () => setFocus(tickers),
    onPointerLeave: () => setFocus(null),
    onFocus: () => setFocus(tickers),
    onBlur: () => setFocus(null),
  };
}
