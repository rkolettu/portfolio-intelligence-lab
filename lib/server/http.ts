import "server-only";
import { fail, LabError } from "@/lib/utils/errors";
export type Fetcher = (
  url: string,
  init?: RequestInit & { next?: { revalidate: number } },
) => Promise<Response>;
export async function fetchPublic(
  url: string,
  ttlSeconds: number,
  fetcher: Fetcher = fetch,
  timeoutMs = 4000,
  /** Error statuses returned with their body for the caller to interpret. */
  passStatuses: readonly number[] = [],
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new LabError({
            code: "TIMEOUT",
            message: "Provider request timed out.",
            retryable: true,
          }),
        );
      }, timeoutMs);
    });
    const work = async () => {
      const response = await fetcher(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PortfolioLab/0.1)",
          Accept: "application/json,text/csv,text/plain",
        },
        signal: controller.signal,
        next: { revalidate: ttlSeconds },
      });
      if (response.status === 404)
        fail("TICKER_NOT_FOUND", "Ticker or data series was not found.");
      if (response.status === 401 || response.status === 403)
        fail("PERMISSION", "The provider denied access.");
      if (response.status === 429)
        fail("RATE_LIMIT", "Provider rate limit reached. Try again later.", {
          retryable: true,
        });
      if (!response.ok && !passStatuses.includes(response.status))
        fail("PROVIDER_ERROR", `Provider returned HTTP ${response.status}.`, {
          retryable: true,
        });
      // Consume the body inside the timeout as well; receiving headers is not a completed fetch.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 16_000_000) {
              void reader.cancel();
              fail(
                "MALFORMED_DATA",
                "Provider response exceeds the data limit.",
              );
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const content = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(content, {
        status: response.status,
        headers: response.headers,
      });
    };
    try {
      return await Promise.race([work(), timeout]);
    } catch (error) {
      if (
        error instanceof LabError &&
        (!error.detail.retryable ||
          error.detail.code === "RATE_LIMIT" ||
          attempt === 1)
      )
        throw error;
      if (attempt === 1) {
        if (controller.signal.aborted)
          fail("TIMEOUT", "Provider request timed out.", { retryable: true });
        fail("PROVIDER_ERROR", "Provider connection failed.", {
          retryable: true,
        });
      }
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail("PROVIDER_ERROR", "Provider request failed.", { retryable: true });
}
