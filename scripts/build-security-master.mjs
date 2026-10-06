// Builds the stored security master used by the builder autocomplete and the
// Portfolio Exposure look-through (never by the return, risk or construction
// engines):
//   config/securities.json          [ticker, name, "E" | "S"], ETFs then stocks by size
//   config/stockClassifications.json  sector + 3×3 style cell per stock
//   config/etfProfiles.json           look-through mix, sectors and style per ETF
//
// Universe
//   - every common stock listed on NYSE, Nasdaq and NYSE American (Nasdaq's
//     screener), including foreign companies' U.S.-listed ADRs;
//   - companies traded over the counter (OTCQX, OTCQB, Pink, OTC ID) with a
//     market cap of at least $2B, mostly foreign issuers such as Nestlé and
//     Roche: one line per company (the ADR preferred), and only when no more
//     than 10% of the last year's sessions had zero volume, the same limit the
//     history providers enforce, so the directory never offers a stale series;
//   - the largest U.S.-listed ETFs by net assets (Yahoo Finance screener).
// Data: Yahoo Finance quotes (sector, market cap, EPS, P/E, book value) and fund
// profiles (stock/bond mix, sector weights, Morningstar category).
//
// Classification (Portfolio Lab's own transparent rule, not a third-party rating)
//   sector  — Morningstar's sector, mapped one-to-one onto the eleven used here.
//   size    — market cap: Large ≥ $20B, Mid ≥ $3B, otherwise Small.
//   value/growth — within each size group, the average percentile rank of
//     earnings yield (mean of trailing and forward E/P) and book-to-price; the
//     top third is Value, the bottom third Growth, the rest Blend. Book-to-price
//     is skipped where the issuer reports in another currency than its quote.
//   ETFs    — sector weights scale by the fund's stock share; bonds count as
//     fixed income (as is a fund whose Morningstar category is a bond, T-bill,
//     target-maturity, preferred or convertible category). Style comes from the Morningstar category when it names a
//     style box, otherwise from the fund's earnings yield and book-to-price
//     scored against the stock breakpoints, sized by its top holdings. Leveraged, inverse and other trading
//     funds get no profile: their exposure is not a long look-through.
// Usage: node scripts/build-security-master.mjs [etfCount=500]
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
const STYLE_CELLS = [
  "Large Value",
  "Large Blend",
  "Large Growth",
  "Mid Value",
  "Mid Blend",
  "Mid Growth",
  "Small Value",
  "Small Blend",
  "Small Growth",
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
const FUND_SECTOR = {
  communication_services: "Communication Services",
  consumer_cyclical: "Consumer Discretionary",
  consumer_defensive: "Consumer Staples",
  energy: "Energy",
  financial_services: "Financials",
  healthcare: "Health Care",
  industrials: "Industrials",
  basic_materials: "Materials",
  realestate: "Real Estate",
  technology: "Technology",
  utilities: "Utilities",
};
const LARGE = 20e9;
const MID = 3e9;
const ETF_COUNT = Number(process.argv[2] ?? 500);
const OTC_MIN_CAP = 2e9;
const OTC_EXCHANGES = ["OQX", "OQB", "PNK", "OID"];
const STALE_SHARE = 0.1;
const VALID = /^[A-Z][A-Z0-9]{0,9}(?:-[A-Z])?$/;
const UA = "Mozilla/5.0 (portfolio-lab security master)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const raw = (v) => (v && typeof v === "object" ? v.raw : v);
const round = (v) => Math.round(v * 1000) / 1000;

// ---------- Yahoo session ----------
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
const H = { "User-Agent": UA, Cookie: cookie };

async function yahoo(path, params, body) {
  const url = new URL(`https://query2.finance.yahoo.com${path}`);
  for (const [k, v] of Object.entries({ ...params, crumb }))
    url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { ...H, "Content-Type": "application/json" } : H,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(1500 * 2 ** attempt);
  }
  throw new Error(`Yahoo ${path} failed`);
}
const screen = (body) =>
  yahoo("/v1/finance/screener", {}, body).then((j) => j.finance.result[0]);

async function profileSector(symbol) {
  const j = await yahoo(`/v10/finance/quoteSummary/${symbol}`, {
    modules: "assetProfile",
  });
  return j?.quoteSummary?.result?.[0]?.assetProfile?.sector;
}

// ---------- Universe ----------
const nasdaq = await fetch(
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true",
  { headers: { "User-Agent": UA, Accept: "application/json" } },
).then((r) => r.json());
const listed = new Set(
  nasdaq.data.rows
    .map((r) => r.symbol.trim().replace("/", "-"))
    .filter((t) => VALID.test(t)),
);
// Nasdaq's market cap fills in where Yahoo's quote has none.
const listedCap = new Map(
  nasdaq.data.rows.map((r) => [
    r.symbol.trim().replace("/", "-"),
    Number(r.marketCap),
  ]),
);
console.log(`${listed.size} exchange-listed symbols`);

const otc = [];
for (let offset = 0; ; offset += 250) {
  const page = await screen({
    offset,
    size: 250,
    sortField: "intradaymarketcap",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: {
      operator: "or",
      operands: OTC_EXCHANGES.map((x) => ({
        operator: "eq",
        operands: ["exchange", x],
      })),
    },
  });
  const rows = page.quotes ?? [];
  otc.push(...rows.filter((q) => (q.marketCap ?? 0) >= OTC_MIN_CAP));
  if (!rows.length || (rows.at(-1).marketCap ?? 0) < OTC_MIN_CAP) break;
  await sleep(400);
}
// One line per company: prefer the ADR (…Y) over ordinary shares (…F).
const byName = new Map();
for (const q of otc) {
  if (!VALID.test(q.symbol) || listed.has(q.symbol)) continue;
  const key = (q.longName ?? q.shortName ?? q.symbol)
    .toUpperCase()
    .slice(0, 24);
  const prev = byName.get(key);
  if (!prev || (q.symbol.endsWith("Y") && !prev.symbol.endsWith("Y")))
    byName.set(key, q);
}
/** True when the last year of daily bars is valid and mostly traded. */
async function liquid(symbol) {
  const j = await yahoo(`/v8/finance/chart/${symbol}`, {
    range: "1y",
    interval: "1d",
  });
  const r = j?.chart?.result?.[0];
  const volume = r?.indicators?.quote?.[0]?.volume ?? [];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
  if (!volume.length || adj.some((v) => v !== null && !(v > 0))) return false;
  return volume.filter((v) => v === 0).length <= STALE_SHARE * volume.length;
}
const otcSymbols = [];
const otcQueue = [...byName.values()].map((q) => q.symbol);
let checked = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (otcQueue.length) {
      const symbol = otcQueue.shift();
      if (await liquid(symbol)) otcSymbols.push(symbol);
      process.stdout.write(`\rOTC liquidity ${++checked}/${byName.size}`);
      await sleep(200);
    }
  }),
);
process.stdout.write("\n");
console.log(`${otcSymbols.length} liquid OTC companies ≥ $2B`);

const etfs = [];
for (let offset = 0; etfs.length < ETF_COUNT; offset += 250) {
  const page = await screen({
    offset,
    size: 250,
    sortField: "fundnetassets",
    sortType: "DESC",
    quoteType: "ETF",
    query: { operator: "eq", operands: ["region", "us"] },
  });
  if (!page.quotes?.length) break;
  etfs.push(...page.quotes.filter((q) => VALID.test(q.symbol)));
  await sleep(400);
}
etfs.length = Math.min(etfs.length, ETF_COUNT);
console.log(`${etfs.length} ETFs`);

// ---------- Stocks ----------
const stockRows = [];
const candidates = [...listed, ...otcSymbols];
for (let i = 0; i < candidates.length; i += 50) {
  const batch = candidates.slice(i, i + 50);
  const j = await yahoo("/v7/finance/quote", {
    symbols: batch.join(","),
    fields:
      "longName,shortName,sector,marketCap,epsTrailingTwelveMonths,trailingPE,forwardPE,bookValue,regularMarketPrice,currency,financialCurrency,quoteType",
  });
  for (const q of j?.quoteResponse?.result ?? []) {
    const marketCap = finite(q.marketCap)
      ? q.marketCap
      : listedCap.get(q.symbol);
    if (q.quoteType !== "EQUITY" || !(marketCap > 0)) continue;
    // Quotes omit the sector for some issuers; the company profile has it.
    const sector = FROM_YAHOO[q.sector ?? (await profileSector(q.symbol))];
    if (!sector) continue;
    const price = q.regularMarketPrice;
    const trailing =
      finite(q.trailingPE) && q.trailingPE > 0
        ? 1 / q.trailingPE
        : finite(q.epsTrailingTwelveMonths) && price > 0
          ? q.epsTrailingTwelveMonths / price
          : null;
    const forward =
      finite(q.forwardPE) && q.forwardPE !== 0 ? 1 / q.forwardPE : null;
    const yields = [trailing, forward].filter((v) => v !== null);
    const sameCurrency =
      !q.financialCurrency || q.financialCurrency === q.currency;
    stockRows.push({
      ticker: q.symbol,
      name: q.longName ?? q.shortName ?? q.symbol,
      sector,
      cap: marketCap,
      ep: yields.length
        ? yields.reduce((a, b) => a + b, 0) / yields.length
        : null,
      bp:
        sameCurrency && finite(q.bookValue) && price > 0
          ? q.bookValue / price
          : null,
    });
  }
  process.stdout.write(
    `\rstocks ${Math.min(i + 50, candidates.length)}/${candidates.length}`,
  );
  await sleep(300);
}
process.stdout.write("\n");

// A company with an exchange listing keeps only that line: its OTC ordinary
// shares (Toyota's TOYOF beside TM) would duplicate it with worse data.
const companyKey = (name) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(
      /\b(INC|CORP|CORPORATION|CO|LTD|LIMITED|PLC|AG|SA|NV|SE|HOLDINGS?|GROUP|THE|ADR)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
const otcSet = new Set(otcSymbols);
const listedCompanies = new Set(
  stockRows.filter((r) => !otcSet.has(r.ticker)).map((r) => companyKey(r.name)),
);
for (let i = stockRows.length - 1; i >= 0; i--)
  if (
    otcSet.has(stockRows[i].ticker) &&
    listedCompanies.has(companyKey(stockRows[i].name))
  )
    stockRows.splice(i, 1);

const sizeOf = (cap) => (cap >= LARGE ? "Large" : cap >= MID ? "Mid" : "Small");
// Sorted measures per size group: a stock (or fund) is scored by where its
// measures fall in these distributions.
const dist = {};
for (const size of ["Large", "Mid", "Small"]) {
  const group = stockRows.filter((r) => sizeOf(r.cap) === size);
  dist[size] = {
    ep: group
      .map((r) => r.ep)
      .filter((v) => v !== null)
      .sort((a, b) => a - b),
    bp: group
      .map((r) => r.bp)
      .filter((v) => v !== null)
      .sort((a, b) => a - b),
  };
}
const percentile = (sorted, v) => {
  if (!sorted.length) return null;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length > 1 ? Math.min(1, lo / (sorted.length - 1)) : 0.5;
};
const styleOf = (cap, ep, bp) => {
  const size = sizeOf(cap);
  const parts = [
    ep === null ? null : percentile(dist[size].ep, ep),
    bp === null ? null : percentile(dist[size].bp, bp),
  ].filter((v) => v !== null);
  if (!parts.length) return null;
  const score = parts.reduce((s, v) => s + v, 0) / parts.length;
  return `${size} ${score >= 2 / 3 ? "Value" : score < 1 / 3 ? "Growth" : "Blend"}`;
};

stockRows.sort((a, b) => b.cap - a.cap);
const stocks = Object.fromEntries(
  stockRows.map((r) => [
    r.ticker,
    [
      SECTORS.indexOf(r.sector),
      STYLE_CELLS.indexOf(styleOf(r.cap, r.ep, r.bp)),
    ],
  ]),
);

// ---------- ETFs ----------
const capOf = new Map(stockRows.map((r) => [r.ticker, r.cap]));
const CATEGORY_STYLE =
  /\b(Large|Mid-Cap|Mid|Small)(?:-Stock)?\s+(Value|Blend|Growth)\b/i;
const SMID_STYLE = /\bSmall\/Mid\s+(Value|Blend|Growth)\b/i;
function categoryStyle(category, equity) {
  const smid = SMID_STYLE.exec(category ?? "");
  if (smid)
    return {
      [`Mid ${cap(smid[1])}`]: equity / 2,
      [`Small ${cap(smid[1])}`]: equity / 2,
    };
  const m = CATEGORY_STYLE.exec(category ?? "");
  if (!m) return null;
  const size = /^mid/i.test(m[1]) ? "Mid" : cap(m[1]);
  return { [`${size} ${cap(m[2])}`]: equity };
}
function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const FIXED_INCOME_CATEGORY =
  /Bond|Treasury|Muni|Target Maturity|Money Market|Bank Loan|Securitized|Preferred Stock|Convertibles/i;
const funds = {};
const fundNames = {};
let done = 0;
async function profile(q) {
  const j = await yahoo(`/v10/finance/quoteSummary/${q.symbol}`, {
    modules: "topHoldings,fundProfile",
  });
  const r = j?.quoteSummary?.result?.[0];
  done++;
  if (!r) return;
  fundNames[q.symbol] = q.longName ?? q.shortName ?? q.symbol;
  const category = r.fundProfile?.categoryName ?? "";
  if (/^Trading|Leveraged|Inverse/i.test(category)) return;
  const th = r.topHoldings ?? {};
  const stock = Math.max(0, raw(th.stockPosition) ?? 0);
  const bond = Math.max(0, raw(th.bondPosition) ?? 0);
  const sectorRaw = Object.assign({}, ...(th.sectorWeightings ?? []));
  const sectorTotal = Object.values(sectorRaw).reduce(
    (s, v) => s + (raw(v) ?? 0),
    0,
  );
  const sectors =
    stock > 0.05 && sectorTotal > 0.5
      ? SECTORS.map((s) => {
          const key = Object.keys(FUND_SECTOR).find(
            (k) => FUND_SECTOR[k] === s,
          );
          return round(((raw(sectorRaw[key]) ?? 0) / sectorTotal) * stock);
        })
      : null;
  let style = null;
  if (stock > 0.05) {
    const fromCategory = categoryStyle(category, stock);
    let cells = fromCategory;
    if (!cells) {
      // Yahoo stores fund valuation as yields: "priceToEarnings" is E/P and
      // "priceToBook" is B/P. Size comes from the fund's top holdings that are
      // in the stock snapshot, by weight.
      const eq = th.equityHoldings ?? {};
      const ep = raw(eq.priceToEarnings);
      const bp = raw(eq.priceToBook);
      let known = 0;
      let large = 0;
      let mid = 0;
      for (const h of th.holdings ?? []) {
        const c = capOf.get(h.symbol);
        const w = raw(h.holdingPercent) ?? 0;
        if (!c || !w) continue;
        known += w;
        if (c >= LARGE) large += w;
        else if (c >= MID) mid += w;
      }
      const sizeCap =
        known > 0
          ? large / known >= 0.5
            ? LARGE
            : (large + mid) / known >= 0.5
              ? MID
              : 0
          : null;
      const cell =
        sizeCap !== null
          ? styleOf(
              sizeCap,
              finite(ep) && ep !== 0 ? ep : null,
              finite(bp) && bp > 0 ? bp : null,
            )
          : null;
      cells = cell ? { [cell]: stock } : null;
    }
    if (cells) style = STYLE_CELLS.map((c) => round(cells[c] ?? 0));
  }
  // The category outranks the reported mix: T-bill funds report their bills as
  // cash, and some box-spread or hybrid funds report no bonds at all.
  const kind = FIXED_INCOME_CATEGORY.test(category)
    ? "fixed-income"
    : stock + bond < 0.5
      ? "other"
      : bond >= 0.5 && stock < 0.1
        ? "fixed-income"
        : "equity";
  funds[q.symbol] = {
    c: category,
    k: kind,
    b: round(bond),
    ...(kind === "equity" && sectors ? { s: sectors } : {}),
    ...(kind === "equity" && style ? { y: style } : {}),
  };
}
const queue = [...etfs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      await profile(queue.shift());
      process.stdout.write(`\rfunds ${done}/${etfs.length}`);
      await sleep(250);
    }
  }),
);
process.stdout.write("\n");

// ---------- Write ----------
const asOf = new Date().toISOString().slice(0, 10);
const previous = new Map(
  JSON.parse(readFileSync("config/securities.json", "utf8")).map((s) => [
    s[0],
    s,
  ]),
);
// Keep previously tidied names; keep earlier ETFs (e.g. inverse funds) listed.
const directory = [];
const seen = new Set();
const add = (ticker, name, kind) => {
  if (seen.has(ticker)) return;
  seen.add(ticker);
  directory.push([ticker, previous.get(ticker)?.[1] ?? name, kind]);
};
for (const q of etfs)
  add(
    q.symbol,
    fundNames[q.symbol] ?? q.longName ?? q.shortName ?? q.symbol,
    "E",
  );
for (const [t, s] of previous) if (s[2] === "E") add(t, s[1], "E");
for (const r of stockRows) add(r.ticker, r.name, "S");

writeFileSync("config/securities.json", JSON.stringify(directory));
writeFileSync(
  "config/stockClassifications.json",
  JSON.stringify({
    asOf,
    source:
      "Yahoo Finance quote snapshot (Morningstar sectors); Portfolio Lab size and value/growth rule",
    stocks,
  }),
);
writeFileSync(
  "config/etfProfiles.json",
  JSON.stringify({
    asOf,
    source:
      "Yahoo Finance fund profiles (holdings mix, sector weights, Morningstar category)",
    funds,
  }),
);
const styled = Object.values(stocks).filter(([, s]) => s >= 0).length;
console.log(
  `${directory.length} directory entries · ${stockRows.length} stocks (${styled} with style) · ${Object.keys(funds).length}/${etfs.length} ETFs profiled`,
);
