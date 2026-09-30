"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  focusHandlers,
  isMouse,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";
import {
  hash,
  layoutConstellation,
  pct,
  prefersReducedMotion,
  spring,
} from "./geometry";

export type StarNode = {
  ticker: string;
  /** Capital weight, 0–1. */
  weight: number;
  /** Percentage risk contribution, 0–1 (null or undefined when unknown). */
  risk?: number | null;
  /** A previous weight kept briefly as an outline (constructor migrations). */
  ghost?: number | null;
  riskless?: boolean;
  /** A signed value tinting the node (e.g. its return through a stress event). */
  tone?: number | null;
};
export type Correlation = {
  tickers: string[];
  matrix: (number | null)[][];
} | null;

type Props = {
  nodes: StarNode[];
  width?: number;
  height?: number;
  /** Fraction of the field the full portfolio's capital area occupies. */
  fill?: number;
  correlation?: Correlation;
  /** capital: capital is the body, risk its shadow; risk: the reverse. */
  mode?: "capital" | "risk" | "construct";
  /** Ambient 1–3 px drift (landing only; the workspace stays still). */
  drift?: boolean;
  /** Tickers whose radius must be reserved in the layout (e.g. every proposal). */
  reserve?: Record<string, number>;
  label: string;
  onSelect?: (ticker: string, anchor: Element) => void;
  /** Hovering a node highlights it everywhere (analysis workspace). */
  linked?: boolean;
  className?: string;
  /** Small technical annotations (scale ticks, core readout). */
  annotate?: boolean;
  /** External single-ticker activation (e.g. the hero builder row in focus). */
  activeTicker?: string | null;
  onActive?: (ticker: string | null) => void;
};

type Body = {
  ticker: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  rr: number;
  vrr: number;
  gr: number;
  vgr: number;
  off: number;
  voff: number;
  phase: number;
  freq: number;
};

const SHADOW_DIR = { x: 0.62, y: 0.78 };

/** The Portfolio Constellation: each holding a node whose area is its capital
 * weight and whose offset outline is its share of risk. Positions come from a
 * deterministic layout. Motion is a small spring system: nodes settle into place,
 * drift a pixel or two on the landing, and a hover sends a ripple outward whose
 * strength at each node is that pair's absolute correlation when known. */
export function Constellation({
  nodes,
  width: defaultWidth = 900,
  height: defaultHeight = 620,
  fill = 0.13,
  correlation = null,
  mode = "capital",
  drift = false,
  reserve,
  label,
  onSelect,
  linked = false,
  className,
  annotate = true,
  activeTicker = null,
  onActive,
}: Props) {
  const holdingFocus = useHoldingFocus();
  const { focus, setFocus } = holdingFocus;
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Lay out in real pixels so labels never scale with the field.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 40 && h > 40)
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = size?.w ?? defaultWidth;
  const height = size?.h ?? defaultHeight;
  const bodies = useRef<Map<string, Body>>(new Map());
  const els = useRef<Map<string, SVGGElement>>(new Map());
  const edgeEls = useRef<SVGGElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const impulses = useRef<{ at: number; ticker: string; vx: number; vy: number }[]>([]);
  const rippleAt = useRef<{ t: number; x: number; y: number; r0: number } | null>(null);
  const frame = useRef(0);
  const visible = useRef(true);
  const reduced = useRef(false);
  const kick = useRef<() => void>(() => {});
  const [hover, setHover] = useState<string | null>(null);
  const uid = useId().replace(/:/g, "");

  const live = useMemo(
    () => nodes.filter((n) => n.weight > 0 || (n.ghost ?? 0) > 0),
    [nodes],
  );
  const R = Math.min(
    Math.sqrt((fill * width * height) / Math.PI),
    Math.min(width, height) * 0.62,
  );
  const rad = useCallback((w: number | null | undefined) => (w && w > 0 ? R * Math.sqrt(w) : 0), [R]);
  const layoutKey = live
    .map((n) => `${n.ticker}:${n.weight.toFixed(4)}:${(n.risk ?? 0).toFixed(3)}:${(n.ghost ?? 0).toFixed(3)}`)
    .join();
  const placed = useMemo(() => {
    const input = live.map((n) => ({
      ticker: n.ticker,
      mass: n.weight,
      reserve:
        Math.max(
          rad(n.weight),
          rad(n.risk ?? 0) + 6,
          rad(n.ghost ?? 0),
          rad(reserve?.[n.ticker] ?? 0),
          9,
        ) + 4,
    }));
    return new Map(
      layoutConstellation(input, width, height, {
        aspect: Math.min(2, Math.max(0.8, width / height)),
      }).map((p) => [p.ticker, p]),
    );
    // Layout depends on the portfolio's identity and reserved sizes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, reserve, width, height, rad]);

  const corr = useCallback(
    (a: string, b: string) => {
      if (!correlation) return null;
      const i = correlation.tickers.indexOf(a);
      const j = correlation.tickers.indexOf(b);
      if (i < 0 || j < 0) return null;
      return correlation.matrix[i]?.[j] ?? null;
    },
    [correlation],
  );

  // Targets for the spring system whenever data or mode changes.
  useEffect(() => {
    if (!size) return;
    const map = bodies.current;
    const first = map.size === 0;
    for (const n of live) {
      const p = placed.get(n.ticker);
      if (!p) continue;
      const cap = rad(n.weight);
      const risk = n.riskless ? 0 : rad(n.risk ?? 0);
      const gap = n.risk == null ? 0 : Math.abs((n.risk ?? 0) - n.weight);
      const offTarget = mode === "risk" ? 6 + gap * 120 : 2 + gap * 16;
      let b = map.get(n.ticker);
      if (!b) {
        const h = hash(n.ticker);
        b = {
          ticker: n.ticker,
          tx: p.x,
          ty: p.y,
          // New nodes enter from the core, already the right size of nothing.
          x: first ? width / 2 + (p.x - width / 2) * 0.82 : p.x,
          y: first ? height / 2 + (p.y - height / 2) * 0.82 : p.y,
          vx: 0,
          vy: 0,
          r: 0,
          vr: 0,
          rr: 0,
          vrr: 0,
          gr: 0,
          vgr: 0,
          off: 0,
          voff: 0,
          phase: (h % 1000) / 1000,
          freq: 0.00032 + ((h >> 10) % 100) / 400000,
        };
        map.set(n.ticker, b);
      }
      b.tx = p.x;
      b.ty = p.y;
      (b as Body & { target?: number[] }).target = [
        cap,
        risk,
        rad(n.ghost ?? 0),
        offTarget,
      ];
    }
    for (const key of [...map.keys()])
      if (!live.some((n) => n.ticker === key)) map.delete(key);
    kick.current();
  }, [live, placed, mode, rad, width, height, size]);

  // The animation loop: runs only while something is moving and on screen.
  useEffect(() => {
    reduced.current = prefersReducedMotion();
    let last = 0;
    let running = false;
    const step = (now: number) => {
      const dt = Math.min(0.034, last ? (now - last) / 1000 : 0.016);
      last = now;
      let moving = false;
      const q = impulses.current;
      for (let i = q.length - 1; i >= 0; i--) {
        if (q[i].at <= now) {
          const b = bodies.current.get(q[i].ticker);
          if (b) {
            b.vx += q[i].vx;
            b.vy += q[i].vy;
          }
          q.splice(i, 1);
        } else moving = true;
      }
      const amp = drift && !reduced.current ? 1.8 : 0;
      for (const b of bodies.current.values()) {
        const t = (b as Body & { target?: number[] }).target ?? [0, 0, 0, 0];
        const dx = amp * Math.sin(now * b.freq * 6.283 + b.phase * 6.283);
        const dy = amp * Math.cos(now * b.freq * 5.1 + b.phase * 9.1);
        if (reduced.current) {
          b.x = b.tx;
          b.y = b.ty;
          b.r = t[0];
          b.rr = t[1];
          b.gr = t[2];
          b.off = t[3];
        } else {
          [b.x, b.vx] = spring(b.x, b.vx, b.tx + dx, dt, 120, 14);
          [b.y, b.vy] = spring(b.y, b.vy, b.ty + dy, dt, 120, 14);
          [b.r, b.vr] = spring(b.r, b.vr, t[0], dt, 140, 20);
          [b.rr, b.vrr] = spring(b.rr, b.vrr, t[1], dt, 110, 17);
          [b.gr, b.vgr] = spring(b.gr, b.vgr, t[2], dt, 60, 16);
          [b.off, b.voff] = spring(b.off, b.voff, t[3], dt, 90, 15);
        }
        if (
          Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vr) + Math.abs(b.vrr) +
            Math.abs(b.voff) + Math.abs(b.vgr) > 0.02 ||
          Math.abs(b.r - t[0]) > 0.05 ||
          Math.abs(b.rr - t[1]) > 0.05
        )
          moving = true;
        const el = els.current.get(b.ticker);
        if (!el) continue;
        el.setAttribute("transform", `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)})`);
        const cap = el.querySelector<SVGCircleElement>(".cs-cap");
        const hit = el.querySelector<SVGCircleElement>(".cs-hit");
        const sh = el.querySelector<SVGCircleElement>(".cs-risk");
        const gh = el.querySelector<SVGCircleElement>(".cs-ghost");
        const lab = el.querySelector<SVGGElement>(".cs-label");
        const r = Math.max(0, b.r);
        cap?.setAttribute("r", r.toFixed(2));
        hit?.setAttribute("r", Math.max(r, 14).toFixed(2));
        if (sh) {
          sh.setAttribute("r", Math.max(0, b.rr).toFixed(2));
          sh.setAttribute("cx", (SHADOW_DIR.x * b.off).toFixed(2));
          sh.setAttribute("cy", (SHADOW_DIR.y * b.off).toFixed(2));
        }
        gh?.setAttribute("r", Math.max(0, b.gr).toFixed(2));
        const inside = r >= 19;
        lab?.setAttribute(
          "transform",
          inside ? "translate(0 0)" : `translate(${(r + 7).toFixed(1)} 0)`,
        );
        lab?.setAttribute("data-inside", inside ? "1" : "0");
      }
      // Edges follow their endpoints.
      edgeEls.current?.querySelectorAll<SVGLineElement>("line").forEach((line) => {
        const a = bodies.current.get(line.dataset.a!);
        const b = bodies.current.get(line.dataset.b!);
        if (!a || !b) return;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        line.setAttribute("x1", (a.x + Math.cos(ang) * (a.r + 3)).toFixed(2));
        line.setAttribute("y1", (a.y + Math.sin(ang) * (a.r + 3)).toFixed(2));
        line.setAttribute("x2", (b.x - Math.cos(ang) * (b.r + 3)).toFixed(2));
        line.setAttribute("y2", (b.y - Math.sin(ang) * (b.r + 3)).toFixed(2));
      });
      const rp = rippleAt.current;
      if (rp && ring.current) {
        const k = (now - rp.t) / 1100;
        if (k >= 1) {
          ring.current.setAttribute("opacity", "0");
          rippleAt.current = null;
        } else {
          const e = 1 - Math.pow(1 - k, 3);
          ring.current.setAttribute("cx", rp.x.toFixed(1));
          ring.current.setAttribute("cy", rp.y.toFixed(1));
          ring.current.setAttribute("r", (rp.r0 + e * 260).toFixed(1));
          ring.current.setAttribute("opacity", ((1 - k) * 0.5).toFixed(3));
          moving = true;
        }
      }
      if ((moving || amp > 0) && visible.current) {
        frame.current = requestAnimationFrame(step);
      } else {
        running = false;
        last = 0;
      }
    };
    kick.current = () => {
      if (running || !visible.current) return;
      running = true;
      frame.current = requestAnimationFrame(step);
    };
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible.current = entry.isIntersecting;
            if (entry.isIntersecting) kick.current();
          });
    if (svg.current && io) io.observe(svg.current);
    const onVis = () => {
      visible.current = !document.hidden;
      if (visible.current) kick.current();
    };
    document.addEventListener("visibilitychange", onVis);
    kick.current();
    return () => {
      cancelAnimationFrame(frame.current);
      running = false;
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [drift]);

  // Which node is active: local hover, the linked focus, or an external ticker.
  const linkedFocus = linked && focus && focus.length === 1 ? focus[0] : null;
  const active = hover ?? linkedFocus ?? activeTicker;
  const pairFocus = linked && focus && focus.length === 2 ? focus : null;

  // A new activation sends a ripple outward, weighted by correlation.
  useEffect(() => {
    if (!active || reduced.current) return;
    const src = bodies.current.get(active);
    if (!src) return;
    const now = performance.now();
    rippleAt.current = { t: now, x: src.x, y: src.y, r0: src.r };
    for (const b of bodies.current.values()) {
      if (b.ticker === active) continue;
      const dx = b.x - src.x;
      const dy = b.y - src.y;
      const d = Math.hypot(dx, dy) || 1;
      const c = corr(active, b.ticker);
      const strength = c === null ? 0.35 : Math.abs(c);
      const v = 70 * strength;
      impulses.current.push({
        at: now + d / 0.55,
        ticker: b.ticker,
        vx: (dx / d) * v,
        vy: (dy / d) * v,
      });
    }
    kick.current();
  }, [active, corr]);

  const edges = useMemo(() => {
    if (!correlation) return [];
    if (pairFocus) {
      const c = corr(pairFocus[0], pairFocus[1]);
      return c === null ? [] : [{ a: pairFocus[0], b: pairFocus[1], c }];
    }
    if (!active) return [];
    return live
      .filter((n) => n.ticker !== active && !n.riskless)
      .map((n) => ({ a: active, b: n.ticker, c: corr(active, n.ticker) }))
      .filter((e): e is { a: string; b: string; c: number } => e.c !== null)
      .sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
  }, [active, pairFocus, live, correlation, corr]);

  useEffect(() => {
    onActive?.(active);
  }, [active, onActive]);
  useEffect(() => kick.current(), [edges]);

  const handlePointerLeave = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") setHover(null);
    if (linked && isMouse(e)) setFocus(null);
  };
  const riskyTotal = live.filter((n) => !n.riskless).length;
  const activeNode = active ? live.find((n) => n.ticker === active) : undefined;
  return (
    <div
      ref={box}
      className={`constellation${className ? ` ${className}` : ""}`}
      data-ready={size ? "" : undefined}
      style={{ "--puck": `url(#${uid}-puck)`, "--hatch": `url(#${uid}-hatch)` } as CSSProperties}
      data-mode={mode}
      data-active={active ? "" : undefined}
      onPointerLeave={handlePointerLeave}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        focusable="false"
      >
        <defs>
          <radialGradient id={`${uid}-puck`} cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#2e2e2b" />
            <stop offset="0.7" stopColor="#1b1b1a" />
            <stop offset="1" stopColor="#151514" />
          </radialGradient>
          <pattern id={`${uid}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#171716" />
            <path d="M0 0v5" stroke="rgba(244,241,234,.28)" strokeWidth="1" />
          </pattern>
        </defs>
        <g className="cs-field" aria-hidden>
          <path
            className="cs-axis"
            d={`M0 ${height / 2}H${width}M${width / 2} 0V${height}`}
          />
          {annotate &&
            Array.from({ length: Math.floor(width / 30) + 1 }, (_, i) => (
              <path
                key={i}
                className={i % 5 === 0 ? "cs-tick cs-tick-major" : "cs-tick"}
                d={`M${i * 30} ${height / 2 - (i % 5 === 0 ? 5 : 2.5)}v${i % 5 === 0 ? 10 : 5}`}
              />
            ))}
          <g className="cs-core">
            <circle cx={width / 2} cy={height / 2} r="2.2" />
            <path
              d={`M${width / 2 - 14} ${height / 2}h-8m30 0h8M${width / 2} ${height / 2 - 14}v-8m0 30v8`}
            />
          </g>
        </g>
        <circle ref={ring} className="cs-ripple" r="0" opacity="0" aria-hidden />
        <g ref={edgeEls} className="cs-edges" aria-hidden>
          {edges.map((e, i) => (
            <line
              key={`${e.a}-${e.b}`}
              data-a={e.a}
              data-b={e.b}
              data-sign={e.c < 0 ? "neg" : "pos"}
              style={
                {
                  "--w": Math.abs(e.c).toFixed(3),
                  "--i": i,
                } as CSSProperties
              }
            />
          ))}
        </g>
        <g className="cs-nodes">
          {live.map((n) => {
            const on = active === n.ticker || pairFocus?.includes(n.ticker);
            const dim = (active || pairFocus) && !on;
            const handlers = linked
              ? focusHandlers(holdingFocus, [n.ticker])
              : {};
            return (
              <g
                key={n.ticker}
                ref={(el) => {
                  if (el) els.current.set(n.ticker, el);
                  else els.current.delete(n.ticker);
                }}
                className="cs-node"
                data-cash={n.riskless ? "" : undefined}
                data-on={on ? "" : undefined}
                data-dim={dim ? "" : undefined}
                data-tone={n.tone == null ? undefined : n.tone >= 0 ? "pos" : "neg"}
                style={
                  n.tone == null
                    ? undefined
                    : ({ "--t": Math.min(1, Math.abs(n.tone) / 0.4).toFixed(3) } as CSSProperties)
                }
                {...handlers}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setHover(n.ticker);
                  (handlers as { onPointerEnter?: (e: ReactPointerEvent) => void }).onPointerEnter?.(e);
                }}
                onClick={(e) => onSelect?.(n.ticker, e.currentTarget)}
              >
                <circle className="cs-ghost" r="0" />
                {!n.riskless && n.risk != null && <circle className="cs-risk" r="0" />}
                <circle className="cs-cap" r="0" />
                <circle className="cs-hit" r="14" />
                <g className="cs-label">
                  <text className="cs-ticker" dy="0.34em">
                    {n.ticker}
                  </text>
                  <text className="cs-weight" dy="0.34em">
                    {n.tone != null ? `${n.tone >= 0 ? "+" : "−"}${pct(Math.abs(n.tone), 1)}` : pct(n.weight)}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {annotate && (
        <div className="cs-readout" aria-hidden>
          {activeNode ? (
            <>
              <span className="cs-ro-ticker">{activeNode.ticker}</span>
              <span>
                <b>{pct(activeNode.weight)}</b> capital
              </span>
              {activeNode.risk != null && !activeNode.riskless && (
                <span>
                  <b>{pct(activeNode.risk)}</b> risk
                </span>
              )}
              {edges[0] && correlation && (
                <span>
                  ρ max <b>{edges[0].b}</b> {edges[0].c.toFixed(2)}
                </span>
              )}
            </>
          ) : (
            <>
              <span>Σ capital 100.00%</span>
              <span>{String(riskyTotal).padStart(2, "0")} risky</span>
              {live.some((n) => n.riskless) && <span>+ cash</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
