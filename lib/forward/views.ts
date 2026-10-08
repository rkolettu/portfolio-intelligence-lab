// V2 views and Black–Litterman inputs (Layer B). Absolute, single-security views
// over the certified forward risk model become the selector matrix P, the view
// returns Q and the confidence-scaled diagonal Ω. Pure and free of Node-only or
// server-only imports, so the same function runs wherever views change. No
// posterior is computed here.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ActiveView,
  BlackLittermanInputsOutcome,
  ForwardRiskModel,
  StreetViewInput,
  ViewClassification,
  ViewInput,
} from "@/lib/types/forward";
import { FORWARD_LABELS } from "./assumptions";
import { viewSchema } from "@/lib/validation/forward";
import { symbolSchema } from "@/lib/validation/symbols";

const TAU = FORWARD_METHODOLOGY.tau;
const HORIZON = FORWARD_METHODOLOGY.horizonMonths;

/** The fields of the risk model the view inputs depend on. */
export type ViewRiskModelInput = Pick<
  ForwardRiskModel,
  "tickers" | "covariance" | "hash"
>;

const canonicalTicker = (t: string) => {
  const parsed = symbolSchema.safeParse(t);
  return parsed.success && parsed.data === t && t !== "CASH";
};

/** A Street input qualifies only if it is available, for this ticker, a 12-month
 * price-target return from the MEDIAN target, finite and above −100%. */
function streetValue(
  ticker: string,
  street: StreetViewInput | undefined,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (!street)
    return {
      ok: false,
      reason:
        "Street View selected, but no qualified Street data has been supplied (no Street-data provider is qualified yet). The security keeps its CAPM prior; no other value is substituted.",
    };
  if (street.ticker !== ticker)
    return { ok: false, reason: `The Street input is for ${street.ticker}, not ${ticker}.` };
  if (!street.available)
    return {
      ok: false,
      reason: `Street data unavailable: ${street.reason} The security keeps its CAPM prior; no other value is substituted.`,
    };
  if (street.targetStatistic !== "median")
    return {
      ok: false,
      reason: "Only a median price target qualifies for a Street View; an average is never substituted.",
    };
  if (street.basis !== "price_return" || street.horizonMonths !== HORIZON)
    return {
      ok: false,
      reason: "A Street View must be a 12-month price-target return (dividends excluded).",
    };
  if (!Number.isFinite(street.priceTargetReturn) || street.priceTargetReturn <= -1)
    return {
      ok: false,
      reason: "The Street price-target return is not a valid return above −100%.",
    };
  return { ok: true, value: street.priceTargetReturn };
}

/** Classify one saved view for a security in the universe. Order of checks: no
 * view; an unreadable view; Street data availability; zero confidence; active. */
function classify(
  ticker: string,
  raw: unknown,
  street: StreetViewInput | undefined,
): ViewClassification {
  const base: ViewClassification = {
    ticker,
    requestedSource: "none",
    status: "NO_VIEW",
    source: null,
    basis: null,
    horizonMonths: null,
    confidence: null,
    viewReturn: null,
    label: null,
    reason: null,
  };
  if (raw === undefined) return base;
  const parsed = viewSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ...base,
      requestedSource:
        typeof raw === "object" && raw && "source" in raw && typeof raw.source === "string"
          ? ((["none", "manual", "street"] as const).find((s) => s === raw.source) ?? "none")
          : "none",
      status: "INVALID_VIEW",
      reason: `The saved view cannot be used: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  const view: ViewInput = parsed.data;
  if (view.source === "none") return base;
  const common = {
    ticker,
    requestedSource: view.source,
    source: view.source,
    horizonMonths: HORIZON,
    confidence: view.confidence,
  } as const;
  if (view.source === "street") {
    const s = streetValue(ticker, street);
    const meta = {
      ...common,
      basis: "price_return" as const,
      label: FORWARD_LABELS.streetReturn,
    };
    if (!s.ok)
      return {
        ...meta,
        status: "STREET_DATA_UNAVAILABLE",
        viewReturn: null,
        reason: s.reason,
      };
    return view.confidence === 0
      ? {
          ...meta,
          status: "ZERO_CONFIDENCE",
          viewReturn: s.value,
          reason: "Confidence is 0%: the view is kept but has no model effect.",
        }
      : { ...meta, status: "ACTIVE", viewReturn: s.value, reason: null };
  }
  const meta = {
    ...common,
    basis: "total_return" as const,
    label: FORWARD_LABELS.manualView,
    viewReturn: view.manualReturn,
  };
  return view.confidence === 0
    ? {
        ...meta,
        status: "ZERO_CONFIDENCE",
        reason: "Confidence is 0%: the view is kept but has no model effect.",
      }
    : { ...meta, status: "ACTIVE", reason: null };
}

/** P, Q and the confidence-scaled diagonal Ω for the views that apply to the
 * certified risk model. Rows and columns follow the risk model's canonical
 * ticker order, so the same economics give the same matrices however the views
 * were created. Zero active views give P = 0 × n, Q = [], Ω = 0 × 0. */
export function buildBlackLittermanInputs(input: {
  riskModel: ViewRiskModelInput;
  /** The saved view state (may hold views on securities outside the universe). */
  views: Readonly<Record<string, unknown>>;
  /** Provider-neutral Street views by ticker; absent when no provider is qualified. */
  street?: Readonly<Record<string, StreetViewInput>>;
}): BlackLittermanInputsOutcome {
  const { tickers, covariance: sigma, hash } = input.riskModel;
  const n = tickers.length;
  const failure = (
    code: "invalid_inputs" | "invalid_view_variance",
    reason: string,
    names: string[] = [],
  ): BlackLittermanInputsOutcome => ({ available: false, code, reason, tickers: names });

  if (
    !tickers.every(canonicalTicker) ||
    tickers.some((t, i) => i > 0 && tickers[i - 1] >= t)
  )
    return failure(
      "invalid_inputs",
      "The risk model's universe must be distinct canonical tickers in canonical order.",
    );
  if (
    sigma.length !== n ||
    sigma.some((row) => row.length !== n || row.some((x) => !Number.isFinite(x)))
  )
    return failure(
      "invalid_inputs",
      "The risk model's covariance must be a finite n × n matrix matching its universe.",
    );
  if (typeof input.views !== "object" || input.views === null || Array.isArray(input.views))
    return failure("invalid_inputs", "The view state must be an object keyed by ticker.");

  const universe = new Set(tickers);
  const securities = tickers.map((t) =>
    classify(t, Object.hasOwn(input.views, t) ? input.views[t] : undefined, input.street?.[t]),
  );
  const outside = Object.keys(input.views)
    .filter((t) => !universe.has(t))
    .sort();
  const invalid: ViewClassification[] = outside
    .filter((t) => !canonicalTicker(t))
    .map((t) => ({
      ticker: t,
      requestedSource: "none",
      status: "INVALID_VIEW",
      source: null,
      basis: null,
      horizonMonths: null,
      confidence: null,
      viewReturn: null,
      label: null,
      reason:
        t === "CASH"
          ? "CASH can never carry a view."
          : `${t} is not a canonical U.S. ticker, so its saved view cannot be used.`,
    }));
  // Saved views on securities outside the universe stay in the user's state; here
  // they are listed as not applicable and contribute nothing.
  const notApplicable: ViewClassification[] = outside
    .filter(canonicalTicker)
    .map((t) => ({ t, c: classify(t, input.views[t], input.street?.[t]) }))
    .filter(({ c }) => c.requestedSource !== "none")
    .map(({ t, c }) => ({
      ...c,
      ticker: t,
      status: "OUT_OF_UNIVERSE",
      reason: `${t} is not in the current forward universe, so this view is not applicable and contributes nothing.`,
    }));

  const activeViews: ActiveView[] = [];
  for (const [column, c] of securities.entries()) {
    if (c.status !== "ACTIVE") continue;
    // P_k τ Σ P_kᵀ with the selector row: exactly τ Σ_kk.
    const p = tickers.map((_, j) => (j === column ? 1 : 0));
    let quadratic = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) quadratic += p[i] * sigma[i][j] * p[j];
    const baseVariance = TAU * quadratic;
    if (!Number.isFinite(baseVariance) || !(baseVariance > 0))
      return failure(
        "invalid_view_variance",
        `The view on ${c.ticker} has a non-positive or non-finite base variance (τ Σ_kk = ${baseVariance}); the certified risk model should never allow this, so no value is substituted.`,
        [c.ticker],
      );
    const confidence = c.confidence!;
    activeViews.push({
      ...c,
      status: "ACTIVE",
      source: c.source!,
      basis: c.basis!,
      horizonMonths: HORIZON,
      confidence,
      viewReturn: c.viewReturn!,
      row: activeViews.length,
      column,
      baseVariance,
      // Exactly 0 at c = 1: (1 − 1) / 1.
      omega: (baseVariance * (1 - confidence)) / confidence,
    });
  }
  const m = activeViews.length;
  return {
    available: true,
    inputs: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: hash,
      tau: TAU,
      omegaConvention: FORWARD_METHODOLOGY.views.omega,
      universeTickers: [...tickers],
      securities,
      notApplicable,
      invalid,
      activeViews,
      inactiveViews: [
        ...securities.filter((c) => c.status !== "ACTIVE" && c.status !== "NO_VIEW"),
        ...notApplicable,
        ...invalid,
      ],
      P: activeViews.map((v) => tickers.map((_, j) => (j === v.column ? 1 : 0))),
      Q: activeViews.map((v) => v.viewReturn),
      Omega: activeViews.map((v, i) =>
        activeViews.map((_, j) => (i === j ? v.omega : 0)),
      ),
      dimensions: { views: m, securities: n },
    },
  };
}
