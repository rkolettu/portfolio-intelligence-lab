import { z } from "zod";
import { METHODOLOGY } from "@/config/methodology";
import { dateSchema } from "./dates";
import { symbolSchema } from "./symbols";
import { yearsBefore, validDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
import type { PortfolioConfig } from "@/lib/types/portfolio";
const schema = z.object({
  holdings: z
    .array(
      z.object({ ticker: symbolSchema, weight: z.number().finite().min(0) }),
    )
    .min(1)
    // Anti-abuse bound only; the product rule (at most maxHoldings risky holdings
    // plus CASH, which never uses a risky slot) is checked below with its own message.
    .max(64),
  benchmark: symbolSchema.refine(
    (t) => t !== "CASH",
    "Benchmark must be a security.",
  ),
  requestedStartDate: dateSchema,
  endDate: dateSchema,
  rebalanceFrequency: z.literal("monthly"),
  cashPolicy: z.enum(["historical_proxy", "zero_explicit"]),
});
export function parsePortfolio(input: unknown, today: string): PortfolioConfig {
  if (!validDate(today)) fail("INVALID_INPUT", "Invalid validation clock.");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    fail(
      "INVALID_INPUT",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  const p = parsed.data;
  if (new Set(p.holdings.map((h) => h.ticker)).size !== p.holdings.length)
    fail("INVALID_INPUT", "Duplicate tickers are not allowed.");
  if (
    p.holdings.filter((h) => h.ticker !== "CASH").length >
    METHODOLOGY.maxHoldings
  )
    fail(
      "INVALID_INPUT",
      `Use at most ${METHODOLOGY.maxHoldings} risky holdings plus CASH.`,
    );
  const total = p.holdings.reduce((s, h) => s + h.weight, 0);
  if (Math.abs(total - 1) > METHODOLOGY.weightTolerance)
    fail(
      "INVALID_INPUT",
      "Weights must total 100% (tolerance 0.0001 percentage points).",
    );
  if (
    p.requestedStartDate >= p.endDate ||
    p.endDate > today ||
    p.requestedStartDate < yearsBefore(p.endDate, METHODOLOGY.maxYears)
  )
    fail(
      "INVALID_INPUT",
      "Start must precede end, end cannot be in the future, and the range cannot exceed 50 years.",
    );
  // Normalize an accepted residual once. A total that differs from 1 only by
  // floating-point noise (e.g. 0.6 + 0.3 + 0.1) is left as entered, so parsing an
  // already-parsed configuration is idempotent and snapshot replay is exact.
  return Math.abs(total - 1) <= 1e-13
    ? p
    : {
        ...p,
        holdings: p.holdings.map((h) => ({ ...h, weight: h.weight / total })),
      };
}
