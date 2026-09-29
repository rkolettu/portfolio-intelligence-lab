import "server-only";
import type { HistoricalProvider, QuoteProvider } from "@/lib/market-data/types";
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
};
export type Qualified<T> = { provider: T; qualification: ProviderQualification };

/** Code-reviewed registration point. History must pass the existing whole-series
 * convention/identity checks; quote qualification is independent. Never add Yahoo
 * here or let a runtime environment flag bypass qualification. */
export const deployedHistoryProviders: Qualified<HistoricalProvider>[] = [];
export const deployedQuoteProvider: Qualified<QuoteProvider> | null = null;

export function assertQualified<T extends { name: string }>(entry: Qualified<T>): T {
  const q = entry.qualification;
  const complete =
    /^https:\/\//.test(q.termsUrl) &&
    /^\d{4}-\d{2}-\d{2}$/.test(q.termsReviewedOn) &&
    [q.deployedSmoke, q.conventionEvidence, q.reviewer].every((v) => v.trim().length >= 3);
  if (!complete || /yahoo/i.test(entry.provider.name))
    fail(
      "UNQUALIFIED_PROVIDER",
      `${entry.provider.name} lacks deployed-provider qualification evidence.`,
    );
  return entry.provider;
}
