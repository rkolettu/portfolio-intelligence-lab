"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const GUTTER = 16;
const GAP = 8;

/** A brief definition, accessible by hover, tap or focus. The tooltip is portaled
 * to document.body so transformed/scrolling/overflow-hidden analysis surfaces can
 * never clip it. Placement follows the trigger and flips above when needed. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number }>();

  useEffect(() => {
    setMounted(true);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const show = () => {
    cancelHide();
    setDismissed(false);
    setActive((wasActive) => {
      if (!wasActive) setBox(undefined);
      return true;
    });
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      const triggerHovered = anchor.current?.matches(":hover") ?? false;
      const tooltipHovered = tip.current?.matches(":hover") ?? false;
      const triggerFocused = anchor.current?.contains(document.activeElement) ?? false;
      if (!triggerHovered && !tooltipHovered && !triggerFocused) setActive(false);
    }, 90);
  };

  useLayoutEffect(() => {
    if (!mounted || !active || dismissed) return;

    const place = () => {
      if (!anchor.current || !tip.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const width = Math.max(0, Math.min(260, window.innerWidth - 2 * GUTTER));
      const maxHeight = Math.max(0, window.innerHeight - 2 * GUTTER);

      // Measure the portaled tooltip at its final width before deciding which
      // side of the trigger has room. It is visibility:hidden until box is set.
      tip.current.style.width = `${width}px`;
      tip.current.style.maxHeight = `${maxHeight}px`;
      const height = Math.min(tip.current.getBoundingClientRect().height, maxHeight);

      const below = rect.bottom + GAP;
      const above = rect.top - GAP - height;
      let top: number;
      if (below + height <= window.innerHeight - GUTTER) top = below;
      else if (above >= GUTTER) top = above;
      else {
        const roomBelow = window.innerHeight - rect.bottom;
        const roomAbove = rect.top;
        top = roomBelow >= roomAbove
          ? Math.min(below, window.innerHeight - GUTTER - height)
          : Math.max(GUTTER, above);
      }

      const centered = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(
        GUTTER,
        Math.min(centered, window.innerWidth - GUTTER - width),
      );

      setBox({ left, top: Math.max(GUTTER, top), width });
    };

    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDismissed(true);
        setActive(false);
      }
    };

    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!anchor.current?.contains(target) && !tip.current?.contains(target)) {
        setActive(false);
      }
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [mounted, active, dismissed, children]);

  const open = active && !dismissed;

  return (
    <>
      <span
        ref={anchor}
        className="info-tip"
        data-dismissed={dismissed || undefined}
        data-open={open || undefined}
        onPointerEnter={show}
        onPointerLeave={(e) => {
          // A tiny delay bridges the physical gap to the portaled tooltip.
          if (e.pointerType === "mouse") scheduleHide();
        }}
        onFocus={show}
        onBlur={scheduleHide}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDismissed(true);
            setActive(false);
          }
        }}
      >
        <button
          type="button"
          className="info-trigger"
          aria-label={`About ${label}`}
          aria-describedby={id}
          aria-expanded={open}
          onClick={show}
        >
          i
        </button>
      </span>
      {mounted &&
        createPortal(
          <span
            ref={tip}
            role="tooltip"
            id={id}
            className="tip"
            data-open={open || undefined}
            onPointerEnter={cancelHide}
            onPointerLeave={scheduleHide}
            style={{
              ...box,
              display: open ? "block" : "none",
              visibility: open && box ? "visible" : "hidden",
              zIndex: 10000,
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}
