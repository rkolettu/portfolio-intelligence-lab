// Live qualification: the direct Yahoo adapter vs the market-data service
// (Render/yfinance) on identical securities and dates, compared at the raw-series
// level and downstream through the unchanged TypeScript engine.
//
// Run (needs network, a running service and its key):
//   MARKET_DATA_SERVICE_URL=https://... MARKET_DATA_SERVICE_KEY=... \
//     npx tsx --conditions=react-server scripts/service-qualification.ts
import { YahooProvider } from "@/lib/market-data/providers/yahoo";
import {
  MarketDataServiceProvider,
  marketDataServiceConfig,
} from "@/lib/market-data/providers/marketDataService";
import { FredProvider } from "@/lib/treasury-data/historical";
import { DataCache } from "@/lib/server/cache";
import { analyze, type DataServices } from "@/lib/server/analyze";
import { stress } from "@/lib/server/stress";
import { construct } from "@/lib/server/construction";
import { samplePortfolio } from "@/config/samplePortfolio";
import { marketDate } from "@/lib/utils/dates";
import type { BacktestResult, Metric } from "@/lib/types/analytics";

const config = marketDataServiceConfig(process.env);
if (!config) throw new Error("Set MARKET_DATA_SERVICE_URL and MARKET_DATA_SERVICE_KEY.");
const now = new Date().toISOString();
const today = marketDate(now);
const treasury = new FredProvider();
const services = (history: DataServices["history"][number]): DataServices => ({
  history: [history],
  quotes: null,
  treasury,
  cache: new DataCache(),
});
const direct = services(new YahooProvider());
const viaService = services(new MarketDataServiceProvider(config));

const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a / b - 1));
const worst: Record<string, { rel: number; abs: number }> = {};
const note = (name: string, a: number | null | undefined, b: number | null | undefined) => {
  if (a == null || b == null) {
    if (a !== b) throw new Error(`${name}: availability differs (${a} vs ${b})`);
    return;
  }
  const w = (worst[name] ??= { rel: 0, abs: 0 });
  w.rel = Math.max(w.rel, rel(a, b));
  w.abs = Math.max(w.abs, Math.abs(a - b));
};
const m = (x: Metric) => (x.available ? x.value : null);

function compareAnalysis(tag: string, a: BacktestResult, b: BacktestResult) {
  if (a.ledger.length !== b.ledger.length) throw new Error(`${tag}: ledger length differs`);
  a.ledger.forEach((row, i) => {
    if (row.date !== b.ledger[i].date) throw new Error(`${tag}: ledger dates differ at ${i}`);
    note("daily portfolio return", row.return, b.ledger[i].return);
  });
  const pa = a.performance, pb = b.performance;
  note("ending wealth", m(pa.portfolio.endingValue), m(pb.portfolio.endingValue));
  note("CAGR", m(pa.portfolio.cagr), m(pb.portfolio.cagr));
  note("volatility", m(pa.risk.volatility), m(pb.risk.volatility));
  note("Sharpe", m(pa.risk.sharpe), m(pb.risk.sharpe));
  note("Sortino", m(pa.risk.sortino), m(pb.risk.sortino));
  note("maximum drawdown", m(pa.risk.maximumDrawdown), m(pb.risk.maximumDrawdown));
  const ba = a.benchmarkAnalytics.relative, bb = b.benchmarkAnalytics.relative;
  note("beta", m(ba.beta), m(bb.beta));
  note("alpha", m(ba.alpha), m(bb.alpha));
  note("tracking error", m(ba.trackingError), m(bb.trackingError));
  const ra = a.riskAnalytics, rb = b.riskAnalytics;
  note("model volatility (sample covariance)", m(ra.portfolio.volatility), m(rb.portfolio.volatility));
  ra.holdings.forEach((h, i) => {
    note("risk contribution (PCR)", m(h.percentage), m(rb.holdings[i].percentage));
    note("marginal risk (MRC)", m(h.marginal), m(rb.holdings[i].marginal));
  });
  if (ra.correlation.available && rb.correlation.available)
    ra.correlation.matrix.forEach((row, i) =>
      row.forEach((v, j) => note("correlation", v, rb.correlation.available ? rb.correlation.matrix[i][j] : null)));
  const drawA = pa.maximumDrawdownEpisode, drawB = pb.maximumDrawdownEpisode;
  if (drawA?.troughDate !== drawB?.troughDate) throw new Error(`${tag}: drawdown trough date differs`);
}

const portfolios = [
  { tag: "sample 5Y", cfg: samplePortfolio(today) },
  {
    tag: "10Y with VT benchmark",
    cfg: { ...samplePortfolio(today), benchmark: "VT", requestedStartDate: `${Number(today.slice(0, 4)) - 10}${today.slice(4)}` },
  },
  {
    tag: "equities + AGG, 3Y",
    cfg: {
      ...samplePortfolio(today),
      holdings: [
        { ticker: "AAPL", weight: 0.3 }, { ticker: "MSFT", weight: 0.3 },
        { ticker: "NVDA", weight: 0.2 }, { ticker: "AGG", weight: 0.2 },
      ],
      benchmark: "AGG",
      requestedStartDate: `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`,
    },
  },
];

for (const { tag, cfg } of portfolios) {
  const [a, b] = await Promise.all([analyze(cfg, now, direct), analyze(cfg, now, viaService)]);
  if (!a.ok || !b.ok) throw new Error(`${tag}: ${JSON.stringify(a.ok ? b : a)}`);
  a.value.snapshot.prices.forEach((s, i) => {
    const t = b.value.snapshot.prices[i];
    if (s.ticker !== t.ticker || s.observations.length !== t.observations.length ||
      s.observations.some((o, k) => o.date !== t.observations[k].date))
      throw new Error(`${tag} ${s.ticker}: session dates differ`);
    s.observations.forEach((o, k) => note("adjusted close (raw)", o.adjustedClose, t.observations[k].adjustedClose));
    if (s.firstTradeDate !== t.firstTradeDate) throw new Error(`${s.ticker}: firstTradeDate differs`);
  });
  compareAnalysis(tag, a.value, b.value);
  console.log(`ANALYSIS ${tag}: identical sessions (${a.value.ledger.length} returns); effective ${a.value.initialDate} → ${a.value.metadata.effectiveEndDate}`);
}

const sample = samplePortfolio(today);
const [sa, sb] = await Promise.all([stress({ config: sample }, now, direct), stress({ config: sample }, now, viaService)]);
if (!sa.ok || !sb.ok) throw new Error("stress failed");
sa.value.events.forEach((e, i) => {
  const f = sb.value.events[i];
  if (e.status !== f.status) throw new Error(`${e.id}: status differs`);
  if (e.status === "complete" && f.status === "complete") {
    note("stress portfolio return", m(e.portfolioReturn), m(f.portfolioReturn));
    note("stress benchmark return", m(e.benchmarkReturn), m(f.benchmarkReturn));
    note("stress maximum drawdown", m(e.maximumDrawdown), m(f.maximumDrawdown));
  }
});
console.log(`STRESS: ${sa.value.events.map((e) => `${e.id} ${e.status}`).join(", ")}`);

const request = {
  config: sample,
  constraints: sample.holdings.filter((h) => h.ticker !== "CASH").map((h) => ({ ticker: h.ticker, minWeight: 0, maxWeight: 1, required: false })),
  cash: { mode: "current" },
};
const [ca, cb] = await Promise.all([construct(request, now, direct), construct(request, now, viaService)]);
if (!ca.ok || !cb.ok) throw new Error(`construction failed: ${JSON.stringify(ca.ok ? cb : ca).slice(0, 300)}`);
if (ca.value.covariance.available && cb.value.covariance.available) {
  note("Ledoit-Wolf shrinkage δ", ca.value.covariance.shrinkage, cb.value.covariance.shrinkage);
  note("Ledoit-Wolf μ", ca.value.covariance.mu, cb.value.covariance.mu);
}
ca.value.proposals.forEach((p, i) => {
  p.weights?.forEach((w, k) => note(`construction weight (${p.method})`, w.weight, cb.value.proposals[i].weights?.[k].weight));
});
console.log("CONSTRUCTION: " + ca.value.proposals.map((p) => `${p.method} ${p.status}`).join(", "));

console.log("\nWORST DIFFERENCE, direct adapter vs market-data service");
for (const [k, v] of Object.entries(worst))
  console.log(`  ${k.padEnd(40)} rel ${v.rel.toExponential(2)}   abs ${v.abs.toExponential(2)}`);
