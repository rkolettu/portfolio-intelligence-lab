/* Presentation geometry for the observatory visuals. Nothing here is a finance
 * calculation: layouts are deterministic placements of values the engine already
 * produced, and the aggregations group engine wealth / price points by month for
 * drawing only. */

export const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Stable 32-bit hash of a ticker, used for phase and ordering tie-breaks. */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type LayoutInput = {
  ticker: string;
  /** Radius the node must reserve (the largest it will be drawn at). */
  reserve: number;
  /** Sort key: larger sits closer to the core. */
  mass: number;
};
export type Placed = { ticker: string; x: number; y: number };

/** Deterministic constellation layout: heaviest node nearest the core, the rest
 * on a golden-angle spiral, then a fixed number of pairwise separation passes.
 * The same inputs always give the same picture, so it can be screenshotted,
 * compared, and trusted not to be decorative randomness. CASH (riskless) is held
 * on the horizontal axis, apart from the risky system. */
export function layoutConstellation(
  input: LayoutInput[],
  width: number,
  height: number,
  { gap = 10, aspect = 1.45 }: { gap?: number; aspect?: number } = {},
): Placed[] {
  const cx = width / 2;
  const cy = height / 2;
  const risky = input
    .filter((n) => n.ticker !== "CASH")
    .sort((a, b) => b.mass - a.mass || a.ticker.localeCompare(b.ticker));
  const cash = input.find((n) => n.ticker === "CASH");
  const pts = risky.map((n, i) => {
    const a = i * GOLDEN - Math.PI / 2 + 0.4;
    const d = i === 0 ? 0 : 34 + 46 * Math.sqrt(i);
    return { ...n, x: cx + Math.cos(a) * d * aspect, y: cy + Math.sin(a) * d };
  });
  // Separation passes: push overlapping pairs apart, pull gently to the core.
  for (let pass = 0; pass < 140; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) {
          dx = Math.cos(j);
          dy = Math.sin(j);
          dist = 1;
        }
        const min = a.reserve + b.reserve + gap;
        if (dist < min) {
          const push = (min - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          // The heaviest node is the anchor and does not move.
          const wa = i === 0 ? 0 : 1;
          const share = wa === 0 ? 2 : 1;
          a.x -= ux * push * wa;
          a.y -= uy * push * wa;
          b.x += ux * push * share;
          b.y += uy * push * share;
        }
      }
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      p.x += (cx - p.x) * 0.012;
      p.y += (cy - p.y) * 0.02;
      // Keep inside the field.
      p.x = Math.min(width - p.reserve - 8, Math.max(p.reserve + 8, p.x));
      p.y = Math.min(height - p.reserve - 22, Math.max(p.reserve + 8, p.y));
    }
  }
  const out: Placed[] = pts.map((p) => ({ ticker: p.ticker, x: p.x, y: p.y }));
  if (cash) {
    const left = Math.min(...pts.map((p) => p.x - p.reserve), cx);
    out.push({
      ticker: cash.ticker,
      x: Math.max(cash.reserve + 12, left - cash.reserve - 30),
      y: cy,
    });
  }
  return out;
}

export type Candle = {
  key: string;
  start: string;
  end: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

/** Group a dated value series into calendar-month candles for drawing: open is
 * the prior month's last value (or the first point), close the month's last. */
export function monthlyCandles(points: { date: string; value: number }[]): Candle[] {
  const out: Candle[] = [];
  let prev: number | null = null;
  let cur: Candle | null = null;
  for (const p of points) {
    const key = p.date.slice(0, 7);
    if (!cur || cur.key !== key) {
      if (cur) {
        out.push(cur);
        prev = cur.c;
      }
      const o: number = prev ?? p.value;
      cur = { key, start: p.date, end: p.date, o, h: Math.max(o, p.value), l: Math.min(o, p.value), c: p.value };
    } else {
      cur.end = p.date;
      cur.c = p.value;
      cur.h = Math.max(cur.h, p.value);
      cur.l = Math.min(cur.l, p.value);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Months between two ISO dates, inclusive, as YYYY-MM keys. */
export function monthKeys(start: string, end: string) {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}/.test(start) || !/^\d{4}-\d{2}/.test(end)) return out;
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 700) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/** Critically damped-ish spring step (semi-implicit Euler). */
export function spring(
  x: number,
  v: number,
  target: number,
  dt: number,
  k = 170,
  c = 22,
) {
  const a = -k * (x - target) - c * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv] as const;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Compact percent for annotations: 0.1834 → "18.34%". */
export const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
