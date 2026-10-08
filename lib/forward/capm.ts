// V2 CAPM prior (Layer B). Pure and free of server-only or Node-only imports, so the
// same functions recompute the prior wherever only the Market Risk Premium changes.
// Inputs are the certified forward risk model (Forward Model Beta), the forward 1Y
// risk-free rate and the explicit MRP assumption — nothing historical-return-based
// and nothing from Street data.
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type {
  CapmPriorOutcome,
  ForwardRiskFree,
  ForwardRiskModel,
  InvalidCapmPrior,
} from "@/lib/types/forward";
import { fail } from "@/lib/utils/errors";
import { marketRiskPremiumSchema } from "@/lib/validation/forward";

/** The one CAPM required-return function, in decimal units: Rf + β × MRP. The CAPM
 * prior, the expected market return (β = 1), CASH (β = 0) and the Security Market
 * Line all use it, so the formula exists exactly once. No floor, clamp or cap. */
export function capmRequiredReturn(
  riskFree: number,
  beta: number,
  marketRiskPremium: number,
): number {
  if (
    !Number.isFinite(riskFree) ||
    !Number.isFinite(beta) ||
    !Number.isFinite(marketRiskPremium)
  )
    fail(
      "INVALID_INPUT",
      "The CAPM required return needs a finite risk-free rate, beta and Market Risk Premium.",
    );
  return riskFree + beta * marketRiskPremium;
}

/** Rf + MRP: the canonical forward expected market return (the proxy's β is 1). */
export const expectedMarketReturn = (riskFree: number, marketRiskPremium: number) =>
  capmRequiredReturn(riskFree, 1, marketRiskPremium);

/** The fields of the risk model the prior depends on. */
export type CapmRiskModelInput = Pick<
  ForwardRiskModel,
  | "tickers"
  | "modelBeta"
  | "marketProxy"
  | "proxyInUniverse"
  | "window"
  | "hash"
>;

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/** The 12-month CAPM prior for every risky security in the forward risk model:
 * Π_i = Rf + β_i × MRP with β_i the Forward Model Beta. Deterministic: same risk
 * model, Rf and MRP give the same result, in the model's canonical ticker order.
 * A prior at or below −100% (an impossible 12-month simple return) is a typed
 * error, never clamped. */
export function buildCapmPrior(input: {
  riskModel: CapmRiskModelInput;
  riskFree: ForwardRiskFree;
  marketRiskPremium: number;
}): CapmPriorOutcome {
  const { riskModel: m, riskFree, marketRiskPremium } = input;
  const invalid = (reason: string): CapmPriorOutcome => ({
    available: false,
    code: "invalid_inputs",
    reason,
  });

  if (riskFree.series !== "DGS1" || riskFree.maturity !== "1Y")
    return invalid(
      "The CAPM prior uses only the forward 1-year Treasury rate (DGS1); no other maturity is substituted.",
    );
  const rf = riskFree.annualYield;
  if (!Number.isFinite(rf) || rf <= -1)
    return invalid("The forward risk-free rate must be a finite rate above −100%.");
  const mrp = marketRiskPremiumSchema.safeParse(marketRiskPremium);
  if (!mrp.success) return invalid(mrp.error.issues[0].message);
  if (
    m.modelBeta.length !== m.tickers.length ||
    m.tickers.some((t, i) => i > 0 && m.tickers[i - 1] >= t)
  )
    return invalid(
      "The risk model must list one Forward Model Beta per security in canonical order.",
    );
  const nonFinite = m.tickers.filter((_, i) => !Number.isFinite(m.modelBeta[i]));
  if (nonFinite.length)
    return invalid(
      `Forward Model Beta is not finite for ${nonFinite.join(", ")}.`,
    );
  // A held proxy must carry β = 1 exactly, so it cannot get a second, different prior.
  if (m.proxyInUniverse && m.modelBeta[m.tickers.indexOf(m.marketProxy)] !== 1)
    return invalid(
      `The market proxy ${m.marketProxy} must have Forward Model Beta 1 in its own risk model.`,
    );

  const rows = m.tickers.map((ticker, i) => ({
    ticker,
    forwardModelBeta: m.modelBeta[i],
    capmPrior: capmRequiredReturn(rf, m.modelBeta[i], mrp.data),
  }));
  const impossible: InvalidCapmPrior[] = rows
    .filter((r) => !(r.capmPrior > -1) || !Number.isFinite(r.capmPrior))
    .map((r) => ({
      ticker: r.ticker,
      forwardModelBeta: r.forwardModelBeta,
      riskFreeRate: rf,
      marketRiskPremium: mrp.data,
      capmPrior: r.capmPrior,
    }));
  if (impossible.length)
    return {
      available: false,
      code: "invalid_capm_prior",
      reason: `A 12-month expected total return cannot be at or below −100%; the CAPM prior is not clamped. ${impossible
        .map(
          (r) =>
            `${r.ticker}: Rf ${pct(r.riskFreeRate)} + Forward Model Beta ${r.forwardModelBeta} × MRP ${pct(r.marketRiskPremium)} = ${pct(r.capmPrior)}`,
        )
        .join("; ")}.`,
      invalid: impossible,
    };

  return {
    available: true,
    prior: {
      methodologyVersion: FORWARD_METHODOLOGY.version,
      riskModelHash: m.hash,
      marketProxy: m.marketProxy,
      riskWindow: m.window.requested,
      riskFreeRate: rf,
      riskFreeObservationDate: riskFree.observationDate,
      riskFreeSource: riskFree.provenance.provider,
      marketRiskPremium: mrp.data,
      expectedMarketReturn: expectedMarketReturn(rf, mrp.data),
      rows,
      cash: {
        ticker: "CASH",
        forwardModelBeta: 0,
        expectedReturn: capmRequiredReturn(rf, 0, mrp.data),
      },
    },
  };
}
