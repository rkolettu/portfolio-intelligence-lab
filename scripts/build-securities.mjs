// Builds config/securities.json: the ticker/name directory the builder's
// autocomplete searches. Stocks come from the SEC's company_tickers.json (ordered
// roughly by size; download it first, with a descriptive User-Agent), ETFs from
// the curated list below. Usage: node scripts/build-securities.mjs <sec.json>
import { readFileSync, writeFileSync } from "node:fs";

const ETFS = [
  ["SPY", "SPDR S&P 500 ETF Trust"], ["VOO", "Vanguard S&P 500 ETF"], ["IVV", "iShares Core S&P 500 ETF"],
  ["VTI", "Vanguard Total Stock Market ETF"], ["VT", "Vanguard Total World Stock ETF"], ["QQQ", "Invesco QQQ Trust"],
  ["QQQM", "Invesco NASDAQ 100 ETF"], ["DIA", "SPDR Dow Jones Industrial Average ETF Trust"], ["IWM", "iShares Russell 2000 ETF"],
  ["IWB", "iShares Russell 1000 ETF"], ["IWF", "iShares Russell 1000 Growth ETF"], ["IWD", "iShares Russell 1000 Value ETF"],
  ["IJH", "iShares Core S&P Mid-Cap ETF"], ["IJR", "iShares Core S&P Small-Cap ETF"], ["MDY", "SPDR S&P MidCap 400 ETF Trust"],
  ["RSP", "Invesco S&P 500 Equal Weight ETF"], ["SPLG", "SPDR Portfolio S&P 500 ETF"], ["VUG", "Vanguard Growth ETF"],
  ["VTV", "Vanguard Value ETF"], ["VB", "Vanguard Small-Cap ETF"], ["VO", "Vanguard Mid-Cap ETF"],
  ["SCHB", "Schwab U.S. Broad Market ETF"], ["SCHX", "Schwab U.S. Large-Cap ETF"], ["SCHD", "Schwab U.S. Dividend Equity ETF"],
  ["VIG", "Vanguard Dividend Appreciation ETF"], ["VYM", "Vanguard High Dividend Yield ETF"], ["JEPI", "JPMorgan Equity Premium Income ETF"],
  ["USMV", "iShares MSCI USA Min Vol Factor ETF"], ["MTUM", "iShares MSCI USA Momentum Factor ETF"], ["QUAL", "iShares MSCI USA Quality Factor ETF"],
  ["VXUS", "Vanguard Total International Stock ETF"], ["VEA", "Vanguard FTSE Developed Markets ETF"], ["VWO", "Vanguard FTSE Emerging Markets ETF"],
  ["EFA", "iShares MSCI EAFE ETF"], ["IEFA", "iShares Core MSCI EAFE ETF"], ["EEM", "iShares MSCI Emerging Markets ETF"],
  ["IEMG", "iShares Core MSCI Emerging Markets ETF"], ["ACWI", "iShares MSCI ACWI ETF"], ["EWJ", "iShares MSCI Japan ETF"],
  ["FXI", "iShares China Large-Cap ETF"], ["INDA", "iShares MSCI India ETF"], ["EWZ", "iShares MSCI Brazil ETF"],
  ["BND", "Vanguard Total Bond Market ETF"], ["AGG", "iShares Core U.S. Aggregate Bond ETF"], ["BNDX", "Vanguard Total International Bond ETF"],
  ["BSV", "Vanguard Short-Term Bond ETF"], ["TLT", "iShares 20+ Year Treasury Bond ETF"], ["IEF", "iShares 7-10 Year Treasury Bond ETF"],
  ["SHY", "iShares 1-3 Year Treasury Bond ETF"], ["GOVT", "iShares U.S. Treasury Bond ETF"], ["VGSH", "Vanguard Short-Term Treasury ETF"],
  ["VGIT", "Vanguard Intermediate-Term Treasury ETF"], ["VGLT", "Vanguard Long-Term Treasury ETF"], ["EDV", "Vanguard Extended Duration Treasury ETF"],
  ["BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF"], ["SGOV", "iShares 0-3 Month Treasury Bond ETF"], ["TIP", "iShares TIPS Bond ETF"],
  ["LQD", "iShares iBoxx $ Investment Grade Corporate Bond ETF"], ["VCIT", "Vanguard Intermediate-Term Corporate Bond ETF"],
  ["HYG", "iShares iBoxx $ High Yield Corporate Bond ETF"], ["JNK", "SPDR Bloomberg High Yield Bond ETF"], ["MUB", "iShares National Muni Bond ETF"],
  ["GLD", "SPDR Gold Shares"], ["IAU", "iShares Gold Trust"], ["SLV", "iShares Silver Trust"], ["GDX", "VanEck Gold Miners ETF"],
  ["DBC", "Invesco DB Commodity Index Tracking Fund"], ["PDBC", "Invesco Optimum Yield Diversified Commodity Strategy No K-1 ETF"],
  ["USO", "United States Oil Fund"], ["VNQ", "Vanguard Real Estate ETF"], ["XLK", "Technology Select Sector SPDR Fund"],
  ["XLF", "Financial Select Sector SPDR Fund"], ["XLE", "Energy Select Sector SPDR Fund"], ["XLV", "Health Care Select Sector SPDR Fund"],
  ["XLI", "Industrial Select Sector SPDR Fund"], ["XLY", "Consumer Discretionary Select Sector SPDR Fund"],
  ["XLP", "Consumer Staples Select Sector SPDR Fund"], ["XLU", "Utilities Select Sector SPDR Fund"], ["XLB", "Materials Select Sector SPDR Fund"],
  ["XLRE", "Real Estate Select Sector SPDR Fund"], ["XLC", "Communication Services Select Sector SPDR Fund"],
  ["VGT", "Vanguard Information Technology ETF"], ["SMH", "VanEck Semiconductor ETF"], ["SOXX", "iShares Semiconductor ETF"],
  ["KRE", "SPDR S&P Regional Banking ETF"], ["XBI", "SPDR S&P Biotech ETF"], ["IBB", "iShares Biotechnology ETF"],
  ["ITA", "iShares U.S. Aerospace & Defense ETF"], ["ARKK", "ARK Innovation ETF"], ["IBIT", "iShares Bitcoin Trust ETF"],
  ["TQQQ", "ProShares UltraPro QQQ"], ["SQQQ", "ProShares UltraPro Short QQQ"], ["SH", "ProShares Short S&P500"],
];
const SMALL = new Set(["of", "and", "the", "de", "for", "in"]);
const TITLE = new Set(["CO", "INC", "COM", "LTD", "PLC", "LLC", "LP", "NEW", "DEL", "THE", "AND", "OF", "FOR", "IN", "DE", "ELI", "BIO"]);
// Title-case all-caps words; keep short acronyms (IBM, AMD) and anything with & (AT&T).
const tidy = (title) =>
  title
    .split(/\s+/)
    .map((w, i) => {
      if (!/^[A-Z0-9&.,'-]+$/.test(w) || !/[A-Z]/.test(w)) return w;
      if (w.includes("&") && w.length > 1) return w;
      const core = w.replace(/[.,]/g, "");
      if (core.length <= 3 && !TITLE.has(core)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(core.toLowerCase())) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
const valid = /^[A-Z][A-Z0-9]{0,9}(?:-[A-Z])?$/;
const sec = Object.values(JSON.parse(readFileSync(process.argv[2], "utf8")));
const out = [];
const seen = new Set();
for (const [t, n] of ETFS) {
  seen.add(t);
  out.push([t, n, "E"]);
}
for (const { ticker, title } of sec) {
  if (out.length >= 1600 + ETFS.length) break;
  const t = ticker.toUpperCase();
  if (!valid.test(t) || seen.has(t)) continue;
  seen.add(t);
  out.push([t, tidy(title), "S"]);
}
writeFileSync("config/securities.json", JSON.stringify(out));
console.log(`${out.length} securities`);
