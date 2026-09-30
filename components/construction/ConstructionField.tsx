"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConstructionAnalytics,
  ConstructionProposal,
} from "@/lib/types/construction";
import { Constellation, type StarNode } from "@/components/observatory/Constellation";
import { MarketSpine } from "@/components/observatory/MarketSpine";
import { useDossier } from "@/components/observatory/Dossier";
import { pct } from "@/components/observatory/geometry";

type Weights = Record<string, number>;

/** The constructor's conclusion, watched rather than read: the current geometry
 * appears first, then the same nodes migrate to the selected method's weights.
 * The previous allocation stays briefly as an outline and risk shadows move to
 * the proposal's Construction Model Risk. Display only: every weight and risk
 * share is the engine's. */
export function ConstructionField({
  analytics,
  proposal,
}: {
  analytics: ConstructionAnalytics;
  proposal: ConstructionProposal;
}) {
  const dossier = useDossier();
  const inputs = analytics.inputs.current;
  const current = useMemo<Weights>(
    () => Object.fromEntries(inputs.map((w) => [w.ticker, w.weight])),
    [inputs],
  );
  const target = useMemo<Weights>(
    () =>
      proposal.weights
        ? Object.fromEntries(proposal.weights.map((w) => [w.ticker, w.weight]))
        : current,
    [proposal, current],
  );
  const risk = useMemo(() => {
    const m = new Map<string, number | null>();
    if (proposal.modelRisk.available)
      for (const h of proposal.modelRisk.holdings) m.set(h.ticker, h.percentage);
    return m;
  }, [proposal]);
  // Reserve the largest size each ticker takes in any method, so nodes resize in
  // place instead of re-laying out.
  const reserve = useMemo(() => {
    const out: Weights = { ...current };
    for (const p of analytics.proposals)
      for (const w of p.weights ?? []) out[w.ticker] = Math.max(out[w.ticker] ?? 0, w.weight);
    return out;
  }, [analytics.proposals, current]);

  const [shown, setShown] = useState<Weights>(current);
  const [ghost, setGhost] = useState<Weights | null>(null);
  const prev = useRef<Weights>(current);
  useEffect(() => {
    // First arrival holds the current geometry for a beat; later method changes
    // migrate at once, leaving the previous allocation as a ghost.
    const first = prev.current === current;
    const from = prev.current;
    const t1 = window.setTimeout(
      () => {
        setGhost(from);
        setShown(target);
        prev.current = target;
      },
      first ? 520 : 0,
    );
    const t2 = window.setTimeout(() => setGhost(null), first ? 2900 : 2400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [target, current]);

  const tickers = [...new Set([...Object.keys(current), ...Object.keys(target)])];
  const nodes: StarNode[] = tickers.map((t) => ({
    ticker: t,
    weight: shown[t] ?? 0,
    ghost: ghost ? (ghost[t] ?? 0) : null,
    risk: t === "CASH" ? null : shown === target ? Math.max(0, risk.get(t) ?? 0) : null,
    riskless: t === "CASH",
  }));
  const moves = tickers
    .map((t) => ({ t, from: current[t] ?? 0, to: target[t] ?? 0 }))
    .filter((m) => Math.abs(m.to - m.from) >= 0.0005)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return (
    <figure className="construct-field" aria-label={`Current allocation migrating to ${proposal.label}`}>
      <div className="cf-object">
        <Constellation
          nodes={nodes}
          reserve={reserve}
          width={620}
          height={400}
          fill={0.15}
          linked
          annotate={false}
          onSelect={(t, el) => dossier?.(t, el)}
          label={`${proposal.label} proposed allocation: ${tickers
            .map((t) => `${t} ${pct(target[t] ?? 0)}`)
            .join(", ")}.`}
        />
      </div>
      <figcaption className="cf-side">
        <p className="cf-kicker">
          Current <span aria-hidden>→</span> {proposal.label}
        </p>
        <ol className="cf-moves">
          {moves.slice(0, 7).map((m) => (
            <li key={m.t} data-dir={m.to > m.from ? "up" : "down"}>
              <b>{m.t}</b>
              <span>
                {pct(m.from)} → {pct(m.to)}
              </span>
              <em>
                {m.to > m.from ? "+" : "−"}
                {(Math.abs(m.to - m.from) * 100).toFixed(2)} pp
              </em>
            </li>
          ))}
          {moves.length === 0 && <li>No holding moves.</li>}
        </ol>
        <p className="cf-legend" aria-hidden>
          <span>
            <i data-k="cap" /> Proposed capital
          </span>
          <span>
            <i data-k="risk" /> Model risk share
          </span>
          <span>
            <i data-k="ghost" /> Previous
          </span>
        </p>
      </figcaption>
      <MarketSpine
        className="cf-spine"
        scan={false}
        data={{
          kind: "allocation",
          current: analytics.inputs.current,
          proposed: proposal.weights,
          method: proposal.method,
        }}
        label="Spine / current (outline) · proposed (solid)"
        caption={proposal.turnover != null ? `One-way turnover ${pct(proposal.turnover)}` : undefined}
      />
    </figure>
  );
}
