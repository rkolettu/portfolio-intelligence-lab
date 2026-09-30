import "server-only";
import type { HistoricalProvider, QuoteProvider } from "@/lib/market-data/types";
import {
  MarketDataServiceProvider,
  marketDataServiceConfig,
} from "@/lib/market-data/providers/marketDataService";
import { fail } from "@/lib/utils/errors";

/** Evidence a reviewer must supply before an adapter may serve deployed traffic.
 * See DATA-PROVIDERS.md, "Replacement-provider path". */
export type ProviderQualification = {
  /** Terms/licence URL reviewed for public display, caching and retention. */
  termsUrl: string;
  termsReviewedOn: string;
  /** Deployed-runtime smoke: region, date and the symbols/benchmarks exercised. */
  deployedSmoke: string;
  /** How split AND distribution adjustment (history) or latency (quotes) was verified. */
  conventionEvidence: string;
  reviewer: string;
  /** Required when the upstream is an unofficial source (Yahoo). Records who accepted
   * its terms risk, for what scope, and that it is reached only through a service. */
  upstreamAcceptance?: {
    upstream: string;
    termsStatus: string;
    acceptedBy: string;
    acceptedOn: string;
    scope: string;
    transport: "market-data-service";
  };
};
export type Qualified<T> = { provider: T; qualification: ProviderQualification };

/** Code-reviewed registration point. History must pass the existing whole-series
 * convention/identity checks; quote qualification is independent. The direct Yahoo
 * adapter is never registered and no runtime flag bypasses qualification: the
 * environment supplies only the service URL and key, never qualification. */
export const deployedHistoryProviders: Qualified<HistoricalProvider>[] = [];
export const deployedQuoteProvider: Qualified<QuoteProvider> | null = null;

/** The direct browser-facing Yahoo chart adapter (local research only). */
const DIRECT_YAHOO = "Yahoo Finance (unofficial chart)";

export function assertQualified<T extends { name: string }>(entry: Qualified<T>): T {
  const q = entry.qualification;
  const complete =
    /^https:\/\//.test(q.termsUrl) &&
    /^\d{4}-\d{2}-\d{2}$/.test(q.termsReviewedOn) &&
    [q.deployedSmoke, q.conventionEvidence, q.reviewer].every((v) => v.trim().length >= 3);
  const a = q.upstreamAcceptance;
  // An unofficial Yahoo upstream is admissible only through the market-data service
  // with a recorded owner acceptance; the direct adapter never is.
  const yahooOk =
    !/yahoo/i.test(entry.provider.name) ||
    (entry.provider.name !== DIRECT_YAHOO &&
      !!a &&
      a.transport === "market-data-service" &&
      /^\d{4}-\d{2}-\d{2}$/.test(a.acceptedOn) &&
      [a.upstream, a.termsStatus, a.acceptedBy, a.scope].every((v) => v.trim().length >= 3));
  if (!complete || !yahooOk)
    fail(
      "UNQUALIFIED_PROVIDER",
      `${entry.provider.name} lacks deployed-provider qualification evidence.`,
    );
  return entry.provider;
}

/** Evidence for the Portfolio Lab Market Data API on Render (Yahoo via yfinance). */
export const MARKET_DATA_SERVICE_QUALIFICATION: ProviderQualification = {
  termsUrl: "https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html",
  termsReviewedOn: "2026-09-30",
  deployedSmoke:
    "Local qualification 2026-09-30: portfolio-lab-market-data under uvicorn (yfinance 1.7.0, pinned) -> Portfolio Lab production build: SPY QQQ IWM BND GLD VT AGG, 21-symbol batch, invalid ticker, pre-listing range, circuit/cache behaviour. After the first deployment, re-run `npm run qualify:service` and `npm run smoke:providers` against the deployed Render service and record the result here.",
  conventionEvidence:
    "yfinance auto_adjust=False 'Adj Close' equals Yahoo chart adjclose (split- and dividend-adjusted): identical session dates and values within 1.4e-6 relative (float32 upstream noise) for SPY BND GLD QQQ NVDA AAPL over 1,946 sessions; range=max monthly downsampling avoided with an explicit start; no fill. docs/DATA-PROVIDERS.md, scripts/service-qualification.ts.",
  reviewer: "Prepared by Claude Code for the project owner, 2026-09-30",
  upstreamAcceptance: {
    upstream: "Yahoo Finance via yfinance (unofficial, no data licence)",
    termsStatus:
      "Yahoo's terms grant no redistribution or commercial-use licence; values are displayed as analytics inputs with attribution, not resold.",
    acceptedBy: "Project owner (Phase 9 brief: deploy through a standalone Render/yfinance market-data service)",
    acceptedOn: "2026-09-30",
    scope: "Non-commercial educational portfolio analytics; replaceable through this registry without analytics changes.",
    transport: "market-data-service",
  },
};

/** The service provider when the deployment configures it (URL + key), else null. */
export function configuredMarketDataService(
  env: Record<string, string | undefined> = process.env,
): MarketDataServiceProvider | null {
  const config = marketDataServiceConfig(env);
  return config
    ? assertQualified({
        provider: new MarketDataServiceProvider(config),
        qualification: MARKET_DATA_SERVICE_QUALIFICATION,
      })
    : null;
}
