import { describe, expect, it } from "vitest";
import {
  applyProposal,
  constructorRequest,
  defaultConstructorDraft,
  builderConsistency,
  fullPrecisionPercent,
  inputsKey,
} from "@/lib/state/construction";
import { runConstruction } from "@/lib/backtest/construction";
import { toDraft, draftConfig, type Draft } from "@/lib/state/portfolioReducer";
import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import {
  constructionConfig,
  constructionInput,
  maxConfig,
  maxConstructionInput,
} from "../fixtures/construction";

const TOL = CONSTRUCTION_METHODOLOGY.tolerances.weight;
const today = "2024-06-03";
const HASH = "analysis-hash-1";

describe("constructor draft → request", () => {
  it("defaults to the full universe (zero weights included), open bounds and CASH at current", () => {
    const d = defaultConstructorDraft(constructionConfig);
    expect(
      d.constraints.map((c) => [c.ticker, c.min, c.max, c.required]),
    ).toEqual([
      ["AAA", "0", "100", false],
      ["BBB", "0", "100", false],
      ["CCC", "0", "100", false],
    ]);
    const r = constructorRequest(d, constructionConfig);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.cash).toEqual({ mode: "current" });
  });

  it("reports the same feasibility errors the server applies, before any request", () => {
    const d = defaultConstructorDraft(constructionConfig);
    d.constraints = d.constraints.map((c) => ({ ...c, max: "20" }));
    const r = constructorRequest(d, constructionConfig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/60\.00%.*80\.00%/);
    const bad = defaultConstructorDraft(constructionConfig);
    bad.constraints[0] = { ...bad.constraints[0], min: "abc" };
    expect(constructorRequest(bad, constructionConfig).ok).toBe(false);
    const fixed = defaultConstructorDraft(constructionConfig);
    fixed.cash = { mode: "fixed", weight: "150" };
    expect(constructorRequest(fixed, constructionConfig).ok).toBe(false);
  });
});

describe("proposal staleness and Apply", () => {
  const result = runConstruction(constructionInput());
  const d = defaultConstructorDraft(constructionConfig);
  const req = constructorRequest(d, constructionConfig);
  if (!req.ok) throw new Error("fixture");
  const builder = toDraft(constructionConfig);
  const consistent = builderConsistency(builder, constructionConfig, today);
  if (!consistent.ok) throw new Error("fixture");
  const key = inputsKey(req.request, HASH, consistent.config);
  const proposal = { key, result };
  type Over = Partial<Parameters<typeof applyProposal>[0]>;
  const apply = (over: Over = {}) =>
    applyProposal({
      proposal,
      currentKey: key,
      method: "minimum_variance",
      builder,
      today,
      ...over,
    });

  it("applies full-precision weights to a new builder draft without mutating the current one", () => {
    const before = JSON.stringify(builder);
    const a = apply();
    expect(a.ok).toBe(true);
    expect(JSON.stringify(builder)).toBe(before);
    expect(JSON.stringify(constructionConfig)).toBe(
      JSON.stringify(result.config),
    );
    if (!a.ok) return;
    const applied = draftConfig(a.draft, today);
    const mv = result.proposals.find((p) => p.method === "minimum_variance")!;
    for (const w of mv.weights!) {
      const got = applied.holdings.find((h) => h.ticker === w.ticker)!.weight;
      expect(Math.abs(got - w.weight)).toBeLessThanOrEqual(1e-15);
    }
  });

  it("preserves binding bounds through the percent round trip", () => {
    const capped = defaultConstructorDraft(constructionConfig);
    capped.constraints = capped.constraints.map((c) => ({ ...c, max: "35" }));
    const cr = constructorRequest(capped, constructionConfig);
    if (!cr.ok) throw new Error("fixture");
    const r = runConstruction(
      constructionInput({ constraints: cr.request.constraints }),
    );
    const k = inputsKey(cr.request, HASH, consistent.config);
    for (const method of ["equal_weight", "minimum_variance"] as const) {
      const a = applyProposal({
        proposal: { key: k, result: r },
        currentKey: k,
        method,
        builder,
        today,
      });
      if (!a.ok) throw new Error(a.reason);
      const appliedConfig = draftConfig(a.draft, today);
      for (const h of appliedConfig.holdings.filter((x) => x.ticker !== "CASH"))
        expect(h.weight).toBeLessThanOrEqual(0.35 + TOL);
      expect(
        Math.abs(appliedConfig.holdings.reduce((s, h) => s + h.weight, 0) - 1),
      ).toBeLessThanOrEqual(1e-12);
    }
  });

  it("refuses a stale proposal after constraint, CASH-choice or analysis changes", () => {
    const changed = defaultConstructorDraft(constructionConfig);
    changed.constraints[1] = { ...changed.constraints[1], max: "50" };
    const c1 = constructorRequest(changed, constructionConfig);
    const cash = defaultConstructorDraft(constructionConfig);
    cash.cash = { mode: "fixed", weight: "10" };
    const c2 = constructorRequest(cash, constructionConfig);
    if (!c1.ok || !c2.ok) throw new Error("fixture");
    for (const currentKey of [
      inputsKey(c1.request, HASH, consistent.config),
      inputsKey(c2.request, HASH, consistent.config),
      inputsKey(req.request, "analysis-hash-2", consistent.config),
    ]) {
      expect(currentKey).not.toBe(key);
      const a = apply({ currentKey });
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.reason).toMatch(/stale/i);
    }
  });

  const edits: [string, (b: Draft) => Draft][] = [
    ["benchmark", (b) => ({ ...b, benchmark: "SPY" })],
    ["start date", (b) => ({ ...b, requestedStartDate: "2023-02-01" })],
    [
      "holding",
      (b) => ({
        ...b,
        holdings: b.holdings.map((h) =>
          h.ticker === "BBB" ? { ...h, ticker: "DDD" } : h,
        ),
      }),
    ],
    [
      "weight",
      (b) => ({
        ...b,
        holdings: b.holdings.map((h) =>
          h.ticker === "AAA"
            ? { ...h, weight: "45" }
            : h.ticker === "BBB"
              ? { ...h, weight: "35" }
              : h,
        ),
      }),
    ],
    [
      "CASH",
      (b) => ({
        ...b,
        holdings: b.holdings.map((h) =>
          h.ticker === "AAA"
            ? { ...h, weight: "45" }
            : h.ticker === "CASH"
              ? { ...h, weight: "25" }
              : h,
        ),
      }),
    ],
  ];
  it.each(edits)(
    "blocks Apply after a builder %s change, even when a stale key is passed",
    (_, edit) => {
      const changed = edit(builder);
      const state = builderConsistency(changed, constructionConfig, today);
      expect(state.ok).toBe(false);
      // The state layer enforces it: the caller's old key does not help.
      const a = apply({ builder: changed });
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.reason).toMatch(/builder has changed/i);
    },
  );

  it("gives a builder-dependent key: a changed but valid builder produces a different key", () => {
    const changed = { ...builder, benchmark: "SPY" };
    const config = draftConfig(changed, today);
    expect(inputsKey(req.request, HASH, config)).not.toBe(key);
  });

  it("revalidates the proposal itself: missing CASH, missing or unknown holdings, current bounds", () => {
    const tampered = (
      edit: (
        w: { ticker: string; weight: number }[],
      ) => { ticker: string; weight: number }[],
    ) => {
      const r = structuredClone(result);
      const mv = r.proposals.find((p) => p.method === "minimum_variance")!;
      mv.weights = edit(mv.weights!);
      return applyProposal({
        proposal: { key, result: r },
        currentKey: key,
        method: "minimum_variance",
        builder,
        today,
      });
    };
    const noCash = tampered((w) => w.filter((x) => x.ticker !== "CASH"));
    expect(noCash.ok ? "ok" : noCash.reason).toMatch(/CASH is missing/);
    const noBbb = tampered((w) => w.filter((x) => x.ticker !== "BBB"));
    expect(noBbb.ok ? "ok" : noBbb.reason).toMatch(/BBB is missing/);
    const unknown = tampered((w) => [...w, { ticker: "ZZZ", weight: 0 }]);
    expect(unknown.ok ? "ok" : unknown.reason).toMatch(
      /ZZZ is outside the eligible universe/,
    );
    // Current editor bounds tighter than the proposal's: refused even with a matching key.
    const tighter = apply({
      constraints: result.inputs.constraints.map((c) => ({
        ...c,
        maxWeight: 0.05,
      })),
    });
    expect(tighter.ok ? "ok" : tighter.reason).toMatch(/current bounds/);
  });

  it("refuses an unusable proposal", () => {
    const infeasible = structuredClone(result);
    const mv = infeasible.proposals.find(
      (p) => p.method === "minimum_variance",
    )!;
    mv.status = "non_converged";
    mv.weights = null;
    expect(
      applyProposal({
        proposal: { key, result: infeasible },
        currentKey: key,
        method: "minimum_variance",
        builder,
        today,
      }).ok,
    ).toBe(false);
  });
});

describe("fullPrecisionPercent", () => {
  it("writes plain decimal notation that round-trips the weight", () => {
    for (const w of [
      0.16,
      0.8 / 3,
      1e-12,
      0,
      0.30000000000000004,
      0.999999999999,
    ])
      expect(
        Math.abs(Number(fullPrecisionPercent(w)) / 100 - w),
      ).toBeLessThanOrEqual(1e-17);
    expect(fullPrecisionPercent(1e-12)).toMatch(/^\d+(\.\d+)?$/);
    expect(fullPrecisionPercent(0)).toBe("0");
  });
});

describe("Apply for a maximum portfolio", () => {
  it("applies a 20-risky-plus-CASH proposal to the builder", () => {
    const r = runConstruction(maxConstructionInput());
    const builder = toDraft(maxConfig);
    const state = builderConsistency(builder, maxConfig, today);
    const request = constructorRequest(
      defaultConstructorDraft(maxConfig),
      maxConfig,
    );
    if (!state.ok || !request.ok) throw new Error("fixture");
    const key = inputsKey(request.request, HASH, state.config);
    const a = applyProposal({
      proposal: { key, result: r },
      currentKey: key,
      method: "equal_weight",
      builder,
      today,
    });
    expect(a.ok).toBe(true);
    if (a.ok) expect(draftConfig(a.draft, today).holdings).toHaveLength(21);
  });
});
