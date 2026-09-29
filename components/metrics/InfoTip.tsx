"use client";
import { useId, type ReactNode } from "react";

/** Methodology tooltip: shown on hover and keyboard focus (and tap, via focus);
 * the text is linked with aria-describedby so screen readers announce it. */
export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        i
      </button>
      <span role="tooltip" id={id} className="tip">
        {children}
      </span>
    </span>
  );
}
