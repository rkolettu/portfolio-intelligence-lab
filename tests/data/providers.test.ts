import { expect, it } from "vitest";
import { normalizePrices } from "@/lib/market-data/normalize";
import { historicalWithFallback } from "@/lib/market-data/fallback";
import { DataCache } from "@/lib/server/cache";
import { series } from "../fixtures/helpers";
const request = {
  ticker: "SPY",
  startDate: "2024-05-30",
  endDate: "2024-05-31",
  now: "2024-06-01T00:00:00Z",
};
it("sorts and deduplicates identical dates but rejects conflicting snapshots", () => {
  expect(
    normalizePrices([
      { date: "2024-05-31", adjustedClose: 110 },
      { date: "2024-05-30", adjustedClose: 100 },
      { date: "2024-05-30", adjustedClose: 100 },
    ]),
  ).toEqual([
    { date: "2024-05-30", adjustedClose: 100 },
    { date: "2024-05-31", adjustedClose: 110 },
  ]);
  expect(() =>
    normalizePrices([
      { date: "2024-05-30", adjustedClose: 100 },
      { date: "2024-05-30", adjustedClose: 50 },
    ]),
  ).toThrow();
});
it.each([0, -1, NaN, Infinity])(
  "never substitutes an invalid adjusted price %s",
  (price) =>
    expect(() =>
      normalizePrices([{ date: "2024-05-30", adjustedClose: price }]),
    ).toThrow(),
);
it("uses whole equivalent fallback series with lineage rather than splicing scales", async () => {
  const whole = series("SPY", ["2024-05-30", "2024-05-31"], [50, 55]);
  const value = await historicalWithFallback(
    [
      {
        name: "broken",
        convention: "total_return_aware_adjusted",
        getHistoricalPrices: async () => {
          throw new Error("outage");
        },
      },
      {
        name: "second",
        convention: "total_return_aware_adjusted",
        getHistoricalPrices: async () => ({
          ...whole,
          provenance: { ...whole.provenance, provider: "second" },
        }),
      },
    ],
    request,
  );
  expect(value.observations.map((p) => p.adjustedClose)).toEqual([50, 55]);
  expect(value.provenance.fallbackUsed).toBe(true);
  expect(value.provenance.provider).toBe("second");
  expect(value.provenance.fallbackReason).toContain("broken");
});
it("rejects provider substitution of another security or return convention", async () => {
  await expect(
    historicalWithFallback(
      [
        {
          name: "bad",
          convention: "total_return_aware_adjusted",
          getHistoricalPrices: async () => series("QQQ", ["2024-05-30"], [50]),
        },
      ],
      request,
    ),
  ).rejects.toThrow();
});
it("deduplicates concurrent work, expires, and does not cache failures", async () => {
  let now = 0;
  let count = 0;
  const cache = new DataCache(2, () => now);
  const load = async () => ++count;
  const values = await Promise.all([
    cache.get("x", 1000, load),
    cache.get("x", 1000, load),
  ]);
  expect(values.map((v) => v.value)).toEqual([1, 1]);
  now = 500;
  expect((await cache.get("x", 1000, load)).ageSeconds).toBe(0.5);
  now = 1001;
  expect((await cache.get("x", 1000, load)).value).toBe(2);
  await expect(
    cache.get("failed", 1000, async () => {
      throw new Error("outage");
    }),
  ).rejects.toThrow();
  expect((await cache.get("failed", 1000, async () => 3)).value).toBe(3);
});
