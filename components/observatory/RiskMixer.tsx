"use client";
import type { CSSProperties } from "react";
import { riskContributions } from "@/lib/analytics/riskContribution";
import { Odometer } from "./Odometer";
import { pct } from "./geometry";

export type Mix = Record<string, number>;
export type MixResult = {
  volatility: number | null;
  /** Percentage risk contribution by ticker (CASH 0, riskless). */
  risk: Record<string, number>;
};

/** Evaluate a mix with the engine's own Euler decomposition over the cached
 * sample's annualized covariance. Risky weights are passed as target weights of
 * the whole portfolio (not renormalized), exactly as the engine does; CASH is
 * outside Σ and contributes zero risk. */
export function evaluateMix(
  mix: Mix,
  covariance: { tickers: string[]; annual: number[][] },
): MixResult {
  const w = covariance.tickers.map((t) => mix[t] ?? 0);
  const risk: Record<string, number> = { CASH: 0 };
  try {
    const r = riskContributions(covariance.annual, w);
    if (!r.ok) return { volatility: 0, risk };
    covariance.tickers.forEach((t, i) => (risk[t] = r.percentage[i]));
    return { volatility: r.volatility, risk };
  } catch {
    return { volatility: null, risk };
  }
}

/** Move one holding to `value` and rescale the others proportionally so the mix
 * always sums to exactly 100%. */
export function setShare(mix: Mix, ticker: string, value: number): Mix {
  const v = Math.min(1, Math.max(0, value));
  const others = Object.keys(mix).filter((t) => t !== ticker);
  const rest = others.reduce((s, t) => s + mix[t], 0);
  const next: Mix = { [ticker]: v };
  for (const t of others)
    next[t] = rest > 1e-9 ? (mix[t] / rest) * (1 - v) : (1 - v) / others.length;
  return next;
}

/** The Risk Mixer: drag capital, watch risk. Capital fill and the risk bar under
 * each slider move together, so WEIGHT ≠ RISK is felt rather than read. */
export function RiskMixer({
  mix,
  result,
  baseline,
  onChange,
  onUse,
}: {
  mix: Mix;
  result: MixResult;
  baseline: Mix;
  onChange: (next: Mix) => void;
  onUse: () => void;
}) {
  const tickers = Object.keys(baseline);
  const equal = Object.fromEntries(tickers.map((t) => [t, 1 / tickers.length]));
  const changed = tickers.some(
    (t) => Math.abs((mix[t] ?? 0) - baseline[t]) > 5e-4,
  );
  const top = tickers
    .filter((t) => t !== "CASH")
    .map((t) => ({ t, gap: (result.risk[t] ?? 0) - (mix[t] ?? 0) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  return (
    <div className="mixer" role="group" aria-label="Risk mixer">
      <div className="mixer-head">
        <div className="mixer-sigma">
          <span className="mixer-k">σ portfolio</span>
          <strong>
            {result.volatility == null ? (
              "—"
            ) : (
              <Odometer value={pct(result.volatility)} />
            )}
          </strong>
        </div>
        {top && (
          <p className="mixer-gap" aria-live="polite">
            <b>{top.t}</b> {pct(mix[top.t] ?? 0, 1)} of capital,{" "}
            <b data-dir={top.gap >= 0 ? "up" : "down"}>
              {pct(result.risk[top.t] ?? 0, 1)}
            </b>{" "}
            of risk
          </p>
        )}
      </div>
      <ul className="mixer-rows">
        {tickers.map((t) => {
          const w = mix[t] ?? 0;
          const r = Math.max(0, result.risk[t] ?? 0);
          return (
            <li
              key={t}
              style={{ "--w": w, "--r": Math.min(1, r) } as CSSProperties}
              data-cash={t === "CASH" ? "" : undefined}
            >
              <label htmlFor={`mix-${t}`}>{t}</label>
              <div className="mixer-track">
                <input
                  id={`mix-${t}`}
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={Math.round(w * 200) / 2}
                  aria-valuetext={`${pct(w, 1)} of capital, ${pct(r, 1)} of risk`}
                  onChange={(e) =>
                    onChange(setShare(mix, t, Number(e.target.value) / 100))
                  }
                />
                <span className="mixer-risk" aria-hidden />
              </div>
              <span className="mixer-v">
                <span>{pct(w, 1)}</span>
                <b>{t === "CASH" ? "0.0%" : pct(r, 1)}</b>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mixer-actions">
        <button
          type="button"
          onClick={() => onChange(baseline)}
          disabled={!changed}
        >
          Sample
        </button>
        <button type="button" onClick={() => onChange(equal)}>
          Equal
        </button>
        <button type="button" className="mixer-use" onClick={onUse}>
          Load this mix into the builder <span aria-hidden>↓</span>
        </button>
      </div>
      <p className="mixer-note">
        Engine risk decomposition on the cached sample&apos;s annualized
        covariance. Exploratory: analyze a portfolio for its own history.
      </p>
    </div>
  );
}
