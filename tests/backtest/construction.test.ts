import { describe, expect, it } from "vitest";
import {
  runConstruction,
  type ConstructionInput,
} from "@/lib/backtest/construction";
import { sessionsBetween } from "@/lib/backtest/calendar";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import type { StressWindowDefinition } from "@/lib/types/analytics";
import type { ConstructionAnalytics } from "@/lib/types/construction";
import type { TreasurySeries } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { provenance, series } from "../fixtures/helpers";
import { LabError } from "@/lib/utils/errors";
import {
  MAX_TICKERS,
  maxConfig,
  maxConstructionInput,
} from "../fixtures/construction";

const FAR = "2100-01-01T00:00:00Z";
const NOW = "2024-06-03T12:00:00Z";
const T = CONSTRUCTION_METHODOLOGY.tolerances;
const calendar = sessionsBetween("2023-01-03", "2024-05-31", FAR);
const ds = calendar.map((s) => s.date);
const wave = (seed: number, drift: number, amp: number) =>
  ds.map((_, i) => 100 * Math.exp(amp * Math.sin(i * seed) + drift * i));
const LATE = 40; // CCC's first session
const window = (
  id: string,
  from: number,
  to: number,
): StressWindowDefinition => ({
  id,
  name: id,
  startDate: ds[from],
  endDate: ds[to],
  description: `${id} fixture window`,
  kind: "preset",
});
const treasury: TreasurySeries = {
  series: "DGS3MO",
  observations: sessionsBetween("2022-12-15", "2024-05-31", FAR).map((s) => ({
    date: s.date,
    annualYield: 0.04,
    availableAt: `${s.date}T23:59:00-05:00`,
    availability: "modeled",
  })),
  provenance,
};
function prices() {
  return [
    series("AAA", ds, wave(0.7, 0.0005, 0.02)),
    series("BBB", ds, wave(1.9, 0.0002, 0.01)),
    series(
      "CCC",
      ds.slice(LATE),
      wave(1.1, 0.0003, 0.015).slice(LATE),
      ds[LATE],
    ),
    series("BMK", ds, wave(0.4, 0.0004, 0.012)),
  ];
}
const baseConfig: PortfolioConfig = {
  holdings: [
    { ticker: "AAA", weight: 0.5 },
    { ticker: "BBB", weight: 0.3 },
    { ticker: "CCC", weight: 0 },
    { ticker: "CASH", weight: 0.2 },
  ],
  benchmark: "BMK",
  requestedStartDate: ds[0],
  endDate: ds.at(-1)!,
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
function input(overrides: Partial<ConstructionInput> = {}): ConstructionInput {
  const p = prices();
  return {
    config: baseConfig,
    constraints: [],
    cash: { mode: "current" },
    estimation: {
      prices: p,
      treasury,
      sessions: calendar,
      eligibleEndDate: ds.at(-1)!,
    },
    stress: {
      windows: [window("early", 10, 30), window("late", 200, 230)],
      prices: p,
      treasury,
      sessions: calendar,
      unavailable: [],
    },
    now: NOW,
    ...overrides,
  };
}
const proposal = (r: ConstructionAnalytics, method: string) =>
  r.proposals.find((p) => p.method === method)!;
const weightOf = (r: ConstructionAnalytics, method: string, ticker: string) =>
  proposal(r, method).weights!.find((w) => w.ticker === ticker)!.weight;

describe("runConstruction", () => {
  it("includes a zero-weight eligible asset in estimation, allocation and the effective start", () => {
    const r = runConstruction(input());
    expect(r.inputs.universe).toEqual(["AAA", "BBB", "CCC"]);
    expect(r.estimation.available).toBe(true);
    if (!r.estimation.available) return;
    expect(r.estimation.sample.startDate).toBe(ds[LATE]);
    expect(r.estimation.status).toBe("normal");
    expect(r.covariance.available).toBe(true);
    for (const m of [
      "equal_weight",
      "inverse_volatility",
      "minimum_variance",
      "equal_risk_contribution",
    ])
      expect(proposal(r, m).status).toBe("success");
    expect(weightOf(r, "equal_weight", "CCC")).toBeCloseTo(0.8 / 3, 15);
    expect(weightOf(r, "minimum_variance", "CCC")).toBeGreaterThan(0);
  });

  it("fixes CASH, keeps budgets and bounds, and records solver diagnostics", () => {
    const r = runConstruction(input());
    for (const p of r.proposals) {
      const cash = p.weights!.find((w) => w.ticker === "CASH")!.weight;
      expect(cash).toBe(0.2);
      const total = p.weights!.reduce((s, w) => s + w.weight, 0);
      expect(Math.abs(total - 1)).toBeLessThanOrEqual(T.weight);
      expect(p.weights!.every((w) => w.weight >= -T.weight)).toBe(true);
    }
    const mv = proposal(r, "minimum_variance").diagnostics;
    expect(proposal(r, "minimum_variance").observations).toContain(
      "Lower modeled variance does not imply better returns, smaller future drawdowns or suitability.",
    );
    expect(proposal(r, "equal_weight").observations).toEqual([]);
    expect(mv.residuals.kkt!).toBeLessThanOrEqual(T.stationarity);
    expect(mv.tieRule).toMatch(/positive definite/);
    expect(
      proposal(r, "equal_risk_contribution").diagnostics.starts.map(
        (s) => s.name,
      ),
    ).toEqual([
      "equal_weight",
      "inverse_volatility",
      "current",
      "log_barrier_risk_budget",
      "tilt_AAA",
      "tilt_BBB",
      "tilt_CCC",
    ]);
    if (r.covariance.available) {
      expect(r.covariance.shrinkage).toBeGreaterThan(0);
      expect(r.covariance.shrinkage).toBeLessThanOrEqual(1);
      expect(
        r.covariance.conditioning.construction.conditionNumber!,
      ).toBeLessThan(r.covariance.conditioning.sample.conditionNumber!);
    }
  });

  it("is deterministic and invariant to the order of holdings", () => {
    const a = runConstruction(input());
    expect(runConstruction(input())).toEqual(a);
    const b = runConstruction(
      input({
        config: { ...baseConfig, holdings: [...baseConfig.holdings].reverse() },
      }),
    );
    if (!a.covariance.available || !b.covariance.available)
      throw new Error("fixture");
    expect(b.covariance.hash).toBe(a.covariance.hash);
    for (const m of [
      "inverse_volatility",
      "minimum_variance",
      "equal_risk_contribution",
    ])
      for (const t of ["AAA", "BBB", "CCC"])
        expect(weightOf(b, m, t)).toBe(weightOf(a, m, t));
  });

  it("lists binding constraints in configuration order", () => {
    const r = runConstruction(
      input({
        config: { ...baseConfig, holdings: [...baseConfig.holdings].reverse() },
        constraints: [
          { ticker: "AAA", minWeight: 0.5, maxWeight: 0.5, required: true },
          { ticker: "BBB", minWeight: 0.3, maxWeight: 0.3, required: true },
          { ticker: "CCC", minWeight: 0, maxWeight: 0, required: false },
        ],
      }),
    );
    expect(proposal(r, "minimum_variance").diagnostics.binding.fixed).toEqual([
      "CCC",
      "BBB",
      "AAA",
    ]);
  });

  it("reports infeasible constraints for every method, never relaxing them", () => {
    const r = runConstruction(
      input({
        constraints: [
          { ticker: "AAA", minWeight: 0, maxWeight: 0.2, required: false },
          { ticker: "BBB", minWeight: 0, maxWeight: 0.2, required: false },
          { ticker: "CCC", minWeight: 0, maxWeight: 0.2, required: false },
        ],
      }),
    );
    for (const p of r.proposals) {
      expect(p.status).toBe("infeasible");
      expect(p.weights).toBeNull();
      expect(p.reason).toMatch(/60\.00%.*80\.00%/);
    }
  });

  it("rejects a zero-volatility risky asset for risk-based methods but keeps equal weight", () => {
    const i = input();
    i.estimation.prices = i.estimation.prices.map((s) =>
      s.ticker === "BBB"
        ? {
            ...s,
            observations: s.observations.map((o) => ({
              ...o,
              adjustedClose: 50,
            })),
          }
        : s,
    );
    const r = runConstruction(i);
    expect(r.zeroVolatility).toEqual(["BBB"]);
    expect(proposal(r, "equal_weight").status).toBe("success");
    for (const m of [
      "inverse_volatility",
      "minimum_variance",
      "equal_risk_contribution",
    ]) {
      expect(proposal(r, m).status).toBe("invalid_inputs");
      expect(proposal(r, m).reason).toMatch(/BBB/);
    }
  });

  it("marks the risk model unavailable below 60 common observations", () => {
    const r = runConstruction(
      input({ config: { ...baseConfig, requestedStartDate: ds.at(-30)! } }),
    );
    expect(r.estimation.available).toBe(false);
    expect(proposal(r, "equal_weight").status).toBe("success");
    for (const m of [
      "inverse_volatility",
      "minimum_variance",
      "equal_risk_contribution",
    ])
      expect(proposal(r, m).status).toBe("insufficient_history");
  });

  it("gives identical current and proposed paths and zero turnover when bounds pin the current allocation", () => {
    const r = runConstruction(
      input({
        constraints: [
          { ticker: "AAA", minWeight: 0.5, maxWeight: 0.5, required: true },
          { ticker: "BBB", minWeight: 0.3, maxWeight: 0.3, required: true },
          { ticker: "CCC", minWeight: 0, maxWeight: 0, required: false },
        ],
      }),
    );
    if (!r.current.historical.available) throw new Error("fixture");
    for (const p of r.proposals.filter(
      (x) => x.method !== "equal_risk_contribution",
    )) {
      expect(p.status).toBe("success");
      expect(p.turnover).toBe(0);
      if (!p.historical.available) throw new Error("fixture");
      expect(p.historical.growth).toEqual(r.current.historical.growth);
    }
    // ERC cannot equalize three contributions with CCC pinned at zero: an honest approximation.
    expect(proposal(r, "equal_risk_contribution").status).toBe(
      "converged_but_parity_not_achieved",
    );
    expect(proposal(r, "equal_risk_contribution").label).toBe(
      "Constrained Risk-Balance Approximation",
    );
  });

  it("compares both portfolios from the same start, set by the latest eligible asset", () => {
    const r = runConstruction(input());
    expect(r.comparison.available).toBe(true);
    if (!r.comparison.available || !r.current.historical.available) return;
    expect(r.comparison.sample.startDate).toBe(ds[LATE]);
    expect(r.current.historical.growth[0]).toEqual({
      date: ds[LATE],
      wealth: 10_000,
    });
    const mv = proposal(r, "minimum_variance");
    if (!mv.historical.available) throw new Error("fixture");
    expect(mv.historical.growth.map((g) => g.date)).toEqual(
      r.current.historical.growth.map((g) => g.date),
    );
    expect(
      mv.historical.beta.available && r.current.historical.beta.available,
    ).toBe(true);
  });

  it("requires stress coverage for the union of both portfolios' holdings", () => {
    const r = runConstruction(input());
    const events = proposal(r, "equal_weight").stress;
    // The early window predates CCC, held only by the proposal: no partial comparison.
    expect(events[0]).toMatchObject({
      id: "early",
      status: "incomplete_coverage",
      missing: ["CCC"],
    });
    expect(events[1].status).toBe("complete");
  });

  it("measures turnover over the union of holdings including CASH", () => {
    const r = runConstruction(input());
    const ew = proposal(r, "equal_weight");
    const expected =
      0.5 *
      (Math.abs(0.8 / 3 - 0.5) +
        Math.abs(0.8 / 3 - 0.3) +
        Math.abs(0.8 / 3 - 0));
    expect(ew.turnover).toBeCloseTo(expected, 15);
  });

  it("uses Construction Model Risk on the same Σ for current and proposed", () => {
    const r = runConstruction(input());
    expect(r.current.modelRisk.available).toBe(true);
    const mv = proposal(r, "minimum_variance");
    if (!mv.modelRisk.available || !r.current.modelRisk.available)
      throw new Error("fixture");
    expect(mv.modelRisk.volatility).toBeLessThanOrEqual(
      r.current.modelRisk.volatility,
    );
    expect(
      mv.modelRisk.holdings.reduce((s, h) => s + h.percentage!, 0),
    ).toBeCloseTo(1, 12);
  });

  it("preserves the Treasury-outage rule: CASH history is unavailable, never zero-filled", () => {
    const i = input();
    i.estimation.treasury = null;
    const r = runConstruction(i);
    expect(r.current.historical.available).toBe(false);
    if (!r.current.historical.available)
      expect(r.current.historical.reason).toMatch(/Treasury/);
  });

  it("replays exactly from its own snapshot", () => {
    const r = runConstruction(input());
    const replay = runConstruction({
      config: r.config,
      constraints: r.inputs.constraints,
      cash: r.inputs.cash,
      ...r.snapshot,
      now: r.metadata.generatedAt,
    });
    expect(replay.metadata.snapshotHash).toBe(r.metadata.snapshotHash);
    expect(replay.proposals).toEqual(r.proposals);
  });

  it("rejects constraints for tickers outside the eligible universe", () => {
    expect(() =>
      runConstruction(
        input({
          constraints: [
            { ticker: "ZZZ", minWeight: 0, maxWeight: 1, required: false },
          ],
        }),
      ),
    ).toThrow(/ZZZ/);
  });

  it("constructs a maximum portfolio of 20 risky holdings plus CASH end to end", () => {
    const r = runConstruction(maxConstructionInput());
    expect(r.inputs.universe).toHaveLength(20);
    expect(r.current.historical.available).toBe(true);
    for (const p of r.proposals) {
      expect(["success", "converged_but_parity_not_achieved"]).toContain(
        p.status,
      );
      expect(p.weights).toHaveLength(21);
      expect(p.historical.available).toBe(true);
      expect(p.stress).toHaveLength(2);
    }
  });

  it("appends fixed CASH to 20 risky holdings without breaking comparison or stress", () => {
    const i = maxConstructionInput();
    i.config = {
      ...maxConfig,
      holdings: MAX_TICKERS.map((ticker) => ({ ticker, weight: 0.05 })),
    };
    i.cash = { mode: "fixed", weight: 0.1 };
    const r = runConstruction(i);
    const ew = r.proposals[0];
    expect(ew.weights).toHaveLength(21);
    expect(ew.weights!.at(-1)).toEqual({ ticker: "CASH", weight: 0.1 });
    expect(ew.historical.available).toBe(true);
    expect(ew.stress.every((e) => e.status !== "unavailable")).toBe(true);
  });

  it("rejects one holding above the maximum with a typed validation error", () => {
    const i = maxConstructionInput();
    i.config = {
      ...maxConfig,
      holdings: [
        ...maxConfig.holdings.slice(0, 20),
        { ticker: "R21", weight: 0 },
        maxConfig.holdings[20],
      ],
    };
    let caught: unknown;
    try {
      runConstruction(i);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LabError);
    expect((caught as LabError).detail.code).toBe("INVALID_INPUT");
    expect((caught as LabError).detail.message).toMatch(
      /at most 20 risky holdings/,
    );
  });

  it("reaches the exact ERC with an extremely small positive weight through the full pipeline", () => {
    // Review counterexample Σ ∝ diag(1, 1/2.25e12): HI's daily returns alternate ±a,
    // LO's follow (+b, +b, −b, −b) with b = a / 1.5e6, so the two are uncorrelated
    // and every demeaned |return| is constant. Ledoit–Wolf δ ≈ 4(b/a)²/n is ~1e-16 and
    // lifts LO's variance by only ≈ 2/n, so Σ_construction stays within 0.1% of
    // diag(1, 1/2.25e12)·a²·252.
    const all = sessionsBetween("2000-01-03", "2024-05-31", FAR);
    // A multiple of 4 returns keeps both patterns exactly zero-mean and uncorrelated.
    const long = all.slice(0, all.length - ((all.length - 1) % 4));
    const dates = long.map((d) => d.date);
    const a = 0.015;
    const b = a / 1.5e6;
    const path = (r: (k: number) => number) => {
      const p = [100];
      for (let k = 1; k < dates.length; k++) p.push(p[k - 1] * (1 + r(k)));
      return p;
    };
    const px = [
      series(
        "HI",
        dates,
        path((k) => (k % 2 ? a : -a)),
      ),
      series(
        "LO",
        dates,
        path((k) => (k % 4 === 1 || k % 4 === 2 ? b : -b)),
      ),
      series(
        "BMK",
        dates,
        path((k) => 0.01 * Math.sin(k)),
      ),
    ];
    const config: PortfolioConfig = {
      holdings: [
        { ticker: "HI", weight: 0.5 },
        { ticker: "LO", weight: 0.5 },
      ],
      benchmark: "BMK",
      requestedStartDate: dates[0],
      endDate: dates.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    };
    const i = input({ config });
    i.estimation = { ...i.estimation, prices: px, sessions: long };
    i.stress = { ...i.stress, prices: px, sessions: long, windows: [] };
    const r = runConstruction(i);
    expect(r.covariance.available).toBe(true);
    if (!r.covariance.available) return;
    const erc = proposal(r, "equal_risk_contribution");
    expect(erc.status).toBe("success");
    expect(erc.diagnostics.residuals.parity!).toBeLessThanOrEqual(T.parity);
    const hi = weightOf(r, "equal_risk_contribution", "HI");
    const lo = weightOf(r, "equal_risk_contribution", "LO");
    expect(Math.abs(hi / 0.0000006666662222 - 1)).toBeLessThan(1e-3);
    expect(Math.abs(lo - 0.9999993333337778)).toBeLessThan(1e-9);
    expect(hi + lo).toBeCloseTo(1, 15);
    // Exact against the closed form on the pipeline's own Σ: with two assets,
    // w₁(Σw)₁ = w₂(Σw)₂ reduces to σ₁w₁ = σ₂w₂ whatever the covariance.
    const [s1, s2] = r.covariance.standaloneVolatility;
    expect(Math.abs(hi / (s2 / (s1 + s2)) - 1)).toBeLessThan(1e-9);
    const selected = erc.diagnostics.starts.find((s) => s.selected)!;
    expect(selected.secondOrder).toBe("parity_achieved");
  });

  const cashOnly: PortfolioConfig = {
    ...baseConfig,
    holdings: [{ ticker: "CASH", weight: 1 }],
  };

  it("constructs a 100% CASH portfolio explicitly: all-CASH allocations, ERC unavailable, zero model risk", () => {
    const r = runConstruction(input({ config: cashOnly }));
    expect(r.inputs.universe).toEqual([]);
    expect(r.inputs.riskyBudget).toBe(0);
    for (const m of [
      "equal_weight",
      "inverse_volatility",
      "minimum_variance",
    ]) {
      const p = proposal(r, m);
      expect(p.status).toBe("success");
      expect(p.label).toBe("All-CASH Allocation (zero risky budget)");
      expect(p.weights).toEqual([{ ticker: "CASH", weight: 1 }]);
      expect(p.turnover).toBe(0);
      expect(p.modelRisk).toMatchObject({
        available: true,
        volatility: 0,
        cash: { weight: 1, contribution: 0 },
      });
    }
    const erc = proposal(r, "equal_risk_contribution");
    expect(erc.status).toBe("invalid_inputs");
    expect(erc.reason).toMatch(
      /no risky allocation and no risk-budget problem/,
    );
    expect(r.current.modelRisk).toMatchObject({
      available: true,
      volatility: 0,
    });
    // Treasury-based CASH path, on the session calendar: no invented risky history.
    expect(r.current.historical.available).toBe(true);
    expect(r.comparison.available).toBe(true);
    const mv = proposal(r, "minimum_variance");
    if (!mv.historical.available || !r.current.historical.available)
      throw new Error("fixture");
    expect(mv.historical.growth).toEqual(r.current.historical.growth);
    expect(mv.stress.every((e) => e.status === "complete")).toBe(true);
    const replay = runConstruction({
      config: r.config,
      constraints: r.inputs.constraints,
      cash: r.inputs.cash,
      ...r.snapshot,
      now: r.metadata.generatedAt,
    });
    expect(replay.metadata.snapshotHash).toBe(r.metadata.snapshotHash);
    expect(replay.proposals).toEqual(r.proposals);
  });

  it("reports the typed Treasury-unavailable state for 100% CASH without Treasury history", () => {
    const i = input({ config: cashOnly });
    i.estimation.treasury = null;
    const r = runConstruction(i);
    expect(proposal(r, "equal_weight").status).toBe("success");
    expect(r.current.historical.available).toBe(false);
    if (!r.current.historical.available)
      expect(r.current.historical.reason).toMatch(/Treasury/);
  });

  describe("all-CASH with an unused zero-weight candidate", () => {
    const candidate: PortfolioConfig = {
      ...baseConfig,
      holdings: [
        { ticker: "AAA", weight: 0 },
        { ticker: "CASH", weight: 1 },
      ],
    };
    // AAA has no usable history at all: it is absent from every price snapshot.
    const withoutAAA = (overrides: Partial<ConstructionInput> = {}) => {
      const i = input(overrides);
      const keep = i.estimation.prices.filter((p) => p.ticker !== "AAA");
      i.estimation = { ...i.estimation, prices: keep };
      i.stress = { ...i.stress, prices: keep };
      return i;
    };

    it("needs no history for a risky candidate held by neither portfolio", () => {
      const r = runConstruction(withoutAAA({ config: candidate }));
      expect(r.inputs.universe).toEqual(["AAA"]);
      expect(r.inputs.riskyBudget).toBe(0);
      for (const m of [
        "equal_weight",
        "inverse_volatility",
        "minimum_variance",
      ]) {
        const p = proposal(r, m);
        expect(p.status).toBe("success");
        expect(p.label).toBe("All-CASH Allocation (zero risky budget)");
        expect(p.weights).toEqual([
          { ticker: "AAA", weight: 0 },
          { ticker: "CASH", weight: 1 },
        ]);
        expect(p.modelRisk).toMatchObject({ available: true, volatility: 0 });
        expect(p.historical.available).toBe(true);
        expect(p.stress.every((e) => e.status === "complete")).toBe(true);
      }
      expect(proposal(r, "equal_risk_contribution").status).toBe(
        "invalid_inputs",
      );
      expect(r.estimation.available).toBe(false);
      if (!r.estimation.available)
        expect(r.estimation.reason).toMatch(/no risky/i);
      expect(r.current.modelRisk).toMatchObject({
        available: true,
        volatility: 0,
      });
      // Calendar + Treasury CASH path, identical to a portfolio with no candidate.
      const plain = runConstruction(
        input({
          config: { ...baseConfig, holdings: [{ ticker: "CASH", weight: 1 }] },
        }),
      );
      expect(r.comparison).toEqual(plain.comparison);
      if (
        !r.current.historical.available ||
        !plain.current.historical.available
      )
        throw new Error("fixture");
      expect(r.current.historical.growth).toEqual(
        plain.current.historical.growth,
      );
      const replay = runConstruction({
        config: r.config,
        constraints: r.inputs.constraints,
        cash: r.inputs.cash,
        ...r.snapshot,
        now: r.metadata.generatedAt,
      });
      expect(replay.proposals).toEqual(r.proposals);
    });

    it("does not depend on whether the unused candidate's history exists", () => {
      const without = runConstruction(withoutAAA({ config: candidate }));
      const withHistory = runConstruction(input({ config: candidate }));
      expect(withHistory.comparison).toEqual(without.comparison);
      expect(withHistory.proposals.map((p) => p.historical)).toEqual(
        without.proposals.map((p) => p.historical),
      );
    });

    it("keeps the typed Treasury reason when Treasury history is missing", () => {
      const i = withoutAAA({ config: candidate });
      i.estimation.treasury = null;
      const r = runConstruction(i);
      expect(proposal(r, "minimum_variance").status).toBe("success");
      expect(r.current.historical.available).toBe(false);
      if (!r.current.historical.available)
        expect(r.current.historical.reason).toMatch(/Treasury/);
    });

    it("still requires the current portfolio's risky history when only the proposal is all-CASH", () => {
      const r = runConstruction(
        withoutAAA({
          config: {
            ...baseConfig,
            holdings: [
              { ticker: "AAA", weight: 0.5 },
              { ticker: "CASH", weight: 0.5 },
            ],
          },
          cash: { mode: "fixed", weight: 1 },
        }),
      );
      expect(r.inputs.riskyBudget).toBe(0);
      expect(r.current.historical.available).toBe(false);
      if (!r.current.historical.available)
        expect(r.current.historical.reason).toMatch(/AAA/);
      expect(r.comparison.available).toBe(false);
    });

    it("still requires the proposed risky history when only the current portfolio is all-CASH", () => {
      const r = runConstruction(
        withoutAAA({ config: candidate, cash: { mode: "fixed", weight: 0.5 } }),
      );
      expect(r.inputs.riskyBudget).toBe(0.5);
      const ew = proposal(r, "equal_weight");
      expect(ew.weights!.find((w) => w.ticker === "AAA")!.weight).toBe(0.5);
      expect(ew.historical.available).toBe(false);
      if (!ew.historical.available) expect(ew.historical.reason).toMatch(/AAA/);
      expect(proposal(r, "minimum_variance").status).toBe(
        "insufficient_history",
      );
    });
  });

  it("makes all-CASH infeasible when a risky minimum is positive", () => {
    const r = runConstruction(
      input({
        config: {
          ...baseConfig,
          holdings: [
            { ticker: "AAA", weight: 0 },
            { ticker: "CASH", weight: 1 },
          ],
        },
        constraints: [
          { ticker: "AAA", minWeight: 0.1, maxWeight: 1, required: true },
        ],
      }),
    );
    for (const p of r.proposals) expect(p.status).toBe("infeasible");
  });

  it("treats zero-weight candidates with 100% CASH as an all-CASH problem, not insufficient history", () => {
    const r = runConstruction(
      input({
        config: {
          ...baseConfig,
          requestedStartDate: ds.at(-30)!,
          holdings: [
            { ticker: "AAA", weight: 0 },
            { ticker: "CASH", weight: 1 },
          ],
        },
      }),
    );
    expect(r.estimation.available).toBe(false); // < 60 observations
    for (const m of ["equal_weight", "inverse_volatility", "minimum_variance"])
      expect(proposal(r, m).status).toBe("success");
    expect(proposal(r, "equal_risk_contribution").status).toBe(
      "invalid_inputs",
    );
  });
});
