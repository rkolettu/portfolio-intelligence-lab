import type { ReactNode } from "react";

/** Numbered section heading: "03 / Benchmark" eyebrow, one h2 and an optional tag. */
export function SectionHeading({
  number,
  eyebrow,
  id,
  title,
  aside,
}: {
  number: number;
  eyebrow: string;
  id: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">
          {String(number).padStart(2, "0")} / {eyebrow}
        </p>
        <h2 id={id}>{title}</h2>
      </div>
      {aside}
    </div>
  );
}
