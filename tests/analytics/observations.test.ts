import { expect, it } from "vitest";
import {
  bindingSummary,
  proposalObservations,
} from "@/lib/analytics/construction/observations";

const bounds = ["SPY", "QQQ", "IWM", "BND", "GLD"].map((ticker) => ({
  ticker,
  minWeight: 0,
  maxWeight: ticker === "GLD" ? 0.1 : 1,
  required: false,
}));

it("explains concentration, zero floors, caps, hedges and high turnover without judging the result", () => {
  const notes = proposalObservations({
    method: "minimum_variance",
    weights: [
      { ticker: "SPY", weight: 0.06 },
      { ticker: "QQQ", weight: 0 },
      { ticker: "IWM", weight: 0 },
      { ticker: "BND", weight: 0.79 },
      { ticker: "GLD", weight: 0.1 },
      { ticker: "CASH", weight: 0.05 },
    ],
    budget: 0.95,
    binding: { lower: ["QQQ", "IWM"], upper: ["GLD"], fixed: [] },
    bounds,
    turnover: 0.68,
    negativeRisk: ["SPY"],
  });
  expect(notes).toEqual([
    "QQQ, IWM are held at the long-only 0% floor (binding).",
    "GLD is held at its maximum weight (binding cap).",
    "BND receives 83.16% of the risky budget.",
    "SPY has a negative risk contribution under Σ_construction (a hedge); it is shown, never clamped.",
    "High one-way turnover: 68.00% of the portfolio would change.",
    "Lower modeled variance does not imply better returns, smaller future drawdowns or suitability.",
  ]);
});

it("says nothing for an unremarkable allocation", () => {
  expect(
    proposalObservations({
      method: "equal_weight",
      weights: bounds.map((b) => ({ ticker: b.ticker, weight: 0.19 })),
      budget: 0.95,
      binding: { lower: [], upper: [], fixed: [] },
      bounds,
      turnover: 0.22,
      negativeRisk: [],
    }),
  ).toEqual([]);
});

it("summarizes binding constraints with 0% floors worded as floors", () => {
  expect(
    bindingSummary({ lower: ["QQQ", "GLD"], upper: ["BND"], fixed: ["IWM"] }, [
      { ticker: "QQQ", minWeight: 0, maxWeight: 1, required: false },
      { ticker: "GLD", minWeight: 0.05, maxWeight: 1, required: true },
    ]),
  ).toBe("QQQ 0% floor, GLD minimum, BND maximum, IWM fixed");
  expect(bindingSummary({ lower: [], upper: [], fixed: [] }, [])).toBe("None");
});
