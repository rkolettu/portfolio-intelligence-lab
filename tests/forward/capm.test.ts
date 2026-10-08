import { describe, expect, it } from "vitest";
import {
  buildCapmPrior,
  capmRequiredReturn,
  expectedMarketReturn,
  type CapmRiskModelInput,
} from "@/lib/forward/capm";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { forwardRiskSessions } from "@/lib/forward/sample";
import { arithmeticReturn } from "@/lib/analytics/returns";
import { LabError } from "@/lib/utils/errors";
import type {
  CapmPrior,
  CapmPriorOutcome,
  ForwardRiskFree,
  ForwardRiskModel,
} from "@/lib/types/forward";
import type { HistoricalSeries } from "@/lib/types/data";
import { FORWARD_END, FORWARD_START_3Y, fixtureSeries } from "../fixtures/forward";

const rf = (annualYield = 0.04, provider = "Federal Reserve H.15 via FRED"): ForwardRiskFree => ({
  series: "DGS1",
  maturity: "1Y",
  observationDate: "2024-06-03",
  annualYield,
  provenance: {
    provider,
    fetchedAt: "2024-06-04T15:00:00Z",
    lastSuccessfulRefresh: "2024-06-04T15:00:00Z",
    cacheAgeSeconds: 0,
    observationDate: "2024-06-03",
    fallbackUsed: false,
    warnings: [],
  },
});

/** A synthetic risk model carrying only what the prior reads. */
const synthetic = (
  tickers: string[],
  modelBeta: number[],
  o: Partial<CapmRiskModelInput> = {},
): CapmRiskModelInput => ({
  tickers,
  modelBeta,
  marketProxy: "VTI",
  proxyInUniverse: tickers.includes("VTI"),
  window: { requested: "3Y" } as ForwardRiskModel["window"],
  hash: "risk-model-hash",
  ...o,
});
const prior = (outcome: CapmPriorOutcome): CapmPrior => {
  if (!outcome.available) throw new Error(`${outcome.code}: ${outcome.reason}`);
  return outcome.prior;
};
const priorFor = (beta: number, mrp = 0.05, r = 0.04) =>
  prior(buildCapmPrior({ riskModel: synthetic(["AAA"], [beta]), riskFree: rf(r), marketRiskPremium: mrp }))
    .rows[0].capmPrior;

const SESSIONS = forwardRiskSessions(FORWARD_START_3Y, FORWARD_END);
const fixtureModel = (prices: HistoricalSeries[], universe = ["AAA", "BBB", "CCC"]) => {
  const r = buildForwardRiskModel({
    universe,
    marketProxy: "VTI",
    riskWindow: "3Y",
    requestedStartDate: FORWARD_START_3Y,
    endDate: FORWARD_END,
    prices,
    sessions: SESSIONS,
  });
  if (!r.available) throw new Error(r.reason);
  return r.model;
};
const PRICES = ["AAA", "BBB", "CCC", "VTI"].map((t) => fixtureSeries(t));

describe("capmRequiredReturn: the one CAPM function", () => {
  it("is Rf + β × MRP in decimal units", () => {
    expect(capmRequiredReturn(0.04, 0, 0.05)).toBe(0.04);
    expect(capmRequiredReturn(0.04, 1, 0.05)).toBeCloseTo(0.09, 15);
    expect(capmRequiredReturn(0.04, 1.5, 0.05)).toBeCloseTo(0.115, 15);
  });

  it("defines the canonical expected market return as the β = 1 case", () => {
    expect(expectedMarketReturn(0.04, 0.05)).toBe(capmRequiredReturn(0.04, 1, 0.05));
    expect(expectedMarketReturn(0.04, 0.05)).toBe(0.04 + 0.05);
  });

  it("fails cleanly on a non-finite input instead of returning NaN", () => {
    const cases: [number, number, number][] = [
      [NaN, 1, 0.05],
      [0.04, Infinity, 0.05],
      [0.04, 1, NaN],
    ];
    for (const args of cases) {
      try {
        capmRequiredReturn(...args);
        throw new Error("expected a failure");
      } catch (error) {
        expect(error).toBeInstanceOf(LabError);
        expect((error as LabError).detail.code).toBe("INVALID_INPUT");
      }
    }
  });
});

describe("CAPM prior: required cases", () => {
  it("Rf 4%, MRP 5%: β 0 → 4%, β 1 → 9%, β 1.5 → 11.5%", () => {
    expect(priorFor(0)).toBe(0.04);
    expect(priorFor(1)).toBeCloseTo(0.09, 15);
    expect(priorFor(1.5)).toBeCloseTo(0.115, 15);
  });

  it("shows negative beta and negative MRP as calculated: no floor at Rf, no clamp at zero", () => {
    expect(priorFor(-0.5)).toBeCloseTo(0.015, 15); // below Rf
    expect(priorFor(1.2, -0.05)).toBeCloseTo(-0.02, 15); // below Rf and below zero
    expect(priorFor(-0.5, -0.05)).toBeCloseTo(0.065, 15); // above Rf
    expect(priorFor(2, -0.1, 0.01)).toBeCloseTo(-0.19, 15);
  });

  it("MRP = 0 gives every risky security exactly Rf, whatever its beta", () => {
    const p = prior(
      buildCapmPrior({
        riskModel: synthetic(["AAA", "BBB", "CCC"], [2.3, -0.7, 0]),
        riskFree: rf(0.0437),
        marketRiskPremium: 0,
      }),
    );
    expect(p.rows.map((r) => r.capmPrior)).toEqual([0.0437, 0.0437, 0.0437]);
    expect(p.expectedMarketReturn).toBe(0.0437);
  });

  it("shifts every prior one-for-one with Rf, and by β × ΔMRP with the MRP", () => {
    const betas = [1.25, 0.7, 0.2, -0.3];
    const model = synthetic(["AAA", "BBB", "CCC", "DDD"], betas);
    const at = (r: number, mrp: number) =>
      prior(buildCapmPrior({ riskModel: model, riskFree: rf(r), marketRiskPremium: mrp })).rows.map(
        (x) => x.capmPrior,
      );
    const base = at(0.04, 0.05);
    at(0.05, 0.05).forEach((x, i) => expect(x - base[i]).toBeCloseTo(0.01, 15));
    at(0.04, 0.065).forEach((x, i) => expect(x - base[i]).toBeCloseTo(betas[i] * 0.015, 15));
  });

  it("gives CASH exactly Rf with β 0, outside the risky model", () => {
    const p = prior(
      buildCapmPrior({ riskModel: synthetic(["AAA"], [1.1]), riskFree: rf(0.0437), marketRiskPremium: -0.05 }),
    );
    expect(p.cash).toEqual({ ticker: "CASH", forwardModelBeta: 0, expectedReturn: 0.0437 });
    expect(p.rows.map((r) => r.ticker)).toEqual(["AAA"]);
  });

  it("exposes Rf + MRP as the one expected market return", () => {
    const p = prior(
      buildCapmPrior({ riskModel: synthetic(["AAA"], [1.1]), riskFree: rf(0.0437), marketRiskPremium: 0.055 }),
    );
    expect(p.expectedMarketReturn).toBe(expectedMarketReturn(0.0437, 0.055));
    expect(p.expectedMarketReturn).toBeCloseTo(0.0987, 15);
  });
});

describe("market proxy identity", () => {
  it("a held proxy has β = 1 and exactly the expected market return as its prior", () => {
    const m = fixtureModel(PRICES, ["AAA", "VTI"]);
    const p = prior(buildCapmPrior({ riskModel: m, riskFree: rf(0.0437), marketRiskPremium: 0.05 }));
    const vti = p.rows.find((r) => r.ticker === "VTI")!;
    expect(vti.forwardModelBeta).toBe(1);
    expect(vti.capmPrior).toBe(p.expectedMarketReturn);
    expect(vti.capmPrior).toBeCloseTo(0.0437 + 0.05, 15);
    expect(p.rows.filter((r) => r.ticker === "VTI")).toHaveLength(1);
  });

  it("refuses a risk model in which a held proxy's beta is not exactly 1", () => {
    const r = buildCapmPrior({
      riskModel: synthetic(["AAA", "VTI"], [1.2, 0.999999]),
      riskFree: rf(),
      marketRiskPremium: 0.05,
    });
    expect(r).toMatchObject({ available: false, code: "invalid_inputs" });
  });
});

describe("certified risk-model inputs only", () => {
  it("uses each Forward Model Beta exactly as the risk model reports it", () => {
    const m = fixtureModel(PRICES);
    const p = prior(buildCapmPrior({ riskModel: m, riskFree: rf(), marketRiskPremium: 0.05 }));
    expect(p.rows.map((r) => r.forwardModelBeta)).toEqual(m.modelBeta);
    expect(p.rows.map((r) => r.ticker)).toEqual(m.tickers);
    expect(p.riskModelHash).toBe(m.hash);
    expect(p.marketProxy).toBe("VTI");
    expect(p.riskWindow).toBe("3Y");
    p.rows.forEach((r) => expect(r.capmPrior).toBe(capmRequiredReturn(0.04, r.forwardModelBeta, 0.05)));
  });

  it("never uses historical mean returns: a large drift in past returns leaves the prior unchanged", () => {
    // Add 0.1% to every daily return of AAA: its cumulative growth more than triples
    // (about +25 points of annual return), its covariance (and so its beta and
    // prior) does not.
    const aaa = PRICES[0];
    const shifted: HistoricalSeries = {
      ...aaa,
      observations: aaa.observations.reduce<HistoricalSeries["observations"]>((out, o, i) => {
        if (i === 0) return [o];
        const r = arithmeticReturn(aaa.observations[i - 1].adjustedClose, o.adjustedClose);
        return [...out, { date: o.date, adjustedClose: out[i - 1].adjustedClose * (1 + r + 0.001) }];
      }, []),
    };
    const growth = (s: HistoricalSeries) =>
      s.observations.at(-1)!.adjustedClose / s.observations[0].adjustedClose;
    expect(growth(shifted) / growth(aaa)).toBeGreaterThan(3);
    const a = prior(buildCapmPrior({ riskModel: fixtureModel(PRICES), riskFree: rf(), marketRiskPremium: 0.05 }));
    const b = prior(
      buildCapmPrior({ riskModel: fixtureModel([shifted, ...PRICES.slice(1)]), riskFree: rf(), marketRiskPremium: 0.05 }),
    );
    b.rows.forEach((r, i) => expect(r.capmPrior).toBeCloseTo(a.rows[i].capmPrior, 12));
  });

  it("works with no risky assets: only the expected market return and CASH", () => {
    const m = fixtureModel(PRICES, []);
    const p = prior(buildCapmPrior({ riskModel: m, riskFree: rf(), marketRiskPremium: 0.05 }));
    expect(p.rows).toEqual([]);
    expect(p.expectedMarketReturn).toBeCloseTo(0.09, 15);
    expect(p.cash.expectedReturn).toBe(0.04);
  });
});

describe("impossible returns and invalid inputs", () => {
  it("returns invalid_capm_prior (never a clamp) when a prior is at or below −100%", () => {
    const r = buildCapmPrior({
      riskModel: synthetic(["AAA", "BBB", "CCC"], [1, -6, -5.2]),
      riskFree: rf(0.04),
      marketRiskPremium: 0.2,
    });
    expect(r.available).toBe(false);
    if (r.available || r.code !== "invalid_capm_prior") throw new Error("expected invalid_capm_prior");
    expect(r.invalid.map((x) => x.ticker)).toEqual(["BBB", "CCC"]);
    expect(r.invalid[0]).toEqual({
      ticker: "BBB",
      forwardModelBeta: -6,
      riskFreeRate: 0.04,
      marketRiskPremium: 0.2,
      capmPrior: 0.04 + -6 * 0.2,
    });
    expect(r.invalid[1].capmPrior).toBeLessThanOrEqual(-1);
    expect(r.reason).toMatch(/cannot be at or below −100%; the CAPM prior is not clamped/);
    expect(r.reason).toMatch(/BBB: Rf 4\.0000% \+ Forward Model Beta -6 × MRP 20\.0000% = -116\.0000%/);
  });

  it("imposes no upper cap: a prior above +100% is reported as calculated", () => {
    expect(priorFor(5, 0.2, 0.04)).toBeCloseTo(1.04, 15);
  });

  it("fails cleanly on non-finite beta, Rf or MRP, and on an MRP outside −10% to +20%", () => {
    const cases = [
      { riskModel: synthetic(["AAA"], [NaN]), riskFree: rf(), marketRiskPremium: 0.05 },
      { riskModel: synthetic(["AAA"], [Infinity]), riskFree: rf(), marketRiskPremium: 0.05 },
      { riskModel: synthetic(["AAA"], [1]), riskFree: rf(NaN), marketRiskPremium: 0.05 },
      { riskModel: synthetic(["AAA"], [1]), riskFree: rf(), marketRiskPremium: NaN },
      { riskModel: synthetic(["AAA"], [1]), riskFree: rf(), marketRiskPremium: Infinity },
      { riskModel: synthetic(["AAA"], [1]), riskFree: rf(), marketRiskPremium: 0.25 },
      { riskModel: synthetic(["AAA"], [1]), riskFree: rf(), marketRiskPremium: 5 },
    ];
    for (const c of cases)
      expect(buildCapmPrior(c)).toMatchObject({ available: false, code: "invalid_inputs" });
  });

  it("refuses another maturity as the risk-free rate", () => {
    const r = buildCapmPrior({
      riskModel: synthetic(["AAA"], [1]),
      riskFree: { ...rf(), series: "DGS3MO" as never },
      marketRiskPremium: 0.05,
    });
    expect(r).toMatchObject({ available: false, code: "invalid_inputs" });
  });

  it("refuses a mismatched or unordered beta vector", () => {
    for (const model of [synthetic(["AAA", "BBB"], [1]), synthetic(["BBB", "AAA"], [1, 1]), synthetic(["AAA", "AAA"], [1, 1])])
      expect(buildCapmPrior({ riskModel: model, riskFree: rf(), marketRiskPremium: 0.05 })).toMatchObject({
        available: false,
        code: "invalid_inputs",
      });
  });
});

describe("determinism", () => {
  it("is invariant to the order the universe and prices arrived in", () => {
    const a = buildCapmPrior({ riskModel: fixtureModel(PRICES), riskFree: rf(), marketRiskPremium: 0.05 });
    const b = buildCapmPrior({
      riskModel: fixtureModel([...PRICES].reverse(), ["CCC", "AAA", "BBB"]),
      riskFree: rf(),
      marketRiskPremium: 0.05,
    });
    expect(b).toEqual(a);
  });

  it("depends only on the risk model, Rf and MRP — not on retrieval times", () => {
    const m = fixtureModel(PRICES);
    const later: ForwardRiskFree = {
      ...rf(),
      provenance: { ...rf().provenance, fetchedAt: "2024-06-04T20:00:00Z", cacheAgeSeconds: 900 },
    };
    expect(buildCapmPrior({ riskModel: m, riskFree: later, marketRiskPremium: 0.05 })).toEqual(
      buildCapmPrior({ riskModel: m, riskFree: rf(), marketRiskPremium: 0.05 }),
    );
  });

  it("records the shared inputs once, at the parent level", () => {
    const p = prior(buildCapmPrior({ riskModel: fixtureModel(PRICES), riskFree: rf(0.0437), marketRiskPremium: 0.05 }));
    expect(p.riskFreeRate).toBe(0.0437);
    expect(p.riskFreeObservationDate).toBe("2024-06-03");
    expect(p.riskFreeSource).toBe("Federal Reserve H.15 via FRED");
    expect(p.marketRiskPremium).toBe(0.05);
    expect(Object.keys(p.rows[0]).sort()).toEqual(["capmPrior", "forwardModelBeta", "ticker"]);
  });
});

describe("module boundaries", () => {
  it("imports nothing Node-only, server-only, historical-return-based or Street-related", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/forward/capm.ts", "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      "@/config/methodology",
      "@/lib/types/forward",
      "@/lib/utils/errors",
      "@/lib/validation/forward",
    ]);
  });
});
