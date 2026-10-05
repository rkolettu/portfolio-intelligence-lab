// Builds config/stockClassifications.json: a stored sector and 3×3 style snapshot
// for every stock in config/securities.json, used only by the Portfolio Exposure
// look-through (never by the return, risk or construction engines).
//
// Source: Yahoo Finance's batch quote endpoint (sector, market cap, trailing EPS,
// book value per share, price). Sector names are Morningstar's, mapped one-to-one
// onto the eleven GICS-style sectors the app uses. Style is Portfolio Lab's own
// transparent rule, not a third-party rating:
//   size  — market cap: Large ≥ $20B, Mid $3B–$20B, Small < $3B
//   value/growth — within each size group, the average percentile rank of
//     earnings yield (the mean of trailing and forward E/P, so one unusual year
//     does not decide it) and book-to-price; the top third is Value, the bottom
//     third Growth, the rest Blend. Book-to-price is skipped when the issuer
//     reports in a currency other than the quote's (ADRs), where Yahoo's book
//     value per share is not comparable to the price. A stock missing both
//     measures keeps its sector but no style cell.
// Usage: node scripts/build-stock-classifications.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Materials",
  "Real Estate",
  "Technology",
  "Utilities",
];
const FROM_YAHOO = {
  "Communication Services": "Communication Services",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  Energy: "Energy",
  "Financial Services": "Financials",
  Healthcare: "Health Care",
  Industrials: "Industrials",
  "Basic Materials": "Materials",
  "Real Estate": "Real Estate",
  Technology: "Technology",
  Utilities: "Utilities",
};
const LARGE = 20e9;
const MID = 3e9;
const UA = "Mozilla/5.0 (portfolio-lab classification snapshot)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const home = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const cookie = (home.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  const crumb = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  }).then((r) => r.text());
  if (!crumb || crumb.length > 40) throw new Error("No Yahoo crumb");
  return { cookie, crumb };
}

async function quotes(symbols, { cookie, crumb }) {
  const url = new URL("https://query2.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("crumb", crumb);
  url.searchParams.set(
    "fields",
    "sector,marketCap,epsTrailingTwelveMonths,trailingPE,forwardPE,bookValue,regularMarketPrice,currency,financialCurrency,quoteType",
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
    if (r.ok) return (await r.json()).quoteResponse.result;
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`Quote batch failed: ${symbols[0]}…`);
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);

const securities = JSON.parse(readFileSync("config/securities.json", "utf8"));
const stocks = securities.filter(([, , kind]) => kind === "S").map(([t]) => t);
const auth = await session();
const rows = [];
for (let i = 0; i < stocks.length; i += 50) {
  const batch = stocks.slice(i, i + 50);
  for (const q of await quotes(batch, auth)) {
    const sector = FROM_YAHOO[q.sector];
    if (q.quoteType !== "EQUITY" || !sector) continue;
    const price = q.regularMarketPrice;
    const trailing = finite(q.trailingPE) && q.trailingPE > 0
      ? 1 / q.trailingPE
      : finite(q.epsTrailingTwelveMonths) && price > 0
        ? q.epsTrailingTwelveMonths / price
        : null;
    const forward = finite(q.forwardPE) && q.forwardPE !== 0 ? 1 / q.forwardPE : null;
    const yields = [trailing, forward].filter((v) => v !== null);
    const sameCurrency = !q.financialCurrency || q.financialCurrency === q.currency;
    rows.push({
      ticker: q.symbol,
      sector,
      cap: finite(q.marketCap) ? q.marketCap : null,
      ep: yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null,
      bp: sameCurrency && finite(q.bookValue) && price > 0 ? q.bookValue / price : null,
    });
  }
  process.stdout.write(`\r${Math.min(i + 50, stocks.length)}/${stocks.length}`);
  await sleep(400);
}
process.stdout.write("\n");

const size = (cap) => (cap === null ? null : cap >= LARGE ? "Large" : cap >= MID ? "Mid" : "Small");
/** Percentile rank (0–1) of each defined value within `group`. */
const ranks = (group, key) => {
  const sorted = group.filter((r) => r[key] !== null).sort((a, b) => a[key] - b[key]);
  const out = new Map();
  sorted.forEach((r, i) => out.set(r, sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
  return out;
};
const style = new Map();
for (const bucket of ["Large", "Mid", "Small"]) {
  const group = rows.filter((r) => size(r.cap) === bucket);
  const ep = ranks(group, "ep");
  const bp = ranks(group, "bp");
  for (const r of group) {
    const parts = [ep.get(r), bp.get(r)].filter((v) => v !== undefined);
    if (!parts.length) continue;
    const score = parts.reduce((s, v) => s + v, 0) / parts.length;
    style.set(r, `${bucket} ${score >= 2 / 3 ? "Value" : score < 1 / 3 ? "Growth" : "Blend"}`);
  }
}

const STYLE_CELLS = ["Large Value", "Large Blend", "Large Growth", "Mid Value", "Mid Blend", "Mid Growth", "Small Value", "Small Blend", "Small Growth"];
const out = {
  asOf: new Date().toISOString().slice(0, 10),
  source: "Yahoo Finance quote snapshot (Morningstar sectors); Portfolio Lab size and value/growth rule",
  // [sector index, style index or -1], indexes into SECTORS and STYLE_CELLS.
  stocks: Object.fromEntries(
    rows
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map((r) => [r.ticker, [SECTORS.indexOf(r.sector), style.has(r) ? STYLE_CELLS.indexOf(style.get(r)) : -1]]),
  ),
};
writeFileSync("config/stockClassifications.json", JSON.stringify(out));
const styled = rows.filter((r) => style.has(r)).length;
console.log(`${rows.length}/${stocks.length} stocks classified by sector, ${styled} by style`);
