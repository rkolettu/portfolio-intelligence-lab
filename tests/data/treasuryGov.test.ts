import { expect, it } from "vitest";
import {
  FallbackTreasuryProvider,
  TreasuryGovProvider,
  parseTreasuryGovCsv,
} from "@/lib/treasury-data/treasuryGov";
import type { TreasuryProvider } from "@/lib/treasury-data/types";

const csv = `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
06/03/2024,5.49,5.48,5.48,5.46,5.42,5.36,5.13,4.82,4.62,4.47,4.47,4.41,4.67,4.55
05/31/2024,5.48,5.47,5.47,5.46,5.43,5.40,5.18,4.89,4.69,4.52,4.51,4.51,4.74,4.65
05/30/2024,5.48,5.47,5.47,5.47,5.43,5.40,5.19,4.93,4.74,4.58,4.58,4.55,4.78,4.69`;

it("reads the 3-month column as DGS3MO, in date order, with modeled availability", () => {
  const rows = parseTreasuryGovCsv(csv, "DGS3MO");
  expect(rows.map((r) => r.date)).toEqual(["2024-05-30", "2024-05-31", "2024-06-03"]);
  expect(rows.map((r) => r.annualYield)).toEqual([0.0547, 0.0546, 0.0546]);
  expect(rows[0].availability).toBe("modeled");
  expect(parseTreasuryGovCsv(csv, "DGS10")[0].annualYield).toBeCloseTo(0.0455, 12);
});

it("rejects an unexpected schema instead of guessing a column", () => {
  expect(() => parseTreasuryGovCsv("Date,Foo\n05/30/2024,1", "DGS3MO")).toThrow();
});

it("fetches each needed year once and filters to the window", async () => {
  const urls: string[] = [];
  const provider = new TreasuryGovProvider(async (url) => {
    urls.push(url);
    return new Response(csv, { status: 200 });
  });
  const s = await provider.getHistoricalRates("2024-05-31", "2024-06-03", "2024-06-04T12:00:00Z");
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("/2024/all?type=daily_treasury_yield_curve");
  expect(s.series).toBe("DGS3MO");
  expect(s.observations.at(-1)?.date).toBe("2024-06-03");
  expect(s.provenance.fallbackUsed).toBe(true);
});

const stub = (name: string, ok: boolean): TreasuryProvider => ({
  name,
  getHistoricalRates: async () => {
    if (!ok) throw new Error(`${name} down`);
    return { series: "DGS3MO", observations: [], provenance: { provider: name } } as never;
  },
  getCurrentCurve: async () => {
    if (!ok) throw new Error(`${name} down`);
    return { provenance: { provider: name } } as never;
  },
});

it("prefers FRED and falls back to the Treasury file only when FRED fails", async () => {
  const both = new FallbackTreasuryProvider(stub("FRED", true), stub("Treasury", true));
  expect((await both.getHistoricalRates("a", "b", "c")).provenance.provider).toBe("FRED");
  const fredDown = new FallbackTreasuryProvider(stub("FRED", false), stub("Treasury", true));
  expect((await fredDown.getHistoricalRates("a", "b", "c")).provenance.provider).toBe("Treasury");
  expect((await fredDown.getCurrentCurve("c")).provenance.provider).toBe("Treasury");
  const allDown = new FallbackTreasuryProvider(stub("FRED", false), stub("Treasury", false));
  await expect(allDown.getHistoricalRates("a", "b", "c")).rejects.toThrow("Treasury down");
});
