"use client";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/** Radio group styled as one segmented control. The markup stays a native
 * fieldset of radio inputs (keyboard arrows, form semantics, accessible names
 * come from each label); a single thumb slides to the selected segment. */
export function Segmented<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  className,
  describedBy,
}: {
  legend: string;
  name: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  describedBy?: string;
}) {
  const root = useRef<HTMLFieldSetElement>(null);
  const [thumb, setThumb] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [settled, setSettled] = useState(false);
  const measure = useCallback(() => {
    const el = root.current?.querySelector<HTMLElement>("label.selected");
    if (!el || !el.offsetWidth) return setThumb(null);
    setThumb({
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    });
  }, []);
  useLayoutEffect(measure, [value, options.length, measure]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  useLayoutEffect(() => {
    // Skip the slide on first paint; animate every later selection change.
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <fieldset
      ref={root}
      className={`segmented${className ? ` ${className}` : ""}`}
      aria-describedby={describedBy}
      data-thumb={thumb ? (settled ? "settled" : "ready") : undefined}
    >
      <legend className="sr-only">{legend}</legend>
      {thumb && (
        <span
          className="seg-thumb"
          aria-hidden
          style={{
            width: thumb.w,
            height: thumb.h,
            transform: `translate(${thumb.x}px, ${thumb.y}px)`,
          }}
        />
      )}
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={value === o.value ? "selected" : undefined}
        >
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
