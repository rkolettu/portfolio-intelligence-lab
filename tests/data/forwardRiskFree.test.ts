import { describe, expect, it } from "vitest";
import { FredProvider } from "@/lib/treasury-data/historical";
import {
  FallbackTreasuryProvider,
  TreasuryGovProvider,
} from "@/lib/treasury-data/treasuryGov";
import type { TreasuryProvider } from "@/lib/treasury-data/types";
import { DataCache } from "@/lib/server/cache";
import { currentTreasury, type DataServices } from "@/lib/server/analyze";
import {
  FORWARD_RISK_FREE_CACHE_KEY,
  forwardRiskFreeReading,
} from "@/lib/server/forward";
import { forwardRiskFree } from "@/lib/forward/riskFree";
import { PROVIDER_POLICY } from "@/config/providers";
import { LabError } from "@/lib/utils/errors";
import type {
  LatestTreasuryYield,
  Provenance,
  Result,
  TreasuryCurve,
} from "@/lib/types/data";

const NOW = "2024-06-04T15:00:00Z"; // New York date 2024-06-04
const TODAY = "2024-06-04";

/** FRED fixture: one CSV per series id; DGS10 has no 2024-06-03 observation, so the
 * curve's latest COMMON date is 2024-05-31 while DGS1's latest is 2024-06-03. */
const FRED: Record<string, string> = {
  DGS3MO: "2024-05-30,5.47\n2024-05-31,5.46\n2024-06-03,5.46",
  DGS1: "2024-05-30,5.19\n2024-05-31,5.18\n2024-06-03,5.13",
  DGS3: "2024-05-30,4.74\n2024-05-31,4.69\n2024-06-03,4.62",
  DGS5: "2024-05-30,4.58\n2024-05-31,4.52\n2024-06-03,4.47",
  DGS10: "2024-05-30,4.55\n2024-05-31,4.51\n2024-06-03,.",
};
function fred(body: (id: string) => string = (id) => FRED[id]) {
  const urls: string[] = [];
  const provider = new FredProvider(async (url) => {
    urls.push(url);
    const id = new URL(url).searchParams.get("id")!;
    return new Response(`observation_date,${id}\n${body(id)}`, { status: 200 });
  });
  return { provider, urls };
}

const GOV_HEADER = `Date,"1 Mo","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"`;
function gov(files: Record<number, string>) {
  const urls: string[] = [];
  const provider = new TreasuryGovProvider(async (url) => {
    urls.push(url);
    const year = Number(/\/(\d{4})\/all\?/.exec(url)![1]);
    return new Response(`${GOV_HEADER}\n${files[year] ?? ""}`, { status: 200 });
  });
  return { provider, urls };
}

describe("FRED: the latest available official 1Y observation, read on its own", () => {
  it("requests only DGS1, over the same window (and URL) as the curve's 1Y leg", async () => {
    const one = fred();
    await one.provider.getLatestOneYearYield(NOW);
    expect(one.urls).toHaveLength(1);
    const params = new URL(one.urls[0]).searchParams;
    expect(params.get("id")).toBe("DGS1");
    expect(params.get("cosd")).toBe("2024-05-14");
    expect(params.get("coed")).toBe(TODAY);
    const curve = fred();
    await curve.provider.getCurrentCurve(NOW);
    expect(curve.urls).toContain(one.urls[0]);
  });

  it("returns DGS1's latest date even when the curve's common date is older", async () => {
    const { provider } = fred();
    const latest = await provider.getLatestOneYearYield(NOW);
    expect(latest).toMatchObject({
      series: "DGS1",
      maturity: "1Y",
      observationDate: "2024-06-03",
      annualYield: 0.0513,
    });
    expect(latest.provenance.provider).toBe("Federal Reserve H.15 via FRED");
    expect(latest.provenance.observationDate).toBe("2024-06-03");
    expect(latest.provenance.fallbackUsed).toBe(false);
    expect(latest.provenance.warnings.join(" ")).toMatch(
      /12-month risk-free proxy, not a guaranteed realized holding-period return/,
    );
    // The existing full curve is unchanged: every maturity on the latest common date.
    const curve = await provider.getCurrentCurve(NOW);
    expect(curve.points.map((p) => p.date)).toEqual(Array(5).fill("2024-05-31"));
    expect(curve.points.find((p) => p.maturity === "1Y")?.annualYield).toBe(0.0518);
    expect(curve.provenance.warnings).toEqual([
      "Latest common official observation; informational context only.",
    ]);
  });

  it("skips unpublished ('.') values and never uses an observation dated after today", async () => {
    const missing = fred(() => "2024-05-30,5.19\n2024-05-31,5.18\n2024-06-03,.");
    expect(
      (await missing.provider.getLatestOneYearYield(NOW)).observationDate,
    ).toBe("2024-05-31");
    const future = fred(() => "2024-05-31,5.18\n2024-06-03,5.13\n2024-06-05,4.90");
    const latest = await future.provider.getLatestOneYearYield(NOW);
    expect(latest.observationDate).toBe("2024-06-03");
    expect(latest.annualYield).toBe(0.0513);
  });

  it("reports a typed, retryable outage when DGS1 has no recent observation", async () => {
    const { provider } = fred(() => "");
    await expect(provider.getLatestOneYearYield(NOW)).rejects.toMatchObject({
      detail: { code: "TREASURY_UNAVAILABLE", retryable: true },
    });
  });

  it("never accepts another maturity's data in place of DGS1", async () => {
    const provider = new FredProvider(
      async () =>
        new Response("observation_date,DGS3MO\n2024-06-03,5.46", { status: 200 }),
    );
    await expect(provider.getLatestOneYearYield(NOW)).rejects.toMatchObject({
      detail: { code: "MALFORMED_DATA" },
    });
  });
});

describe("U.S. Treasury Daily Par Yield Curve: the 1 Yr column only", () => {
  it("reads the latest 1 Yr value from the current year's file, with fallback provenance", async () => {
    const { provider, urls } = gov({
      2024: "06/03/2024,5.49,5.48,5.46,5.42,5.36,5.13,4.82,4.62,4.47,4.47,4.41,4.67,4.55\n05/31/2024,5.48,5.47,5.46,5.43,5.40,5.18,4.89,4.69,4.52,4.51,4.51,4.74,4.65",
    });
    const latest = await provider.getLatestOneYearYield(NOW);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/2024/all?type=daily_treasury_yield_curve");
    expect(latest).toMatchObject({
      series: "DGS1",
      maturity: "1Y",
      observationDate: "2024-06-03",
      annualYield: 0.0513,
    });
    expect(latest.provenance.fallbackUsed).toBe(true);
    expect(latest.provenance.warnings).toEqual([
      expect.stringMatching(/12-month risk-free proxy/),
      "Read from the U.S. Treasury's Daily Par Yield Curve because FRED was unreachable.",
    ]);
  });

  it("spans the year boundary in early January and skips N/A values", async () => {
    const { provider, urls } = gov({
      2024: "12/31/2024,4.37,4.36,4.37,4.32,4.24,4.16,4.25,4.27,4.38,4.48,4.58,4.86,4.78",
      2025: "01/03/2025,4.38,4.36,4.36,4.33,4.25,N/A,4.28,4.31,4.41,4.52,4.60,4.86,4.82\n01/02/2025,4.37,4.36,4.35,4.32,4.25,4.17,4.28,4.31,4.38,4.47,4.57,4.86,4.79",
    });
    const latest = await provider.getLatestOneYearYield("2025-01-03T22:00:00Z");
    expect(urls.map((u) => /\/(\d{4})\/all/.exec(u)![1])).toEqual(["2024", "2025"]);
    expect(latest.observationDate).toBe("2025-01-02");
    expect(latest.annualYield).toBe(0.0417);
  });
});

const yieldOf = (provider: string, date = "2024-06-03"): LatestTreasuryYield => ({
  series: "DGS1",
  maturity: "1Y",
  observationDate: date,
  annualYield: 0.0513,
  provenance: { provider, cacheAgeSeconds: 0 } as Provenance,
});
const stub = (name: string, ok: boolean): TreasuryProvider => ({
  name,
  getHistoricalRates: async () => {
    throw new Error("unused");
  },
  getCurrentCurve: async () => {
    throw new Error("unused");
  },
  getLatestOneYearYield: async () => {
    if (!ok) throw new Error(`${name} down`);
    return yieldOf(name);
  },
});

describe("existing FRED → U.S. Treasury fallback", () => {
  it("uses FRED when it answers, the Treasury file only when FRED fails", async () => {
    const both = new FallbackTreasuryProvider(stub("FRED", true), stub("Treasury", true));
    expect((await both.getLatestOneYearYield(NOW)).provenance.provider).toBe("FRED");
    const fredDown = new FallbackTreasuryProvider(stub("FRED", false), stub("Treasury", true));
    expect((await fredDown.getLatestOneYearYield(NOW)).provenance.provider).toBe(
      "Treasury",
    );
    const allDown = new FallbackTreasuryProvider(stub("FRED", false), stub("Treasury", false));
    await expect(allDown.getLatestOneYearYield(NOW)).rejects.toThrow("Treasury down");
  });
});

describe("cached server read", () => {
  function services(read: () => Promise<LatestTreasuryYield>) {
    let clock = Date.parse(NOW);
    const calls = { oneYear: 0, curve: 0 };
    const data: DataServices = {
      history: [],
      quotes: null,
      treasury: {
        name: "fixture",
        getHistoricalRates: async () => {
          throw new Error("unused");
        },
        getCurrentCurve: async () => {
          calls.curve++;
          return {
            points: [],
            mixedDates: false,
            provenance: { provider: "curve", cacheAgeSeconds: 0 },
          } as unknown as TreasuryCurve;
        },
        getLatestOneYearYield: async () => {
          calls.oneYear++;
          return read();
        },
      },
      cache: new DataCache(128, () => clock),
    };
    return { data, calls, advance: (ms: number) => (clock += ms) };
  }

  it("uses its own cache key with the Treasury TTL, adding the cache age", async () => {
    expect(FORWARD_RISK_FREE_CACHE_KEY).toBe("fred:latest-DGS1:v1");
    const s = services(async () => yieldOf("FRED"));
    const first = await forwardRiskFreeReading(NOW, s.data);
    expect(first).toEqual({ ok: true, value: yieldOf("FRED") });
    s.advance(60_000);
    const second = await forwardRiskFreeReading(NOW, s.data);
    expect(s.calls.oneYear).toBe(1);
    expect(second.ok && second.value.provenance.cacheAgeSeconds).toBe(60);
    s.advance(PROVIDER_POLICY.treasuryTtlMs);
    await forwardRiskFreeReading(NOW, s.data);
    expect(s.calls.oneYear).toBe(2);
  });

  it("never reads (or is served by) the current curve, which keeps its own key", async () => {
    const s = services(async () => yieldOf("FRED"));
    await forwardRiskFreeReading(NOW, s.data);
    expect(s.calls).toEqual({ oneYear: 1, curve: 0 });
    const curve: Result<TreasuryCurve> = await currentTreasury(NOW, s.data);
    expect(curve.ok && curve.value.provenance.provider).toBe("curve");
    expect(s.calls).toEqual({ oneYear: 1, curve: 1 });
  });

  it("returns typed failures without caching them", async () => {
    const s = services(async () => {
      throw new LabError({
        code: "TREASURY_UNAVAILABLE",
        message: "No official 1-year Treasury (DGS1) observation is available.",
        retryable: true,
      });
    });
    const r = await forwardRiskFreeReading(NOW, s.data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TREASURY_UNAVAILABLE");
    await forwardRiskFreeReading(NOW, s.data);
    expect(s.calls.oneYear).toBe(2);
  });
});

describe("forward risk-free outcome (pure)", () => {
  it("exposes the rate, observation date, source and provenance unchanged", () => {
    const reading = yieldOf("Federal Reserve H.15 via FRED");
    expect(forwardRiskFree({ ok: true, value: reading }, TODAY)).toEqual({
      available: true,
      value: reading,
    });
  });

  it("makes the forward model unavailable, never substituting 3M, when the read fails", () => {
    const out = forwardRiskFree(
      {
        ok: false,
        error: {
          code: "TREASURY_UNAVAILABLE",
          message: "No recent common official Treasury curve date is available.",
          retryable: true,
        },
      },
      TODAY,
    );
    expect(out.available).toBe(false);
    if (!out.available)
      expect(out.reason).toMatch(/3-month rate is never substituted/);
  });

  it("rejects another maturity, a future-dated observation and an invalid yield", () => {
    const good = yieldOf("FRED");
    const bad: LatestTreasuryYield[] = [
      { ...good, series: "DGS3MO" as never },
      { ...good, maturity: "3M" as never },
      { ...good, observationDate: "2024-06-05" },
      { ...good, observationDate: "2024-13-01" },
      { ...good, annualYield: NaN },
      { ...good, annualYield: -1 },
    ];
    for (const value of bad) {
      const out = forwardRiskFree({ ok: true, value }, TODAY);
      expect(out.available).toBe(false);
      if (!out.available) expect(out.reason).toMatch(/never substituted/);
    }
  });
});
