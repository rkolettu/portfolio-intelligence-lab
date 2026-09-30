"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Constellation, type StarNode } from "./Constellation";
import { MarketSpine, type SpineData } from "./MarketSpine";
import type { SampleDigest } from "./digest";
import { monthKeys, pct } from "./geometry";

export type ChapterId =
  | "portfolio"
  | "capital"
  | "performance"
  | "relationship"
  | "risk"
  | "stress"
  | "construction"
  | "builder";

type Draft = { ticker: string; weight: number }[];

const dot = (d: string) => d.slice(0, 7).replace("-", ".");
const signed = (v: number, digits = 2) =>
  `${v >= 0 ? "+" : "−"}${pct(Math.abs(v), digits)}`;
const SHORT: Record<string, string> = {
  gfc: "GFC",
  covid: "COVID",
  "rate-shock-2022": "2022",
};

/** Reads which chapter is in the middle band of the viewport. */
function useChapter(ids: ChapterId[]) {
  const [chapter, setChapter] = useState<ChapterId>("portfolio");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting)
            setChapter((e.target as HTMLElement).dataset.chapter as ChapterId);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    ids.forEach((id) => {
      const el = document.querySelector(`[data-chapter="${id}"]`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids]);
  return chapter;
}

/** The cached sample digest, fetched once the page is idle. */
function useDigest() {
  const [digest, setDigest] = useState<SampleDigest | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/sample-digest")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("digest"))))
        .then((d: SampleDigest) => !cancelled && setDigest(d))
        .catch(() => !cancelled && setFailed(true));
    const t = window.setTimeout(load, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);
  return { digest, failed };
}

const IDS: ChapterId[] = [
  "portfolio",
  "capital",
  "performance",
  "relationship",
  "risk",
  "stress",
  "construction",
  "builder",
];

/** A chapter's numbered, architectural heading with one large figure. */
function Chapter({
  id,
  n,
  title,
  figure,
  figureLabel,
  notes,
  children,
}: {
  id: ChapterId;
  n: string;
  title: [string, string?];
  figure?: ReactNode;
  figureLabel?: ReactNode;
  notes?: (string | null)[];
  children: ReactNode;
}) {
  return (
    <section className="chapter" data-chapter={id} aria-labelledby={`ch-${id}`}>
      <p className="ch-num" aria-hidden>
        {n}
      </p>
      <h2 id={`ch-${id}`} className="ch-title">
        <span>{title[0]}</span>
        {title[1] && <span>{title[1]}</span>}
      </h2>
      {figure != null && (
        <p className="ch-figure">
          <strong>{figure}</strong>
          {figureLabel && <span>{figureLabel}</span>}
        </p>
      )}
      <div className="ch-body">{children}</div>
      {notes && (
        <ul className="ch-notes" aria-label="Sample details">
          {notes.filter(Boolean).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Landing page: one continuous instrument. A sticky stage holds the Portfolio
 * Constellation and the Market Spine; chapters scroll past and the same objects
 * take on each chapter's meaning, then dock beside the builder and follow the
 * draft live. Chapters 02–06 illustrate with the cached sample analysis, labelled
 * as such; nothing on this page is a new calculation. */
export function Observatory({
  draft,
  period,
  benchmark,
  onAnalyze,
  onBuild,
  pending = false,
  children,
}: {
  /** An analysis is running: the stage makes room for the engine panel. */
  pending?: boolean;
  draft: Draft;
  period: { start: string; end: string; label: string };
  benchmark: string;
  onAnalyze: () => void;
  onBuild: () => void;
  /** The builder, rendered as the final chapter. */
  children: ReactNode;
}) {
  const chapter = useChapter(IDS);
  const { digest, failed } = useDigest();
  const [event, setEvent] = useState("gfc");
  const [focusTicker, setFocusTicker] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const live = draft.filter((h) => h.ticker && h.weight > 0);
  const total = live.reduce((s, h) => s + h.weight, 0) || 1;
  const draftNodes: StarNode[] = live.map((h) => ({
    ticker: h.ticker,
    weight: h.weight / total,
    riskless: h.ticker === "CASH",
  }));
  const largest = [...live].sort((a, b) => b.weight - a.weight)[0];

  const usesSample =
    !!digest &&
    ["performance", "relationship", "risk", "stress", "construction"].includes(chapter);
  const sampleEvent = digest?.stress.find((e) => e.id === event) ?? null;
  const topRisk = digest?.holdings
    .filter((h) => !h.riskless && h.risk != null)
    .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))[0];
  const pairs = useMemo(() => {
    const c = digest?.correlation;
    if (!c) return [];
    const out: { a: string; b: string; c: number }[] = [];
    c.tickers.forEach((a, i) =>
      c.tickers.forEach((b, j) => {
        const v = c.matrix[i]?.[j];
        if (j > i && v != null) out.push({ a, b, c: v });
      }),
    );
    return out.sort((x, y) => y.c - x.c);
  }, [digest]);

  const sampleNodes: StarNode[] = useMemo(
    () =>
      digest
        ? digest.holdings.map((h) => ({
            ticker: h.ticker,
            weight: h.weight,
            risk: h.riskless ? null : h.risk,
            riskless: h.riskless,
          }))
        : [],
    [digest],
  );
  let nodes = usesSample ? sampleNodes : draftNodes;
  if (usesSample && chapter === "stress" && sampleEvent)
    nodes = sampleNodes.map((n) => ({
      ...n,
      risk: null,
      tone: sampleEvent.holdings.find((h) => h.ticker === n.ticker)?.return ?? null,
    }));
  if (usesSample && chapter === "construction")
    nodes = sampleNodes.map((n) => ({ ...n, ghost: n.weight }));
  const mode =
    chapter === "risk" && usesSample
      ? "risk"
      : chapter === "construction"
        ? "construct"
        : "capital";

  const months = useMemo(
    () => monthKeys(period.start, period.end),
    [period.start, period.end],
  );
  let spine: SpineData = { kind: "calendar", months, capital: live };
  let spineLabel = `Spine / rebalance calendar · ${period.label}`;
  if (usesSample && digest) {
    if (chapter === "performance") {
      spine = { kind: "candles", candles: digest.candles };
      spineLabel = "Spine / monthly wealth · sample";
    } else if (chapter === "relationship") {
      spine = { kind: "spectrum", pairs };
      spineLabel = `Spine / ${pairs.length} pair correlations · sample`;
    } else if (chapter === "risk") {
      spine = {
        kind: "capital-risk",
        rows: digest.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight, risk: h.risk })),
      };
      spineLabel = "Spine / capital · risk contribution";
    } else if (chapter === "stress") {
      spine = {
        kind: "events",
        events: digest.stress.map((e) => ({ ...e, name: SHORT[e.id] ?? e.name, value: e.portfolio })),
        selected: event,
        bracket: [digest.start, digest.end],
        today: digest.end,
      };
      spineLabel = "Spine / historical environments";
    } else if (chapter === "construction") {
      spine = { kind: "allocation", current: digest.holdings };
      spineLabel = "Spine / current allocation";
    }
  }
  const spineData = spine;

  const onSelect = useCallback(
    (ticker: string) => {
      if (usesSample) return;
      const i = draft.findIndex((h) => h.ticker === ticker);
      const el = document.getElementById(`weight-${i}`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    },
    [draft, usesSample],
  );

  // A builder row gaining focus activates its node on the docked stage.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const id = (e.target as HTMLElement | null)?.id ?? "";
      const m = /^(?:ticker|weight)-(\d+)$/.exec(id);
      setFocusTicker(m ? (draft[Number(m[1])]?.ticker ?? null) : null);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [draft]);

  const fig =
    chapter === "builder"
      ? "Your draft · live"
      : usesSample
        ? `Sample · cached ${digest!.refreshedAt.slice(0, 10).replaceAll("-", ".")}`
        : "Draft portfolio";
  const n = IDS.indexOf(chapter);
  const sampleNote = digest
    ? `Sample portfolio · cached analysis refreshed ${digest.refreshedAt.slice(0, 10)}`
    : failed
      ? "The cached sample is unavailable here; the builder below is unaffected."
      : "Loading the cached sample…";

  return (
    <div className="obs" data-chapter={chapter} data-pending={pending ? "" : undefined}>
      <div className="obs-flow">
        <section className="obs-hero" data-chapter="portfolio" aria-labelledby="hero-title">
          <div className="obs-meta" aria-hidden>
            <span>Portfolio Intelligence &amp; Construction Lab</span>
            <span>
              Window {dot(period.start)}—{dot(period.end)} · {benchmark} · monthly
            </span>
          </div>
          <dl className="obs-spec" aria-label="Draft portfolio">
            <div>
              <dt>Holdings</dt>
              <dd>{String(live.length).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Largest</dt>
              <dd>{largest ? `${largest.ticker} ${pct(largest.weight / total)}` : "—"}</dd>
            </div>
            <div>
              <dt>Benchmark</dt>
              <dd>{benchmark}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>{period.label} · {months.length} rebalances</dd>
            </div>
          </dl>
          <h1 id="hero-title" className="obs-title">
            <span>Portfolio</span>
            <span>Intelligence</span>
          </h1>
          <p className="obs-sub" aria-hidden>
            <span>&amp; Construction Lab</span>
            <span className="obs-rule" />
            <span>Fig. 00</span>
          </p>
          <div className="obs-lede">
            <p>
              A financial observatory for one portfolio: where capital sits, where
              risk actually originates, how both behave through time, and how the
              same holdings reorganize under four construction methods.
            </p>
            <div className="actions">
              <button type="button" className="primary" onClick={onAnalyze}>
                Analyze Sample Portfolio <span aria-hidden>↗</span>
              </button>
              <button type="button" className="secondary" onClick={onBuild}>
                Build Portfolio
              </button>
            </div>
          </div>
          <a className="obs-scroll" href="#ch-capital">
            <span>Enter the system</span>
            <i aria-hidden />
          </a>
        </section>

        <Chapter
          id="capital"
          n="01"
          title={["Capital"]}
          figure={largest ? pct(largest.weight / total) : "—"}
          figureLabel={largest?.ticker}
          notes={[
            `Holdings / ${String(live.filter((h) => h.ticker !== "CASH").length).padStart(2, "0")} risky`,
            `Rebalance / monthly · ${months.length} months`,
            `Σ / ${pct(total / 100)}`,
          ]}
        >
          <p>
            Each node is a holding. Its area is its capital weight and its place
            is deterministic: the same portfolio always draws the same picture.
            CASH sits apart on the axis, outside the risky system.
          </p>
        </Chapter>

        <Chapter
          id="performance"
          n="02"
          title={["Performance"]}
          figure={digest?.metrics.cagr != null ? signed(digest.metrics.cagr) : "—"}
          figureLabel="CAGR"
          notes={[
            digest ? `Obs / ${digest.observations.toLocaleString()} daily returns` : null,
            digest ? `Window / ${dot(digest.start)}—${dot(digest.end)}` : null,
            digest?.metrics.maxDrawdown != null ? `Max DD / ${pct(digest.metrics.maxDrawdown)}` : null,
            sampleNote,
          ]}
        >
          <p>
            Daily closes compound into one path. On the spine, each candle is a
            month of the sample portfolio&apos;s wealth: open, high, low and close
            of the same $10,000.
          </p>
        </Chapter>

        <Chapter
          id="relationship"
          n="03"
          title={["Relationship"]}
          figure={pairs[0] ? pairs[0].c.toFixed(2) : "—"}
          figureLabel={pairs[0] ? `ρ ${pairs[0].a}–${pairs[0].b}` : "ρ"}
          notes={[
            pairs.length ? `Pairs / ${pairs.length}` : null,
            pairs.length ? `ρ min / ${pairs[pairs.length - 1].a}–${pairs[pairs.length - 1].b} ${pairs[pairs.length - 1].c.toFixed(2)}` : null,
            sampleNote,
          ]}
        >
          <p>
            Every pair of holdings has a correlation. Point at a node: a ripple
            leaves it and reaches each other holding with a strength equal to how
            closely the two have moved together.
          </p>
        </Chapter>

        <Chapter
          id="risk"
          n="04"
          title={["Risk", "Contribution"]}
          figure={topRisk?.risk != null ? pct(topRisk.risk) : "—"}
          figureLabel={topRisk ? `${topRisk.ticker} · ${pct(topRisk.weight)} of capital` : undefined}
          notes={[
            digest ? `Obs / ${digest.observations.toLocaleString()}` : null,
            digest ? `Window / ${dot(digest.start)}—${dot(digest.end)}` : null,
            "Σ / sample covariance",
            sampleNote,
          ]}
        >
          <p>
            Weight is not risk. Behind each node sits a shadow: its share of
            portfolio volatility. Here the shadow separates from the capital it
            came from, and the difference is the point.
          </p>
        </Chapter>

        <Chapter
          id="stress"
          n="05"
          title={["Stress"]}
          figure={sampleEvent?.portfolio != null ? signed(sampleEvent.portfolio) : "—"}
          figureLabel={
            sampleEvent
              ? `${sampleEvent.name}${sampleEvent.benchmark != null ? ` · ${digest?.benchmark} ${signed(sampleEvent.benchmark)}` : ""}`
              : undefined
          }
          notes={[
            sampleEvent ? `Slice / ${sampleEvent.start} → ${sampleEvent.end}` : null,
            sampleNote,
          ]}
        >
          <p>
            The same portfolio, moved through another historical environment.
            Target weights reset at each event&apos;s start; each node takes the
            color of its own return through the slice.
          </p>
          {digest && digest.stress.length > 0 && (
            <div className="ch-events" role="group" aria-label="Historical event">
              {digest.stress.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={event === e.id}
                  onClick={() => setEvent(e.id)}
                >
                  {SHORT[e.id] ?? e.name}
                </button>
              ))}
            </div>
          )}
        </Chapter>

        <Chapter
          id="construction"
          n="06"
          title={["Construction"]}
          figure="04"
          figureLabel="methods · one covariance"
          notes={[
            "Equal Weight",
            "Inverse Volatility",
            "Minimum Variance",
            "Equal Risk Contribution",
          ]}
        >
          <p>
            The current geometry stays on the table as an outline. In the
            Constructor, the same nodes migrate to each method&apos;s weights under
            long-only bounds and a Ledoit–Wolf covariance. Mathematical outputs,
            not recommendations.
          </p>
        </Chapter>

        <div className="obs-builder" data-chapter="builder">
          <p className="ch-num" aria-hidden>
            07
          </p>
          <p className="ch-title" aria-hidden>
            <span>Your</span>
            <span>Portfolio</span>
          </p>
          <p className="ch-lede">
            Enter holdings and weights. The constellation follows the draft as
            you type, and nothing is analyzed until you ask.
          </p>
          {children}
        </div>
      </div>

      <aside className="obs-stage" aria-label="Portfolio constellation" ref={stage}>
        <div className="stage-frame">
          <div className="stage-top" aria-hidden>
            <span>
              Fig. {String(n).padStart(2, "0")} — {fig}
            </span>
            <span className="stage-index">
              {IDS.map((id, i) => (
                <i key={id} data-on={i === n ? "" : undefined} data-past={i < n ? "" : undefined} />
              ))}
            </span>
          </div>
          <div className="stage-object">
            <Constellation
              nodes={nodes}
              mode={mode}
              drift={chapter === "portfolio" || chapter === "capital"}
              correlation={usesSample ? digest?.correlation ?? null : null}
              activeTicker={
                chapter === "relationship" ? (pairs[0]?.a ?? null) : chapter === "builder" ? focusTicker : null
              }
              fill={0.16}
              label={`${usesSample ? "Sample" : "Draft"} portfolio constellation. ${nodes
                .map((x) => `${x.ticker} ${pct(x.weight)}`)
                .join(", ")}. Node area is capital weight.`}
              onSelect={onSelect}
            />
          </div>
          <MarketSpine data={spineData} label={spineLabel} caption={`${dot(period.start)} — ${dot(period.end)}`} />
        </div>
      </aside>
    </div>
  );
}
