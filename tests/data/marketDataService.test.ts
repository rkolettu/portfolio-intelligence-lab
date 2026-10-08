import { afterEach, expect, it, vi } from "vitest";
import {
  MarketDataServiceProvider,
  marketDataServiceConfig,
  SERVICE_KEY_HEADER,
} from "@/lib/market-data/providers/marketDataService";
import {
  assertQualified,
  MARKET_DATA_SERVICE_QUALIFICATION,
} from "@/config/deployed-providers";
import { analyze, currentQuotes, type DataServices } from "@/lib/server/analyze";
import { stress } from "@/lib/server/stress";
import { DataCache } from "@/lib/server/cache";
import { marketDataStatus } from "@/lib/server/marketDataStatus";
import { provenance, series } from "../fixtures/helpers";

// The service is always faked here: no test depends on Render or Yahoo.
const KEY = "k".repeat(40);
const CONFIG = { url: "https://market-data.example", key: KEY };
const NOW = "2024-06-04T12:00:00Z";
const DATES = ["2024-05-28", "2024-05-29", "2024-05-30", "2024-05-31", "2024-06-03", "2024-06-04"];
const config = {
  holdings: [
    { ticker: "SPY", weight: 0.6 },
    { ticker: "QQQ", weight: 0.4 },
  ],
  benchmark: "VT",
  requestedStartDate: "2024-05-29",
  endDate: "2024-06-04",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
const prices: Record<string, number[]> = {
  SPY: [100, 101, 103, 102, 104, 111],
  QQQ: [200, 199, 204, 206, 205, 222],
  VT: [50, 50.5, 51, 50.8, 51.2, 55],
};
const ok = (ticker: string, extra: Record<string, unknown> = {}) => ({
  ok: true,
  ticker,
  currency: "USD",
  exchange: "PCX",
  instrument: "ETF",
  firstTradeDate: "2000-01-03",
  dates: DATES,
  adjustedClose: prices[ticker],
  provenance: {
    fetchedAt: "2024-06-04T11:00:00Z",
    lastSuccessfulRefresh: "2024-06-04T11:00:00Z",
    cacheAgeSeconds: 12,
    observationDate: "2024-06-04",
    stale: false,
  },
  ...extra,
});
const historyBody = (results: unknown[]) => ({
  ok: true,
  provider: { name: "yahoo-yfinance", label: "Yahoo Finance via yfinance (unofficial)", convention: "total_return_aware_adjusted" },
  results,
});

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return respond(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
function services(provider: MarketDataServiceProvider): DataServices {
  return {
    history: [provider],
    quotes: provider,
    treasury: {
      name: "fixture",
      getHistoricalRates: async () => ({ series: "DGS3MO", observations: [], provenance }),
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

afterEach(() => vi.useRealTimers());

it("reads its URL and key only from the server environment and requires TLS", () => {
  expect(marketDataServiceConfig({})).toBeNull();
  expect(marketDataServiceConfig({ MARKET_DATA_SERVICE_URL: "https://x.onrender.com/", MARKET_DATA_SERVICE_KEY: KEY }))
    .toEqual({ url: "https://x.onrender.com", key: KEY });
  expect(marketDataServiceConfig({ MARKET_DATA_SERVICE_URL: "http://x.onrender.com", MARKET_DATA_SERVICE_KEY: KEY })).toBeNull();
  expect(marketDataServiceConfig({ MARKET_DATA_SERVICE_URL: "http://127.0.0.1:8765", MARKET_DATA_SERVICE_KEY: KEY })).not.toBeNull();
  expect(marketDataServiceConfig({ MARKET_DATA_SERVICE_URL: "https://x", MARKET_DATA_SERVICE_KEY: "short" })).toBeNull();
});

it("one authenticated batch request serves the whole analysis", async () => {
  const { fn, calls } = fakeFetch(({ body }) =>
    Response.json(historyBody((body.tickers as string[]).map((t) => ok(t)))),
  );
  const provider = new MarketDataServiceProvider(CONFIG, fn);
  const shared = services(provider);
  const r = await analyze(config, NOW, shared);
  expect(r.ok).toBe(true);
  expect(calls).toHaveLength(1);
  const [call] = calls;
  expect(call.url).toBe("https://market-data.example/api/market-data/history");
  const headers = call.init.headers as Record<string, string>;
  expect(headers[SERVICE_KEY_HEADER]).toBe(KEY);
  expect(headers["X-Request-Id"]).toMatch(/^pl-/);
  expect(call.init.cache).toBe("no-store");
  // Same 10-day lead-in as the direct adapter; end is the prior market day.
  expect(call.body).toEqual({ tickers: ["SPY", "QQQ", "VT"], startDate: "2024-05-19", endDate: "2024-06-03" });
  if (r.ok) {
    // Today's (unfinalized) bar is never used, exactly as with the direct adapter.
    expect(r.value.snapshot.prices.every((p) => p.observations.every((o) => o.date < "2024-06-04"))).toBe(true);
    expect(r.value.snapshot.prices[0].provenance.provider).toBe(provider.name);
  }
  // A repeat (e.g. hard-refresh recovery) is served from the process cache.
  expect((await analyze(config, NOW, shared)).ok).toBe(true);
  expect(calls).toHaveLength(1);
});

it("identical data gives identical analytics through the service and a direct provider", async () => {
  const { fn } = fakeFetch(({ body }) => Response.json(historyBody((body.tickers as string[]).map((t) => ok(t)))));
  const viaService = await analyze(config, NOW, services(new MarketDataServiceProvider(CONFIG, fn)));
  const direct: DataServices = {
    ...services(new MarketDataServiceProvider(CONFIG, fn)),
    history: [{
      name: "direct fixture",
      convention: "total_return_aware_adjusted",
      getHistoricalPrices: async (r) => series(r.ticker, DATES.slice(0, -1), prices[r.ticker].slice(0, -1)),
    }],
  };
  const viaDirect = await analyze(config, NOW, direct);
  expect(viaService.ok && viaDirect.ok).toBe(true);
  if (viaService.ok && viaDirect.ok) {
    expect(viaService.value.ledger).toEqual(viaDirect.value.ledger);
    expect(viaService.value.performance).toEqual(viaDirect.value.performance);
    expect(viaService.value.riskAnalytics).toEqual(viaDirect.value.riskAnalytics);
    expect(viaService.value.benchmarkAnalytics).toEqual(viaDirect.value.benchmarkAnalytics);
  }
});

it("a failed holding keeps its exact typed failure; it is never dropped", async () => {
  const { fn } = fakeFetch(({ body }) =>
    Response.json(historyBody((body.tickers as string[]).map((t) => t === "QQQ"
      ? { ok: false, ticker: t, error: { code: "TICKER_NOT_FOUND", message: "No history found for QQQ.", retryable: false } }
      : ok(t)))),
  );
  const r = await analyze(config, NOW, services(new MarketDataServiceProvider(CONFIG, fn)));
  expect(r).toEqual({ ok: false, error: { code: "TICKER_NOT_FOUND", message: "No history found for QQQ.", retryable: false, ticker: "QQQ" } });
});

it("stress keeps partial batches: failures are recorded per security", async () => {
  const { fn, calls } = fakeFetch(({ body }) =>
    Response.json(historyBody((body.tickers as string[]).map((t) => t === "QQQ"
      ? { ok: false, ticker: t, error: { code: "INSUFFICIENT_HISTORY", message: "QQQ has no history in the requested range; it may have listed later.", retryable: false } }
      : ok(t)))),
  );
  const r = await stress({ config }, NOW, services(new MarketDataServiceProvider(CONFIG, fn)));
  expect(calls).toHaveLength(1);
  expect(r.ok).toBe(true);
});

it("maps transport failures to typed errors", async () => {
  const run = async (respond: () => Response | Promise<Response>) => {
    const { fn } = fakeFetch(respond);
    const r = await analyze(config, NOW, services(new MarketDataServiceProvider(CONFIG, fn)));
    return r.ok ? null : r.error;
  };
  expect((await run(() => new Response("nope", { status: 401 })))?.code).toBe("PERMISSION");
  expect((await run(() => new Response("<html>502</html>", { status: 502 })))).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  expect((await run(() => Response.json({ ok: true, results: "x" })))?.code).toBe("MALFORMED_DATA");
  expect((await run(() => { throw new TypeError("fetch failed"); }))).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  expect((await run(() => Response.json(historyBody([ok("SPY")]))))?.code).toBe("MALFORMED_DATA"); // omitted QQQ
});

it("times out a hung service call", async () => {
  vi.useFakeTimers();
  const { fn } = fakeFetch(({ init }) => new Promise<Response>((_, reject) =>
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  const provider = new MarketDataServiceProvider(CONFIG, fn);
  const pending = provider.getHistoricalPrices({ ticker: "SPY", startDate: "2024-05-29", endDate: "2024-06-03", now: NOW });
  const assertion = expect(pending).rejects.toMatchObject({ detail: { code: "TIMEOUT", retryable: true } });
  await vi.advanceTimersByTimeAsync(50_001);
  await assertion;
});

it("stale cached history is served with an explicit provenance warning", async () => {
  const { fn } = fakeFetch(({ body }) => Response.json(historyBody((body.tickers as string[]).map((t) =>
    ok(t, { provenance: { ...ok(t).provenance, stale: true, staleReason: "Market-data provider connection failed." } })))));
  const r = await new MarketDataServiceProvider(CONFIG, fn).getHistoricalPrices({ ticker: "SPY", startDate: "2024-05-29", endDate: "2024-06-03", now: NOW });
  expect(r.provenance.warnings.at(-1)).toMatch(/Served from the market-data cache/);
});

it("quotes: one batch request, truthful freshness, failures isolated per security", async () => {
  const { fn, calls } = fakeFetch(() => Response.json({
    ok: true,
    provider: { name: "yahoo-yfinance", label: "Yahoo Finance via yfinance (unofficial)" },
    results: [
      { ok: true, ticker: "SPY", currency: "USD", regularMarketPrice: 525.5, regularMarketTime: "2024-06-04T11:59:00Z",
        recentCloses: [{ date: "2024-06-03", close: 520 }, { date: "2024-06-04", close: 526 }], retrievedAt: "2024-06-04T12:00:00Z" },
      { ok: true, ticker: "QQQ", currency: "USD", regularMarketPrice: null, regularMarketTime: null,
        recentCloses: [{ date: "2024-06-03", close: 450 }], retrievedAt: "2024-06-04T12:00:00Z" },
      { ok: false, ticker: "ZZZZ", error: { code: "TICKER_NOT_FOUND", message: "No history found for ZZZZ.", retryable: false } },
    ],
  }));
  const provider = new MarketDataServiceProvider(CONFIG, fn);
  const q = await currentQuotes(["SPY", "QQQ", "ZZZZ"], NOW, services(provider));
  expect(calls).toHaveLength(1);
  expect(q[0].ok && q[0].value.status).toBe("latest_available"); // never "live"
  expect(q[1].ok && q[1].value.status).toBe("end_of_day"); // previous close, labelled as such
  expect(q[1].ok && q[1].value.provenance.fallbackReason).toMatch(/Current quote unavailable/);
  expect(q[2]).toMatchObject({ ok: false, error: { code: "TICKER_NOT_FOUND", ticker: "ZZZZ" } });
});

it("admits the service provider only with its recorded upstream acceptance, never the direct adapter", () => {
  const provider = new MarketDataServiceProvider(CONFIG);
  expect(assertQualified({ provider, qualification: MARKET_DATA_SERVICE_QUALIFICATION })).toBe(provider);
  const { upstreamAcceptance: _, ...without } = MARKET_DATA_SERVICE_QUALIFICATION;
  void _;
  expect(() => assertQualified({ provider, qualification: without })).toThrow("qualification");
  expect(() => assertQualified({ provider: { name: "Yahoo Finance (unofficial chart)" }, qualification: MARKET_DATA_SERVICE_QUALIFICATION })).toThrow();
});

it("the status route reports readiness and the wake-up latency", async () => {
  const { fn } = fakeFetch(() => Response.json({ ok: true, status: "ok", circuit: { state: "closed", retryAfterSeconds: 0 }, prewarm: { state: "done" } }));
  expect(await marketDataStatus({}, NOW, services(new MarketDataServiceProvider(CONFIG, fn))))
    .toMatchObject({ mode: "service", ready: true, circuit: "closed", prewarm: "done" });
  const down = fakeFetch(() => { throw new TypeError("fetch failed"); });
  expect(await marketDataStatus({ waitMs: 10 }, NOW, services(new MarketDataServiceProvider(CONFIG, down.fn))))
    .toMatchObject({ mode: "service", ready: false });
});

it("a waking service is polled until it answers; a wrong key fails immediately", async () => {
  let calls = 0;
  const booting = fakeFetch(() => {
    calls++;
    if (calls <= 2) throw new TypeError("fetch failed"); // connection refused while booting
    if (calls === 3) return new Response("Bad Gateway", { status: 502 });
    return Response.json({ ok: true, status: "ok", circuit: { state: "closed", retryAfterSeconds: 0 } });
  });
  const waits: number[] = [];
  const woke = await new MarketDataServiceProvider(CONFIG, booting.fn).health(45_000, async (ms) => {
    waits.push(ms);
  });
  expect(woke.ready).toBe(true);
  expect(calls).toBe(4);
  expect(waits).toEqual([2_000, 2_000, 2_000]);
  const denied = fakeFetch(() => new Response("no", { status: 401 }));
  const r = await new MarketDataServiceProvider(CONFIG, denied.fn).health(45_000, async () => {});
  expect(r.ready).toBe(false);
  expect(denied.calls).toHaveLength(1);
});
