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
    .max(METHODOLOGY.maxHoldings),
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
  return {
    ...p,
    holdings: p.holdings.map((h) => ({ ...h, weight: h.weight / total })),
  };
}
