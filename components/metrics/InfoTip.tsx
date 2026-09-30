"use client";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const GUTTER = 16;

/** A brief definition, accessible by hover, tap or focus. Fixed positioning lets
 * table-caption tips escape local scroll containers; placement follows scrolling
 * and flips above the trigger near the bottom of the viewport. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number }>();
  useLayoutEffect(() => {
    if (!active || dismissed) return;
    const place = () => {
      if (!anchor.current || !tip.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 2 * GUTTER);
      // Measure at the final width before choosing above/below placement.
      tip.current.style.width = `${width}px`;
      const height = tip.current.getBoundingClientRect().height;
      const top = rect.bottom + 8 + height <= window.innerHeight - GUTTER
        ? rect.bottom + 8
        : Math.max(GUTTER, rect.top - height - 8);
      setBox({
        left: Math.max(GUTTER, Math.min(rect.left - 8, window.innerWidth - GUTTER - width)),
        top,
        width,
      });
    };
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    // Touch opens the tip on tap (Safari never focuses a tapped button); a tap
    // anywhere outside the trigger and tip closes it.
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setActive(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [active, dismissed, children]);
  const show = () => { setDismissed(false); setActive(true); };
  return (
    <span
      ref={anchor}
      className="info-tip"
      data-dismissed={dismissed || undefined}
      data-open={(active && !dismissed) || undefined}
      onPointerEnter={show}
      onPointerLeave={(e) => {
        // Touch pointers leave right after every tap; only a mouse leaving closes.
        if (e.pointerType === "mouse" && !anchor.current?.contains(document.activeElement)) setActive(false);
      }}
      onFocus={show}
      onBlur={() => { if (!anchor.current?.matches(":hover")) setActive(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") setDismissed(true); }}
    >
      <button type="button" className="info-trigger" aria-label={`About ${label}`} aria-describedby={id}>i</button>
      <span ref={tip} role="tooltip" id={id} className="tip" style={box}>
        {children}
      </span>
    </span>
  );
}
