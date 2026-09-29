// Allocation-sandbox state. A proposal lives beside the builder draft and never
// mutates it; Apply revalidates the full-precision weights before producing a new
// builder draft. Pure functions, so every rule is testable without React.
import type {
  ConstructionAnalytics,
  ConstructionMethod,
  ConstructionRequest,
  OptimizationConstraint,
} from "@/lib/types/construction";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import { checkFeasibility } from "@/lib/analytics/optimization";
import { draftConfig, type Draft } from "./portfolioReducer";

const TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;

export type ConstraintDraft = {
  ticker: string;
  /** Percent strings as typed. */
  min: string;
  max: string;
  required: boolean;
};
export type ConstructorDraft = {
  constraints: ConstraintDraft[];
  cash: { mode: "current" } | { mode: "fixed"; weight: string };
};
export type Proposal = { key: string; result: ConstructionAnalytics };

const PERCENT = /^\d+(?:\.\d*)?$/;
const percent = (s: string) => (PERCENT.test(s.trim()) ? Number(s) / 100 : NaN);

/** Default inputs: every eligible risky asset (zero weights included), 0–100%,
 * optional, CASH fixed at its current weight. */
export function defaultConstructorDraft(
  config: PortfolioConfig,
): ConstructorDraft {
  return {
    constraints: config.holdings
      .filter((h) => h.ticker !== "CASH")
      .map((h) => ({
        ticker: h.ticker,
        min: "0",
        max: "100",
        required: false,
      })),
    cash: { mode: "current" },
  };
}

/** Parse the editor into a request and apply the same feasibility check the server
 * runs, so the user sees infeasible bounds before any request is made. */
export function constructorRequest(
  draft: ConstructorDraft,
  config: PortfolioConfig,
):
  { ok: true; request: ConstructionRequest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const constraints: OptimizationConstraint[] = draft.constraints.map((c) => {
    const minWeight = percent(c.min);
    const maxWeight = percent(c.max);
    if (!Number.isFinite(minWeight) || !Number.isFinite(maxWeight))
      errors.push(
        `${c.ticker}: enter numeric minimum and maximum percentages.`,
      );
    return { ticker: c.ticker, minWeight, maxWeight, required: c.required };
  });
  const currentCash =
    config.holdings.find((h) => h.ticker === "CASH")?.weight ?? 0;
  const cashWeight =
    draft.cash.mode === "current" ? currentCash : percent(draft.cash.weight);
  if (!Number.isFinite(cashWeight))
    errors.push("Enter a numeric fixed CASH weight.");
  if (errors.length) return { ok: false, errors };
  const feasibility = checkFeasibility({
    tickers: constraints.map((c) => c.ticker),
    lower: constraints.map((c) => c.minWeight),
    upper: constraints.map((c) => c.maxWeight),
    required: constraints.map((c) => c.required),
    cash: cashWeight,
  });
  if (!feasibility.ok) return { ok: false, errors: [feasibility.reason] };
  return {
    ok: true,
    request: {
      config,
      constraints,
      cash:
        draft.cash.mode === "current"
          ? { mode: "current" }
          : { mode: "fixed", weight: cashWeight },
    },
  };
}

/** Canonical form of a configuration for identity comparison. */
function canonical(config: PortfolioConfig): string {
  return JSON.stringify({
    holdings: config.holdings.map((h) => [h.ticker, h.weight]),
    benchmark: config.benchmark,
    requestedStartDate: config.requestedStartDate,
    endDate: config.endDate,
    rebalanceFrequency: config.rebalanceFrequency,
    cashPolicy: config.cashPolicy,
  });
}

/** Construction is defined only while the builder still holds exactly the analyzed
 * configuration (holdings, weights, CASH, benchmark, dates, CASH policy). Any edit
 * means the analysis, and every proposal built on it, describes another portfolio. */
export function builderConsistency(
  builder: Draft,
  analyzed: PortfolioConfig,
  today: string,
): { ok: true; config: PortfolioConfig } | { ok: false; reason: string } {
  let config: PortfolioConfig;
  try {
    config = draftConfig(builder, today);
  } catch {
    return {
      ok: false,
      reason:
        "The builder has changed since this analysis and is not a valid portfolio. Re-run the analysis before constructing or applying.",
    };
  }
  return canonical(config) === canonical(analyzed)
    ? { ok: true, config }
    : {
        ok: false,
        reason:
          "The builder has changed since this analysis (holdings, weights, CASH, benchmark or dates). Re-run the analysis, then generate again.",
      };
}

/** Everything that defines a proposal: the analyzed snapshot and configuration, the
 * builder configuration at generation time, and the construction inputs. Any change
 * makes an existing proposal stale. */
export function inputsKey(
  request: ConstructionRequest,
  analysisHash: string,
  builder: PortfolioConfig,
): string {
  return JSON.stringify({
    analysisHash,
    analyzed: canonical(request.config),
    builder: canonical(builder),
    constraints: request.constraints,
    cash: request.cash,
  });
}

/** Plain decimal percent string (no exponent) carrying a double's full precision,
 * accepted by the builder's weight field. */
export function fullPrecisionPercent(weight: number): string {
  if (weight === 0) return "0";
  const pct = weight * 100;
  const digits = Math.min(
    100,
    Math.max(0, 16 - Math.floor(Math.log10(Math.abs(pct)))),
  );
  const s = pct.toFixed(digits);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Apply a proposal to a NEW builder draft. Refuses stale or unusable proposals and
 * revalidates the frozen constraints before and after the percent round trip. */
export function applyProposal(input: {
  proposal: Proposal;
  currentKey: string;
  method: ConstructionMethod;
  builder: Draft;
  today: string;
  /** Current editor bounds; the proposal must still satisfy them. */
  constraints?: readonly OptimizationConstraint[];
}): { ok: true; draft: Draft } | { ok: false; reason: string } {
  const { proposal, currentKey, method, builder, today } = input;
  if (proposal.key !== currentKey)
    return {
      ok: false,
      reason:
        "This proposal is stale: the construction inputs or the analysis changed. Generate it again before applying.",
    };
  // Enforced here, not only in the UI: the builder must still hold exactly the
  // analyzed configuration, so newer edits are never overwritten.
  const consistency = builderConsistency(
    builder,
    proposal.result.config,
    today,
  );
  if (!consistency.ok) return { ok: false, reason: consistency.reason };
  const outcome = proposal.result.proposals.find((p) => p.method === method);
  if (
    !outcome?.weights ||
    (outcome.status !== "success" &&
      outcome.status !== "converged_but_parity_not_achieved")
  )
    return { ok: false, reason: "This method produced no usable allocation." };
  const { inputs } = proposal.result;
  const bounds = new Map(inputs.constraints.map((c) => [c.ticker, c]));
  const current = new Map((input.constraints ?? []).map((c) => [c.ticker, c]));
  const expectCash =
    inputs.cashWeight > 0 || inputs.current.some((w) => w.ticker === "CASH");
  const check = (weights: { ticker: string; weight: number }[]) => {
    const tickers = weights.map((w) => w.ticker);
    if (new Set(tickers).size !== tickers.length)
      return "Each holding may appear only once.";
    for (const t of inputs.universe)
      if (!tickers.includes(t)) return `${t} is missing from the proposal.`;
    if (expectCash && !tickers.includes("CASH"))
      return "CASH is missing from the proposal.";
    const total = weights.reduce((s, w) => s + w.weight, 0);
    if (!weights.every((w) => Number.isFinite(w.weight) && w.weight >= 0))
      return "Weights must be finite and nonnegative.";
    if (Math.abs(total - 1) > TOL) return "Weights must sum to 100%.";
    for (const w of weights) {
      if (w.ticker === "CASH") {
        if (Math.abs(w.weight - inputs.cashWeight) > TOL)
          return "The CASH weight differs from the fixed CASH weight.";
        continue;
      }
      const b = bounds.get(w.ticker);
      if (!b) return `${w.ticker} is outside the eligible universe.`;
      if (w.weight < b.minWeight - TOL || w.weight > b.maxWeight + TOL)
        return `${w.ticker} violates its bounds.`;
      const c = current.get(w.ticker);
      if (c && (w.weight < c.minWeight - TOL || w.weight > c.maxWeight + TOL))
        return `${w.ticker} no longer satisfies the current bounds.`;
    }
    return null;
  };
  const before = check(outcome.weights);
  if (before) return { ok: false, reason: `Revalidation failed: ${before}` };
  const draft: Draft = {
    ...builder,
    holdings: outcome.weights.map((w) => ({
      ticker: w.ticker,
      weight: fullPrecisionPercent(w.weight),
    })),
  };
  let applied: PortfolioConfig;
  try {
    applied = draftConfig(draft, today);
  } catch (error) {
    return {
      ok: false,
      reason: `Revalidation failed: ${error instanceof Error ? error.message : "invalid allocation"}`,
    };
  }
  const after = check(applied.holdings);
  if (after)
    return {
      ok: false,
      reason: `Revalidation failed after conversion: ${after}`,
    };
  return { ok: true, draft };
}
