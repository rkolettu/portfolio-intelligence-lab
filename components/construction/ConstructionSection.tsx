"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ConstructionAnalytics,
  ConstructionMethod,
} from "@/lib/types/construction";
import type { DataError, Result } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import type { Draft } from "@/lib/state/portfolioReducer";
import {
  applyProposal,
  builderConsistency,
  constructorRequest,
  defaultConstructorDraft,
  inputsKey,
  type ConstructorDraft,
  type Proposal,
} from "@/lib/state/construction";
import { fixed, timestamp, unsignedPercent } from "@/lib/utils/format";
import { constructionStatus, errorState } from "@/lib/ui/quality";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { StateBadge } from "@/components/ui/StateBadge";
import { LoadingState } from "@/components/ui/LoadingState";
import { Segmented } from "@/components/ui/Segmented";
import { useSlot } from "@/components/workspace/WorkspaceProvider";
import { bindingSummary } from "@/lib/analytics/construction/observations";
import { ProposalView } from "./ProposalView";

const METHODS: { value: ConstructionMethod; label: string }[] = [
  { value: "equal_weight", label: "Equal Weight" },
  { value: "inverse_volatility", label: "Inverse Volatility" },
  { value: "minimum_variance", label: "Minimum Variance" },
  { value: "equal_risk_contribution", label: "Equal Risk Contribution" },
];
export const CONSTRUCTION_DISCLAIMER =
  "Portfolio allocations shown are mathematical outputs based on the selected inputs, assumptions, and constraints, not personalized recommendations.";
const sci = (v: number | null) => (v === null ? "—" : v.toExponential(2));
const words = (v: string) => v.replaceAll("_", " ");

/** Portfolio Constructor / Allocation Sandbox. Inputs live beside the builder
 * draft; a generated proposal never mutates the current portfolio, goes stale when
 * any input changes, and Apply revalidates before replacing the builder holdings. */
export function ConstructionSection({
  config,
  analysisHash,
  today,
  builder,
  onApply,
}: {
  config: PortfolioConfig;
  analysisHash: string;
  today: string;
  builder: Draft;
  onApply: (draft: Draft) => void;
}) {
  // Per-analysis state survives page navigation; an in-flight request does not
  // (leaving the page aborts it), so `pending` stays local.
  const slot = `${analysisHash}:construction`;
  const [draft, setDraft] = useSlot<ConstructorDraft>(`${slot}:draft`, () =>
    defaultConstructorDraft(config),
  );
  const [method, setMethod] = useSlot<ConstructionMethod>(
    `${slot}:method`,
    "minimum_variance",
  );
  const [proposal, setProposal] = useSlot<Proposal | null>(`${slot}:proposal`, null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useSlot<DataError | null>(`${slot}:error`, null);
  const [applyMessage, setApplyMessage] = useSlot<{
    ok: boolean;
    text: string;
  } | null>(`${slot}:apply`, null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const pendingRequest = request;
    return () => pendingRequest.current?.abort();
  }, []);

  const parsed = constructorRequest(draft, config);
  // Construction is defined only while the builder still holds the analyzed portfolio.
  const consistency = builderConsistency(builder, config, today);
  const key =
    parsed.ok && consistency.ok
      ? inputsKey(parsed.request, analysisHash, consistency.config)
      : null;
  // A response keeps the key captured when its request was sent, so edits made while
  // it was outstanding (constraints, CASH, builder) leave it stale.
  const stale = !!proposal && proposal.key !== key;
  const currentCash =
    config.holdings.find((h) => h.ticker === "CASH")?.weight ?? 0;
  const setConstraint = (
    i: number,
    patch: Partial<ConstructorDraft["constraints"][number]>,
  ) =>
    setDraft((d) => ({
      ...d,
      constraints: d.constraints.map((c, k) =>
        k === i ? { ...c, ...patch } : c,
      ),
    }));

  async function generate() {
    if (!parsed.ok || !key) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setApplyMessage(null);
    try {
      const response = await fetch("/api/construction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: parsed.request.config,
          constraints: parsed.request.constraints,
          cash: parsed.request.cash,
        }),
        signal: controller.signal,
      });
      const r = (await response.json()) as Result<ConstructionAnalytics>;
      if (controller.signal.aborted) return;
      if (r.ok) setProposal({ key, result: r.value });
      else setError(r.error);
    } catch {
      if (!controller.signal.aborted)
        setError({
          code: "PROVIDER_ERROR",
          message:
            "The construction request failed. The analysis above is unaffected.",
          retryable: true,
        });
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function apply() {
    if (!proposal || !key) return;
    const r = applyProposal({
      proposal,
      currentKey: key,
      method,
      builder,
      today,
      constraints: parsed.ok ? parsed.request.constraints : undefined,
    });
    if (r.ok) {
      onApply(r.draft);
      setApplyMessage({
        ok: true,
        text: "Applied to the builder with full-precision weights. Re-run the analysis to evaluate the new allocation; the analysis above is unchanged.",
      });
    } else setApplyMessage({ ok: false, text: r.reason });
  }

  const result = proposal?.result ?? null;
  const selected = result?.proposals.find((p) => p.method === method) ?? null;
  const cov = result?.covariance;
  const est = result?.estimation;
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Eligible universe</span>
          <strong>
            {draft.constraints.length} risky
            {currentCash > 0 || draft.cash.mode === "fixed"
              ? " + fixed CASH"
              : ""}
          </strong>
        </div>
        <div>
          <span>Estimation window</span>
          <strong>
            {est?.available
              ? `${est.sample.startDate} → ${est.sample.endDate} · ${est.sample.returnCount.toLocaleString()} obs`
              : `Analysis period ${config.requestedStartDate} → ${config.endDate}`}
          </strong>
        </div>
        <div>
          <span>Covariance</span>
          <strong>
            {cov?.available
              ? `Ledoit–Wolf · δ = ${fixed(cov.shrinkage, 4)}`
              : "Ledoit–Wolf shrinkage"}
          </strong>
        </div>
        <div>
          <span>Evaluation</span>
          <strong>In-sample · retrospective</strong>
        </div>
      </div>
      {est && !est.available && (
        <StatusNotice
          tone="warning"
          title="Construction risk model unavailable"
        >
          {est.reason}
        </StatusNotice>
      )}
      {est?.available &&
        est.notes.map((n) => (
          <p className="hint" key={n}>
            {n}
          </p>
        ))}

      <ol
        className="construct-steps"
        aria-label="Construction workflow"
        data-stage={result ? "review" : "setup"}
      >
        <li>Select method</li>
        <li>Set constraints</li>
        <li>Generate allocation</li>
        <li>Review Proposed Allocation and turnover</li>
        <li>Inspect diagnostics</li>
        <li>Compare Current vs Proposed model risk</li>
        <li>Review historical and stress behavior</li>
        <li>Apply only if you choose to</li>
      </ol>
      <h3 className="group-title">1 · Method</h3>
      <div className="series-control">
        <Segmented
          legend="Construction method"
          name="construction-method"
          options={METHODS}
          value={method}
          onChange={setMethod}
        />
        <span className="hint">
          One generation solves all four methods on the same inputs; this
          chooses which to review.
        </span>
      </div>

      <h3 className="group-title">
        2 · Constraints · % of the whole portfolio, long only
      </h3>
      <div className="table-wrap">
        <table className="constraint-table">
          <caption className="sr-only">
            Per-asset construction constraints
          </caption>
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Current</th>
              <th scope="col">Minimum %</th>
              <th scope="col">Maximum %</th>
              <th scope="col">Required</th>
            </tr>
          </thead>
          <tbody>
            {draft.constraints.map((c, i) => (
              <tr key={c.ticker}>
                <td>
                  {c.ticker}
                  {(config.holdings.find((h) => h.ticker === c.ticker)
                    ?.weight ?? 0) === 0 && (
                    <span className="cr-tag">candidate</span>
                  )}
                </td>
                <td>
                  {unsignedPercent(
                    config.holdings.find((h) => h.ticker === c.ticker)
                      ?.weight ?? 0,
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Minimum weight ${c.ticker}`}
                    inputMode="decimal"
                    value={c.min}
                    onChange={(e) => setConstraint(i, { min: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Maximum weight ${c.ticker}`}
                    inputMode="decimal"
                    value={c.max}
                    onChange={(e) => setConstraint(i, { max: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Required ${c.ticker}`}
                    checked={c.required}
                    onChange={(e) =>
                      setConstraint(i, { required: e.target.checked })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        A positive minimum always applies; a required asset needs one. To
        consider a new asset, add it to the builder at 0% and re-run the
        analysis.
      </p>

      <h3 className="group-title">3 · CASH · fixed, never optimized</h3>
      <fieldset className="cash-choice">
        <legend className="sr-only">CASH weight</legend>
        <label>
          <input
            type="radio"
            name="construction-cash"
            checked={draft.cash.mode === "current"}
            onChange={() =>
              setDraft((d) => ({ ...d, cash: { mode: "current" } }))
            }
          />
          Fixed at current ({unsignedPercent(currentCash)})
        </label>
        <label>
          <input
            type="radio"
            name="construction-cash"
            checked={draft.cash.mode === "fixed"}
            onChange={() =>
              setDraft((d) => ({
                ...d,
                cash: {
                  mode: "fixed",
                  weight: String(Number((currentCash * 100).toFixed(8))),
                },
              }))
            }
          />
          Fixed at
        </label>
        <input
          aria-label="Fixed CASH weight %"
          inputMode="decimal"
          disabled={draft.cash.mode !== "fixed"}
          value={draft.cash.mode === "fixed" ? draft.cash.weight : ""}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              cash: { mode: "fixed", weight: e.target.value },
            }))
          }
        />
        <span className="hint">
          %. The remaining risky budget (1 − CASH) is allocated across eligible
          assets.
        </span>
      </fieldset>

      <div className="submit-bar construction-submit">
        <div>
          {!consistency.ok && (
            <p className="warning" role="status">
              {consistency.reason}
            </p>
          )}
          {parsed.ok ? (
            <p className="muted">
              Inputs valid: the risky budget and every bound are feasible.
            </p>
          ) : (
            parsed.errors.map((e) => (
              <p className="warning" role="status" key={e}>
                {e}
              </p>
            ))
          )}
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary cta"
            disabled={!parsed.ok || !consistency.ok || pending}
            aria-busy={pending}
            onClick={() => void generate()}
          >
            <svg
              className="cta-icon"
              viewBox="0 0 16 12"
              aria-hidden
              focusable="false"
            >
              <rect x="0" y="0" width="9" height="3" rx="1" />
              <rect x="0" y="4.5" width="14" height="3" rx="1" />
              <rect x="0" y="9" width="6" height="3" rx="1" />
            </svg>
            Generate allocation
          </button>
        </div>
      </div>
      {pending && (
        <LoadingState
          label="Constructing allocations…"
          detail="Estimating the shrinkage covariance, solving all four methods and running the historical and stress comparisons. The analysis above is unaffected."
          rows={2}
        />
      )}
      {error && (
        <StatusNotice
          tone={errorState(error.code).tone}
          title={`Construction failed · ${error.ticker ? `${error.ticker} · ` : ""}${errorState(error.code).title}`}
          actions={
            <>
              <button
                type="button"
                className="secondary"
                disabled={!parsed.ok || !consistency.ok}
                onClick={() => void generate()}
              >
                Retry
              </button>
              <button
                type="button"
                className="text-action"
                onClick={() =>
                  document
                    .querySelector<HTMLInputElement>(".constraint-table input")
                    ?.focus()
                }
              >
                Adjust constraints ↑
              </button>
            </>
          }
        >
          <p>
            {error.message} Your current portfolio and the analysis above are
            unchanged.
          </p>
        </StatusNotice>
      )}
      {stale && (
        <StatusNotice tone="warning" title="Stale Proposal">
          Inputs changed since this proposal was generated. It is shown for
          reference only and cannot be applied; generate again.
        </StatusNotice>
      )}
      {result && selected && (
        <>
          <ProposalView
            proposal={selected}
            analytics={result}
            stale={stale}
            onApply={apply}
            applyMessage={applyMessage}
            diagnostics={
              <>
                <div className="table-wrap">
                  <table className="methods-table">
                    <caption>
                      All methods on the same inputs · Construction Model Risk
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Method</th>
                        <th scope="col">Status</th>
                        <th scope="col">Model volatility</th>
                        <th scope="col">Turnover</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.proposals.map((p) => (
                        <tr
                          key={p.method}
                          className={
                            p.method === method ? "selected-row" : undefined
                          }
                        >
                          <td>
                            {METHODS.find((m) => m.value === p.method)!.label}
                          </td>
                          <td>
                            <StateBadge state={constructionStatus(p.status)} />
                          </td>
                          <td>
                            {p.modelRisk.available
                              ? unsignedPercent(p.modelRisk.volatility)
                              : "N/A"}
                          </td>
                          <td>
                            {p.turnover === null
                              ? "N/A"
                              : unsignedPercent(p.turnover)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="methodology construction-diagnostics">
                  <summary>
                    Solver &amp; covariance diagnostics (detailed){" "}
                    <span aria-hidden>+</span>
                  </summary>
                  <div className="table-wrap">
                    <table>
                      <caption>{selected.label} · solver diagnostics</caption>
                      <tbody>
                        <tr>
                          <td>Status</td>
                          <td>
                            {constructionStatus(selected.status).label} ·{" "}
                            {words(selected.status)}
                          </td>
                        </tr>
                        <tr>
                          <td>Termination</td>
                          <td>
                            {words(selected.diagnostics.termination)} ·{" "}
                            {selected.diagnostics.iterations.toLocaleString()}{" "}
                            iterations
                          </td>
                        </tr>
                        <tr>
                          <td>Objective</td>
                          <td>
                            {selected.diagnostics.objective.name || "—"} ={" "}
                            {sci(selected.diagnostics.objective.value)}
                          </td>
                        </tr>
                        <tr>
                          <td>Budget / bound residual</td>
                          <td>
                            {sci(selected.diagnostics.residuals.budget)} /{" "}
                            {sci(selected.diagnostics.residuals.bound)}
                          </td>
                        </tr>
                        <tr>
                          <td>
                            Stationarity (projected gradient) / KKT residual
                          </td>
                          <td>
                            {sci(selected.diagnostics.residuals.stationarity)} /{" "}
                            {sci(selected.diagnostics.residuals.kkt)}
                          </td>
                        </tr>
                        <tr>
                          <td>ERC parity residual max|PCR − 1/N|</td>
                          <td>{sci(selected.diagnostics.residuals.parity)}</td>
                        </tr>
                        <tr>
                          <td>Binding constraints</td>
                          <td>
                            {bindingSummary(
                              selected.diagnostics.binding,
                              result.inputs.constraints,
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td>Tie rule</td>
                          <td>
                            {selected.diagnostics.tieRule ?? "Not applicable"}
                          </td>
                        </tr>
                        {selected.diagnostics.notes.map((n) => (
                          <tr key={n}>
                            <td>Note</td>
                            <td>{n}</td>
                          </tr>
                        ))}
                        {selected.diagnostics.starts.map((s) => (
                          <tr key={s.name}>
                            <td>
                              Start · {words(s.name)}
                              {s.selected ? " (selected)" : ""}
                            </td>
                            <td>
                              {s.used
                                ? `${words(s.termination)} · ${s.iterations} it · objective ${sci(s.objective)} · parity ${sci(s.parity)} · second order ${s.secondOrder ? words(s.secondOrder) : "—"}${s.curvature === null ? "" : ` (min curvature ${sci(s.curvature)})`}${s.escapes ? ` · ${s.escapes} saddle escape${s.escapes === 1 ? "" : "s"}` : ""}`
                                : `skipped · ${s.reason}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {cov?.available ? (
                    <p>
                      Σ_construction = 252 × [(1 − δ)S + δμI], Ledoit–Wolf
                      (2004) linear shrinkage toward a scaled identity: δ ={" "}
                      {fixed(cov.shrinkage, 6)}, μ (annualized) ={" "}
                      {fixed(cov.mu, 6)}; {cov.sampleConvention}. Conditioning
                      before → after: λmin{" "}
                      {sci(cov.conditioning.sample.minEigenvalue)} →{" "}
                      {sci(cov.conditioning.construction.minEigenvalue)},
                      condition number{" "}
                      {cov.conditioning.sample.conditionNumber === null
                        ? "singular"
                        : fixed(
                            cov.conditioning.sample.conditionNumber,
                            1,
                          )}{" "}
                      →{" "}
                      {cov.conditioning.construction.conditionNumber === null
                        ? "singular"
                        : fixed(
                            cov.conditioning.construction.conditionNumber,
                            1,
                          )}
                      . Covariance hash {cov.hash.slice(0, 16)}…
                    </p>
                  ) : (
                    <p>Ledoit–Wolf covariance unavailable: {cov?.reason}</p>
                  )}
                  {result.zeroVolatility.length > 0 && (
                    <p className="warning">
                      Zero or undefined volatility:{" "}
                      {result.zeroVolatility.join(", ")}.
                    </p>
                  )}
                  <ul>
                    {result.metadata.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="hash">
                    Construction snapshot SHA-256:{" "}
                    {result.metadata.snapshotHash} · generated{" "}
                    {timestamp(result.metadata.generatedAt)} ·{" "}
                    {Object.entries(result.metadata.methodologyVersions)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ")}
                  </p>
                </details>
              </>
            }
          />
        </>
      )}
      <p className="hint construction-disclaimer">
        {CONSTRUCTION_DISCLAIMER} For educational and analytical purposes only.
      </p>
    </>
  );
}
