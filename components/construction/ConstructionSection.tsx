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
import { timestamp, unsignedPercent } from "@/lib/utils/format";
import { bindingSummary } from "@/lib/analytics/construction/observations";
import { ProposalView } from "./ProposalView";

const METHODS: { value: ConstructionMethod; label: string }[] = [
  { value: "equal_weight", label: "Equal Weight" },
  { value: "inverse_volatility", label: "Inverse Volatility" },
  { value: "minimum_variance", label: "Minimum Variance" },
  { value: "equal_risk_contribution", label: "Equal Risk Contribution" },
];
const DISCLAIMER =
  "For educational and analytical purposes only. Allocation outputs are mathematical results based on selected inputs, assumptions and constraints, not personalized recommendations.";
const sci = (v: number | null) => (v === null ? "—" : v.toExponential(2));

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
  const [draft, setDraft] = useState<ConstructorDraft>(() =>
    defaultConstructorDraft(config),
  );
  const [method, setMethod] = useState<ConstructionMethod>("minimum_variance");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DataError | null>(null);
  const [applyMessage, setApplyMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
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
              ? `Ledoit–Wolf · δ = ${cov.shrinkage.toFixed(4)}`
              : "Ledoit–Wolf shrinkage"}
          </strong>
        </div>
        <div>
          <span>Evaluation</span>
          <strong>In-sample · retrospective</strong>
        </div>
      </div>
      {est && !est.available && (
        <p className="warning" role="status">
          Construction risk model unavailable: {est.reason}
        </p>
      )}
      {est?.available &&
        est.notes.map((n) => (
          <p className="hint" key={n}>
            {n}
          </p>
        ))}

      <h3 className="group-title">A · Method</h3>
      <div className="series-control">
        <fieldset className="segmented">
          <legend className="sr-only">Construction method</legend>
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={method === m.value ? "selected" : undefined}
            >
              <input
                type="radio"
                name="construction-method"
                value={m.value}
                checked={method === m.value}
                onChange={() => setMethod(m.value)}
              />
              {m.label}
            </label>
          ))}
        </fieldset>
        <span className="hint">
          One generation solves all four on the same frozen inputs; this chooses
          the view.
        </span>
      </div>

      <h3 className="group-title">
        B · Constraints · fractions of the whole portfolio, long only
      </h3>
      <div className="table-wrap">
        <table className="constraint-table">
          <caption className="sr-only">
            Per-asset construction constraints
          </caption>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Current</th>
              <th>Minimum %</th>
              <th>Maximum %</th>
              <th>Required</th>
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
        A positive minimum applies unconditionally (never “0% or at least the
        minimum”); a required asset needs one. Zero-weight holdings in the
        builder are eligible candidates. Add a candidate as a 0% holding and
        re-run the analysis to include it.
      </p>

      <h3 className="group-title">
        C · CASH · outside the risky covariance, never optimized
      </h3>
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
          %. Risky budget B = 1 − CASH is allocated across eligible assets.
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
              Inputs valid. The risky budget and every bound pass the
              feasibility check.
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
            className="primary"
            disabled={!parsed.ok || !consistency.ok || pending}
            aria-busy={pending}
            onClick={() => void generate()}
          >
            Generate allocation
          </button>
        </div>
      </div>
      {pending && (
        <div className="loading" role="status">
          <span className="loading-line" />
          <p>
            Estimating Σ_construction, solving four methods and running both
            comparisons…
          </p>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <strong>
            {error.ticker ? `${error.ticker} · ` : ""}
            {error.code.replaceAll("_", " ")}
          </strong>
          <p>{error.message}</p>
        </div>
      )}
      {stale && (
        <p className="warning" role="status">
          Inputs changed since this proposal was generated. It is shown for
          reference only and cannot be applied; generate again.
        </p>
      )}
      {result && selected && (
        <>
          <ProposalView
            proposal={selected}
            analytics={result}
            stale={stale}
            onApply={apply}
            applyMessage={applyMessage}
          />
          <div className="table-wrap">
            <table className="methods-table">
              <caption>
                All methods on the same inputs · model risk on Σ_construction
              </caption>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Result</th>
                  <th>Model volatility</th>
                  <th>Turnover</th>
                </tr>
              </thead>
              <tbody>
                {result.proposals.map((p) => (
                  <tr
                    key={p.method}
                    className={p.method === method ? "selected-row" : undefined}
                  >
                    <td>{METHODS.find((m) => m.value === p.method)!.label}</td>
                    <td>
                      {p.weights
                        ? p.label
                        : `Unavailable · ${p.status.replaceAll("_", " ")}`}
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
              Solver &amp; covariance diagnostics <span aria-hidden>+</span>
            </summary>
            <div className="table-wrap">
              <table>
                <caption>{selected.label} · solver diagnostics</caption>
                <tbody>
                  <tr>
                    <td>Status</td>
                    <td>{selected.status.replaceAll("_", " ")}</td>
                  </tr>
                  <tr>
                    <td>Termination</td>
                    <td>
                      {selected.diagnostics.termination.replaceAll("_", " ")} ·{" "}
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
                    <td>Stationarity (projected gradient) / KKT residual</td>
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
                    <td>{selected.diagnostics.tieRule ?? "Not applicable"}</td>
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
                        Start · {s.name.replaceAll("_", " ")}
                        {s.selected ? " (selected)" : ""}
                      </td>
                      <td>
                        {s.used
                          ? `${s.termination.replaceAll("_", " ")} · ${s.iterations} it · objective ${sci(s.objective)} · parity ${sci(s.parity)} · second order ${s.secondOrder?.replaceAll("_", " ") ?? "—"}${s.curvature === null ? "" : ` (min curvature ${sci(s.curvature)})`}${s.escapes ? ` · ${s.escapes} saddle escape${s.escapes === 1 ? "" : "s"}` : ""}`
                          : `skipped · ${s.reason}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cov?.available ? (
              <p>
                Σ_construction = 252 × [(1 − δ)S + δμI], Ledoit–Wolf (2004)
                linear shrinkage toward a scaled identity: δ ={" "}
                {cov.shrinkage.toFixed(6)}, μ (annualized) = {cov.mu.toFixed(6)}
                ; {cov.sampleConvention}. Conditioning before → after: λmin{" "}
                {sci(cov.conditioning.sample.minEigenvalue)} →{" "}
                {sci(cov.conditioning.construction.minEigenvalue)}, condition
                number{" "}
                {cov.conditioning.sample.conditionNumber === null
                  ? "singular"
                  : cov.conditioning.sample.conditionNumber.toFixed(1)}{" "}
                →{" "}
                {cov.conditioning.construction.conditionNumber === null
                  ? "singular"
                  : cov.conditioning.construction.conditionNumber.toFixed(1)}
                . Covariance hash {cov.hash.slice(0, 16)}…
              </p>
            ) : (
              <p>Ledoit–Wolf covariance unavailable: {cov?.reason}</p>
            )}
            {result.zeroVolatility.length > 0 && (
              <p className="warning">
                Zero or undefined volatility: {result.zeroVolatility.join(", ")}
                .
              </p>
            )}
            <ul>
              {result.metadata.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="hash">
              Construction snapshot SHA-256: {result.metadata.snapshotHash} ·
              generated {timestamp(result.metadata.generatedAt)} ·{" "}
              {Object.entries(result.metadata.methodologyVersions)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            </p>
          </details>
        </>
      )}
      <p className="hint construction-disclaimer">{DISCLAIMER}</p>
    </>
  );
}
