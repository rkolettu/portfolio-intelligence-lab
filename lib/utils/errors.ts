import type { DataError, ErrorCode, Result } from "@/lib/types/data";
export class LabError extends Error {
  constructor(readonly detail: DataError) {
    super(detail.message);
  }
}
export function fail(
  code: ErrorCode,
  message: string,
  extra: Partial<DataError> = {},
): never {
  throw new LabError({ code, message, retryable: false, ...extra });
}
export function errorResult<T>(error: unknown): Result<T> {
  return {
    ok: false,
    error:
      error instanceof LabError
        ? error.detail
        : {
            code: "PROVIDER_ERROR",
            message: "The data request failed. Retry or edit the portfolio.",
            retryable: true,
          },
  };
}
