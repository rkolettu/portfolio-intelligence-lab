import { expect, it, vi } from "vitest";
import {
  analyze,
  currentQuotes,
  type DataServices,
} from "@/lib/server/analyze";
import { DataCache } from "@/lib/server/cache";
import { fetchPublic } from "@/lib/server/http";
import { handleJson } from "@/lib/server/route";
import { allowRequest } from "@/lib/server/rateLimit";
import { normalizeQuote } from "@/lib/market-data/quotes";
import { series, provenance } from "../fixtures/helpers";
const config = {
  holdings: [{ ticker: "SPY", weight: 1 }],
  benchmark: "VT",
  requestedStartDate: "2024-05-30",
  endDate: "2024-06-03",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
function service(): DataServices {
  return {
    history: [
      {
        name: "fixture",
        convention: "total_return_aware_adjusted",
        getHistoricalPrices: async (r) => {
          if (r.ticker === "VT") throw new Error("benchmark outage");
          return series(
            "SPY",
            ["2024-05-30", "2024-05-31", "2024-06-03"],
            [100, 110, 99],
          );
        },
      },
    ],
    quotes: null,
    treasury: {
      name: "fixture",
      getHistoricalRates: async () => ({
        series: "DGS3MO",
        observations: [],
        provenance,
      }),
      getCurrentCurve: async () => {
        throw new Error("outage");
      },
      getLatestOneYearYield: async () => {
        throw new Error("outage");
      },
    },
    cache: new DataCache(),
  };
}
it("isolates benchmark, Treasury and quote outages from no-CASH absolute history", async () => {
  const services = service();
  const r = await analyze(config, "2024-06-04T12:00:00Z", services);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.ledger.at(-1)?.wealth).toBeCloseTo(9900, 10);
    expect(r.value.benchmark.ok).toBe(false);
  }
  const q = await currentQuotes(["SPY"], "2024-06-04T12:00:00Z", services);
  expect(q[0].ok).toBe(false);
});
it("surfaces failed holdings with ticker identity without substituting cash", async () => {
  const r = await analyze(
    { ...config, holdings: [{ ticker: "VT", weight: 1 }] },
    "2024-06-04T12:00:00Z",
    service(),
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.ticker).toBe("VT");
});
it("rejects invalid route JSON and oversized bodies before invoking providers", async () => {
  const run = vi.fn();
  const r = await handleJson(
    new Request("http://localhost/api/analysis", { method: "POST", body: "{" }),
    run,
  );
  expect(r.status).toBe(400);
  expect(run).not.toHaveBeenCalled();
  const big = await handleJson(
    new Request("http://localhost/api/analysis", {
      method: "POST",
      body: "x".repeat(16001),
    }),
    run,
  );
  expect(big.status).toBe(400);
});
it("does not retry missing symbols, permission failures, or rate limits", async () => {
  for (const status of [404, 403, 429]) {
    const fetcher = vi.fn(async () => new Response("", { status }));
    await expect(
      fetchPublic("https://example.test", 60, fetcher, 100),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("aborts timed-out requests and makes only one transient retry", async () => {
  const fetcher = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  );
  await expect(
    fetchPublic("https://example.test", 60, fetcher, 5),
  ).rejects.toThrow("timed out");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds per-instance request frequency", () => {
  for (let i = 0; i < 30; i++)
    expect(allowRequest("test-only", 1000)).toBe(true);
  expect(allowRequest("test-only", 1000)).toBe(false);
  expect(allowRequest("test-only", 61001)).toBe(true);
});
it("keeps the timeout active while the response body stalls", async () => {
  const fetcher = async () => new Response(new ReadableStream({ start() {} }));
  await expect(
    fetchPublic("https://example.test", 60, fetcher, 5),
  ).rejects.toThrow("timed out");
});
it("accepts the browser host behind a Next internal URL while rejecting cross-host origins", async () => {
  const run = vi.fn(async () => ({ ok: true, value: "accepted" }));
  const request = new Request("http://localhost:3100/api/analysis", {
    method: "POST",
    headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
    body: "{}",
  });
  expect((await handleJson(request, run)).status).toBe(200);
  const rejected = new Request("http://localhost:3100/api/analysis", {
    method: "POST",
    headers: { host: "127.0.0.1:3100", origin: "https://unrelated.example" },
    body: "{}",
  });
  expect((await handleJson(rejected, run)).status).toBe(403);
  expect(run).toHaveBeenCalledTimes(1);
});

it("expires a cached live claim independently of the quote cache TTL", async () => {
  const data = service();
  const quote = normalizeQuote(
    {
      ticker: "SPY",
      price: 100,
      provider: "qualified fixture",
      marketTimestamp: "2024-05-31T19:58:20Z",
      fetchedAt: "2024-05-31T20:00:00Z",
      claimedStatus: "live",
      liveQualified: true,
      delaySeconds: 0,
      session: "regular",
    },
    "2024-05-31T20:00:00Z",
  );
  let clock = 0;
  data.cache = new DataCache(128, () => clock);
  data.quotes = { name: "fixture", getCurrentQuote: async () => quote };
  await currentQuotes(["SPY"], "2024-05-31T20:00:00Z", data);
  clock = 30000;
  const [result] = await currentQuotes(["SPY"], "2024-05-31T20:00:30Z", data);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("latest_available");
    expect(result.value.observationAgeSeconds).toBe(130);
    expect(result.value.provenance.cacheAgeSeconds).toBe(30);
  }
  expect(quote.status).toBe("live"); // A consumer must not mutate the cached source.
});

it("streams a lossless result above the Vercel buffered-response limit in bounded chunks", async () => {
  const payload = { ok: true, value: "€".repeat(1_600_000), last: "complete" };
  const response = await handleJson(
    new Request("http://localhost/api/analysis", {
      method: "POST",
      body: "{}",
    }),
    async () => payload,
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("content-length")).toBe(false);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    expect(part.value.byteLength).toBeLessThanOrEqual(65536);
    size += part.value.byteLength;
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  expect(size).toBeGreaterThan(4_500_000);
  expect(JSON.parse(text)).toEqual(payload);
});

it("marks a cached Friday close stale on read once Monday's session has closed", async () => {
  const data = service();
  const close = normalizeQuote(
    {
      ticker: "SPY",
      price: 100,
      provider: "fixture",
      claimedStatus: "end_of_day",
      marketTimestamp: "2026-09-25T20:00:00Z",
      fetchedAt: "2026-09-27T12:00:00Z",
      session: "regular",
    },
    "2026-09-27T12:00:00Z",
  );
  data.quotes = { name: "fixture", getCurrentQuote: async () => close };
  let clock = 0;
  data.cache = new DataCache(128, () => clock);
  const [weekend] = await currentQuotes(["SPY"], "2026-09-27T12:00:00Z", data);
  expect(weekend.ok && weekend.value.stale).toBe(false);
  expect(weekend.ok && weekend.value.staleAfter).toBe("2026-09-28T20:00:00Z");
  clock = 50_000; // still inside the 60-second quote cache TTL
  const [monday] = await currentQuotes(["SPY"], "2026-09-28T20:00:10Z", data);
  expect(monday.ok && monday.value.stale).toBe(true);
  expect(close.stale).toBeUndefined();
});

it("bounds retained cache bytes, evicting oldest entries and never retaining oversized values", async () => {
  const cache = new DataCache(128, Date.now, 100, (v) => String(v).length);
  await cache.get("a", 60_000, async () => "x".repeat(60));
  await cache.get("b", 60_000, async () => "y".repeat(30));
  expect(cache.retainedBytes).toBe(90);
  await cache.get("c", 60_000, async () => "z".repeat(40));
  expect(cache.retainedBytes).toBe(70); // "a" evicted
  const big = await cache.get("d", 60_000, async () => "w".repeat(500));
  expect(big.value).toHaveLength(500);
  expect(cache.retainedBytes).toBe(70);
  const load = vi.fn(async () => "fresh");
  await cache.get("b", 60_000, load);
  expect(load).not.toHaveBeenCalled();
});

it("permits CDN compression of streamed snapshots and releases them on client cancel", async () => {
  const response = await handleJson(
    new Request("http://localhost/api/analysis", {
      method: "POST",
      body: "{}",
    }),
    async () => ({ ok: true, value: "x".repeat(200_000) }),
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  const reader = response.body!.getReader();
  expect((await reader.read()).value!.byteLength).toBe(65536);
  await reader.cancel();
  expect((await reader.read()).done).toBe(true);
});
it("accepts current quotes for 20 risky holdings plus CASH and a benchmark (22 tickers)", async () => {
  const tickers = [
    ...Array.from(
      { length: 20 },
      (_, i) => `R${String(i + 1).padStart(2, "0")}`,
    ),
    "CASH",
    "SPY",
  ];
  const quotes = await currentQuotes(
    tickers,
    "2024-06-04T12:00:00Z",
    service(),
  );
  expect(quotes).toHaveLength(21);
  await expect(
    currentQuotes([...tickers, "QQQ"], "2024-06-04T12:00:00Z", service()),
  ).rejects.toThrow(/at most 22/);
});
