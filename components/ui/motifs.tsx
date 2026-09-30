import { displayIndices } from "@/lib/charts/series";

/* Finance-native micro-visualizations. Every one is decorative: aria-hidden, no
   text nodes (so they never change what screen readers or tests read), and driven
   only by values the parent already computed. */

const W = 96;
const H = 22;
const PAD = 2.5;

const thin = (values: readonly number[], max = 48) =>
  displayIndices(values.length, max, [values]).map((i) => values[i]);
const scale = (lo: number, hi: number, size: number) => (v: number) =>
  size - PAD - ((v - lo) / (hi - lo || 1)) * (size - 2 * PAD);
const line = (xs: number[], ys: number[]) =>
  xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join("");

/** Single trace. `baseline` fills toward a reference (e.g. 0 for drawdown);
 * `marker` places a ring on the last point or the extreme. */
export function Sparkline({
  values,
  tone = "var(--series-portfolio)",
  baseline,
  marker,
}: {
  values: readonly number[];
  tone?: string;
  baseline?: number;
  marker?: "last" | "min";
}) {
  if (values.length < 2) return null;
  const v = thin(values);
  const lo = Math.min(...v, baseline ?? Infinity);
  const hi = Math.max(...v, baseline ?? -Infinity);
  const y = scale(lo, hi, H);
  const xs = v.map((_, i) => PAD + (i / (v.length - 1)) * (W - 2 * PAD));
  const ys = v.map(y);
  const d = line(xs, ys);
  const base = baseline === undefined ? null : y(baseline);
  const at =
    marker === "min"
      ? ys.indexOf(Math.max(...ys))
      : marker === "last"
        ? v.length - 1
        : -1;
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      {base !== null && (
        <>
          <path
            d={`${d}L${xs.at(-1)!.toFixed(1)},${base.toFixed(1)}L${xs[0].toFixed(1)},${base.toFixed(1)}Z`}
            fill={tone}
            opacity="0.14"
          />
          <line x1={PAD} x2={W - PAD} y1={base} y2={base} className="viz-axis" />
        </>
      )}
      <path
        d={d}
        pathLength={1}
        className="viz-line"
        stroke={tone}
        fill="none"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {at >= 0 && (
        <circle
          cx={xs[at]}
          cy={ys[at]}
          r="2.4"
          fill="var(--surface)"
          stroke={tone}
          strokeWidth="1.4"
        />
      )}
    </svg>
  );
}

/** Two synchronized traces on one shared scale (portfolio vs benchmark). */
export function PairTraces({
  a,
  b,
  toneA = "var(--series-portfolio)",
  toneB = "var(--series-benchmark)",
}: {
  a: readonly number[];
  b: readonly number[];
  toneA?: string;
  toneB?: string;
}) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ia = displayIndices(n, 48, [a.slice(0, n), b.slice(0, n)]);
  const va = ia.map((i) => a[i]);
  const vb = ia.map((i) => b[i]);
  const lo = Math.min(...va, ...vb);
  const hi = Math.max(...va, ...vb);
  const y = scale(lo, hi, H);
  const xs = ia.map((_, i) => PAD + (i / (ia.length - 1)) * (W - 2 * PAD));
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <path
        d={line(xs, vb.map(y))}
        pathLength={1}
        className="viz-line"
        stroke={toneB}
        fill="none"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d={line(xs, va.map(y))}
        pathLength={1}
        className="viz-line"
        stroke={toneA}
        fill="none"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Beta relative to 1.0: the tick is the market, the dot is the portfolio. */
export function BetaMarker({ beta }: { beta: number }) {
  const min = -0.25;
  const max = 2.25;
  const x = (v: number) =>
    PAD + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (W - 2 * PAD);
  const mid = H / 2;
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <line x1={x(0)} x2={x(2)} y1={mid} y2={mid} className="viz-axis" />
      <line x1={x(0)} x2={x(0)} y1={mid - 3} y2={mid + 3} className="viz-axis" />
      <line
        x1={x(1)}
        x2={x(1)}
        y1={mid - 7}
        y2={mid + 7}
        stroke="var(--muted)"
        strokeWidth="1.2"
      />
      <line
        x1={x(1)}
        x2={x(beta)}
        y1={mid}
        y2={mid}
        className="viz-reveal"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx={x(beta)}
        cy={mid}
        r="3.4"
        fill="var(--accent)"
        stroke="var(--surface)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Two holdings drawn closer as their correlation approaches +1. */
export function PairDots({ rho }: { rho: number }) {
  const d = ((1 - Math.max(-1, Math.min(1, rho))) / 2) * 62;
  const c = W / 2;
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <line
        x1={c - d / 2}
        x2={c + d / 2}
        y1={H / 2}
        y2={H / 2}
        stroke="var(--border-strong)"
        strokeDasharray="2 2"
      />
      <circle cx={c - d / 2} cy={H / 2} r="4.5" fill="var(--series-portfolio)" opacity="0.85" className="viz-dot" />
      <circle cx={c + d / 2} cy={H / 2} r="4.5" fill="var(--series-benchmark)" opacity="0.85" className="viz-dot" />
    </svg>
  );
}

/** Proportional blocks: the largest holdings against the rest of the portfolio. */
export function WeightBlocks({ weights }: { weights: readonly number[] }) {
  const rest = Math.max(0, 1 - weights.reduce((s, w) => s + w, 0));
  const parts = [...weights, rest];
  const total = parts.reduce((s, w) => s + w, 0) || 1;
  const gap = 2;
  const usable = W - 2 * PAD - gap * (parts.length - 1);
  let x = PAD;
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      {parts.map((w, i) => {
        const width = Math.max(1.5, (w / total) * usable);
        const rect = (
          <rect
            key={i}
            x={x}
            y={5}
            width={width}
            height={H - 10}
            rx="1.5"
            fill={i < weights.length ? "var(--accent)" : "var(--border-strong)"}
            opacity={i < weights.length ? 1 - i * 0.22 : 0.7}
            className="viz-block"
            style={{ ["--i" as string]: i }}
          />
        );
        x += width + gap;
        return rect;
      })}
    </svg>
  );
}

/** Effective holdings against the nominal count: filled dots are "real" diversifiers. */
export function DotRow({ effective, count }: { effective: number; count: number }) {
  const n = Math.min(Math.max(1, Math.round(count)), 21);
  const step = Math.min(11, (W - 2 * PAD) / n);
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      {Array.from({ length: n }, (_, i) => {
        const fill = Math.max(0, Math.min(1, effective - i));
        return (
          <circle
            key={i}
            cx={PAD + step / 2 + i * step}
            cy={H / 2}
            r={Math.min(3.6, step / 2 - 1)}
            fill={fill > 0 ? "var(--accent)" : "none"}
            opacity={fill > 0 ? 0.35 + 0.65 * fill : 1}
            stroke={fill > 0 ? "none" : "var(--border-strong)"}
            className="viz-dot"
            style={{ ["--i" as string]: i }}
          />
        );
      })}
    </svg>
  );
}

/** Two bars on one scale, e.g. capital vs risk or weighted vs portfolio volatility. */
export function PairBars({
  a,
  b,
  toneA = "var(--series-capital)",
  toneB = "var(--series-portfolio)",
}: {
  a: number;
  b: number;
  toneA?: string;
  toneB?: string;
}) {
  const max = Math.max(a, b, 1e-9);
  const width = (v: number) => Math.max(1.5, (Math.max(0, v) / max) * (W - 2 * PAD));
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <rect x={PAD} y={4} height={5} rx="2" width={width(a)} fill={toneA} className="viz-bar" />
      <rect x={PAD} y={13} height={5} rx="2" width={width(b)} fill={toneB} className="viz-bar" style={{ ["--i" as string]: 1 }} />
    </svg>
  );
}

/** Signed value on a zero-centered bar (stress and active returns). */
export function CenterBar({ value, extent }: { value: number; extent: number }) {
  const half = (W - 2 * PAD) / 2;
  const w = Math.min(half, (Math.abs(value) / (extent || 1)) * half);
  const mid = W / 2;
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <rect
        x={value < 0 ? mid - w : mid}
        y={7}
        width={Math.max(w, 1)}
        height={8}
        rx="2"
        fill={value < 0 ? "var(--negative)" : "var(--positive)"}
        opacity="0.75"
        className="viz-bar"
        style={{ transformOrigin: `${mid}px 11px` }}
      />
      <line x1={mid} x2={mid} y1={3} y2={H - 3} stroke="var(--muted)" strokeWidth="1" />
    </svg>
  );
}

/** Yield curve as one trace with a ring on the maturity nearest the horizon. */
export function CurveTrace({
  values,
  mark,
}: {
  values: readonly number[];
  mark: number;
}) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = scale(lo, hi, H);
  const xs = values.map((_, i) => PAD + (i / (values.length - 1)) * (W - 2 * PAD));
  const ys = values.map(y);
  return (
    <svg className="viz viz-wide" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <path d={line(xs, ys)} pathLength={1} className="viz-line" stroke="var(--muted)" fill="none" strokeWidth="1.3" strokeLinejoin="round" />
      {values.map((_, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r={i === mark ? 3.2 : 1.6} fill={i === mark ? "var(--accent)" : "var(--faint)"} stroke={i === mark ? "var(--surface)" : "none"} strokeWidth="1.4" />
      ))}
    </svg>
  );
}
