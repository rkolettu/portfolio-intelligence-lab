// One vocabulary for data-quality, error and freshness states across the product.
// Pure display mapping: it never changes a calculation or a status.
import type { ConstructionStatus } from "@/lib/types/construction";
import type { RiskSampleStatus } from "@/lib/types/analytics";
import type { CurrentQuote, ErrorCode } from "@/lib/types/data";

export type Tone = "ok" | "info" | "warning" | "error";
export type StateLabel = { label: string; tone: Tone };

const ERRORS: Record<
  ErrorCode,
  { title: string; detail?: string; tone: Tone }
> = {
  INVALID_INPUT: { title: "Invalid Input", tone: "warning" },
  TICKER_NOT_FOUND: { title: "Ticker Not Found", tone: "error" },
  PROVIDER_ERROR: { title: "Provider Error", tone: "error" },
  PERMISSION: {
    title: "Provider Error",
    detail: "Access denied by the provider",
    tone: "error",
  },
  RATE_LIMIT: {
    title: "Provider Error",
    detail: "Provider rate limit",
    tone: "error",
  },
  TIMEOUT: {
    title: "Provider Error",
    detail: "Request timed out",
    tone: "error",
  },
  MALFORMED_DATA: {
    title: "Provider Error",
    detail: "Malformed provider data",
    tone: "error",
  },
  COVERAGE_GAP: { title: "Incomplete Historical Coverage", tone: "warning" },
  INSUFFICIENT_HISTORY: { title: "Insufficient History", tone: "warning" },
  TREASURY_UNAVAILABLE: {
    title: "Treasury Data Unavailable",
    tone: "warning",
  },
  UNSUPPORTED_ASSET: { title: "Unsupported Asset", tone: "warning" },
  UNQUALIFIED_PROVIDER: {
    title: "Provider Not Qualified",
    detail: "No qualified market-data provider in this deployment",
    tone: "error",
  },
};

export const errorState = (code: ErrorCode) => ERRORS[code];

export const sampleState = (status: RiskSampleStatus): StateLabel =>
  status === "normal"
    ? { label: "Complete Data", tone: "ok" }
    : status === "limited"
      ? { label: "Limited History", tone: "warning" }
      : { label: "Insufficient History", tone: "warning" };

const CONSTRUCTION: Record<ConstructionStatus, StateLabel> = {
  success: { label: "Certified", tone: "ok" },
  converged_but_parity_not_achieved: {
    label: "Approximate ERC",
    tone: "warning",
  },
  infeasible: { label: "Infeasible Constraints", tone: "error" },
  invalid_inputs: { label: "Invalid Inputs", tone: "error" },
  insufficient_history: { label: "Insufficient History", tone: "warning" },
  invalid_covariance: { label: "Numerical Limitation", tone: "error" },
  numerical_failure: { label: "Numerical Limitation", tone: "error" },
  non_converged: { label: "Optimizer Non-Convergence", tone: "error" },
};
export const constructionStatus = (status: ConstructionStatus) =>
  CONSTRUCTION[status];

/** Freshness badge from the quote's re-derived status. A stale quote is never
 * shown as Live; a delay is stated only when the provider supplied one. */
export function quoteBadge(q: CurrentQuote): StateLabel {
  if (q.stale) return { label: "Stale Current Data", tone: "warning" };
  switch (q.status) {
    case "live":
      return { label: "Live", tone: "ok" };
    case "delayed":
      return {
        label:
          q.delaySeconds && q.delaySeconds >= 60
            ? `${Math.round(q.delaySeconds / 60)}m Delayed`
            : "Delayed",
        tone: "info",
      };
    case "end_of_day":
      return { label: "End of Day", tone: "info" };
    default:
      return { label: "Latest Available", tone: "info" };
  }
}
