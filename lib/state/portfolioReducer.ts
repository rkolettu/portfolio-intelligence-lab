import type { Period, PortfolioConfig } from "@/lib/types/portfolio";
import { parsePortfolio } from "@/lib/validation/portfolio";
import { yearsBefore } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export type Draft = {
  holdings: { ticker: string; weight: string }[];
  benchmark: string;
  requestedStartDate: string;
  endDate: string;
  period: Period;
  cashPolicy: "historical_proxy" | "zero_explicit";
};
export type DraftAction =
  | { type: "replace"; draft: Draft }
  | {
      type: "holding";
      index: number;
      field: "ticker" | "weight";
      value: string;
    }
  | { type: "add" }
  | { type: "remove"; index: number }
  | {
      type: "field";
      field: "benchmark" | "requestedStartDate" | "endDate" | "cashPolicy";
      value: string;
    }
  | { type: "period"; period: Period };
export function toDraft(config: PortfolioConfig): Draft {
  return {
    holdings: config.holdings.map((h) => ({
      ticker: h.ticker,
      weight: String(Number((h.weight * 100).toFixed(8))),
    })),
    benchmark: config.benchmark,
    requestedStartDate: config.requestedStartDate,
    endDate: config.endDate,
    period: "5Y",
    cashPolicy: config.cashPolicy,
  };
}
export function draftConfig(draft: Draft, today: string): PortfolioConfig {
  if (
    draft.holdings.some(
      (h) => h.weight.trim() === "" || !/^\d+(?:\.\d*)?$/.test(h.weight.trim()),
    )
  )
    fail(
      "INVALID_INPUT",
      "Enter a nonnegative numeric weight for every holding.",
    );
  return parsePortfolio(
    {
      holdings: draft.holdings.map((h) => ({
        ticker: h.ticker,
        weight: Number(h.weight) / 100,
      })),
      benchmark: draft.benchmark,
      requestedStartDate: draft.requestedStartDate,
      endDate: draft.endDate,
      rebalanceFrequency: "monthly",
      cashPolicy: draft.cashPolicy,
    },
    today,
  );
}
export function portfolioReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "replace":
      return action.draft;
    case "holding":
      return {
        ...draft,
        holdings: draft.holdings.map((h, i) =>
          i === action.index
            ? {
                ...h,
                [action.field]:
                  action.field === "ticker"
                    ? action.value.toUpperCase()
                    : action.value,
              }
            : h,
        ),
      };
    case "add":
      return draft.holdings.length >= 20
        ? draft
        : {
            ...draft,
            holdings: [...draft.holdings, { ticker: "", weight: "0" }],
          };
    case "remove":
      return {
        ...draft,
        holdings: draft.holdings.filter((_, i) => i !== action.index),
      };
    case "field":
      return {
        ...draft,
        [action.field]:
          action.field === "benchmark"
            ? action.value.toUpperCase()
            : action.value,
        ...(["requestedStartDate", "endDate"].includes(action.field)
          ? { period: "Custom" as const }
          : {}),
      };
    case "period":
      return {
        ...draft,
        period: action.period,
        ...(action.period === "Custom"
          ? {}
          : {
              requestedStartDate: yearsBefore(
                draft.endDate,
                action.period === "MAX"
                  ? 50
                  : Number(action.period.replace("Y", "")),
              ),
            }),
      };
  }
}
