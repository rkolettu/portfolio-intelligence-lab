"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";

/** FLIP reorder animation for keyed rows. Children opt in with `data-flip="<key>"`.
 * When `order` changes, each row slides from its previous vertical position to its
 * new one. Purely visual; skipped for reduced motion and where WAAPI is missing. */
export function useFlip<T extends HTMLElement>(
  order: string,
): RefObject<T | null> {
  const root = useRef<T | null>(null);
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>("[data-flip]");
    const next = new Map<string, number>();
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rows.forEach((row) => {
      const key = row.dataset.flip!;
      const top = row.offsetTop;
      next.set(key, top);
      const before = previous.current.get(key);
      if (
        before !== undefined &&
        before !== top &&
        !reduced &&
        typeof row.animate === "function"
      )
        row.animate(
          [
            { transform: `translateY(${before - top}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 300, easing: "cubic-bezier(0.22, 0.7, 0.2, 1)" },
        );
    });
    previous.current = next;
  }, [order]);
  return root;
}
