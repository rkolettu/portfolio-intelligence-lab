import { expect, it } from "vitest";
import {
  constructionStatus,
  errorState,
  quoteBadge,
  sampleState,
} from "@/lib/ui/quality";
import { referenceMaturity } from "@/lib/treasury-data/reference";
import type { CurrentQuote } from "@/lib/types/data";

it("names every error code with one product vocabulary", () => {
  expect(errorState("TICKER_NOT_FOUND").title).toBe("Ticker Not Found");
  expect(errorState("TIMEOUT").title).toBe("Provider Error");
  expect(errorState("TIMEOUT").detail).toBe("Request timed out");
  expect(errorState("RATE_LIMIT").title).toBe("Provider Error");
  expect(errorState("INSUFFICIENT_HISTORY").title).toBe("Insufficient History");
  expect(errorState("COVERAGE_GAP").title).toBe(
    "Incomplete Historical Coverage",
  );
  expect(errorState("TREASURY_UNAVAILABLE").title).toBe(
    "Treasury Data Unavailable",
  );
  expect(errorState("UNQUALIFIED_PROVIDER").tone).toBe("error");
  expect(errorState("INVALID_INPUT").tone).toBe("warning");
});

it("maps sample status to Complete Data, Limited History or Insufficient History", () => {
  expect(sampleState("normal")).toEqual({
    label: "Complete Data",
    tone: "ok",
  });
  expect(sampleState("limited").label).toBe("Limited History");
  expect(sampleState("insufficient").label).toBe("Insufficient History");
});

it("labels solver outcomes without claiming more than was certified", () => {
  expect(constructionStatus("success").label).toBe("Certified");
  expect(constructionStatus("non_converged").label).toBe(
    "Optimizer Non-Convergence",
  );
  expect(constructionStatus("numerical_failure").label).toBe(
    "Numerical Limitation",
  );
  expect(constructionStatus("converged_but_parity_not_achieved").label).toBe(
    "Approximate ERC",
  );
  expect(constructionStatus("infeasible").tone).toBe("error");
});

const quote = (over: Partial<CurrentQuote>): CurrentQuote => ({
  ticker: "SPY",
  price: 500,
  marketTimestamp: "2026-09-28T20:00:00Z",
  marketDate: "2026-09-28",
  fetchedAt: "2026-09-28T20:05:00Z",
  status: "latest_available",
  provider: "test",
  session: "regular",
  observationAgeSeconds: 300,
  provenance: {
    provider: "test",
    fetchedAt: "2026-09-28T20:05:00Z",
    lastSuccessfulRefresh: "2026-09-28T20:05:00Z",
    cacheAgeSeconds: 0,
    observationDate: "2026-09-28",
    fallbackUsed: false,
    warnings: [],
  },
  ...over,
});

it("never shows a stale quote as Live and states delay only when known", () => {
  expect(quoteBadge(quote({ status: "live" })).label).toBe("Live");
  expect(quoteBadge(quote({ status: "live", stale: true })).label).toBe(
    "Stale Current Data",
  );
  expect(
    quoteBadge(quote({ status: "delayed", delaySeconds: 900 })).label,
  ).toBe("15m Delayed");
  expect(quoteBadge(quote({ status: "delayed" })).label).toBe("Delayed");
  expect(quoteBadge(quote({ status: "end_of_day" })).label).toBe("End of Day");
  expect(quoteBadge(quote({})).label).toBe("Latest Available");
});

it("maps the analysis horizon to the nearest supported Treasury maturity", () => {
  expect(referenceMaturity("2025-09-28", "2026-09-28")).toBe("1Y");
  expect(referenceMaturity("2023-09-28", "2026-09-28")).toBe("3Y");
  expect(referenceMaturity("2021-09-28", "2026-09-28")).toBe("5Y");
  expect(referenceMaturity("2016-09-28", "2026-09-28")).toBe("10Y");
  // MAX and anything longer than ten years map to 10Y.
  expect(referenceMaturity("1980-01-02", "2026-09-28")).toBe("10Y");
  // Custom ranges pick the nearest; a tie goes to the longer maturity.
  expect(referenceMaturity("2026-06-28", "2026-09-28")).toBe("3M");
  expect(referenceMaturity("2024-09-28", "2026-09-28")).toBe("3Y");
  expect(referenceMaturity("2019-09-28", "2026-09-28")).toBe("5Y");
  expect(referenceMaturity("2018-03-28", "2026-09-28")).toBe("10Y");
});
