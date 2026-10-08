import { describe, expect, it } from "vitest";
import * as M from "@/config/methodology";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import { snapshotHash } from "@/lib/backtest/metadata";
import {
  DEFAULT_FORWARD_ASSUMPTIONS,
  FORWARD_LABELS,
  defaultForwardState,
  defaultView,
} from "@/lib/forward/assumptions";
import {
  FORWARD_STORAGE_KEY,
  forwardReducer,
  persistForwardState,
  restoreForwardState,
} from "@/lib/state/forwardAssumptions";
import {
  parseForwardAssumptions,
  parseForwardState,
  parseViewState,
} from "@/lib/validation/forward";
import { LabError } from "@/lib/utils/errors";
import type { ForwardAssumptionState } from "@/lib/types/forward";

const invalid = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LabError);
    expect((error as LabError).detail.code).toBe("INVALID_INPUT");
    return (error as LabError).detail.message;
  }
  throw new Error("expected INVALID_INPUT");
};

describe("FORWARD_METHODOLOGY", () => {
  it("fixes the 12-month outlook and the approved defaults", () => {
    expect(FORWARD_METHODOLOGY.version).toBe("forward-v1");
    expect(FORWARD_METHODOLOGY.horizonMonths).toBe(12);
    expect(FORWARD_METHODOLOGY.riskWindows).toEqual(["1Y", "3Y", "5Y"]);
    expect(FORWARD_METHODOLOGY.defaultRiskWindow).toBe("3Y");
    expect(FORWARD_METHODOLOGY.marketProxies).toEqual(["VTI", "SPY", "VT"]);
    expect(FORWARD_METHODOLOGY.defaultMarketProxy).toBe("VTI");
    expect(FORWARD_METHODOLOGY.defaultMarketRiskPremium).toBe(0.05);
    expect(FORWARD_METHODOLOGY.views.defaultConfidence).toBe(0.5);
    expect(FORWARD_METHODOLOGY.tau).toBe(0.05);
    expect(FORWARD_METHODOLOGY.frontierPoints).toBe(41);
    expect(FORWARD_METHODOLOGY.minimumObservations).toBe(60);
    expect(FORWARD_METHODOLOGY.normalObservations).toBe(252);
    expect(FORWARD_METHODOLOGY.riskFree.series).toBe("DGS1");
    expect(FORWARD_METHODOLOGY.riskAnnualization).toBe(252);
  });

  it("leaves every pre-V2 methodology constant (and so every snapshot hash) unchanged", () => {
    // SHA-256 of each constant at main@5d0840a, before any V2 code.
    const pinned: Record<string, string> = {
      METHODOLOGY:
        "940ae24516ac5506b0dda21cee9221063a56b8e104478c85f165a4625ef1a953",
      PERFORMANCE_METHODOLOGY:
        "b6ae1ad0e633f03a3e00f69324941330de8eef27436a248c308f20da9d17fde0",
      BENCHMARK_METHODOLOGY:
        "f3c72575676158a50eadc8d1457787b172a58d6440b9de3298e84502968d0296",
      RISK_METHODOLOGY:
        "de4a6d19ce4f8594941153b187b268966834e8e8e4e15d1faa5351d563110797",
      ROLLING_METHODOLOGY:
        "665d946b61a40fe1be43787b3d899bf228875876ea5eecdd6f5c61efdfddc81e",
      CONSTRUCTION_METHODOLOGY:
        "4f2b50e20e46dfade240d68af3a73a95f521455b65d64fd83fb4e635f2ba86c1",
      STRESS_METHODOLOGY:
        "b93d076a1b632127e7194dae8f2be75ddc877d2cec165dd07b9ece2910129bf0",
    };
    for (const [name, hash] of Object.entries(pinned))
      expect(snapshotHash((M as Record<string, unknown>)[name]), name).toBe(
        hash,
      );
  });
});

describe("default assumptions and views", () => {
  it("defaults to a 3Y risk window, VTI and a 5.00% Market Risk Premium", () => {
    expect(DEFAULT_FORWARD_ASSUMPTIONS).toEqual({
      riskWindow: "3Y",
      marketProxy: "VTI",
      marketRiskPremium: 0.05,
    });
    expect(parseForwardAssumptions(DEFAULT_FORWARD_ASSUMPTIONS)).toEqual(
      DEFAULT_FORWARD_ASSUMPTIONS,
    );
    expect(defaultForwardState()).toEqual({
      assumptions: DEFAULT_FORWARD_ASSUMPTIONS,
      views: {},
    });
  });

  it("starts a view with no source, no manual value and 50% confidence", () => {
    expect(defaultView()).toEqual({
      source: "none",
      manualReturn: null,
      confidence: 0.5,
    });
  });

  it("returns fresh objects so callers cannot mutate the defaults", () => {
    const a = defaultForwardState();
    a.assumptions.marketRiskPremium = 0.09;
    a.views.AAPL = defaultView();
    expect(defaultForwardState()).toEqual({
      assumptions: DEFAULT_FORWARD_ASSUMPTIONS,
      views: {},
    });
    expect(DEFAULT_FORWARD_ASSUMPTIONS.marketRiskPremium).toBe(0.05);
  });
});

describe("assumption validation", () => {
  const base = DEFAULT_FORWARD_ASSUMPTIONS;

  it("accepts every allowed risk window and market proxy", () => {
    for (const riskWindow of ["1Y", "3Y", "5Y"] as const)
      for (const marketProxy of ["VTI", "SPY", "VT"] as const)
        expect(
          parseForwardAssumptions({ ...base, riskWindow, marketProxy }),
        ).toEqual({ ...base, riskWindow, marketProxy });
  });

  it("never lets a bond ETF or any other fund become the market proxy", () => {
    for (const marketProxy of ["BND", "AGG", "TLT", "QQQ", "IWM", "vti", ""])
      expect(
        invalid(() => parseForwardAssumptions({ ...base, marketProxy })),
      ).toMatch(/market proxy must be VTI, SPY, VT/i);
  });

  it("rejects unsupported risk windows", () => {
    for (const riskWindow of ["10Y", "MAX", "2Y", "3y"])
      invalid(() => parseForwardAssumptions({ ...base, riskWindow }));
  });

  it("accepts a Market Risk Premium from −10% to +20% inclusive, negative scenarios included", () => {
    expect(FORWARD_METHODOLOGY.marketRiskPremiumRange).toEqual({
      min: -0.1,
      max: 0.2,
    });
    for (const marketRiskPremium of [-0.1, -0.02, 0, 0.05, 0.12, 0.2])
      expect(
        parseForwardAssumptions({ ...base, marketRiskPremium }).marketRiskPremium,
      ).toBe(marketRiskPremium);
  });

  it("rejects (never clamps) a Market Risk Premium outside −10% to +20%, and explains the range", () => {
    for (const marketRiskPremium of [
      -0.10000001, 0.20000001, 0.25, 5, -1, -2, NaN, Infinity, -Infinity, "5",
    ])
      expect(
        invalid(() => parseForwardAssumptions({ ...base, marketRiskPremium })),
      ).toMatch(/must be between −10\.00% and \+20\.00%/);
  });

  it("rejects missing and unknown fields (tau is not a user setting)", () => {
    invalid(() =>
      parseForwardAssumptions({ riskWindow: "3Y", marketProxy: "VTI" }),
    );
    expect(
      invalid(() => parseForwardAssumptions({ ...base, tau: 0.025 })),
    ).toMatch(/tau/);
  });
});

describe("view validation", () => {
  const view = { source: "manual", manualReturn: 0.115, confidence: 0.6 };

  it("accepts absolute views on canonical tickers", () => {
    expect(
      parseViewState({
        AAPL: view,
        "BRK-B": { source: "street", manualReturn: null, confidence: 0.5 },
        MSFT: { source: "none", manualReturn: 0.08, confidence: 0 },
      }),
    ).toEqual({
      AAPL: view,
      "BRK-B": { source: "street", manualReturn: null, confidence: 0.5 },
      MSFT: { source: "none", manualReturn: 0.08, confidence: 0 },
    });
  });

  it("keeps confidence within 0–100%, inclusive of both ends", () => {
    for (const confidence of [0, 0.5, 1])
      expect(parseViewState({ AAPL: { ...view, confidence } }).AAPL.confidence).toBe(
        confidence,
      );
    for (const confidence of [-0.01, 1.01, NaN, Infinity, "0.5"])
      expect(
        invalid(() => parseViewState({ AAPL: { ...view, confidence } })),
      ).toMatch(/AAPL\.confidence/);
  });

  it("requires a manual value only when the manual view is selected", () => {
    expect(
      invalid(() =>
        parseViewState({ AAPL: { ...view, manualReturn: null } }),
      ),
    ).toMatch(/manual view needs a 12M Expected Total Return/);
    expect(
      parseViewState({
        AAPL: { source: "street", manualReturn: null, confidence: 0.5 },
      }).AAPL.source,
    ).toBe("street");
  });

  it("accepts a 12M Expected Total Return above −100% and up to +200%", () => {
    expect(FORWARD_METHODOLOGY.views.manualReturnRange).toEqual({
      exclusiveMin: -1,
      max: 2,
    });
    for (const manualReturn of [-0.99, -0.25, 0, 0.115, 1.5, 2])
      expect(
        parseViewState({ AAPL: { ...view, manualReturn } }).AAPL.manualReturn,
      ).toBe(manualReturn);
  });

  it("rejects (never clamps) manual views at or below −100% or above +200%, and explains the range", () => {
    for (const manualReturn of [-1, -1.5, 2.0000001, 100, NaN, Infinity])
      expect(
        invalid(() => parseViewState({ AAPL: { ...view, manualReturn } })),
      ).toMatch(
        /12M Expected Total Return must be greater than −100\.00% and at most \+200\.00%/,
      );
  });

  it("rejects non-canonical keys, CASH and unknown view sources or fields", () => {
    for (const key of ["aapl", " AAPL", "CASH", "BRK.B", "__proto__", ""])
      invalid(() => parseViewState({ [key]: view }));
    invalid(() => parseViewState({ AAPL: { ...view, source: "ai" } }));
    invalid(() => parseViewState({ AAPL: { ...view, weight: 0.1 } }));
  });
});

describe("forwardReducer", () => {
  const start = defaultForwardState();

  it("updates assumptions immutably", () => {
    const a = forwardReducer(start, { type: "riskWindow", value: "5Y" });
    const b = forwardReducer(a, { type: "marketProxy", value: "VT" });
    const c = forwardReducer(b, { type: "marketRiskPremium", value: 0.045 });
    expect(c.assumptions).toEqual({
      riskWindow: "5Y",
      marketProxy: "VT",
      marketRiskPremium: 0.045,
    });
    expect(start).toEqual(defaultForwardState());
    expect(a.assumptions.marketProxy).toBe("VTI");
  });

  it("refuses invalid dispatches instead of storing them", () => {
    invalid(() =>
      forwardReducer(start, {
        type: "marketProxy",
        value: "BND" as never,
      }),
    );
    invalid(() =>
      forwardReducer(start, { type: "marketRiskPremium", value: NaN }),
    );
    invalid(() =>
      forwardReducer(start, {
        type: "view",
        ticker: "CASH",
        patch: { source: "manual", manualReturn: 0.04 },
      }),
    );
    expect(start).toEqual(defaultForwardState());
  });

  it("merges view patches from the default view and keeps the manual value when switching source", () => {
    const manual = forwardReducer(start, {
      type: "view",
      ticker: "AAPL",
      patch: { source: "manual", manualReturn: 0.115 },
    });
    expect(manual.views.AAPL).toEqual({
      source: "manual",
      manualReturn: 0.115,
      confidence: 0.5,
    });
    const street = forwardReducer(manual, {
      type: "view",
      ticker: "AAPL",
      patch: { source: "street", confidence: 0.6 },
    });
    expect(street.views.AAPL).toEqual({
      source: "street",
      manualReturn: 0.115,
      confidence: 0.6,
    });
    expect(manual.views.AAPL.source).toBe("manual");
  });

  it("clears one view and resets assumptions without touching views", () => {
    const s = forwardReducer(
      forwardReducer(
        forwardReducer(start, {
          type: "view",
          ticker: "AAPL",
          patch: { source: "manual", manualReturn: 0.1 },
        }),
        {
          type: "view",
          ticker: "MSFT",
          patch: { source: "street" },
        },
      ),
      { type: "marketRiskPremium", value: 0.07 },
    );
    const cleared = forwardReducer(s, { type: "clearView", ticker: "AAPL" });
    expect(Object.keys(cleared.views)).toEqual(["MSFT"]);
    expect(Object.keys(s.views)).toEqual(["AAPL", "MSFT"]);
    const reset = forwardReducer(s, { type: "resetAssumptions" });
    expect(reset.assumptions).toEqual(DEFAULT_FORWARD_ASSUMPTIONS);
    expect(reset.views).toEqual(s.views);
  });

  it("validates a replaced state as a whole", () => {
    const next: ForwardAssumptionState = {
      assumptions: { riskWindow: "1Y", marketProxy: "SPY", marketRiskPremium: 0.06 },
      views: { NVDA: { source: "manual", manualReturn: 0.2, confidence: 1 } },
    };
    expect(forwardReducer(start, { type: "replace", state: next })).toEqual(next);
    invalid(() =>
      forwardReducer(start, {
        type: "replace",
        state: { ...next, views: { nvda: next.views.NVDA } },
      }),
    );
  });
});

describe("local persistence of the shared assumption state", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };
  const state: ForwardAssumptionState = {
    assumptions: { riskWindow: "5Y", marketProxy: "VT", marketRiskPremium: 0.055 },
    views: {
      AAPL: { source: "street", manualReturn: 0.115, confidence: 0.6 },
      "BRK-B": { source: "manual", manualReturn: 0.07, confidence: 1 },
    },
  };

  it("round-trips under a versioned key", () => {
    const storage = memory();
    expect(persistForwardState(storage, state)).toBe(true);
    expect(JSON.parse(storage.data.get(FORWARD_STORAGE_KEY)!).version).toBe(1);
    expect(restoreForwardState(storage)).toEqual({ state, notice: null });
  });

  it("starts from the defaults, silently, when nothing is stored", () => {
    expect(restoreForwardState(memory())).toEqual({
      state: defaultForwardState(),
      notice: null,
    });
  });

  it("restores the defaults with a notice for corrupt, unsupported or invalid data", () => {
    for (const raw of [
      "bad",
      "{}",
      JSON.stringify({ version: 2, state }),
      JSON.stringify({ version: 1, state: { ...state, extra: true } }),
      JSON.stringify({
        version: 1,
        state: {
          ...state,
          assumptions: { ...state.assumptions, marketProxy: "BND" },
        },
      }),
      JSON.stringify({
        version: 1,
        state: {
          ...state,
          views: { AAPL: { source: "manual", manualReturn: null, confidence: 0.5 } },
        },
      }),
    ])
      expect(restoreForwardState({ getItem: () => raw })).toEqual({
        state: defaultForwardState(),
        notice: expect.stringMatching(/Defaults have been restored/),
      });
  });

  it("survives storage that is denied", () => {
    const denied = () => {
      throw new Error("denied");
    };
    expect(restoreForwardState({ getItem: denied }).state).toEqual(
      defaultForwardState(),
    );
    expect(persistForwardState({ setItem: denied }, state)).toBe(false);
  });

  it("never persists an invalid state", () => {
    const storage = memory();
    expect(
      persistForwardState(storage, {
        ...state,
        assumptions: { ...state.assumptions, marketRiskPremium: NaN },
      }),
    ).toBe(false);
    expect(storage.data.size).toBe(0);
  });
});

describe("approved forward labels", () => {
  it("keeps forward and historical statistics distinguishable", () => {
    expect(FORWARD_LABELS.modelBeta).toBe("Forward Model Beta");
    expect(FORWARD_LABELS.modelBetaLong).toBe("Model Beta vs Market Proxy");
    expect(FORWARD_LABELS.historicalBeta).toBe("Historical Beta vs Benchmark");
    expect(FORWARD_LABELS.forwardSharpe).toBe("Forward Model Sharpe");
    expect(FORWARD_LABELS.historicalSharpe).toBe("Historical Sharpe");
    expect(FORWARD_LABELS.scenarioBaseline).toBe("Scenario Baseline");
  });

  it("never calls the Model CAL a CML, and qualifies the market line as a proxy", () => {
    expect(FORWARD_LABELS.modelCal).toBe("Model Capital Allocation Line");
    expect(FORWARD_LABELS.modelCal).not.toMatch(/CML/);
    expect(FORWARD_LABELS.modelCalShort).not.toMatch(/CML/);
    expect(FORWARD_LABELS.marketCmlProxy).toBe("Market CML Proxy");
  });

  it("labels the forward risk-free rate as the latest available 1Y Treasury, never live", () => {
    expect(FORWARD_LABELS.forwardRiskFree).toBe("Forward Risk-Free Rate");
    expect(FORWARD_LABELS.forwardRiskFreeSource).toBe("1Y U.S. Treasury");
    expect(FORWARD_LABELS.latestAvailable).toBe("Latest Available");
    expect(Object.values(FORWARD_LABELS).join(" ")).not.toMatch(/\blive\b/i);
  });

  it("uses the approved Street and extension wording", () => {
    expect(FORWARD_LABELS.manualView).toBe("12M Expected Total Return");
    expect(FORWARD_LABELS.streetReturn).toBe(
      "12M Price-Target Return · Dividends Excluded",
    );
    expect(FORWARD_LABELS.ratingsCounted).toBe("Ratings Counted");
    expect(FORWARD_LABELS.retrieved).toBe("Retrieved");
    expect(FORWARD_LABELS.borrowingExtension).toBe(
      "Requires borrowing/leverage at the assumed risk-free rate and is outside the lab's modeled allocation constraints.",
    );
    const all = Object.values(FORWARD_LABELS).join(" ");
    expect(all).not.toMatch(/undervalued|overvalued|\balpha\b/i);
  });
});

it("parses a complete state through the shared schema", () => {
  expect(parseForwardState(defaultForwardState())).toEqual(
    defaultForwardState(),
  );
});
