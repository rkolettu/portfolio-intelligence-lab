import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const runtime = "nodejs";

/** Last-known-good sample analysis (and its stress events), produced from real
 * data by `npm run sample:snapshot`. Offered only for the sample portfolio when the
 * market-data service is unavailable, and always labelled as cached. */
export async function GET() {
  try {
    const gz = await readFile(
      path.join(process.cwd(), "data", "cached-sample.json.gz"),
    );
    return new Response(gunzipSync(gz), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          message: "No cached sample is available in this deployment.",
          retryable: false,
        },
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
