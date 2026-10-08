import { describe, expect, it } from "vitest";
import {
  buildBlackLittermanInputs,
  type ViewRiskModelInput,
} from "@/lib/forward/views";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  BlackLittermanInputs,
  BlackLittermanInputsOutcome,
  StreetViewInput,
} from "@/lib/types/forward";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

const TAU = 0.05;
// Annualized covariance of AAPL, JPM, MSFT (canonical order), positive definite.
const SIGMA = [
  [0.09, 0.02, 0.04],
  [0.02, 0.0625, 0.015],
  [0.04, 0.015, 0.0729],
];
const model = (o: Partial<ViewRiskModelInput> = {}): ViewRiskModelInput => ({
  tickers: ["AAPL", "JPM", "MSFT"],
  covariance: SIGMA,
  hash: "risk-model-hash",
  ...o,
});
const manual = (manualReturn: number, confidence = 0.5) => ({
  source: "manual",
  manualReturn,
  confidence,
});
const streetSel = (confidence = 0.5, manualReturn: number | null = null) => ({
  source: "street",
  manualReturn,
  confidence,
});
const streetData = (
  ticker: string,
  priceTargetReturn: number,
): Extract<StreetViewInput, { available: true }> => ({
  ticker,
  available: true,
  priceTargetReturn,
  basis: "price_return",
  horizonMonths: 12,
  targetStatistic: "median",
  provider: "fixture",
  retrievedAt: "2024-06-04T15:00:00Z",
});
const ok = (o: BlackLittermanInputsOutcome): BlackLittermanInputs => {
  if (!o.available) throw new Error(`${o.code}: ${o.reason}`);
  return o.inputs;
};
const build = (
  views: Record<string, unknown>,
  street?: Record<string, StreetViewInput>,
  m: ViewRiskModelInput = model(),
) => ok(buildBlackLittermanInputs({ riskModel: m, views, street }));

describe("P and Q for absolute single-security views", () => {
  it("puts a manual view's selector row in P at the security's canonical column, and its exact decimal return in Q", () => {
    const r = build({ JPM: manual(0.12) });
    expect(r.P).toEqual([[0, 1, 0]]);
    expect(r.Q).toEqual([0.12]);
    expect(r.dimensions).toEqual({ views: 1, securities: 3 });
    expect(r.activeViews[0]).toMatchObject({
      ticker: "JPM",
      status: "ACTIVE",
      source: "manual",
      basis: "total_return",
      horizonMonths: 12,
      label: "12M Expected Total Return",
      viewReturn: 0.12,
      row: 0,
      column: 1,
    });
  });

  it("has dimensions P m × n, Q m and Ω m × m, rows in canonical ticker order", () => {
    const r = build({ MSFT: manual(0.1, 0.6), AAPL: manual(0.15, 0.4) });
    expect(r.P).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    expect(r.Q).toEqual([0.15, 0.1]);
    expect(r.Omega).toHaveLength(2);
    r.Omega.forEach((row) => expect(row).toHaveLength(2));
    expect(r.activeViews.map((v) => v.ticker)).toEqual(["AAPL", "MSFT"]);
    expect(r.universeTickers).toEqual(["AAPL", "JPM", "MSFT"]);
  });

  it("does not depend on the order the views were created in", () => {
    const a = buildBlackLittermanInputs({
      riskModel: model(),
      views: { MSFT: manual(0.1, 0.6), JPM: manual(0.08, 0.25), AAPL: manual(0.15, 1) },
    });
    const b = buildBlackLittermanInputs({
      riskModel: model(),
      views: { AAPL: manual(0.15, 1), MSFT: manual(0.1, 0.6), JPM: manual(0.08, 0.25) },
    });
    expect(b).toEqual(a);
  });

  it("represents zero active views as P 0 × n, Q [] and Ω 0 × 0 (no fake view)", () => {
    const r = build({});
    expect(r.P).toEqual([]);
    expect(r.Q).toEqual([]);
    expect(r.Omega).toEqual([]);
    expect(r.dimensions).toEqual({ views: 0, securities: 3 });
    expect(r.activeViews).toEqual([]);
    expect(r.securities.map((s) => s.status)).toEqual(["NO_VIEW", "NO_VIEW", "NO_VIEW"]);
  });
});

describe("Ω: confidence-scaled, diagonal, from the annual risk-model Σ", () => {
  const omegaAt = (c: number) => build({ JPM: manual(0.1, c) }).activeViews[0];

  it("50% gives Ω = base variance exactly, with base = τ Σ_kk", () => {
    const v = omegaAt(0.5);
    expect(v.baseVariance).toBe(TAU * SIGMA[1][1]);
    expect(v.omega).toBe(v.baseVariance);
  });

  it("25% gives 3× and 75% gives ⅓× the base variance", () => {
    expect(omegaAt(0.25).omega).toBeCloseTo(3 * TAU * SIGMA[1][1], 15);
    expect(omegaAt(0.75).omega / (TAU * SIGMA[1][1])).toBeCloseTo(1 / 3, 14);
  });

  it("100% gives Ω exactly 0, with no epsilon", () => {
    const v = omegaAt(1);
    expect(v.omega).toBe(0);
    expect(Object.is(v.omega, 0)).toBe(true);
  });

  it("builds a diagonal Ω for several views, zero off the diagonal", () => {
    const r = build({ AAPL: manual(0.15, 0.5), JPM: manual(0.09, 0.25), MSFT: manual(0.1, 1) });
    expect(r.Omega).toEqual([
      [TAU * SIGMA[0][0], 0, 0],
      [0, (TAU * SIGMA[1][1] * 0.75) / 0.25, 0],
      [0, 0, 0],
    ]);
  });

  it("scales with Σ: doubling Σ doubles Ω", () => {
    const a = build({ AAPL: manual(0.15, 0.4) });
    const b = build({ AAPL: manual(0.15, 0.4) }, undefined, model({ covariance: SIGMA.map((r) => r.map((x) => 2 * x)) }));
    expect(b.Omega[0][0]).toBeCloseTo(2 * a.Omega[0][0], 15);
  });

  it("uses the certified Task 3 Σ exactly", () => {
    const r = buildForwardRiskModel({
      universe: ["AAA", "BBB", "CCC"],
      marketProxy: "VTI",
      riskWindow: "3Y",
      requestedStartDate: FORWARD_START_3Y,
      endDate: FORWARD_END,
      prices: ["AAA", "BBB", "CCC", "VTI"].map((t) => fixtureSeries(t)),
      sessions: forwardRiskSessions(FORWARD_START_3Y, FORWARD_END),
    });
    if (!r.available) throw new Error(r.reason);
    const inputs = build({ BBB: manual(0.08, 0.5) }, undefined, r.model);
    expect(inputs.activeViews[0].baseVariance).toBe(TAU * r.model.covariance[1][1]);
    expect(inputs.riskModelHash).toBe(r.model.hash);
    expect(inputs.tau).toBe(FORWARD_METHODOLOGY.tau);
    expect(inputs.omegaConvention).toMatch(/Idzorek-style closed form/);
  });
});

describe("views with no model effect", () => {
  it("drops a 0% view from P, Q and Ω but keeps it visible", () => {
    const r = build({ JPM: manual(0.12, 0), MSFT: manual(0.1, 0.5) });
    expect(r.P).toEqual([[0, 0, 1]]);
    expect(r.Q).toEqual([0.1]);
    expect(r.Omega).toEqual([[TAU * SIGMA[2][2]]]);
    expect(r.securities[1]).toMatchObject({
      ticker: "JPM",
      status: "ZERO_CONFIDENCE",
      viewReturn: 0.12,
      confidence: 0,
    });
    expect(r.inactiveViews.map((v) => v.ticker)).toEqual(["JPM"]);
  });

  it("keeps a saved view outside the universe as not applicable, contributing nothing", () => {
    const r = build({ NVDA: manual(0.3, 0.9), JPM: manual(0.12) });
    expect(r.P).toEqual([[0, 1, 0]]);
    expect(r.notApplicable).toEqual([
      expect.objectContaining({ ticker: "NVDA", status: "OUT_OF_UNIVERSE", viewReturn: 0.3, confidence: 0.9 }),
    ]);
    expect(r.inactiveViews.map((v) => v.ticker)).toEqual(["NVDA"]);
    expect(r.dimensions.views).toBe(1);
  });

  it("marks Street View without qualified Street data unavailable and never substitutes the manual value", () => {
    const r = build({ JPM: streetSel(0.6, 0.11) });
    expect(r.P).toEqual([]);
    expect(r.Q).toEqual([]);
    expect(r.securities[1]).toMatchObject({
      status: "STREET_DATA_UNAVAILABLE",
      requestedSource: "street",
      source: "street",
      basis: "price_return",
      viewReturn: null,
    });
    expect(r.securities[1].reason).toMatch(/no other value is substituted/);
  });

  it("refuses unavailable, non-median, mismatched or invalid Street inputs", () => {
    const cases: StreetViewInput[] = [
      { ticker: "JPM", available: false, reason: "Ticker not covered." },
      { ...streetData("JPM", 0.08), targetStatistic: "average" as never },
      { ...streetData("JPM", 0.08), basis: "total_return" as never },
      { ...streetData("JPM", 0.08), horizonMonths: 24 as never },
      streetData("JPM", NaN),
      streetData("JPM", -1),
      streetData("MSFT", 0.08),
    ];
    for (const s of cases) {
      const r = build({ JPM: streetSel(0.6, 0.11) }, { JPM: s });
      expect(r.securities[1].status).toBe("STREET_DATA_UNAVAILABLE");
      expect(r.Q).toEqual([]);
    }
  });

  it("never lets a view on CASH reach P", () => {
    const r = build({ CASH: manual(0.04), JPM: manual(0.12) });
    expect(r.P).toEqual([[0, 1, 0]]);
    expect(r.invalid).toEqual([
      expect.objectContaining({ ticker: "CASH", status: "INVALID_VIEW", reason: "CASH can never carry a view." }),
    ]);
    expect(r.inactiveViews.map((v) => v.ticker)).toContain("CASH");
  });

  it("classifies unreadable saved views as invalid without failing the others", () => {
    const r = build({
      AAPL: { source: "manual", manualReturn: 3, confidence: 0.5 }, // above +200%
      JPM: { source: "manual", manualReturn: NaN, confidence: 0.5 },
      MSFT: { source: "manual", manualReturn: 0.1, confidence: NaN },
      aapl: manual(0.1),
    });
    expect(r.securities.map((s) => s.status)).toEqual(["INVALID_VIEW", "INVALID_VIEW", "INVALID_VIEW"]);
    expect(r.invalid.map((v) => v.ticker)).toEqual(["aapl"]);
    expect(r.P).toEqual([]);
  });
});

describe("one active view per security and return basis", () => {
  it("feeds Q from the selected source only", () => {
    const street = { JPM: streetData("JPM", 0.08), MSFT: streetData("MSFT", 0.2) };
    const r = build({ JPM: streetSel(0.6, 0.11), MSFT: manual(0.1, 0.5) }, street);
    expect(r.Q).toEqual([0.08, 0.1]);
    expect(r.activeViews.map((v) => [v.ticker, v.source, v.basis])).toEqual([
      ["JPM", "street", "price_return"],
      ["MSFT", "manual", "total_return"],
    ]);
    expect(r.activeViews.filter((v) => v.ticker === "JPM")).toHaveLength(1);
  });

  it("keeps the Street basis and label auditable on the active view", () => {
    const r = build({ AAPL: streetSel(0.6) }, { AAPL: streetData("AAPL", 0.134) });
    expect(r.activeViews[0]).toMatchObject({
      source: "street",
      basis: "price_return",
      horizonMonths: 12,
      label: "12M Price-Target Return · Dividends Excluded",
      viewReturn: 0.134,
      confidence: 0.6,
    });
  });

  it("records confidence as a fraction (0.5 = 50%)", () => {
    const r = build({ AAPL: manual(0.1, 0.5) });
    expect(r.activeViews[0].confidence).toBe(0.5);
    expect(build({ AAPL: manual(0.1, 50) }).securities[0].status).toBe("INVALID_VIEW");
  });
});

describe("failures", () => {
  it("fails cleanly on non-finite or mis-shaped covariance and a non-canonical universe", () => {
    const bad = [
      model({ covariance: [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]] }),
      model({ covariance: [[1, 0], [0, 1]] }),
      model({ tickers: ["JPM", "AAPL", "MSFT"] }),
      model({ tickers: ["AAPL", "CASH", "MSFT"] }),
    ];
    for (const m of bad)
      expect(buildBlackLittermanInputs({ riskModel: m, views: {} })).toMatchObject({
        available: false,
        code: "invalid_inputs",
      });
  });

  it("names the security when an active view has a non-positive base variance", () => {
    const r = buildBlackLittermanInputs({
      riskModel: model({ covariance: [[0.09, 0, 0], [0, 0, 0], [0, 0, 0.0729]] }),
      views: { JPM: manual(0.1) },
    });
    expect(r).toMatchObject({ available: false, code: "invalid_view_variance", tickers: ["JPM"] });
  });
});

describe("module boundaries", () => {
  it("imports nothing Node-only, server-only or provider-specific", async () => {
    const { readFileSync } = await import("node:fs");
    const imports = [...readFileSync("lib/forward/views.ts", "utf8").matchAll(/from "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imports.sort()).toEqual([
      "./assumptions",
      "@/config/methodology",
      "@/lib/types/forward",
      "@/lib/validation/forward",
      "@/lib/validation/symbols",
    ]);
  });
});
