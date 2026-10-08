import "server-only";
import type { LatestTreasuryYield, Result } from "@/lib/types/data";
import { PROVIDER_POLICY } from "@/config/providers";
import { oneYearStaleness } from "@/lib/treasury-data/latest";
import { marketDate } from "@/lib/utils/dates";
import { errorResult, fail } from "@/lib/utils/errors";
import { services, type DataServices } from "./analyze";

/** Cache key of the forward 1Y read. Separate from the current curve's
 * `fred:current-curve:v1`, which is unchanged; both share the Treasury TTL. */
export const FORWARD_RISK_FREE_CACHE_KEY = "fred:latest-DGS1:v1";

/** The latest available official 1-year Treasury observation for the V2 forward
 * model: the later of FRED's and the U.S. Treasury file's (FRED on equal dates),
 * through the existing Treasury providers and the shared process cache. Reads only
 * DGS1; never the curve, never another maturity. Staleness (more than seven
 * calendar days before the New York date) is judged on every read, so a cached
 * reading that ages past the limit becomes TREASURY_UNAVAILABLE. */
export async function forwardRiskFreeReading(
  now: string,
  data: DataServices = services,
): Promise<Result<LatestTreasuryYield>> {
  try {
    const r = await data.cache.get(
      FORWARD_RISK_FREE_CACHE_KEY,
      PROVIDER_POLICY.treasuryTtlMs,
      () => data.treasury.getLatestOneYearYield(now),
    );
    const stale = oneYearStaleness(r.value.observationDate, marketDate(now));
    if (stale) fail("TREASURY_UNAVAILABLE", stale, { retryable: true });
    return {
      ok: true,
      value: {
        ...r.value,
        provenance: {
          ...r.value.provenance,
          cacheAgeSeconds: r.value.provenance.cacheAgeSeconds + r.ageSeconds,
        },
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}
