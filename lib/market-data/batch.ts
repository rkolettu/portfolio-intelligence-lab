import type { Result } from "@/lib/types/data";
import { LabError } from "@/lib/utils/errors";

/** Collects every call made in the same tick and runs them as one upstream batch
 * (chunked to `maxBatch`). Each caller receives its own result or typed failure;
 * a batch-level failure (transport, auth) rejects every caller in that chunk. */
export function microBatcher<Req, Res>(
  maxBatch: number,
  run: (requests: Req[]) => Promise<Result<Res>[]>,
): (request: Req) => Promise<Res> {
  let queue: {
    request: Req;
    resolve: (v: Res) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const flush = async () => {
    const items = queue;
    queue = [];
    for (let i = 0; i < items.length; i += maxBatch) {
      const chunk = items.slice(i, i + maxBatch);
      try {
        const results = await run(chunk.map((c) => c.request));
        chunk.forEach((c, k) => {
          const r = results[k];
          if (!r)
            c.reject(
              new LabError({
                code: "MALFORMED_DATA",
                message: "Market-data response is missing a result.",
                retryable: true,
              }),
            );
          else if (r.ok) c.resolve(r.value);
          else c.reject(new LabError(r.error));
        });
      } catch (error) {
        chunk.forEach((c) => c.reject(error));
      }
    }
  };
  return (request) =>
    new Promise<Res>((resolve, reject) => {
      if (!queue.length) queueMicrotask(() => void flush());
      queue.push({ request, resolve, reject });
    });
}
