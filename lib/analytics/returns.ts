import { fail } from "@/lib/utils/errors";
export function arithmeticReturn(previous: number, current: number): number {
  if (
    !Number.isFinite(previous) ||
    !Number.isFinite(current) ||
    previous <= 0 ||
    current <= 0
  )
    fail(
      "MALFORMED_DATA",
      "Adjusted prices must be positive and finite; terminal events require separate accounting.",
    );
  const result = current / previous - 1;
  if (!Number.isFinite(result) || result <= -1)
    fail("MALFORMED_DATA", "Return exceeds the numerical range.");
  return result;
}
export function compoundWealth(initial: number, returns: number[]): number[] {
  if (!Number.isFinite(initial) || initial <= 0)
    fail("INVALID_INPUT", "Initial wealth must be positive and finite.");
  const values = [initial];
  for (const r of returns) {
    const next = values[values.length - 1] * (1 + r);
    if (!Number.isFinite(r) || r <= -1 || !Number.isFinite(next) || next <= 0)
      fail("MALFORMED_DATA", "Invalid or non-finite compounded wealth.");
    values.push(next);
  }
  return values;
}
