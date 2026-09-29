// Opt-in live qualification smoke; never part of routine tests. Local only.
import {
  analyze,
  currentQuotes,
  currentTreasury,
  services,
} from "../lib/server/analyze";
import { stress } from "../lib/server/stress";
import { construct } from "../lib/server/construction";
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
          performance: Object.fromEntries(
            Object.entries({
              ...result.value.performance.portfolio,
              ...result.value.performance.risk,
              currentDrawdown: result.value.performance.currentDrawdown,
            }).map(([k, m]) => [k, m.available ? m.value : `N/A: ${m.reason}`]),
          ),
          maximumDrawdownEpisode:
            result.value.performance.maximumDrawdownEpisode,
          risk: (() => {
            const r = result.value.riskAnalytics;
            const val = (m: {
              available: boolean;
              value?: number;
              reason?: string;
            }) => (m.available ? m.value : `N/A: ${m.reason}`);
            return {
              sample: r.sample.available
                ? {
                    ...r.sample.sample,
                    status: r.sample.status,
                    tickers: r.sample.tickers,
                  }
                : r.sample,
              volatility: val(r.portfolio.volatility),
              weightedAverageVolatility: val(
                r.portfolio.weightedAverageVolatility,
              ),
              diversificationRatio: val(r.portfolio.diversificationRatio),
              concentration: r.concentration,
              identityResiduals: r.portfolio.identityResiduals,
              holdings: r.holdings.map((h) => ({
                ticker: h.ticker,
                weight: h.weight,
                volatility: val(h.volatility),
                beta: val(h.beta),
                mrc: val(h.marginal),
                crc: val(h.component),
                pcr: val(h.percentage),
              })),
              highest: r.correlation.available ? r.correlation.highest : null,
              lowest: r.correlation.available ? r.correlation.lowest : null,
              returnContribution: r.returnContribution.rows,
              sumOfDailyReturns: r.returnContribution.sumOfDailyReturns,
            };
          })(),
          rolling: (() => {
            const r = result.value.rollingAnalytics;
            const summary = (m: typeof r.volatility) =>
              m.available
                ? m.series.map((s) => ({
                    window: s.window,
                    validCount: s.validCount,
                    firstDate: s.firstDate,
                    latest: s.values.at(-1),
                    undefinedCount: s.undefinedCount,
                  }))
                : `N/A: ${m.reason}`;
            return {
              version: r.methodologyVersion,
              dates: r.dates.length,
              volatility: summary(r.volatility),
              beta: summary(r.beta),
              correlation: summary(r.correlation),
            };
          })(),
          benchmarkComparison: result.value.benchmarkAnalytics.comparison
            .available
            ? {
                ...result.value.benchmarkAnalytics.comparison.sample,
                riskFree: result.value.benchmarkAnalytics.riskFree,
              }
            : result.value.benchmarkAnalytics.comparison,
          benchmarkMetrics: Object.fromEntries(
            Object.entries({
              ...result.value.benchmarkAnalytics.relative,
              ...result.value.benchmarkAnalytics.geometric,
              ...(result.value.benchmarkAnalytics.drawdown.available
                ? {
                    benchmarkMaximumDrawdown:
                      result.value.benchmarkAnalytics.drawdown.maximumDrawdown,
                  }
                : {}),
            }).map(([k, m]) => [k, m.available ? m.value : `N/A: ${m.reason}`]),
          ),
        }
      : result,
    null,
    2,
  ),
);
// Falsifiable release-timing check: every observation the model says is known by
// `now` must already be served by FRED; otherwise the model is too aggressive.
const rates = await services.treasury.getHistoricalRates(
  addDays(today, -21),
  today,
  now,
);
const latestServed = rates.observations.at(-1)?.date ?? null;
let modelClaimsKnown: string | null = null;
for (let d = today; d >= addDays(today, -21); d = addDays(d, -1))
  if (
    federalBusinessDay(d) &&
    Date.parse(modeledAvailableAt(d)) <= Date.parse(now)
  ) {
    modelClaimsKnown = d;
    break;
  }
console.log(
  "TREASURY_TIMING",
  JSON.stringify({
    latestServed,
    latestServedModeledAvailableAt: rates.observations.at(-1)?.availableAt,
    modelClaimsKnownThrough: modelClaimsKnown,
    servedButNotYetModeledAvailable: rates.observations
      .filter((r) => Date.parse(r.availableAt) > Date.parse(now))
      .map((r) => r.date),
    modelConservative:
      latestServed !== null &&
      modelClaimsKnown !== null &&
      latestServed >= modelClaimsKnown,
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
// Stress Lab: its own request, snapshot and hash; the analysis above is untouched.
const started = Date.now();
const events = await stress({ config }, now);
console.log(
  "STRESS",
  JSON.stringify(
    events.ok
      ? {
          ok: true,
          ms: Date.now() - started,
          version: events.value.methodologyVersion,
          windows: events.value.windowsVersion,
          snapshotHash: events.value.metadata.snapshotHash,
          responseBytes: Buffer.byteLength(JSON.stringify(events)),
          events: events.value.events.map((e) =>
            e.status === "complete"
              ? {
                  id: e.id,
                  window: `${e.startDate} → ${e.endDate}`,
                  returns: e.sample.returnCount,
                  portfolio: e.portfolioReturn.available
                    ? e.portfolioReturn.value
                    : e.portfolioReturn.reason,
                  benchmark: e.benchmarkReturn.available
                    ? e.benchmarkReturn.value
                    : e.benchmarkReturn.reason,
                  active: e.activeReturn.available
                    ? e.activeReturn.value
                    : e.activeReturn.reason,
                  maximumDrawdown: e.maximumDrawdown.available
                    ? e.maximumDrawdown.value
                    : e.maximumDrawdown.reason,
                  best: e.best,
                  worst: e.worst,
                  rebalances: e.rebalances,
                  holdings: e.holdings.map((h) => [h.ticker, h.return]),
                }
              : e,
          ),
        }
      : events,
  ),
);
if (!events.ok) process.exitCode = 1;
// Portfolio construction: its own request, snapshot and hash; default constraints,
// CASH fixed at the current weight. Mathematical allocations, not recommendations.
const constructionStarted = Date.now();
const built = result.ok
  ? await construct(
      {
        config: result.value.config,
        constraints: [],
        cash: { mode: "current" },
      },
      now,
    )
  : null;
console.log(
  "CONSTRUCTION",
  JSON.stringify(
    built?.ok
      ? {
          ok: true,
          ms: Date.now() - constructionStarted,
          snapshotHash: built.value.metadata.snapshotHash,
          responseBytes: Buffer.byteLength(JSON.stringify(built)),
          estimation: built.value.estimation.available
            ? {
                ...built.value.estimation.sample,
                status: built.value.estimation.status,
              }
            : built.value.estimation,
          covariance: built.value.covariance.available
            ? {
                shrinkage: built.value.covariance.shrinkage,
                conditioning: built.value.covariance.conditioning,
                hash: built.value.covariance.hash,
              }
            : built.value.covariance,
          proposals: built.value.proposals.map((p) => ({
            method: p.method,
            status: p.status,
            label: p.label,
            weights: p.weights,
            turnover: p.turnover,
            modelVolatility: p.modelRisk.available
              ? p.modelRisk.volatility
              : null,
            residuals: p.diagnostics.residuals,
            iterations: p.diagnostics.iterations,
            binding: p.diagnostics.binding,
          })),
        }
      : built,
  ),
);
if (built && !built.ok) process.exitCode = 1;
if (!result.ok) process.exitCode = 1;
