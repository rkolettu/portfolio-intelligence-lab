"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionGlyph, type GlyphKind } from "./SectionGlyph";

/** Numbered section heading: "03 / Benchmark" eyebrow, one h2, an optional compact
 * subtitle, the section's own motif and an optional tag. The motif settles once the
 * heading scrolls into view. */
export function SectionHeading({
  number,
  eyebrow,
  id,
  title,
  subtitle,
  glyph,
  aside,
}: {
  /** Page sections are numbered in navigation order; sub-sections are not. */
  number?: number;
  eyebrow: string;
  id: string;
  title: string;
  subtitle?: string;
  glyph?: GlyphKind;
  aside?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no observer: settle immediately
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <div
      className="section-heading"
      ref={root}
      data-seen={seen ? "" : undefined}
    >
      <div className="section-title">
        <p className="eyebrow">
          {number === undefined
            ? eyebrow
            : `${String(number).padStart(2, "0")} / ${eyebrow}`}
        </p>
        <h2 id={id}>{title}</h2>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      <div className="section-aside">
        {glyph && <SectionGlyph kind={glyph} />}
        {aside}
      </div>
    </div>
  );
}
