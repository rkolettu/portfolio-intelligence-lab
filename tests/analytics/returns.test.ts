import { expect, it } from "vitest";
import { arithmeticReturn, compoundWealth } from "@/lib/analytics/returns";
import { applyReturns, crossesMonth } from "@/lib/analytics/rebalance";
it("computes daily arithmetic adjusted returns and geometric wealth", () => {
  expect(arithmeticReturn(100, 110)).toBeCloseTo(0.1, 12);
  expect(arithmeticReturn(110, 99)).toBeCloseTo(-0.1, 12);
  expect(compoundWealth(10000, [0.1, -0.1])).toEqual([10000, 11000, 9900]);
});
it.each([
  [0, 10],
  [10, 0],
  [NaN, 10],
  [10, Infinity],
])("rejects invalid prices %j %j", (a, b) =>
  expect(() => arithmeticReturn(a, b)).toThrow(),
);
it("guards invalid wealth and returns", () => {
  expect(() => compoundWealth(0, [0.1])).toThrow();
  expect(() => compoundWealth(100, [-1])).toThrow();
  expect(() => compoundWealth(100, [NaN])).toThrow();
});
it("drifts weights and preserves the contribution identity", () => {
  const s = applyReturns([0.5, 0.5], [0.1, 0]);
  expect(s.portfolioReturn).toBeCloseTo(0.05, 12);
  expect(s.contributions).toEqual([0.05, 0]);
  expect(s.endWeights[0]).toBeCloseTo(55 / 105, 12);
  expect(s.endWeights[1]).toBeCloseTo(50 / 105, 12);
  expect(applyReturns(s.endWeights, [0, 0.1]).portfolioReturn).toBeCloseTo(
    5 / 105,
    12,
  );
});
it("rejects invalid portfolio dimensions or budgets", () => {
  expect(() => applyReturns([1], [0, 0.1])).toThrow();
  expect(() => applyReturns([0.4], [0])).toThrow();
  expect(() => applyReturns([1], [-1])).toThrow();
});
it("recognizes session month boundaries, including holiday month-end", () => {
  expect(crossesMonth("2024-03-28", "2024-04-01")).toBe(true);
  expect(crossesMonth("2024-03-27", "2024-03-28")).toBe(false);
});
