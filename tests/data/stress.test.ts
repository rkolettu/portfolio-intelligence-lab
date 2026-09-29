import { describe, expect, it } from "vitest";
import type { DataServices } from "@/lib/server/analyze";
import { stress } from "@/lib/server/stress";
import { runStress } from "@/lib/backtest/stress";
import { DataCache } from "@/lib/server/cache";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { HistoryRequest } from "@/lib/market-data/types";
import { addDays } from "@/lib/utils/dates";
import { provenance, series } from "../fixtures/helpers";

const NOW = "2026-09-29T12:00:00Z";
const FAR = "2100-01-01T00:00:00Z";
const config = {
  holdings: [
    { ticker: "SPY", weight: 0.7 },
    { ticker: "BND", weight: 0.3 },
  ],
  benchmark: "VT",
  requestedStartDate: "2021-09-28",
  endDate: "2026-09-28",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
function services(options: { failing?: string[] } = {}) {
  const history: HistoryRequest[] = [];
  const rates: [string, string][] = [];
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
          const drift = r.ticker === "BND" ? 0.0001 : -0.0003;
          return series(
            r.ticker,
            days.map((d) => d.date),
            days.map(
              (_, i) => 100 * (1 + drift) ** i * (1 + 0.01 * Math.sin(i)),
            ),
          );
        },
      },
    ],
    quotes: null,
    treasury: {
      name: "fixture",
      getHistoricalRates: async (start, end) => {
        rates.push([start, end]);
        return {
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
        };
      },
      getCurrentCurve: async () => {
        throw new Error("unused");
      },
    },
    cache: new DataCache(),
  };
  return { data, history, rates };
}

describe("stress service", () => {
  it("fetches each security once over the fixed preset span and ships a trimmed snapshot", async () => {
    const s = services();
    const r = await stress({ config }, NOW, s.data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      s.history.map((h) => [h.ticker, h.startDate, h.endDate]).sort(),
    ).toEqual([
      ["BND", "2007-10-09", "2022-12-30"],
      ["SPY", "2007-10-09", "2022-12-30"],
      ["VT", "2007-10-09", "2022-12-30"],
    ]);
    expect(s.rates).toEqual([]); // no CASH held
    expect(r.value.events.map((e) => [e.id, e.status])).toEqual([
      ["gfc", "complete"],
      ["covid", "complete"],
      ["rate-shock-2022", "complete"],
    ]);
    const dates = r.value.snapshot.prices[0].observations.map((o) => o.date);
    expect(dates.some((d) => d > "2009-03-09" && d < "2020-02-19")).toBe(false);
    const replay = runStress({
      ...r.value.snapshot,
      config: r.value.config,
      now: r.value.metadata.generatedAt,
    });
    expect(replay.metadata.snapshotHash).toBe(r.value.metadata.snapshotHash);
    expect(replay.events).toEqual(r.value.events);
  });

  it("fetches Treasury history only when CASH is held", async () => {
    const s = services();
    const r = await stress(
      {
        config: {
          ...config,
          holdings: [
            { ticker: "SPY", weight: 0.9 },
            { ticker: "CASH", weight: 0.1 },
          ],
        },
      },
      NOW,
      s.data,
    );
    expect(r.ok).toBe(true);
    expect(s.rates).toEqual([["2007-10-09", "2022-12-30"]]);
    if (r.ok)
      expect(r.value.events.every((e) => e.status === "complete")).toBe(true);
  });

  it("runs a single validated Custom Historical Window over its own span", async () => {
    const s = services();
    const r = await stress(
      { config, window: { startDate: "2018-10-01", endDate: "2018-12-24" } },
      NOW,
      s.data,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.events).toHaveLength(1);
    expect(r.value.events[0]).toMatchObject({
      id: "custom",
      kind: "custom",
      name: "Custom Historical Window",
      status: "complete",
    });
    expect(
      new Set(s.history.map((h) => `${h.startDate}:${h.endDate}`)),
    ).toEqual(new Set(["2018-10-01:2018-12-24"]));
  });

  it("rejects malformed requests and invalid custom windows", async () => {
    for (const body of [
      null,
      { config, extra: 1 },
      { config, window: { startDate: "2018-12-24", endDate: "2018-10-01" } },
      { config, window: { startDate: "2008-01-01", endDate: "2019-01-01" } },
      { config: { ...config, holdings: [] } },
    ]) {
      const r = await stress(body, NOW, services().data);
      expect(r.ok ? "ok" : r.error.code).toBe("INVALID_INPUT");
    }
  });

  it("isolates a benchmark outage to benchmark and active results", async () => {
    const r = await stress({ config }, NOW, services({ failing: ["VT"] }).data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const e of r.value.events) {
      expect(e.status).toBe("complete");
      if (e.status !== "complete") continue;
      expect(e.portfolioReturn.available).toBe(true);
      expect(e.benchmarkReturn.available).toBe(false);
      expect(e.activeReturn.available).toBe(false);
    }
  });

  it("reports a holding fetch failure per event rather than failing the request", async () => {
    const r = await stress(
      { config },
      NOW,
      services({ failing: ["BND"] }).data,
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.events.map((e) => e.status)).toEqual([
        "unavailable",
        "unavailable",
        "unavailable",
      ]);
  });

  it("requires a qualified provider for equity holdings", async () => {
    const s = services();
    const r = await stress({ config }, NOW, { ...s.data, history: [] });
    expect(r.ok ? "ok" : r.error.code).toBe("UNQUALIFIED_PROVIDER");
  });
});
