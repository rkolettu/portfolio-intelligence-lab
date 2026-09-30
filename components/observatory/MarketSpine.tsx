"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { dayMs, pct, prefersReducedMotion, type Candle } from "./geometry";

type Weighted = { ticker: string; weight: number };
export type SpineData =
  | { kind: "calendar"; months: string[]; capital: Weighted[] }
  | {
      kind: "candles";
      candles: Candle[];
      /** Rolling windows drawn as brackets ending at the last observation. */
      windows?: { sessions: number; total: number; active: boolean }[];
    }
  | { kind: "relative"; marks: { key: string; p: number; b: number }[]; benchmark: string }
  | { kind: "capital-risk"; rows: { ticker: string; weight: number; risk: number | null }[] }
  | { kind: "spectrum"; pairs: { a: string; b: string; c: number }[] }
  | {
      kind: "events";
      events: { id: string; name: string; start: string; end: string; value?: number | null }[];
      selected: string | null;
      /** The analyzed period, drawn as a bracket for orientation. */
      bracket?: [string, string] | null;
      today: string;
    }
  | { kind: "allocation"; current: Weighted[]; proposed?: Weighted[] | null; method?: string };

const fmtMonth = (key: string) => key.replace("-", ".");
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${pct(Math.abs(v))}`;
const money = (v: number) =>
  `$${Math.round(v).toLocaleString("en-US")}`;

function segments(list: Weighted[]) {
  const live = list.filter((h) => h.weight > 0);
  const total = live.reduce((s, h) => s + h.weight, 0) || 1;
  let at = 0;
  return live.map((h) => {
    const s = { ...h, left: at / total, width: h.weight / total };
    at += h.weight;
    return s;
  });
}

/** Count of scannable positions and the readout for one of them. */
function scanModel(d: SpineData): { count: number; read: (i: number) => ReactNode } {
  switch (d.kind) {
    case "calendar":
      return {
        count: d.months.length,
        read: (i) => (
          <>
            <b>{fmtMonth(d.months[i])}</b> monthly reset to target
          </>
        ),
      };
    case "candles":
      return {
        count: d.candles.length,
        read: (i) => {
          const c = d.candles[i];
          return (
            <>
              <b>{fmtMonth(c.key)}</b> {money(c.c)}{" "}
              <em data-sign={c.c >= c.o ? "pos" : "neg"}>{signed(c.c / c.o - 1)}</em> month
            </>
          );
        },
      };
    case "relative":
      return {
        count: d.marks.length,
        read: (i) => {
          const m = d.marks[i];
          return (
            <>
              <b>{fmtMonth(m.key)}</b> portfolio <em data-sign={m.p >= 0 ? "pos" : "neg"}>{signed(m.p)}</em> ·{" "}
              {d.benchmark} <em data-sign={m.b >= 0 ? "pos" : "neg"}>{signed(m.b)}</em>
            </>
          );
        },
      };
    case "capital-risk":
      return { count: 0, read: () => null };
    case "spectrum":
      return {
        count: d.pairs.length,
        read: (i) => {
          const p = d.pairs[i];
          return (
            <>
              <b>
                {p.a}–{p.b}
              </b>{" "}
              ρ {p.c.toFixed(2)}
            </>
          );
        },
      };
    default:
      return { count: 0, read: () => null };
  }
}

/** The Market Spine: a thin architectural rail that recurs through the product and
 * takes on the meaning of wherever it is — a rebalance calendar, monthly wealth
 * candles, relative marks, capital beside risk, historical event slices, or an
 * allocation in migration. Its marks re-assemble whenever that meaning changes.
 * A read-head scans the marks slowly while the page is idle; pointing at the rail
 * takes the head over. */
export function MarketSpine({
  data,
  label,
  caption,
  className,
  scan = true,
}: {
  data: SpineData;
  /** Left-hand system label, e.g. "Spine / performance". */
  label: string;
  /** Right-hand static caption (dates, units). */
  caption?: ReactNode;
  className?: string;
  scan?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const model = useMemo(() => scanModel(data), [data]);
  const [index, setIndex] = useState<number | null>(null);
  const idx = useRef<number | null>(null);
  const pos = useRef(0);
  const scrub = useRef(false);

  useEffect(() => {
    if (!scan || model.count < 2 || prefersReducedMotion()) {
      head.current?.style.setProperty("opacity", "0");
      return;
    }
    let frame = 0;
    let last = 0;
    let visible = true;
    const set = (p: number) => {
      pos.current = p;
      head.current?.style.setProperty("--p", p.toFixed(4));
      const i = Math.min(model.count - 1, Math.floor(p * model.count));
      if (i !== idx.current) {
        idx.current = i;
        setIndex(i);
      }
    };
    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      if (!scrub.current) set((pos.current + dt / 30) % 1);
      if (visible) frame = requestAnimationFrame(loop);
    };
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([e]) => {
            visible = e.isIntersecting;
            cancelAnimationFrame(frame);
            last = 0;
            if (visible) frame = requestAnimationFrame(loop);
          });
    if (track.current && io) io.observe(track.current);
    else frame = requestAnimationFrame(loop);
    const el = track.current;
    const move = (e: PointerEvent) => {
      if (!el) return;
      const b = el.getBoundingClientRect();
      scrub.current = true;
      set(Math.min(0.9999, Math.max(0, (e.clientX - b.left) / b.width)));
    };
    const leave = () => {
      scrub.current = false;
    };
    el?.addEventListener("pointermove", move);
    el?.addEventListener("pointerdown", move);
    el?.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      io?.disconnect();
      el?.removeEventListener("pointermove", move);
      el?.removeEventListener("pointerdown", move);
      el?.removeEventListener("pointerleave", leave);
    };
  }, [model, scan]);

  const readout =
    index !== null && index < model.count ? model.read(index) : null;
  return (
    <div
      className={`spine${className ? ` ${className}` : ""}`}
      data-kind={data.kind}
      aria-hidden
    >
      <div className="spine-head">
        <span className="spine-label">{label}</span>
        <span className="spine-readout" key={index ?? "none"}>
          {readout ?? caption}
        </span>
      </div>
      <div className="spine-track" ref={track}>
        <span className="spine-base" />
        {/* Remounting on kind replays the assembly: same rail, new meaning. */}
        <div className="spine-marks" key={data.kind}>
          <Marks data={data} active={index} />
        </div>
        <span
          className="spine-head-mark"
          ref={head}
          data-live={index !== null ? "" : undefined}
        />
      </div>
    </div>
  );
}

function Marks({ data, active }: { data: SpineData; active: number | null }) {
  const i = (n: number, extra?: Record<string, string | number>) =>
    ({ "--i": n, ...extra }) as CSSProperties;
  switch (data.kind) {
    case "calendar": {
      const n = data.months.length || 1;
      return (
        <>
          {segments(data.capital).map((s, k) => (
            <span
              key={s.ticker}
              className="sp-seg"
              data-cash={s.ticker === "CASH" ? "" : undefined}
              style={i(k, { left: `${s.left * 100}%`, width: `${s.width * 100}%` })}
            >
              {s.width >= 0.03 && <em>{s.ticker}</em>}
            </span>
          ))}
          {data.months.map((m, k) => (
            <span
              key={m}
              className="sp-tick"
              data-year={m.endsWith("-01") ? m.slice(0, 4) : undefined}
              data-on={active === k ? "" : undefined}
              style={i(k, { left: `${((k + 0.5) / n) * 100}%` })}
            />
          ))}
        </>
      );
    }
    case "candles": {
      const cs = data.candles;
      if (!cs.length) return null;
      const hi = Math.max(...cs.map((c) => c.h));
      const lo = Math.min(...cs.map((c) => c.l));
      const y = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
      const n = cs.length;
      return (
        <>
          {cs.map((c, k) => (
            <span
              key={c.key}
              className="sp-candle"
              data-sign={c.c >= c.o ? "pos" : "neg"}
              data-on={active === k ? "" : undefined}
              data-year={c.key.endsWith("-01") ? c.key.slice(0, 4) : undefined}
              style={i(k, {
                left: `${((k + 0.5) / n) * 100}%`,
                "--lo": y(c.l).toFixed(2),
                "--hi": y(c.h).toFixed(2),
                "--b0": y(Math.min(c.o, c.c)).toFixed(2),
                "--b1": y(Math.max(c.o, c.c)).toFixed(2),
              })}
            />
          ))}
          {data.windows?.map((w) => (
            <span
              key={w.sessions}
              className="sp-window"
              data-on={w.active ? "" : undefined}
              style={{ width: `${Math.min(100, (w.sessions / w.total) * 100)}%` }}
            >
              <em>{w.sessions}</em>
            </span>
          ))}
        </>
      );
    }
    case "relative": {
      const n = data.marks.length || 1;
      const m = Math.max(0.0001, ...data.marks.map((x) => Math.abs(x.p - x.b)));
      return (
        <>
          {data.marks.map((x, k) => (
            <span
              key={x.key}
              className="sp-rel"
              data-sign={x.p - x.b >= 0 ? "pos" : "neg"}
              data-on={active === k ? "" : undefined}
              style={i(k, {
                left: `${((k + 0.5) / n) * 100}%`,
                "--h": ((Math.abs(x.p - x.b) / m) * 46).toFixed(2),
              })}
            />
          ))}
        </>
      );
    }
    case "capital-risk": {
      const cap = segments(data.rows);
      const risk = segments(
        data.rows.map((r) => ({ ticker: r.ticker, weight: Math.max(0, r.risk ?? 0) })),
      );
      return (
        <>
          {cap.map((s, k) => (
            <span
              key={`c-${s.ticker}`}
              className="sp-seg"
              data-cash={s.ticker === "CASH" ? "" : undefined}
              style={i(k, { left: `${s.left * 100}%`, width: `${s.width * 100}%` })}
            >
              <em>{s.ticker}</em>
            </span>
          ))}
          {risk.map((s, k) => (
            <span
              key={`r-${s.ticker}`}
              className="sp-seg sp-seg-risk"
              style={i(k + 2, { left: `${s.left * 100}%`, width: `${s.width * 100}%` })}
            >
              {s.width >= 0.06 && <em>{pct(s.width, 1)}</em>}
            </span>
          ))}
        </>
      );
    }
    case "spectrum": {
      const n = data.pairs.length || 1;
      return (
        <>
          {data.pairs.map((p, k) => (
            <span
              key={`${p.a}-${p.b}`}
              className="sp-rel"
              data-sign={p.c >= 0 ? "pos" : "neg"}
              data-tone="corr"
              data-on={active === k ? "" : undefined}
              style={i(k, {
                left: `${((k + 0.5) / n) * 100}%`,
                "--h": (Math.abs(p.c) * 46).toFixed(2),
              })}
            />
          ))}
        </>
      );
    }
    case "events":
      return <EventMarks data={data} />;
    case "allocation": {
      const cur = segments(data.current);
      const next = data.proposed ? segments(data.proposed) : null;
      return (
        <>
          {cur.map((s, k) => (
            <span
              key={`c-${s.ticker}`}
              className="sp-seg"
              data-ghost={next ? "" : undefined}
              data-cash={s.ticker === "CASH" ? "" : undefined}
              style={i(k, { left: `${s.left * 100}%`, width: `${s.width * 100}%` })}
            >
              <em>{s.ticker}</em>
            </span>
          ))}
          {next?.map((s, k) => (
            <span
              key={`p-${s.ticker}`}
              className="sp-seg sp-seg-proposed"
              data-cash={s.ticker === "CASH" ? "" : undefined}
              style={{
                ...i(k),
                left: `${s.left * 100}%`,
                width: `${s.width * 100}%`,
              }}
            >
              {s.width >= 0.06 && <em>{pct(s.weight, 1)}</em>}
            </span>
          ))}
        </>
      );
    }
  }
}

/** Event slices on a historical axis. Selecting an event compresses the axis
 * toward it: other slices slide out of frame, the selected one widens. */
function EventMarks({ data }: { data: Extract<SpineData, { kind: "events" }> }) {
  const all = data.events;
  const lo = Math.min(...all.map((e) => dayMs(e.start)), data.bracket ? dayMs(data.bracket[0]) : Infinity);
  const hi = Math.max(dayMs(data.today), ...all.map((e) => dayMs(e.end)));
  const sel = all.find((e) => e.id === data.selected);
  let d0 = lo;
  let d1 = hi;
  if (sel) {
    const a = dayMs(sel.start);
    const b = dayMs(sel.end);
    const span = Math.max(b - a, 70 * 864e5);
    d0 = a - span * 0.45;
    d1 = b + span * 0.45;
  }
  const at = (t: number) => ((t - d0) / (d1 - d0)) * 100;
  const years: number[] = [];
  for (let y = new Date(lo).getUTCFullYear(); y <= new Date(hi).getUTCFullYear() + 1; y++)
    years.push(y);
  const months: number[] = [];
  if (sel) {
    const s = new Date(d0);
    const cur = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1);
    for (let t = cur; t < d1; ) {
      months.push(t);
      const dt = new Date(t);
      t = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
    }
  }
  return (
    <>
      {years.map((y) => {
        const x = at(Date.UTC(y, 0, 1));
        return (
          <span
            key={y}
            className="sp-year"
            data-hidden={x < -2 || x > 102 ? "" : undefined}
            style={{ left: `${x}%` }}
          >
            <em>{y}</em>
          </span>
        );
      })}
      {months.map((t) => (
        <span key={t} className="sp-month" style={{ left: `${at(t)}%` }} />
      ))}
      {data.bracket && (
        <span
          className="sp-bracket"
          style={{
            left: `${at(dayMs(data.bracket[0]))}%`,
            width: `${at(dayMs(data.bracket[1])) - at(dayMs(data.bracket[0]))}%`,
          }}
        >
          <em>Analysis</em>
        </span>
      )}
      {all.map((e) => (
        <span
          key={e.id}
          className="sp-event"
          data-on={e.id === data.selected ? "" : undefined}
          style={{
            left: `${at(dayMs(e.start))}%`,
            width: `max(3px, ${at(dayMs(e.end)) - at(dayMs(e.start))}%)`,
          }}
        >
          <em>
            {e.name}
            {e.value != null && <b data-sign={e.value >= 0 ? "pos" : "neg"}> {signed(e.value)}</b>}
          </em>
        </span>
      ))}
    </>
  );
}
