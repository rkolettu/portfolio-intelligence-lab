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
it("reports a span entirely before listing as insufficient history, not a provider fault", async () => {
  // Observed live: Yahoo answers a pre-listing range with HTTP 400 and this body.
  let calls = 0;
  const p = new YahooProvider(async () => {
    calls++;
    return Response.json(
      {
        chart: {
          result: null,
          error: {
            code: "Bad Request",
            description:
              "Data doesn't exist for startDate = 1191024000, endDate = 1672531200",
          },
        },
      },
      { status: 400 },
    );
  });
  const request = {
    ticker: "ARM",
    startDate: "2007-10-09",
    endDate: "2022-12-30",
    now: "2026-09-29T12:00:00Z",
  };
  await expect(p.getHistoricalPrices(request)).rejects.toMatchObject({
    detail: {
      code: "INSUFFICIENT_HISTORY",
      ticker: "ARM",
      retryable: false,
    },
  });
  expect(calls).toBe(1);
  const other = new YahooProvider(async () =>
    Response.json(
      {
        chart: {
          result: null,
          error: { code: "Bad Request", description: "Invalid input" },
        },
      },
      { status: 400 },
    ),
  );
  await expect(other.getHistoricalPrices(request)).rejects.toMatchObject({
    detail: { code: "PROVIDER_ERROR" },
  });
});

/** n consecutive weekday bars from 2024-05-01, all at price 20. */
function otcChart(exchangeName: string, volume: number[]) {
  const timestamps: number[] = [];
  for (
    let d = Date.UTC(2024, 4, 1, 13, 30);
    timestamps.length < volume.length;
    d += 86_400_000
  )
    if (![0, 6].includes(new Date(d).getUTCDay())) timestamps.push(d / 1000);
  const chart = structuredClone(raw);
  Object.assign(chart.chart.result[0].meta, {
    symbol: "NSRGY",
    exchangeName,
    instrumentType: "EQUITY",
  });
  chart.chart.result[0].timestamp = timestamps;
  chart.chart.result[0].indicators = {
    quote: [{ close: volume.map(() => 20), volume }] as never,
    adjclose: [{ adjclose: volume.map(() => 20) }],
  };
  return chart;
}
const otcRequest = {
  ticker: "NSRGY",
  startDate: "2024-05-01",
  endDate: "2024-06-28",
  now: "2024-07-01T10:00:00Z",
};
it("accepts OTC tiers and tolerates a few sessions without trades", async () => {
  for (const venue of ["OQX", "OQB", "PNK", "OID"]) {
    const volume = Array.from({ length: 40 }, (_, i) =>
      i % 15 === 0 ? 0 : 900,
    );
    const s = await new YahooProvider(async () =>
      Response.json(otcChart(venue, volume)),
    ).getHistoricalPrices(otcRequest);
    expect(s.exchange).toBe(venue);
    expect(s.observations).toHaveLength(40);
  }
});
it("refuses an OTC history whose prices are mostly stale", async () => {
  const volume = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0 : 900));
  await expect(
    new YahooProvider(async () =>
      Response.json(otcChart("PNK", volume)),
    ).getHistoricalPrices(otcRequest),
  ).rejects.toThrow("too thinly");
});
it("never applies the stale-price check to exchange-listed securities", async () => {
  const chart = otcChart("NYQ", Array(40).fill(0));
  chart.chart.result[0].meta.symbol = "NSRGY";
  const s = await new YahooProvider(async () =>
    Response.json(chart),
  ).getHistoricalPrices(otcRequest);
  expect(s.observations).toHaveLength(40);
});
