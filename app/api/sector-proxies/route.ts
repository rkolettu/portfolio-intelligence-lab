import { handleJson } from "@/lib/server/route";
import { sectorProxyReturns } from "@/lib/server/sectorProxies";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleJson(request, sectorProxyReturns);
}
