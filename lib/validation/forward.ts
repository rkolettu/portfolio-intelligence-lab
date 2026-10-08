import { z } from "zod";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ForwardAssumptionState,
  ForwardAssumptions,
  ViewState,
} from "@/lib/types/forward";
import { fail } from "@/lib/utils/errors";
import { symbolSchema } from "./symbols";

const { riskWindows, marketProxies } = FORWARD_METHODOLOGY;

export const riskWindowSchema = z.enum(riskWindows, {
  error: `The risk window must be one of ${riskWindows.join(", ")}.`,
});

/** Broad equity funds only: a bond ETF (or any other fund) can never become the
 * market portfolio. Custom proxies are a later, separately approved change. */
export const marketProxySchema = z.enum(marketProxies, {
  error: `The market proxy must be ${marketProxies.join(", ")}; a bond or other non-market fund cannot stand in for the market portfolio.`,
});

/** Numeric sanity only (finite, above −100%); no economic range is imposed. */
export const marketRiskPremiumSchema = z
  .number({ error: "The Market Risk Premium must be a finite number." })
  .gt(-1, "The Market Risk Premium must be greater than −100%.");

export const forwardAssumptionsSchema = z
  .object({
    riskWindow: riskWindowSchema,
    marketProxy: marketProxySchema,
    marketRiskPremium: marketRiskPremiumSchema,
  })
  .strict();

export const confidenceSchema = z
  .number({ error: "Confidence must be a finite number." })
  .min(0, "Confidence must be between 0% and 100%.")
  .max(1, "Confidence must be between 0% and 100%.");

export const viewSchema = z
  .object({
    source: z.enum(["none", "street", "manual"]),
    /** A long position cannot lose more than 100%. */
    manualReturn: z
      .number({ error: "A manual view must be a finite number." })
      .gt(-1, "A manual 12-month expected return must be greater than −100%.")
      .nullable(),
    confidence: confidenceSchema,
  })
  .strict()
  .refine((v) => v.source !== "manual" || v.manualReturn !== null, {
    error: "A manual view needs a 12-month expected return.",
    path: ["manualReturn"],
  });

/** Views keyed by canonical ticker. Keys must already be normalized (so "aapl"
 * and "AAPL" can never silently collide) and CASH never carries a view. Keys are
 * checked on the raw input, before the record parse: Zod's record drops keys such
 * as "__proto__" without an issue, which would silently lose a view. */
export const viewStateSchema = z
  .unknown()
  .superRefine((input, ctx) => {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return; // the record parse reports the type error
    for (const ticker of Object.keys(input)) {
      const parsed = symbolSchema.safeParse(ticker);
      if (!parsed.success || parsed.data !== ticker || ticker === "CASH")
        ctx.addIssue({
          code: "custom",
          message: `${ticker}: views are keyed by canonical U.S. tickers, and CASH carries no view.`,
          path: [ticker],
        });
    }
  })
  .pipe(z.record(z.string(), viewSchema));

export const forwardStateSchema = z
  .object({ assumptions: forwardAssumptionsSchema, views: viewStateSchema })
  .strict();

function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    fail(
      "INVALID_INPUT",
      parsed.error.issues
        .map((i) =>
          i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
        )
        .join("; "),
    );
  return parsed.data;
}

export const parseForwardAssumptions = (input: unknown): ForwardAssumptions =>
  parseWith(forwardAssumptionsSchema, input);
export const parseViewState = (input: unknown): ViewState =>
  parseWith(viewStateSchema, input);
export const parseForwardState = (input: unknown): ForwardAssumptionState =>
  parseWith(forwardStateSchema, input);
