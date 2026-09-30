import type { LabelProps } from "recharts";
import { axisMoney } from "@/lib/utils/format";
import { CHART } from "./theme";

/** Hover marker: the hovered observation gets a solid dot inside a soft halo. */
export const activeDot = (color: string) =>
  function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
    if (cx === undefined || cy === undefined) return <g />;
    return (
      <g pointerEvents="none">
        <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.16} />
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={color}
          stroke={CHART.surface}
          strokeWidth={2}
        />
      </g>
    );
  };

/** Series end label: a haloed dot on the last observation plus "Name $value". */
export const endLabel = (
  lastIndex: number,
  name: string,
  color: string,
  dy = 4,
  format: (v: number) => string = axisMoney,
) =>
  function EndLabel({ x, y, index, value }: LabelProps) {
    if (index !== lastIndex || x === undefined || y === undefined) return <g />;
    return (
      <g>
        <circle cx={Number(x)} cy={Number(y)} r={7} fill={color} opacity={0.16} />
        <circle
          cx={Number(x)}
          cy={Number(y)}
          r={3.6}
          fill={color}
          stroke={CHART.surface}
          strokeWidth={1.8}
        />
        <text x={Number(x) + 11} y={Number(y) + dy} className="end-label">
          {name} {format(Number(value))}
        </text>
      </g>
    );
  };

/** Extremum ring for a labelled high or low: quiet, never competing with the line. */
export function ExtremumMark({
  cx,
  cy,
  color,
}: {
  cx?: number;
  cy?: number;
  color: string;
}) {
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.4}
      fill={CHART.surface}
      stroke={color}
      strokeWidth={1.4}
    />
  );
}
