import { describe, expect, it } from "vitest";
import {
  allocationResiduals,
  bindingConstraints,
  checkFeasibility,
  kktResidual,
  projectBudgetBox,
} from "@/lib/analytics/optimization";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";

const TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;
const feasibility = (
  lower: number[],
  upper: number[],
  cash: number,
  required: boolean[] = lower.map(() => false),
) =>
  checkFeasibility({
    tickers: lower.map((_, i) => `A${i}`),
    lower,
    upper,
    required,
    cash,
  });

describe("checkFeasibility", () => {
  it("rejects 20% CASH with two risky assets capped at 35% (capacity 70% < budget 80%)", () => {
    const r = feasibility([0, 0], [0.35, 0.35], 0.2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe("infeasible");
      expect(r.reason).toMatch(/70\.00%.*80\.00%/);
    }
  });

  it("rejects minimums that exceed the risky budget", () => {
    const r = feasibility([0.5, 0.4], [1, 1], 0.2);
    expect(r.ok ? "ok" : r.status).toBe("infeasible");
  });

  it("rejects invalid bounds, CASH and required holdings without a positive minimum", () => {
    for (const [lower, upper, cash, required] of [
      [[0.3], [0.2], 0, [false]],
      [[-0.1], [1], 0, [false]],
      [[0], [1.1], 0, [false]],
      [[NaN], [1], 0, [false]],
      [[0], [1], 1.2, [false]],
      [[0], [1], NaN, [false]],
      [[0], [1], 0, [true]],
    ] as [number[], number[], number, boolean[]][]) {
      const r = feasibility(lower, upper, cash, required);
      expect(r.ok ? "ok" : r.status).toBe("invalid_inputs");
    }
  });

  it("handles a zero risky budget and an empty universe", () => {
    expect(feasibility([0, 0], [1, 1], 1).ok).toBe(true);
    expect(feasibility([0.1, 0], [1, 1], 1).ok).toBe(false);
    expect(feasibility([], [], 1).ok).toBe(true);
    const empty = feasibility([], [], 0.4);
    expect(empty.ok ? "ok" : empty.status).toBe("infeasible");
  });

  it("accepts exactly tight bounds (singleton feasible set)", () => {
    expect(feasibility([0.4, 0.4], [0.4, 0.4], 0.2).ok).toBe(true);
    expect(feasibility([0.4, 0.4], [1, 1], 0.2).ok).toBe(true);
  });
});

describe("projectBudgetBox (exact Euclidean projection)", () => {
  it("returns a feasible reference unchanged", () => {
    expect(
      projectBudgetBox([0.3, 0.3, 0.2], [0, 0, 0], [1, 1, 1], 0.8),
    ).toEqual([0.3, 0.3, 0.2]);
  });

  it("differs from clip-and-renormalize: excess is removed equally from free assets", () => {
    const w = projectBudgetBox([0.6, 0.3, 0.1], [0, 0, 0], [0.4, 1, 1], 1);
    [0.4, 0.4, 0.2].forEach((x, i) => expect(w[i]).toBeCloseTo(x, 15));
    // Clip-then-proportional-renormalize would give [0.4, 0.45, 0.15].
    expect(w[1]).not.toBeCloseTo(0.45, 6);
  });

  it("binds a lower bound and keeps KKT form w = clip(r − τ)", () => {
    const w = projectBudgetBox([0.05, 0.45, 0.5], [0.1, 0, 0], [1, 1, 1], 1);
    [0.1, 0.425, 0.475].forEach((x, i) => expect(w[i]).toBeCloseTo(x, 15));
  });

  it("returns the singleton feasible point exactly and respects fixed positions", () => {
    expect(projectBudgetBox([0.9, 0.1], [0.4, 0.4], [1, 1], 0.8)).toEqual([
      0.4, 0.4,
    ]);
    expect(projectBudgetBox([0.1, 0.1], [0, 0], [0.3, 0.5], 0.8)).toEqual([
      0.3, 0.5,
    ]);
    const w = projectBudgetBox([0.5, 0.5, 0], [0.2, 0, 0], [0.2, 1, 1], 1);
    expect(w[0]).toBe(0.2);
    expect(
      allocationResiduals(w, [0.2, 0, 0], [0.2, 1, 1], 1).budget,
    ).toBeLessThan(TOL);
  });

  it("satisfies budget and bounds to full precision on a larger random-like case", () => {
    const r = Array.from(
      { length: 17 },
      (_, i) => Math.sin(i * 1.7) * 0.2 + 0.05,
    );
    const lower = r.map((_, i) => (i % 5 === 0 ? 0.02 : 0));
    const upper = r.map((_, i) => (i % 3 === 0 ? 0.08 : 0.25));
    const w = projectBudgetBox(r, lower, upper, 0.93);
    const res = allocationResiduals(w, lower, upper, 0.93);
    expect(res.finite).toBe(true);
    expect(res.budget).toBeLessThan(1e-15);
    expect(res.bound).toBe(0);
  });
});

describe("certification helpers", () => {
  it("measures budget and bound violations", () => {
    expect(allocationResiduals([0.5, 0.6], [0, 0], [1, 0.55], 1)).toEqual({
      budget: expect.closeTo(0.1, 15),
      bound: expect.closeTo(0.05, 15),
      finite: true,
    });
    expect(allocationResiduals([NaN, 1], [0, 0], [1, 1], 1).finite).toBe(false);
  });

  it("KKT residual is zero at a stationary point and positive elsewhere", () => {
    // f = w'Σw, Σ = diag(0.04, 0.01), B = 0.8 → optimum [0.16, 0.64], gradient 2Σw = [0.0128, 0.0128].
    expect(
      kktResidual([0.16, 0.64], [0.0128, 0.0128], [0, 0], [1, 1]).residual,
    ).toBeLessThan(1e-17);
    expect(
      kktResidual([0.4, 0.4], [0.032, 0.008], [0, 0], [1, 1]).residual,
    ).toBeGreaterThan(0.01);
    // At a binding upper bound the gradient may be lower than the multiplier.
    expect(
      kktResidual([0.1, 0.7], [0.008, 0.014], [0, 0], [0.1, 1]).residual,
    ).toBe(0);
  });

  it("names binding lower, upper and fixed positions", () => {
    expect(
      bindingConstraints(
        [0.1, 0.35, 0.2, 0.15],
        [0.1, 0, 0.2, 0],
        [1, 0.35, 0.2, 1],
      ),
    ).toEqual({ lower: [0], upper: [1], fixed: [2] });
  });

  it("reports an asset held at the long-only 0% floor as binding", () => {
    expect(bindingConstraints([0, 0.4, 0.6], [0, 0, 0], [1, 1, 1])).toEqual({
      lower: [0],
      upper: [],
      fixed: [],
    });
  });
});
