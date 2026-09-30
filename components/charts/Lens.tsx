"use client";

type CursorProps = {
  points?: { x: number; y: number }[];
  top?: number;
  height?: number;
  left?: number;
  width?: number;
};

/** The Financial Lens: an inspection region instead of a bare crosshair. A
 * bracketed band around the hovered session, a hairline at its center and a
 * measuring scale along its edges, like the reticle of an instrument. */
export function LensCursor({ points, top = 0, height = 0, left = 0, width = 0 }: CursorProps) {
  const x = points?.[0]?.x;
  if (x === undefined) return null;
  const half = 18;
  const x0 = Math.max(left, x - half);
  const x1 = Math.min(left + width, x + half);
  const ticks = Math.floor(height / 12);
  return (
    <g className="lens" pointerEvents="none">
      <rect className="lens-band" x={x0} y={top} width={x1 - x0} height={height} />
      <path
        className="lens-bracket"
        d={`M${x0 + 6} ${top}H${x0}V${top + 6}M${x1 - 6} ${top}H${x1}V${top + 6}M${x0 + 6} ${top + height}H${x0}V${top + height - 6}M${x1 - 6} ${top + height}H${x1}V${top + height - 6}`}
      />
      {Array.from({ length: ticks }, (_, i) => (
        <path
          key={i}
          className="lens-tick"
          d={`M${x0} ${top + i * 12}h${i % 4 === 0 ? 5 : 3}M${x1} ${top + i * 12}h${i % 4 === 0 ? -5 : -3}`}
        />
      ))}
      <line className="lens-axis" x1={x} x2={x} y1={top} y2={top + height} />
    </g>
  );
}
