import { z } from "zod";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  ForwardAssumptionState,
  ForwardAssumptions,
  ViewState,
} from "@/lib/types/forward";
import { fail } from "@/lib/utils/errors";
import { symbolSchema } from "./symbols";

const {
  riskWindows,
  marketProxies,
  marketRiskPremiumRange: MRP,
  views: { manualReturnRange: MANUAL },
} = FORWARD_METHODOLOGY;
const pct = (x: number) =>
  `${x > 0 ? "+" : x < 0 ? "−" : ""}${(Math.abs(x) * 100).toFixed(2)}%`;

export const riskWindowSchema = z.enum(riskWindows, {
  error: `The risk window must be one of ${riskWindows.join(", ")}.`,
});

/** Broad equity funds only: a bond ETF (or any other fund) can never become the
 * market portfolio. Custom proxies are a later, separately approved change. */
export const marketProxySchema = z.enum(marketProxies, {
  error: `The market proxy must be ${marketProxies.join(", ")}; a bond or other non-market fund cannot stand in for the market portfolio.`,
});

/** The MRP is an explicit assumption bounded to [−10%, +20%]. A negative premium is
 * an allowed scenario; anything outside the range is rejected, never clamped. */
const MRP_RANGE_MESSAGE = `The Market Risk Premium must be between ${pct(MRP.min)} and ${pct(MRP.max)}.`;
export const marketRiskPremiumSchema = z
  .number({ error: MRP_RANGE_MESSAGE })
  .min(MRP.min, MRP_RANGE_MESSAGE)
  .max(MRP.max, MRP_RANGE_MESSAGE);

export const forwardAssumptionsSchema = z
  .object({
    riskWindow: riskWindowSchema,
    marketProxy: marketProxySchema,
    marketRiskPremium: marketRiskPremiumSchema,
  })
  .strict();

const MANUAL_RANGE_MESSAGE = `A 12M Expected Total Return must be greater than ${pct(MANUAL.exclusiveMin)} and at most ${pct(MANUAL.max)}.`;

export const confidenceSchema = z
  .number({ error: "Confidence must be a finite number." })
  .min(0, "Confidence must be between 0% and 100%.")
  .max(1, "Confidence must be between 0% and 100%.");

export const viewSchema = z
  .object({
    source: z.enum(["none", "street", "manual"]),
    /** 12M Expected Total Return, on the CAPM prior's basis: above −100% (a long
     * position cannot lose more) and at most +200%; rejected, never clamped. */
    manualReturn: z
      .number({ error: MANUAL_RANGE_MESSAGE })
      .gt(MANUAL.exclusiveMin, MANUAL_RANGE_MESSAGE)
      .max(MANUAL.max, MANUAL_RANGE_MESSAGE)
      .nullable(),
    confidence: confidenceSchema,
  })
  .strict()
  .refine((v) => v.source !== "manual" || v.manualReturn !== null, {
    error: "A manual view needs a 12M Expected Total Return.",
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
