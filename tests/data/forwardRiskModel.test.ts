import { describe, expect, it } from "vitest";
import { loadForwardRiskModel } from "@/lib/server/forward";
import { buildForwardRiskModel } from "@/lib/forward/riskModel";
import { DataCache } from "@/lib/server/cache";
import type { DataServices } from "@/lib/server/analyze";
import type { HistoryRequest } from "@/lib/market-data/types";
import { LabError } from "@/lib/utils/errors";
import { DEFAULT_FORWARD_ASSUMPTIONS } from "@/lib/forward/assumptions";
import { FORWARD_NOW, fixtureSeries } from "../fixtures/forward";

function services(fail: string[] = []) {
  const requests: HistoryRequest[] = [];
  const data: DataServices = {
    history: [
      {
        name: "fixture",
        convention: "total_return_aware_adjusted",
        getHistoricalPrices: async (r) => {
          requests.push(r);
          if (fail.includes(r.ticker))
            throw new LabError({
              code: "TICKER_NOT_FOUND",
              message: `No history found for ${r.ticker}.`,
              ticker: r.ticker,
              retryable: false,
            });
          return fixtureSeries(r.ticker);
        },
      },
    ],
    quotes: null,
    treasury: {
      name: "fixture",
      getHistoricalRates: async () => {
        throw new Error("unused");
      },
      getCurrentCurve: async () => {
        throw new Error("unused");
      },
      getLatestOneYearYield: async () => {
        throw new Error("unused");
      },
    },
    cache: new DataCache(),
  };
  return { data, requests };
}

describe("loadForwardRiskModel", () => {
  it("loads universe ∪ proxy once over the requested window and replays exactly", async () => {
    const s = services();
    const { outcome, snapshot } = await loadForwardRiskModel(
      { universe: ["BBB", "AAA", "CCC"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS },
      FORWARD_NOW,
      s.data,
    );
    expect(s.requests.map((r) => r.ticker).sort()).toEqual(["AAA", "BBB", "CCC", "VTI"]);
    expect(new Set(s.requests.map((r) => `${r.startDate}→${r.endDate}`))).toEqual(
      new Set(["2021-06-03→2024-06-03"]),
    );
    expect(outcome.available).toBe(true);
    expect(snapshot).not.toBeNull();
    expect(
      buildForwardRiskModel({
        ...snapshot!,
        universe: ["BBB", "AAA", "CCC"],
        marketProxy: "VTI",
        riskWindow: "3Y",
      }),
    ).toEqual(outcome);
  });

  it("shares the history cache: a second load fetches nothing", async () => {
    const s = services();
    const args = { universe: ["AAA"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS };
    await loadForwardRiskModel(args, FORWARD_NOW, s.data);
    const first = s.requests.length;
    await loadForwardRiskModel(args, FORWARD_NOW, s.data);
    expect(s.requests.length).toBe(first);
  });

  it("uses the selected proxy and window", async () => {
    const s = services();
    const { outcome } = await loadForwardRiskModel(
      {
        universe: ["AAA"],
        assumptions: { riskWindow: "1Y", marketProxy: "SPY", marketRiskPremium: 0.05 },
      },
      FORWARD_NOW,
      s.data,
    );
    expect(s.requests.map((r) => r.ticker).sort()).toEqual(["AAA", "SPY"]);
    expect(s.requests[0].startDate).toBe("2023-06-03");
    expect(outcome.available && outcome.model.marketProxy).toBe("SPY");
  });

  it("reports a proxy that cannot be loaded as a typed unavailable model", async () => {
    const { outcome } = await loadForwardRiskModel(
      { universe: ["AAA"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS },
      FORWARD_NOW,
      services(["VTI"]).data,
    );
    expect(outcome).toMatchObject({
      available: false,
      code: "history_unavailable",
      tickers: ["VTI"],
    });
  });

  it("is unavailable, without fetching, when no history provider is qualified", async () => {
    const s = services();
    s.data.history = [];
    const { outcome } = await loadForwardRiskModel(
      { universe: ["AAA"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS },
      FORWARD_NOW,
      s.data,
    );
    expect(outcome.available).toBe(false);
    if (!outcome.available) {
      expect(outcome.code).toBe("history_unavailable");
      expect(outcome.reason).toMatch(/no market-data provider has been qualified/);
    }
  });

  it("refuses invalid assumptions or tickers before any fetch", async () => {
    const s = services();
    for (const input of [
      { universe: ["AAA"], assumptions: { ...DEFAULT_FORWARD_ASSUMPTIONS, marketProxy: "BND" as never } },
      { universe: ["AAA", "CASH"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS },
      { universe: ["aaa"], assumptions: DEFAULT_FORWARD_ASSUMPTIONS },
    ]) {
      const { outcome, snapshot } = await loadForwardRiskModel(input, FORWARD_NOW, s.data);
      expect(outcome.available).toBe(false);
      if (!outcome.available) expect(outcome.code).toBe("invalid_inputs");
      expect(snapshot).toBeNull();
    }
    expect(s.requests).toHaveLength(0);
  });
});
