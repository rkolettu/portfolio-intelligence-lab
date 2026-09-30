// Refresh the last-known-good sample (data/cached-sample.json.gz) from real data
// through the configured provider: the market-data service when
// MARKET_DATA_SERVICE_URL/KEY are set, otherwise the local research adapter.
//   npx tsx --conditions=react-server scripts/cached-sample.ts
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { analyze, services } from "@/lib/server/analyze";
import { stress } from "@/lib/server/stress";
import { samplePortfolio } from "@/config/samplePortfolio";
import { marketDate } from "@/lib/utils/dates";

const now = new Date().toISOString();
const sample = samplePortfolio(marketDate(now));
if (!services.history.length) throw new Error("No historical provider is configured.");
const analysis = await analyze(sample, now);
if (!analysis.ok) throw new Error(`Sample analysis failed: ${analysis.error.message}`);
const events = await stress({ config: sample }, now);
const body = {
  ok: true,
  value: {
    refreshedAt: analysis.value.metadata.generatedAt,
    provider: services.history.map((p) => p.name).join(", "),
    analysis: analysis.value,
    stress: events.ok ? events.value : null,
  },
};
const gz = gzipSync(JSON.stringify(body), { level: 9 });
writeFileSync("data/cached-sample.json.gz", gz);
console.log(
  `Cached sample: ${analysis.value.initialDate} → ${analysis.value.metadata.effectiveEndDate}, ` +
    `stress ${events.ok ? "included" : "unavailable"}, ${(gz.length / 1024).toFixed(0)} KiB gzip, ` +
    `provider ${body.value.provider}.`,
);
