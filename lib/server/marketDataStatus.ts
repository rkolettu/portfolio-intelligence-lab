import "server-only";
import { z } from "zod";
import { MarketDataServiceProvider } from "@/lib/market-data/providers/marketDataService";
import { fail } from "@/lib/utils/errors";
import { services, type DataServices } from "./analyze";

export type MarketDataStatus = {
  /** service: the Render market-data service; direct: local research adapter;
   * unavailable: this deployment has no equity history provider. */
  mode: "service" | "direct" | "unavailable";
  ready: boolean;
  latencyMs: number;
  circuit?: string;
  retryAfterSeconds?: number;
  prewarm?: string;
};

const input = z.object({ waitMs: z.number().int().min(0).max(45_000).optional() }).strict();

/** Advisory readiness for the loading stages. Waits (bounded) for a sleeping
 * service to wake, so the browser can say so truthfully. It never gates analysis:
 * the analysis request itself returns the authoritative result or failure. */
export async function marketDataStatus(
  body: unknown,
  _now: string,
  data: DataServices = services,
): Promise<MarketDataStatus> {
  const parsed = input.safeParse(body ?? {});
  if (!parsed.success) fail("INVALID_INPUT", "Invalid status request.");
  const provider = data.history[0];
  if (!provider) return { mode: "unavailable", ready: false, latencyMs: 0 };
  if (!(provider instanceof MarketDataServiceProvider))
    return { mode: "direct", ready: true, latencyMs: 0 };
  return { mode: "service", ...(await provider.health(parsed.data.waitMs ?? 45_000)) };
}
