"use client";
import { memo } from "react";
import { MethodologyButton } from "@/components/methodology/MethodologyDrawer";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { money, percent, timestamp } from "@/lib/utils/format";
import type { BacktestResult } from "@/lib/types/analytics";
import { ResultTag, type ResultStatus } from "./AnalysisSections";

/** Section 11: methodology entry point, return ledger and data lineage. */
export const LineageSection = memo(function LineageSection({
  result,
  status,
}: {
  result: BacktestResult | null;
  status: ResultStatus;
}) {
  const stateTag = <ResultTag status={status} />;
  return (
    <section className="results" aria-labelledby="methodology-section-title">
      <SectionHeading
        number={11}
        eyebrow="Methodology"
        id="methodology-section-title"
        title="Methodology & data lineage."
        subtitle="Every figure replays from a frozen, hashed snapshot."
        glyph="methodology"
        aside={result ? stateTag : undefined}
      />
      <p className="muted method-lead">
        Every figure is computed server-side from a frozen snapshot of daily
        adjusted closes and can be replayed from that snapshot. Its SHA-256 hash identifies the inputs; the hash alone cannot recover the data.{" "}
        <MethodologyButton className="secondary">
          Open methodology
        </MethodologyButton>
      </p>
      {result && (
        <>
          <div className="summary-grid">
            <div>
              <span>Historical provider</span>
              <strong>{result.metadata.historicalProviders.join(", ")}</strong>
            </div>
            <div>
              <span>Historical Risk-Free</span>
              <strong>
                {result.metadata.treasuryProvider ?? "Unavailable"}
              </strong>
            </div>
            <div>
              <span>Generated</span>
              <strong>{timestamp(result.metadata.generatedAt)}</strong>
            </div>
            <div>
              <span>Methodology</span>
              <strong>{result.metadata.version}</strong>
            </div>
          </div>
          <p className="hash">
            Snapshot SHA-256: {result.metadata.snapshotHash}
          </p>
          <div className="table-wrap">
            <table>
              <caption>
                Return ledger · latest 10 intervals · indexed from $10,000
              </caption>
              <thead>
                <tr>
                  <th scope="col">Interval</th>
                  <th scope="col">Daily return</th>
                  <th scope="col">Indexed wealth</th>
                  <th scope="col">After close</th>
                </tr>
              </thead>
              <tbody>
                {result.ledger.slice(-10).map((row) => (
                  <tr key={row.date}>
                    <td>
                      {row.startDate} → {row.date}
                    </td>
                    <td>{percent(row.return)}</td>
                    <td>{money(row.wealth)}</td>
                    <td>
                      {row.rebalanced ? "Reset to targets" : "Weights drift"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <caption>Data coverage and fetch provenance</caption>
              <thead>
                <tr>
                  <th scope="col">Security</th>
                  <th scope="col">First date</th>
                  <th scope="col">Last date</th>
                  <th scope="col">Rows in range</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {result.coverage.map((c) => {
                  const s = result.snapshot.prices.find(
                    (p) => p.ticker === c.ticker,
                  );
                  return (
                    <tr key={c.ticker}>
                      <td>{c.ticker}</td>
                      <td>{c.firstAvailableDate ?? "—"}</td>
                      <td>{c.lastAvailableDate ?? "—"}</td>
                      <td>{c.observationCount.toLocaleString()}</td>
                      <td>
                        {s
                          ? `${s.provenance.provider}${s.provenance.fallbackUsed ? " · fallback" : ""} · fetched ${timestamp(s.provenance.fetchedAt)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.metadata.warnings.length > 0 && (
            <ul className="hint method-warnings">
              {result.metadata.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
});
