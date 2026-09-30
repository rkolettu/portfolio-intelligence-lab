"use client";
import { memo, useEffect, useState } from "react";
import { quoteAfterElapsed } from "@/lib/market-data/quotes";
import { quoteBadge } from "@/lib/ui/quality";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice, Unavailable } from "@/components/ui/StatusNotice";
import { CurveTrace } from "@/components/ui/motifs";
import { StateBadge } from "@/components/ui/StateBadge";
import { money, timestamp, yieldPercent } from "@/lib/utils/format";
import type {
  CurrentQuote,
  Result,
  TreasuryCurve,
  TreasuryMaturity,
} from "@/lib/types/data";

/** Section 10. Owns the display clock: shown quotes re-derive freshness every 15 s
 * while the tab is visible (live/delayed claims lapse, closes go stale), and only
 * this table re-renders. Nothing here enters a historical calculation. */
export const CurrentMarket = memo(function CurrentMarket({
  quotes,
  receivedAt,
  curve,
  horizon,
  pending,
}: {
  quotes: Result<CurrentQuote>[] | null;
  /** Browser time the quotes arrived; the server clock advances by elapsed time. */
  receivedAt: number | null;
  curve: Result<TreasuryCurve> | null;
  horizon: TreasuryMaturity | null;
  pending: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (receivedAt === null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, [receivedAt]);
  const elapsed =
    receivedAt !== null && now !== null ? Math.max(0, now - receivedAt) : 0;
  const quoteRows = quotes?.filter((q) => q.ok) ?? [];
  const quoteErrors = quotes?.filter((q) => !q.ok) ?? [];
  return (
    <section
      className="results current-context"
      aria-labelledby="context-title"
    >
      <SectionHeading
        number={10}
        eyebrow="Current Market"
        id="context-title"
        title="Current market & Treasury reference."
        subtitle="Context only. Never enters a historical result."
        glyph="market"
        aside={<span className="tag">Never enters historical results</span>}
      />
      {!quotes && !curve && (
        <Unavailable
          kind={pending ? "stale" : "data"}
          title={pending ? "Requesting current data" : "Nothing requested yet"}
        >
          {pending
            ? "Requesting current quotes and the latest official Treasury curve…"
            : "Run an analysis to request current quotes and the latest official Treasury curve. They load independently of the historical analysis."}
        </Unavailable>
      )}
      {quotes && quoteRows.length === 0 && quoteErrors.length > 0 && (
        <StatusNotice tone="warning" title="Current Quotes Unavailable">
          {quoteErrors[0].ok ? null : quoteErrors[0].error.message}
        </StatusNotice>
      )}
      {quoteRows.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>
              Current market snapshot · latency is not guaranteed
            </caption>
            <thead>
              <tr>
                <th scope="col">Security</th>
                <th scope="col">Price</th>
                <th scope="col">Status</th>
                <th scope="col">Market time</th>
                <th scope="col">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {quotes!.map((q, i) => {
                if (!q.ok)
                  return (
                    <tr key={i}>
                      <td>{q.error.ticker ?? "Quotes"}</td>
                      <td colSpan={4} className="muted">
                        {q.error.message}
                      </td>
                    </tr>
                  );
                const v = quoteAfterElapsed(q.value, elapsed);
                return (
                  <tr key={v.ticker}>
                    <td>{v.ticker}</td>
                    <td>{money(v.price)}</td>
                    <td>
                      <StateBadge state={quoteBadge(v)} />
                    </td>
                    <td>{timestamp(v.marketTimestamp)}</td>
                    <td className="hint">
                      {v.provider} · observation age{" "}
                      {Math.round(v.observationAgeSeconds)}s · cache age at fetch{" "}
                      {Math.round(v.provenance.cacheAgeSeconds)}s · refreshed{" "}
                      {timestamp(v.provenance.lastSuccessfulRefresh)}
                      {v.stale && " · a newer market close exists"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {curve &&
        (curve.ok ? (
          <div className="treasury">
            <h3 className="group-title">
              Current Treasury Reference · latest official ·{" "}
              {curve.value.provenance.observationDate}
            </h3>
            <div className="curve-trace" aria-hidden>
              <CurveTrace
                values={curve.value.points.map((p) => p.annualYield)}
                mark={curve.value.points.findIndex((p) => p.maturity === horizon)}
              />
            </div>
            <dl className="curve-points">
              {curve.value.points.map((p) => (
                <div
                  key={p.maturity}
                  className={p.maturity === horizon ? "curve-selected" : ""}
                >
                  <dt>
                    {p.maturity}
                    {p.maturity === horizon && (
                      <span className="sr-only"> (analysis horizon)</span>
                    )}
                  </dt>
                  <dd>{yieldPercent(p.annualYield)}</dd>
                </div>
              ))}
            </dl>
            {horizon && (
              <p className="hint">
                Highlighted: {horizon}, the maturity nearest the requested
                analysis horizon. Context only; historical Sharpe, Sortino,
                alpha and CASH use the Historical Risk-Free series.
              </p>
            )}
            {curve.value.mixedDates && (
              <p className="warning">
                Maturities carry different observation dates; the curve is not a
                single synchronous observation.
              </p>
            )}
            <p className="hint">
              {curve.value.provenance.provider} · refreshed{" "}
              {timestamp(curve.value.provenance.lastSuccessfulRefresh)} · cache
              age {Math.round(curve.value.provenance.cacheAgeSeconds)}s.
            </p>
          </div>
        ) : (
          <StatusNotice tone="warning" title="Treasury Data Unavailable">
            {curve.error.message}
          </StatusNotice>
        ))}
    </section>
  );
});
