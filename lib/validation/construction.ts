import { z } from "zod";
import type { ConstructionRequest } from "@/lib/types/construction";
import { parsePortfolio } from "./portfolio";
import { symbolSchema } from "./symbols";
import { fail } from "@/lib/utils/errors";

const schema = z
  .object({
    config: z.unknown(),
    constraints: z
      .array(
        z
          .object({
            ticker: symbolSchema,
            minWeight: z.number(),
            maxWeight: z.number(),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    cash: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("current") }).strict(),
      z.object({ mode: z.literal("fixed"), weight: z.number() }).strict(),
    ]),
  })
  .strict();

/** Shape-level validation of a construction request. Bound values themselves are
 * judged by the feasibility check, which reports invalid inputs per method. */
export function parseConstructionRequest(
  input: unknown,
  today: string,
): ConstructionRequest {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    fail(
      "INVALID_INPUT",
      "A construction request contains the analyzed configuration, per-asset constraints and a CASH choice.",
    );
  const config = parsePortfolio(parsed.data.config, today);
  const tickers = parsed.data.constraints.map((c) => c.ticker);
  if (new Set(tickers).size !== tickers.length)
    fail("INVALID_INPUT", "Each eligible asset may have only one constraint.");
  const universe = new Set(
    config.holdings.filter((h) => h.ticker !== "CASH").map((h) => h.ticker),
  );
  for (const t of tickers)
    if (!universe.has(t))
      fail(
        "INVALID_INPUT",
        `${t} is not in the eligible universe; add it to the portfolio (0% is allowed) and re-run the analysis.`,
      );
  return {
    config,
    constraints: parsed.data.constraints,
    cash: parsed.data.cash,
  };
}
