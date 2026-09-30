"use client";
import { useMemo, useRef, useState, type PointerEvent } from "react";

type Holding = { ticker: string; weight: number };

/** mulberry32: a tiny seeded generator so the candles are identical on server and
 * client and across reloads (no hydration mismatch, no random flicker). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CANDLES = (() => {
  const rand = seeded(20260929);
  let close = 50;
  return Array.from({ length: 27 }, () => {
    const open = close;
    close = Math.min(70, Math.max(30, open + (rand() - 0.46) * 11));
    const high = Math.max(open, close) + rand() * 5;
    const low = Math.min(open, close) - rand() * 5;
    return { open, close, high, low };
  });
})();

const NODE_CENTER = { x: 168, y: 46 };

/** One finance-native motif, tiny: portfolio weights as nodes (size = weight, the
 * largest highlighted) drifting slightly with the pointer, over a row of candles
 * that draw in once. The nodes come from the builder, so editing weights resizes
 * them. Decorative: aria-hidden and out of the tab order. */
function HeroMotif({ holdings }: { holdings: Holding[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<number | null>(null);
  const nodes = useMemo(() => {
    const live = holdings.filter((h) => h.ticker && h.weight > 0);
    const total = live.reduce((s, h) => s + h.weight, 0) || 1;
    const sorted = live
      .map((h) => ({ ...h, share: h.weight / total }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 14);
    return sorted.map((h, i) => {
      // Golden-angle spiral: deterministic, well spread, largest node central.
      const angle = i * 2.399963;
      const radius = 24 * Math.sqrt(i + 0.35);
      return {
        ...h,
        x: NODE_CENTER.x + Math.cos(angle) * radius * 2.05,
        y: NODE_CENTER.y + Math.sin(angle) * radius * 0.62,
        r: 2.6 + 15 * Math.sqrt(h.share),
        depth: 2 + (i % 4) * 2.4,
      };
    });
  }, [holdings]);
  const links = useMemo(() => {
    const seen = new Set<string>();
    const out: [number, number][] = [];
    nodes.forEach((a, i) => {
      nodes
        .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((n) => n.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2)
        .forEach(({ j }) => {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push([i, j]);
          }
        });
    });
    return out;
  }, [nodes]);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const nx = ((e.clientX - box.left) / box.width) * 2 - 1;
    const ny = ((e.clientY - box.top) / box.height) * 2 - 1;
    el.style.setProperty("--mx", nx.toFixed(3));
    el.style.setProperty("--my", ny.toFixed(3));
    const px = ((e.clientX - box.left) / box.width) * 420;
    const py = ((e.clientY - box.top) / box.height) * 150;
    let best: number | null = null;
    let bestD = 30;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - px, n.y - py) - n.r * 0.4;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHot(best);
  };
  const leave = () => {
    root.current?.style.setProperty("--mx", "0");
    root.current?.style.setProperty("--my", "0");
    setHot(null);
  };
  const lo = 22;
  const hi = 78;
  const y = (v: number) => 146 - ((v - lo) / (hi - lo)) * 46;
  return (
    <div
      className="motif"
      ref={root}
      onPointerMove={move}
      onPointerLeave={leave}
      data-active={hot === null ? undefined : ""}
      aria-hidden
    >
      <svg viewBox="0 0 420 150" focusable="false">
        <defs>
          <pattern id="motif-dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="var(--text)" opacity="0.1" />
          </pattern>
          <linearGradient id="motif-fade" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.25" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id="motif-mask">
            <rect width="420" height="150" fill="url(#motif-fade)" />
          </mask>
        </defs>
        <rect width="420" height="150" fill="url(#motif-dots)" mask="url(#motif-mask)" />
        {links.map(([i, j]) => (
          <line
            key={`${i}-${j}`}
            className="motif-link"
            x1={nodes[i].x}
            y1={nodes[i].y}
            x2={nodes[j].x}
            y2={nodes[j].y}
          />
        ))}
        {nodes.map((n, i) => (
          <g
            key={n.ticker + i}
            className="motif-dot"
            data-hot={hot === i ? "" : undefined}
            style={{ ["--depth" as string]: n.depth }}
          >
            {n.ticker === "CASH" ? (
              <circle
                cx={n.x}
                cy={n.y}
                style={{ r: n.r }}
                fill="none"
                stroke="var(--muted)"
                strokeDasharray="2 2"
                opacity="0.8"
              />
            ) : (
              <circle
                cx={n.x}
                cy={n.y}
                style={{ r: n.r }}
                fill={i === 0 ? "var(--accent)" : "var(--muted)"}
                opacity={i === 0 ? 0.92 : 0.5}
              />
            )}
            <text
              x={n.x > 290 ? n.x - n.r - 5 : n.x + n.r + 5}
              y={n.y + 3}
              textAnchor={n.x > 290 ? "end" : "start"}
            >
              {n.ticker} {(n.share * 100).toFixed(1)}%
            </text>
          </g>
        ))}
        <line x1="8" x2="412" y1="146.5" y2="146.5" stroke="var(--text)" strokeOpacity="0.14" />
        {CANDLES.map((c, i) => {
          const up = c.close >= c.open;
          const x = 14 + i * 15;
          const color = up ? "var(--positive)" : "var(--negative)";
          return (
            <g className="candle" key={i} style={{ ["--i" as string]: i }}>
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeOpacity="0.7" />
              <rect
                x={x - 3.2}
                y={y(Math.max(c.open, c.close))}
                width="6.4"
                height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))}
                rx="1"
                fill={color}
                opacity={up ? 0.75 : 0.62}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Compact hero: title, one line of context, the motif and the two actions. */
export function Hero({
  holdings,
  onAnalyze,
  onBuild,
}: {
  holdings: Holding[];
  onAnalyze: () => void;
  onBuild: () => void;
}) {
  return (
    <div className="hero">
      <div>
        <p className="hero-tape">
          <span>
            <i aria-hidden />
            <b>Portfolio analytics</b>
          </span>
          <span>Construction</span>
          <span>Reproducible daily data</span>
        </p>
        <h1>
          Portfolio Intelligence
          <br className="desktop-break" /> &amp; Construction Lab
          <span className="title-dot">.</span>
        </h1>
        <p className="hero-lede">
          <strong>See what actually drives your portfolio.</strong> Performance,
          risk concentration, diversification, benchmark behavior, historical
          stress periods and alternative allocations.
        </p>
      </div>
      <div className="hero-side">
        <HeroMotif holdings={holdings} />
        <div className="actions hero-actions">
          <button type="button" className="primary" onClick={onAnalyze}>
            Analyze Sample Portfolio <span aria-hidden>↗</span>
          </button>
          <button type="button" className="secondary" onClick={onBuild}>
            Build Portfolio
          </button>
        </div>
      </div>
    </div>
  );
}
