// Opt-in live qualification smoke; never part of routine tests. Local only.
import {
  analyze,
  currentQuotes,
  currentTreasury,
  services,
} from "../lib/server/analyze";
import { samplePortfolio } from "../config/samplePortfolio";
import { PROVIDER_POLICY } from "../config/providers";
import { CALENDAR_COVERAGE, CALENDAR_VERSION } from "../lib/backtest/calendar";
import {
  FEDERAL_CALENDAR_VERSION,
  federalBusinessDay,
  modeledAvailableAt,
} from "../lib/treasury-data/normalize";
import { addDays, marketDate } from "../lib/utils/dates";
const now = new Date().toISOString();
const today = marketDate(now);
console.log(
  "POLICY",
  JSON.stringify({
    now,
    yahooLocalResearch: PROVIDER_POLICY.yahooEnabled,
    calendar: CALENDAR_VERSION,
    calendarCoverage: CALENDAR_COVERAGE,
    federalCalendar: FEDERAL_CALENDAR_VERSION,
  }),
);
const config = samplePortfolio(today);
const result = await analyze(config, now);
console.log(
  JSON.stringify(
    result.ok
      ? {
          ok: true,
          requested: config,
          effectiveStart: result.value.initialDate,
          effectiveEnd: result.value.metadata.effectiveEndDate,
          returns: result.value.ledger.length,
          terminalWealth: result.value.ledger.at(-1)?.wealth,
          snapshotHash: result.value.metadata.snapshotHash,
          providers: result.value.metadata.historicalProviders,
          benchmark: result.value.benchmark.ok,
          coverage: result.value.coverage,
          responseBytes: Buffer.byteLength(JSON.stringify(result)),
        }
      : result,
    null,
    2,
  ),
);
// Falsifiable release-timing check: every observation the model says is known by
// `now` must already be served by FRED; otherwise the model is too aggressive.
const rates = await services.treasury.getHistoricalRates(addDays(today, -21), today, now);
const latestServed = rates.observations.at(-1)?.date ?? null;
let modelClaimsKnown: string | null = null;
for (let d = today; d >= addDays(today, -21); d = addDays(d, -1))
  if (federalBusinessDay(d) && Date.parse(modeledAvailableAt(d)) <= Date.parse(now)) {
    modelClaimsKnown = d;
    break;
  }
console.log(
  "TREASURY_TIMING",
  JSON.stringify({
    latestServed,
    latestServedModeledAvailableAt: rates.observations.at(-1)?.availableAt,
    modelClaimsKnownThrough: modelClaimsKnown,
    servedButNotYetModeledAvailable: rates.observations.filter(
      (r) => Date.parse(r.availableAt) > Date.parse(now),
    ).map((r) => r.date),
    modelConservative:
      latestServed !== null && modelClaimsKnown !== null && latestServed >= modelClaimsKnown,
  }),
);
console.log(
  "QUOTES",
  JSON.stringify(
    (await currentQuotes(["SPY"], now)).map((q) =>
      q.ok
        ? {
            ok: true,
            status: q.value.status,
            provider: q.value.provider,
            marketTimestamp: q.value.marketTimestamp,
            staleAfter: q.value.staleAfter,
            stale: q.value.stale,
            fallbackReason: q.value.provenance.fallbackReason,
          }
        : q,
    ),
  ),
);
console.log("TREASURY", JSON.stringify(await currentTreasury(now)));
if (!result.ok) process.exitCode = 1;
