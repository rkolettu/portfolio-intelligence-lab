import { expect, it } from "vitest";
import { YahooProvider } from "@/lib/market-data/providers/yahoo";
const raw = {
  chart: {
    error: null,
    result: [
      {
        meta: {
          symbol: "SPY",
          currency: "USD",
          exchangeName: "PCX",
          exchangeTimezoneName: "America/New_York",
          instrumentType: "ETF",
          firstTradeDate: 728317800,
          regularMarketPrice: 50,
          regularMarketTime: 1717160400,
        },
        timestamp: [1717075800, 1717162200],
        indicators: {
          quote: [{ close: [100, 50] }],
          adjclose: [{ adjclose: [50, 50] }],
        },
      },
    ],
  },
};
it("uses adjusted prices across a split, without adding distributions or using raw closes", async () => {
  const p = new YahooProvider(async () => Response.json(raw));
  const s = await p.getHistoricalPrices({
    ticker: "SPY",
    startDate: "2024-05-30",
    endDate: "2024-05-31",
    now: "2024-06-01T10:00:00Z",
  });
  expect(s.observations.map((p) => p.adjustedClose)).toEqual([50, 50]);
});
it("excludes partial same-day bars and refuses raw-close substitution", async () => {
  const p = new YahooProvider(async () => Response.json(raw));
  expect(
    (
      await p.getHistoricalPrices({
        ticker: "SPY",
        startDate: "2024-05-30",
        endDate: "2024-05-31",
        now: "2024-05-31T22:00:00Z",
      })
    ).observations,
  ).toHaveLength(1);
  const missing = structuredClone(raw);
  missing.chart.result[0].indicators.adjclose = [];
  await expect(
    new YahooProvider(async () => Response.json(missing)).getHistoricalPrices({
      ticker: "SPY",
      startDate: "2024-05-30",
      endDate: "2024-05-31",
      now: "2024-06-01T10:00:00Z",
    }),
  ).rejects.toThrow("Adjusted history");
});
it("does not use chart range previous-close for a daily price change", async () => {
  const p = new YahooProvider(async () => Response.json(raw));
  const q = await p.getCurrentQuote("SPY", "2024-06-01T10:00:00Z");
  expect(q.previousClose).toBeUndefined();
  expect(q.status).toBe("end_of_day");
});
it("falls back to the latest finalized raw close when a quote is older or missing", async () => {
  const old = structuredClone(raw);
  old.chart.result[0].meta.regularMarketTime = 1717070400;
  old.chart.result[0].meta.regularMarketPrice = 100;
  const q = await new YahooProvider(async () =>
    Response.json(old),
  ).getCurrentQuote("SPY", "2024-06-01T10:00:00Z");
  expect(q.price).toBe(50);
  expect(q.marketTimestamp).toBe("2024-05-31T20:00:00Z");
  expect(q.status).toBe("end_of_day");
});
