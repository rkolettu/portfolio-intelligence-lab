import { describe, expect, it } from "vitest";
import type { DataServices } from "@/lib/server/analyze";
import { construct } from "@/lib/server/construction";
import { runConstruction } from "@/lib/backtest/construction";
import { DataCache } from "@/lib/server/cache";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { HistoryRequest } from "@/lib/market-data/types";
import { addDays } from "@/lib/utils/dates";
import { normalizeQuote } from "@/lib/market-data/quotes";
import { provenance, series } from "../fixtures/helpers";

const NOW = "2026-09-29T12:00:00Z";
const FAR = "2100-01-01T00:00:00Z";
const config = {
  holdings: [
    { ticker: "SPY", weight: 0.6 },
    { ticker: "BND", weight: 0.3 },
    { ticker: "GLD", weight: 0 },
    { ticker: "CASH", weight: 0.1 },
  ],
  benchmark: "VT",
  requestedStartDate: "2024-09-27",
  endDate: "2026-09-28",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
const body = (extra: Record<string, unknown> = {}) => ({
  config,
  constraints: [],
  cash: { mode: "current" },
  ...extra,
});
function services(options: { failing?: string[]; quote?: number } = {}) {
  const history: HistoryRequest[] = [];
  const data: DataServices = {
    history: [
      {
        name: "fixture",
        convention: "total_return_aware_adjusted",
        getHistoricalPrices: async (r) => {
          history.push(r);
          if (options.failing?.includes(r.ticker))
            throw new Error("upstream outage");
          const days = sessionsBetween(
            addDays(r.startDate, -10),
            r.endDate,
            FAR,
          );
          const seed = r.ticker.charCodeAt(0) / 40;
          return series(
            r.ticker,
            days.map((d) => d.date),
            days.map(
              (_, i) => 100 * Math.exp(0.012 * Math.sin(i * seed) + 0.0002 * i),
            ),
          );
        },
      },
    ],
    quotes: {
      name: "fixture",
      getCurrentQuote: async (ticker, now) =>
        normalizeQuote(
          {
            ticker,
            price: options.quote ?? 100,
            marketTimestamp: now,
            fetchedAt: now,
            provider: "fixture",
            session: "regular",
          },
          now,
        ),
    },
    treasury: {
      name: "fixture",
      getHistoricalRates: async (start, end) => ({
        series: "DGS3MO",
        observations: sessionsBetween(addDays(start, -14), end, FAR).map(
          (s) => ({
            date: s.date,
            annualYield: 0.03,
            availableAt: `${addDays(s.date, 1)}T12:00:00Z`,
            availability: "modeled" as const,
          }),
        ),
        provenance,
      }),
      getCurrentCurve: async () => {
        throw new Error("unused");
      },
    },
    cache: new DataCache(),
  };
  return { data, history };
}

describe("construction service", () => {
  it("fetches every eligible ticker, zero weights included, on the analysis window and the stress span", async () => {
    const s = services();
    const r = await construct(body(), NOW, s.data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const spans = (t: string) =>
      s.history
        .filter((h) => h.ticker === t)
        .map((h) => `${h.startDate}:${h.endDate}`)
        .sort();
    for (const t of ["SPY", "BND", "GLD", "VT"])
      expect(spans(t)).toEqual([
        "2007-10-09:2022-12-30",
        "2024-09-27:2026-09-28",
      ]);
    expect(r.value.inputs.universe).toEqual(["SPY", "BND", "GLD"]);
    expect(r.value.proposals.every((p) => p.status === "success")).toBe(true);
    const replay = runConstruction({
      config: r.value.config,
      constraints: r.value.inputs.constraints,
      cash: r.value.inputs.cash,
      ...r.value.snapshot,
      now: r.value.metadata.generatedAt,
    });
    expect(replay.metadata.snapshotHash).toBe(r.value.metadata.snapshotHash);
    expect(replay.proposals).toEqual(r.value.proposals);
  });

  it("fails explicitly when an eligible asset's history cannot be fetched (never dropped)", async () => {
    const r = await construct(body(), NOW, services({ failing: ["GLD"] }).data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ticker).toBe("GLD");
  });

  it("isolates a benchmark outage to benchmark-relative comparison metrics", async () => {
    const r = await construct(body(), NOW, services({ failing: ["VT"] }).data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mv = r.value.proposals.find((p) => p.method === "minimum_variance")!;
    expect(mv.status).toBe("success");
    if (mv.historical.available) {
      expect(mv.historical.sharpe.available).toBe(true);
      expect(mv.historical.beta.available).toBe(false);
    }
  });

  it("does not depend on current quotes", async () => {
    const a = await construct(body(), NOW, services({ quote: 100 }).data);
    const b = await construct(body(), NOW, services({ quote: 250 }).data);
    if (!a.ok || !b.ok) throw new Error("fixture");
    expect(b.value.proposals).toEqual(a.value.proposals);
  });

  it("validates the request shape and constraint tickers", async () => {
    for (const bad of [
      null,
      { config, constraints: [] },
      body({ extra: true }),
      body({ cash: { mode: "fixed" } }),
      body({
        constraints: [
          { ticker: "SPY", minWeight: 0, maxWeight: 1, required: false },
          { ticker: "SPY", minWeight: 0, maxWeight: 1, required: false },
        ],
      }),
      body({
        constraints: [
          { ticker: "QQQ", minWeight: 0, maxWeight: 1, required: false },
        ],
      }),
    ]) {
      const r = await construct(bad, NOW, services().data);
      expect(r.ok ? "ok" : r.error.code).toBe("INVALID_INPUT");
    }
  });

  it("requires a qualified provider for equity holdings", async () => {
    const r = await construct(body(), NOW, { ...services().data, history: [] });
    expect(r.ok ? "ok" : r.error.code).toBe("UNQUALIFIED_PROVIDER");
  });

  describe("all-CASH with an unavailable zero-weight candidate", () => {
    const cashConfig = {
      ...config,
      holdings: [
        { ticker: "GLD", weight: 0 },
        { ticker: "CASH", weight: 1 },
      ],
    };

    it("constructs the all-CASH comparison without the candidate's history", async () => {
      const r = await construct(
        body({ config: cashConfig }),
        NOW,
        services({ failing: ["GLD"] }).data,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const m of [
        "equal_weight",
        "inverse_volatility",
        "minimum_variance",
      ]) {
        const p = r.value.proposals.find((x) => x.method === m)!;
        expect(p.status).toBe("success");
        expect(p.historical.available).toBe(true);
        expect(p.modelRisk).toMatchObject({ available: true, volatility: 0 });
      }
      expect(
        r.value.proposals.find((x) => x.method === "equal_risk_contribution")!
          .status,
      ).toBe("invalid_inputs");
      expect(r.value.current.historical.available).toBe(true);
    });

    it("still fails when the current portfolio holds the missing asset", async () => {
      const r = await construct(
        body({
          config: {
            ...config,
            holdings: [
              { ticker: "GLD", weight: 0.5 },
              { ticker: "CASH", weight: 0.5 },
            ],
          },
          cash: { mode: "fixed", weight: 1 },
        }),
        NOW,
        services({ failing: ["GLD"] }).data,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.ticker).toBe("GLD");
    });

    it("still fails when a proposal can hold the missing asset", async () => {
      const r = await construct(
        body({ config: cashConfig, cash: { mode: "fixed", weight: 0.5 } }),
        NOW,
        services({ failing: ["GLD"] }).data,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.ticker).toBe("GLD");
    });
  });

  it("returns a typed INVALID_INPUT for more than 20 risky holdings", async () => {
    const holdings = [
      ...Array.from({ length: 21 }, (_, i) => ({
        ticker: `R${String(i + 1).padStart(2, "0")}`,
        weight: 0.9 / 21,
      })),
      { ticker: "CASH", weight: 0.1 },
    ];
    const r = await construct(
      body({ config: { ...config, holdings } }),
      NOW,
      services().data,
    );
    expect(r.ok ? "ok" : r.error.code).toBe("INVALID_INPUT");
  });
});
