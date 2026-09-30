import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { toDigest } from "@/components/observatory/digest";
import type { BacktestResult, StressAnalytics } from "@/lib/types/analytics";

export const runtime = "nodejs";

/** A few kilobytes of the cached sample analysis (see `digest.ts`) for the landing
 * page's illustrated chapters. Read-only; always labelled as cached by the UI. */
export async function GET() {
  try {
    const gz = await readFile(
      path.join(process.cwd(), "data", "cached-sample.json.gz"),
    );
    const cached = JSON.parse(gunzipSync(gz).toString("utf8")) as {
      ok: boolean;
      value: {
        refreshedAt: string;
        provider: string;
        analysis: BacktestResult;
        stress: StressAnalytics | null;
      };
    };
    if (!cached.ok) throw new Error("no sample");
    const { refreshedAt, provider, analysis, stress } = cached.value;
    return Response.json(toDigest(refreshedAt, provider, analysis, stress), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return Response.json(
      { error: "No cached sample is available in this deployment." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
