import "server-only";
import { allowRequest } from "./rateLimit";
import { errorResult, fail } from "@/lib/utils/errors";
export async function handleJson(
  request: Request,
  run: (input: unknown, now: string) => Promise<unknown>,
): Promise<Response> {
  try {
    const key =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    if (!allowRequest(key))
      return Response.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMIT",
            message: "Too many requests. Try again in a minute.",
            retryable: true,
          },
        },
        { status: 429 },
      );
    // Same-origin route; reject cross-site browsers before spending upstream quota.
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        fail("PERMISSION", "Invalid browser origin.");
      }
      // Next/Vercel can reconstruct request.url with an internal host/protocol.
      const browserHost =
        request.headers.get("host") ?? new URL(request.url).host;
      if (
        originHost !== browserHost ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        fail("PERMISSION", "Cross-origin analysis requests are not supported.");
    }
    const body = await request.text();
    if (body.length > 16000)
      fail("INVALID_INPUT", "Request body exceeds the input limit.");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      fail("INVALID_INPUT", "Request must be valid JSON.");
    }
    const result = await run(input, new Date().toISOString());
    const json = JSON.stringify(result);
    // Vercel's 4.5 MB limit applies to buffered responses. A pull-based stream
    // preserves every observation, applies backpressure and stops on cancellation.
    // Slice UTF-8 bytes, not JS characters; the browser decodes across chunk boundaries.
    let bytes: Uint8Array | null = new TextEncoder().encode(json);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!bytes || offset >= bytes.length) {
          bytes = null;
          controller.close();
          return;
        }
        const end = Math.min(offset + 65536, bytes.length);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
      cancel() {
        bytes = null; // Client went away: release the encoded snapshot promptly.
      },
    });
    // No `no-transform`: the CDN may gzip/brotli this JSON while streaming it.
    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const result = errorResult(error);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
      status: result.ok
        ? 200
        : result.error.code === "INVALID_INPUT"
          ? 400
          : result.error.code === "PERMISSION"
            ? 403
            : 502,
    });
  }
}
