"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import type { BacktestResult } from "@/lib/types/analytics";
import {
  focusHandlers,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";
import { monthlyCandles, pct, prefersReducedMotion } from "./geometry";

type Open = (ticker: string, anchor: Element, viaKeyboard?: boolean) => void;
const DossierContext = createContext<Open | null>(null);

/** Opens the Security Dossier for a ticker; a no-op outside an analysis. */
export function useDossier() {
  return useContext(DossierContext);
}

/** A ticker as an instrument control: hover highlights it everywhere, click or
 * Enter opens its dossier. Outside an analysis it renders as plain text. */
export function TickerChip({
  ticker,
  className,
  focusable = true,
}: {
  ticker: string;
  className?: string;
  focusable?: boolean;
}) {
  const open = useDossier();
  const holdingFocus = useHoldingFocus();
  if (!open) return <span className={className}>{ticker}</span>;
  return (
    <button
      type="button"
      className={`ticker-chip${className ? ` ${className}` : ""}`}
      aria-haspopup="dialog"
      tabIndex={focusable ? undefined : -1}
      {...focusHandlers(holdingFocus, [ticker])}
      onClick={(e) => {
        e.stopPropagation();
        open(ticker, e.currentTarget, e.detail === 0);
      }}
    >
      {ticker}
    </button>
  );
}

/** Rolls a number from its previous value to the new one. */
function useRoll(value: number, ms = 520) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const dur = prefersReducedMotion() ? 0 : ms;
    const start = performance.now();
    const a = from.current === value ? 0 : from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = dur ? Math.min(1, (now - start) / dur) : 1;
      const e = 1 - Math.pow(1 - k, 4);
      setShown(a + (value - a) * e);
      if (k < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

function Roll({ value, format }: { value: number; format: (v: number) => string }) {
  return <>{format(useRoll(value))}</>;
}

type State = { ticker: string; rect: DOMRect; anchor: Element; keyboard: boolean } | null;

/** The Security Dossier: a compact floating instrument panel for one holding,
 * reading only values the analysis already holds. What appears depends on what
 * is available for that holding. */
export function DossierProvider({
  result,
  children,
}: {
  result: BacktestResult;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>(null);
  const { setFocus } = useHoldingFocus();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const open = useCallback<Open>((ticker, anchor, keyboard = false) => {
    setState((s) =>
      s?.ticker === ticker
        ? null
        : { ticker, anchor, rect: anchor.getBoundingClientRect(), keyboard },
    );
  }, []);
  const close = useCallback(() => {
    setState((s) => {
      if (s?.keyboard) (s.anchor as HTMLElement).focus?.();
      return null;
    });
  }, []);

  useEffect(() => {
    setFocus(state ? [state.ticker] : null);
  }, [state, setFocus]);

  useLayoutEffect(() => {
    if (!state) return;
    const place = () => {
      const r = state.anchor.isConnected
        ? state.anchor.getBoundingClientRect()
        : state.rect;
      const w = panel.current?.offsetWidth ?? 300;
      const h = panel.current?.offsetHeight ?? 280;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = r.bottom + h + 12 < vh || r.top - h - 12 < 0;
      const x = Math.min(vw - w - 12, Math.max(12, r.left + r.width / 2 - 28));
      const y = below ? r.bottom + 10 : r.top - h - 10;
      setPos({ x, y, below });
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [state]);

  useEffect(() => {
    if (!state) return;
    if (state.keyboard) panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || state.anchor.contains(t)) return;
      setState(null);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [state, close]);

  return (
    <DossierContext.Provider value={open}>
      {children}
      {state && (
        <div
          ref={panel}
          className="dossier"
          role="dialog"
          aria-label={`${state.ticker} dossier`}
          tabIndex={-1}
          data-below={pos?.below ? "" : undefined}
          style={{
            left: pos?.x ?? -9999,
            top: pos?.y ?? -9999,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          <DossierBody result={result} ticker={state.ticker} onClose={close} />
        </div>
      )}
    </DossierContext.Provider>
  );
}

function DossierBody({
  result,
  ticker,
  onClose,
}: {
  result: BacktestResult;
  ticker: string;
  onClose: () => void;
}) {
  const r = result.riskAnalytics;
  const h = r.holdings.find((x) => x.ticker === ticker);
  const weight =
    h?.weight ?? result.config.holdings.find((x) => x.ticker === ticker)?.weight ?? 0;
  const risk = h && h.percentage.available ? h.percentage.value : null;
  const series = result.snapshot.prices.find((p) => p.ticker === ticker);
  const candles = useMemo(() => {
    if (!series) return [];
    const lo = result.initialDate;
    const hi = result.metadata.effectiveEndDate;
    return monthlyCandles(
      series.observations
        .filter((o) => o.date >= lo && o.date <= hi)
        .map((o) => ({ date: o.date, value: o.adjustedClose })),
    );
  }, [series, result.initialDate, result.metadata.effectiveEndDate]);
  let partner: { t: string; c: number } | null = null;
  if (r.correlation.available) {
    const i = r.correlation.tickers.indexOf(ticker);
    if (i >= 0)
      r.correlation.tickers.forEach((t, j) => {
        const c = r.correlation.available ? r.correlation.matrix[i][j] : null;
        if (j !== i && c != null && (!partner || Math.abs(c) > Math.abs(partner.c)))
          partner = { t, c };
      });
  }
  const p = partner as { t: string; c: number } | null;
  const hiC = Math.max(...candles.map((c) => c.h));
  const loC = Math.min(...candles.map((c) => c.l));
  const y = (v: number) => 34 - ((v - loC) / (hiC - loC || 1)) * 30;
  const cw = candles.length ? 248 / candles.length : 0;
  const delta = risk === null ? null : risk - weight;
  const riskless = h?.riskless ?? ticker === "CASH";
  return (
    <>
      <div className="ds-head">
        <strong className="ds-ticker">{ticker}</strong>
        <span className="ds-kind">
          {riskless
            ? "Cash · riskless"
            : series
              ? `${series.instrument} · ${series.exchange}`
              : "Holding"}
        </span>
        <button type="button" className="ds-close" aria-label="Close dossier" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="ds-figures">
        <div>
          <dt>Capital</dt>
          <dd>
            <Roll value={weight} format={(v) => pct(v)} />
          </dd>
        </div>
        {!riskless && (
          <div data-tone="risk">
            <dt>Risk</dt>
            <dd>{risk === null ? "N/A" : <Roll value={risk} format={(v) => pct(v)} />}</dd>
          </div>
        )}
        {delta !== null && !riskless && (
          <div>
            <dt>Δ</dt>
            <dd data-dir={delta >= 0 ? "up" : "down"}>
              {delta >= 0 ? "+" : "−"}
              {(Math.abs(delta) * 100).toFixed(2)} pp
            </dd>
          </div>
        )}
      </dl>
      {!riskless && (
        <dl className="ds-stats">
          {h?.volatility.available && (
            <div>
              <dt>Vol</dt>
              <dd>{pct(h.volatility.value, 1)}</dd>
            </div>
          )}
          {h?.beta.available && (
            <div>
              <dt>β / {result.config.benchmark}</dt>
              <dd>{h.beta.value.toFixed(2)}</dd>
            </div>
          )}
          {p && (
            <div>
              <dt>ρ max</dt>
              <dd>
                {p.t} {p.c.toFixed(2)}
              </dd>
            </div>
          )}
        </dl>
      )}
      {candles.length > 1 && (
        <figure className="ds-candles" aria-label="Monthly adjusted closes">
          <svg viewBox="0 0 248 38" preserveAspectRatio="none" aria-hidden>
            {candles.map((c, i) => {
              const x = i * cw + cw / 2;
              const up = c.c >= c.o;
              return (
                <g key={c.key} data-sign={up ? "pos" : "neg"} style={{ animationDelay: `${i * 8}ms` }}>
                  <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} />
                  <rect
                    x={x - Math.max(0.6, cw * 0.3)}
                    width={Math.max(1.2, cw * 0.6)}
                    y={y(Math.max(c.o, c.c))}
                    height={Math.max(0.8, Math.abs(y(c.o) - y(c.c)))}
                  />
                </g>
              );
            })}
          </svg>
          <figcaption>
            <span>{candles[0].start.slice(0, 7).replace("-", ".")}</span>
            <span>
              Adj. close ${candles[0].o.toFixed(2)} → ${candles[candles.length - 1].c.toFixed(2)}
            </span>
            <span>{candles[candles.length - 1].end.slice(0, 7).replace("-", ".")}</span>
          </figcaption>
        </figure>
      )}
      {riskless && (
        <p className="ds-note">
          Earns the Historical Risk-Free rate (3-month Treasury). Modeled as locally
          riskless and kept outside the covariance matrix.
        </p>
      )}
      <div className="ds-links">
        <Link href="/analysis/risk" onClick={onClose}>
          Risk <span aria-hidden>→</span>
        </Link>
        <Link href="/analysis/constructor" onClick={onClose}>
          Constructor <span aria-hidden>→</span>
        </Link>
      </div>
    </>
  );
}
