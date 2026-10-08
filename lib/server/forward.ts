import "server-only";
import type { LatestTreasuryYield, Result } from "@/lib/types/data";
import { PROVIDER_POLICY } from "@/config/providers";
import { errorResult } from "@/lib/utils/errors";
import { services, type DataServices } from "./analyze";

/** Cache key of the forward 1Y read. Separate from the current curve's
 * `fred:current-curve:v1`, which is unchanged; both share the Treasury TTL. */
export const FORWARD_RISK_FREE_CACHE_KEY = "fred:latest-DGS1:v1";

/** The latest available official 1-year Treasury observation for the V2 forward
 * model, through the existing FRED → U.S. Treasury fallback provider and the shared
 * process cache. Reads only DGS1; never the curve, never another maturity. */
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
