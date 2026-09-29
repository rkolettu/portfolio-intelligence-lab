"use client";
import { useId, useState, type ReactNode } from "react";

const TIP_WIDTH = 260;
const GUTTER = 16;
const DEFAULT_OFFSET = -8;

/** Methodology tooltip: shown on hover and keyboard focus (and tap, via focus);
 * the text is linked with aria-describedby so screen readers announce it. Width
 * and horizontal offset are computed from the trigger's position so the tip stays
 * inside the viewport in any grid layout. */
export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const place = (target: HTMLElement) => {
    const anchor = target.getBoundingClientRect().left;
    const viewport = window.innerWidth;
    const width = Math.min(TIP_WIDTH, viewport - 2 * GUTTER);
    // Offset relative to the trigger, clamped to [GUTTER, viewport - GUTTER].
    const left = Math.max(
      GUTTER - anchor,
      Math.min(DEFAULT_OFFSET, viewport - GUTTER - width - anchor),
    );
    setBox({ left, width });
  };
  return (
    <span
      className="info-tip"
      onPointerEnter={(e) => place(e.currentTarget)}
      onFocus={(e) => place(e.currentTarget)}
    >
      <button
        type="button"
        className="info-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        i
      </button>
      <span role="tooltip" id={id} className="tip" style={box ?? undefined}>
        {children}
      </span>
    </span>
  );
}
