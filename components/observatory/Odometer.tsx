"use client";
import type { CSSProperties } from "react";

/** A figure whose digits roll like a mechanical counter when the value changes.
 * Positions are keyed from the right so digits stay aligned as the width
 * changes; non-digits sit still. Screen readers get the plain value. */
export function Odometer({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const chars = [...value];
  return (
    <span className={`odo${className ? ` ${className}` : ""}`}>
      <span className="sr-only">{value}</span>
      <span className="odo-face" aria-hidden>
        {chars.map((c, i) => {
          const key = chars.length - i;
          if (!/\d/.test(c))
            return (
              <span key={`s${key}`} className="odo-static">
                {c}
              </span>
            );
          return (
            <span key={`d${key}`} className="odo-cell">
              <span
                className="odo-strip"
                style={{ "--d": Number(c), "--k": key } as CSSProperties}
              >
                {"0123456789".split("").map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
              <span className="odo-sizer">0</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
