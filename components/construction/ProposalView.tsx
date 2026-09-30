"use client";
import type { ReactNode } from "react";
import type { Metric } from "@/lib/types/analytics";
import type {
  ConstructionAnalytics,
  ConstructionProposal,
  HistoricalSide,
  ModelRisk,
} from "@/lib/types/construction";
import {
  decimal,
  percent,
  percentagePoints,
  ratio,
  unsignedPercent,
} from "@/lib/utils/format";
import { bindingSummary } from "@/lib/analytics/construction/observations";
import { constructionStatus } from "@/lib/ui/quality";
import { StateBadge } from "@/components/ui/StateBadge";
import { StatusNotice, Unavailable } from "@/components/ui/StatusNotice";
import {
  focusHandlers,
  focusState,
  useHoldingFocus,
} from "@/components/ui/HoldingFocus";
import { ComparisonChart } from "./ComparisonChart";
import { AllocationCompare, WeightMove } from "./WeightMove";

const cell = (m: Metric | undefined, f: (v: number) => string) =>
  m && m.available ? f(m.value) : "N/A";
const risk = (
  m: ModelRisk,
  pick: (r: Extract<ModelRisk, { available: true }>) => number | null,
  f: (v: number) => string,
) => {
  if (!m.available) return "N/A";
  const v = pick(m);
  return v === null ? "N/A" : f(v);
};

function HistoricalTable({
  current,
  proposed,
  benchmark,
}: {
  current: HistoricalSide;
  proposed: HistoricalSide;
  benchmark: string;
}) {
  const rows: [
    string,
    (h: Extract<HistoricalSide, { available: true }>) => Metric,
    (v: number) => string,
  ][] = [
    ["Cumulative return", (h) => h.cumulativeReturn, percent],
    ["CAGR", (h) => h.cagr, percent],
    ["Annualized volatility", (h) => h.volatility, unsignedPercent],
    ["Sharpe ratio", (h) => h.sharpe, ratio],
    ["Sortino ratio", (h) => h.sortino, ratio],
    ["Maximum drawdown", (h) => h.maximumDrawdown, percent],
    [`Beta vs ${benchmark}`, (h) => h.beta, decimal],
    [`Tracking error vs ${benchmark}`, (h) => h.trackingError, unsignedPercent],
    [`Information ratio vs ${benchmark}`, (h) => h.informationRatio, ratio],
  ];
  const value = (
    h: HistoricalSide,
    pick: (typeof rows)[number][1],
    f: (v: number) => string,
  ) => (h.available ? cell(pick(h), f) : "N/A");
  return (
    <div className="table-wrap">
      <table className="comparison-table construction-compare">
        <caption>
          Historical comparison · realized backtest, same definitions as the
          analysis
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col" className="th-current">
              Current Portfolio
            </th>
            <th scope="col" className="th-proposed">
              Proposed Portfolio
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, pick, f]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{value(current, pick, f)}</td>
              <td>{value(proposed, pick, f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One method's proposal: allocation, turnover, Apply, Construction Model Risk,
 * in-sample historical and stress comparison. Every number is precomputed. */
export function ProposalView({
  proposal: p,
  analytics,
  stale,
  onApply,
  applyMessage,
  diagnostics,
}: {
  proposal: ConstructionProposal;
  analytics: ConstructionAnalytics;
  stale: boolean;
  onApply: () => void;
  applyMessage: { ok: boolean; text: string } | null;
  /** Step 5: all-methods table and the collapsed solver diagnostics. */
  diagnostics?: ReactNode;
}) {
  const current = new Map(
    analytics.inputs.current.map((w) => [w.ticker, w.weight]),
  );
  const b = p.diagnostics.binding;
  const minOf = (t: string) =>
    analytics.inputs.constraints.find((c) => c.ticker === t)?.minWeight ?? 0;
  const tag = (t: string) =>
    b.fixed.includes(t)
      ? "fixed"
      : b.lower.includes(t)
        ? minOf(t) === 0
          ? "at 0% floor"
          : "at minimum"
        : b.upper.includes(t)
          ? "at maximum"
          : null;
  const holdingFocus = useHoldingFocus();
  const { focus } = holdingFocus;
  const usable = !!p.weights;
  const benchmark = analytics.config.benchmark;
  const cur = analytics.current;
  const weightRows =
    p.weights?.map((w) => ({
      ticker: w.ticker,
      current: current.get(w.ticker) ?? 0,
      proposed: w.weight,
    })) ?? [];
  const scaleMax = Math.max(
    0.05,
    ...weightRows.flatMap((r) => [r.current, r.proposed]),
  );
  const changed = weightRows.filter(
    (r) => Math.abs(r.proposed - r.current) >= 0.0005,
  ).length;
  // Display-only deltas between two values the engine already produced.
  const volNow = cur.modelRisk.available ? cur.modelRisk.volatility : null;
  const volNext = p.modelRisk.available ? p.modelRisk.volatility : null;
  return (
    <div className="proposal">
      <p className="eyebrow">4 · Proposed Allocation</p>
      <div className="proposal-head">
        <h3>{p.label}</h3>
        <StateBadge state={constructionStatus(p.status)} />
        {(b.lower.length > 0 || b.upper.length > 0) && (
          <StateBadge state={{ label: "Bounds binding", tone: "info" }} />
        )}
        {stale && <StateBadge state={{ label: "Stale", tone: "warning" }} />}
      </div>
      {p.reason &&
        (usable ? (
          <p className="hint">{p.reason}</p>
        ) : (
          <StatusNotice
            tone="warning"
            title={constructionStatus(p.status).label}
          >
            {p.reason} Your current portfolio is unchanged; adjust the
            constraints and generate again.
          </StatusNotice>
        ))}
      {p.observations.length > 0 && (
        <ul className="observations" aria-label="What shaped this allocation">
          {p.observations.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
      {!usable && diagnostics}
      {usable && (
        <>
          <AllocationCompare
            key={p.method}
            rows={weightRows}
            format={unsignedPercent}
          />
          <p className="hint proposal-moves">
            {changed === 0
              ? "No holding moves: the proposed allocation matches the current one."
              : `${changed} of ${weightRows.length} holdings move; the rest stay put.`}
          </p>
          <div className="table-wrap">
            <table className="proposal-table">
              <caption>
                Proposed Allocation · {p.label} · mathematical allocation under
                selected constraints and methodology
              </caption>
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="th-current">
                    Current Portfolio
                  </th>
                  <th scope="col" className="th-proposed">
                    Proposed Portfolio
                  </th>
                  <th scope="col">Difference</th>
                  <th scope="col">Constraint</th>
                </tr>
              </thead>
              <tbody>
                {p.weights!.map((w) => {
                  const c = current.get(w.ticker) ?? 0;
                  const diff = w.weight - c;
                  const moved = Math.abs(diff) >= 0.0005;
                  return (
                    <tr
                      key={w.ticker}
                      data-moved={moved ? (diff > 0 ? "up" : "down") : "none"}
                      data-focus={focusState(focus, w.ticker)}
                      {...focusHandlers(holdingFocus, [w.ticker])}
                    >
                      <td>
                        {w.ticker}
                        {w.ticker === "CASH" && (
                          <span className="cr-tag">fixed CASH</span>
                        )}
                      </td>
                      <td>{unsignedPercent(c)}</td>
                      <td className="cell-stack">
                        <strong>{unsignedPercent(w.weight)}</strong>
                        <WeightMove
                          key={p.method}
                          current={c}
                          proposed={w.weight}
                          max={scaleMax}
                        />
                      </td>
                      <td className="delta-cell">{percentagePoints(diff)}</td>
                      <td>
                        {w.ticker === "CASH" ? "—" : (tag(w.ticker) ?? "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="summary-grid construction-kpis">
            <div>
              <span>Estimated One-Way Turnover</span>
              <strong>
                {p.turnover === null ? "N/A" : unsignedPercent(p.turnover)}
              </strong>
            </div>
            <div>
              <span>Model volatility · current → proposed</span>
              <strong>
                {risk(cur.modelRisk, (r) => r.volatility, unsignedPercent)} →{" "}
                {risk(p.modelRisk, (r) => r.volatility, unsignedPercent)}
              </strong>
              {volNow !== null && volNext !== null && (
                <em
                  className="kpi-delta"
                  data-dir={volNext < volNow ? "down" : volNext > volNow ? "up" : "flat"}
                >
                  {percentagePoints(volNext - volNow)}
                </em>
              )}
            </div>
            <div>
              <span>Diversification ratio · current → proposed</span>
              <strong>
                {risk(
                  cur.modelRisk,
                  (r) => r.diversificationRatio,
                  (v) => `${decimal(v)}×`,
                )}{" "}
                →{" "}
                {risk(
                  p.modelRisk,
                  (r) => r.diversificationRatio,
                  (v) => `${decimal(v)}×`,
                )}
              </strong>
            </div>
            <div>
              <span>Binding constraints</span>
              <strong>{bindingSummary(b, analytics.inputs.constraints)}</strong>
            </div>
          </div>
          <p className="hint">
            One-way turnover = ½ Σ |proposed − current| over every holding, CASH
            included: a distance between target allocations, not traded
            notional. No transaction costs are estimated.
          </p>
          <h3 className="group-title">5 · Diagnostics</h3>
          {diagnostics}
          <h3 className="group-title">
            6 · Construction Model Risk · Current vs Proposed on the same
            Ledoit–Wolf matrix
          </h3>
          {p.modelRisk.available && cur.modelRisk.available ? (
            <div className="table-wrap">
              <table className="risk-table">
                <caption className="sr-only">
                  Construction model risk contributions, current versus proposed
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Model volatility</th>
                    <th scope="col">Current PCR</th>
                    <th scope="col">Proposed PCR</th>
                    <th scope="col">Proposed CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {p.modelRisk.holdings.map((h, i) => {
                    const c = (
                      cur.modelRisk as Extract<ModelRisk, { available: true }>
                    ).holdings[i];
                    return (
                      <tr key={h.ticker}>
                        <td>{h.ticker}</td>
                        <td>
                          {h.standaloneVolatility === null
                            ? "N/A"
                            : unsignedPercent(h.standaloneVolatility)}
                        </td>
                        <td className="cell-stack">
                          <span>
                            {c.percentage === null
                              ? "N/A"
                              : unsignedPercent(c.percentage)}
                          </span>
                          <i
                            className="cellbar cellbar-current"
                            aria-hidden
                            style={{
                              width: `${Math.min(100, Math.abs(c.percentage ?? 0) * 100)}%`,
                            }}
                          />
                        </td>
                        <td className="cell-stack">
                          <strong>
                            {h.percentage === null
                              ? "N/A"
                              : unsignedPercent(h.percentage)}
                          </strong>
                          <i
                            className="cellbar cellbar-proposed"
                            aria-hidden
                            style={{
                              width: `${Math.min(100, Math.abs(h.percentage ?? 0) * 100)}%`,
                            }}
                          />
                        </td>
                        <td>
                          {h.component === null
                            ? "N/A"
                            : unsignedPercent(h.component)}
                        </td>
                      </tr>
                    );
                  })}
                  {p.modelRisk.cash.weight > 0 && (
                    <tr>
                      <td>
                        CASH<span className="cr-tag">outside Σ</span>
                      </td>
                      <td>0.00%</td>
                      <td>0.00%</td>
                      <td>
                        <strong>0.00%</strong>
                      </td>
                      <td>0.00%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <Unavailable kind="solver" title="Model risk not shown">
              Construction model risk unavailable:{" "}
              {!p.modelRisk.available
                ? p.modelRisk.reason
                : !cur.modelRisk.available
                  ? cur.modelRisk.reason
                  : ""}
            </Unavailable>
          )}
          <p className="hint">
            Model risk uses the shrinkage matrix the optimizer used, so both
            allocations are judged by one estimator. It differs from the
            Historical Risk Analysis above (sample covariance) and from realized
            volatility. Negative contributions are hedges and are never clamped.
          </p>
          <h3 className="group-title">
            7 · Historical comparison · same data and start, both re-initialized
            at target weights
          </h3>
          <StatusNotice
            tone="info"
            role="note"
            title="In-Sample Retrospective Analysis"
          >
            These weights were estimated from the same history they are compared
            on. This is not an out-of-sample backtest and does not validate any
            prediction.
          </StatusNotice>
          <HistoricalTable
            current={cur.historical}
            proposed={p.historical}
            benchmark={benchmark}
          />
          {cur.historical.available && p.historical.available ? (
            <ComparisonChart
              current={cur.historical.growth}
              proposed={p.historical.growth}
              label={p.label}
            />
          ) : (
            <Unavailable kind="history" title="Comparison not shown">
              Historical comparison unavailable:{" "}
              {!cur.historical.available
                ? cur.historical.reason
                : !p.historical.available
                  ? p.historical.reason
                  : ""}
            </Unavailable>
          )}
          <h3 className="group-title">
            Stress comparison · fixed windows · both portfolios&apos; holdings
          </h3>
          <div className="table-wrap">
            <table className="stress-table">
              <caption>
                Stress comparison · retrospective scenario application of
                weights estimated later
              </caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Current</th>
                  <th scope="col">Proposed</th>
                  <th scope="col">{benchmark}</th>
                  <th scope="col">Current max. drawdown</th>
                  <th scope="col">Proposed max. drawdown</th>
                </tr>
              </thead>
              <tbody>
                {p.stress.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    {e.status === "complete" ? (
                      <>
                        <td>{cell(e.current.return, percent)}</td>
                        <td>
                          <strong>{cell(e.proposed.return, percent)}</strong>
                        </td>
                        <td>{cell(e.benchmark, percent)}</td>
                        <td>{cell(e.current.maximumDrawdown, percent)}</td>
                        <td>{cell(e.proposed.maximumDrawdown, percent)}</td>
                      </>
                    ) : e.status === "incomplete_coverage" ? (
                      <td colSpan={5} className="warning">
                        Incomplete Historical Coverage · missing{" "}
                        {e.missing.join(", ")}; no partial comparison
                      </td>
                    ) : (
                      <td colSpan={5} className="muted">
                        Unavailable · {e.reason}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            The proposed weights were estimated after these events; applying
            them to earlier windows is a retrospective scenario, not a portfolio
            that could have been known at the time, and not a forecast.
          </p>
          <h3 className="group-title">8 · Apply</h3>
          <div className="actions apply-row">
            <button
              type="button"
              className="secondary"
              disabled={stale}
              onClick={onApply}
            >
              Apply proposed weights to the builder
            </button>
            <span className="hint">
              {stale
                ? "Disabled: regenerate first — this proposal no longer matches the inputs."
                : "Revalidates the full-precision weights, then replaces the builder's holdings. Re-run the analysis to evaluate them."}
            </span>
          </div>
          {applyMessage && (
            <p className={applyMessage.ok ? "notice" : "warning"} role="status">
              {applyMessage.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
