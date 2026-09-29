import { afterEach, expect, it, vi } from "vitest";
import { analyze } from "@/lib/server/analyze";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each(["preview", "production"])("blocks Yahoo on Vercel %s even with the obsolete bypass flag", async (environment) => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", environment);
  vi.stubEnv("ENABLE_YAHOO_PRODUCTION", "true");
  vi.resetModules();
  const { services } = await import("@/lib/server/analyze");
  const result = await analyze({ holdings: [{ ticker: "SPY", weight: 1 }], benchmark: "SPY",
    requestedStartDate: "2024-05-30", endDate: "2024-06-03",
    rebalanceFrequency: "monthly", cashPolicy: "historical_proxy",
  }, "2024-06-04T12:00:00Z", services);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("UNQUALIFIED_PROVIDER");
  expect(services.quotes).toBeNull();
});

import { yahooLocalResearchEnabled } from "@/config/providers";
import { assertQualified } from "@/config/deployed-providers";
import type { HistoricalProvider } from "@/lib/market-data/types";

it("permits Yahoo only locally and denies production builds without an explicit local opt-in", () => {
  expect(yahooLocalResearchEnabled({ NODE_ENV: "development" })).toBe(true);
  expect(yahooLocalResearchEnabled({ NODE_ENV: "test" })).toBe(true);
  expect(yahooLocalResearchEnabled({ NODE_ENV: "production" })).toBe(false);
  expect(yahooLocalResearchEnabled({ NODE_ENV: "production", PORTFOLIO_LAB_LOCAL_YAHOO: "true" })).toBe(false);
  expect(yahooLocalResearchEnabled({ NODE_ENV: "production", PORTFOLIO_LAB_LOCAL_YAHOO: "1" })).toBe(true);
});

it.each(["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "VERCEL_DEPLOYMENT_ID"])(
  "any hosted marker (%s) overrides the local opt-in", (marker) => {
    expect(yahooLocalResearchEnabled({ NODE_ENV: "development", [marker]: "x" })).toBe(false);
    expect(yahooLocalResearchEnabled({ NODE_ENV: "production", PORTFOLIO_LAB_LOCAL_YAHOO: "1", [marker]: "x" })).toBe(false);
  });

it("registers a replacement provider only with complete qualification evidence, never Yahoo", () => {
  const provider = (name: string): HistoricalProvider => ({
    name, convention: "total_return_aware_adjusted",
    getHistoricalPrices: async () => { throw new Error("unused"); },
  });
  const qualification = {
    termsUrl: "https://provider.example/terms", termsReviewedOn: "2026-10-01",
    deployedSmoke: "iad1 2026-10-02: SPY QQQ IWM BND GLD VT AGG, invalid ticker, range limit",
    conventionEvidence: "2-for-1 split and distribution fixtures reconciled", reviewer: "reviewer",
  };
  expect(assertQualified({ provider: provider("Qualified vendor"), qualification }).name).toBe("Qualified vendor");
  expect(() => assertQualified({ provider: provider("Qualified vendor"),
    qualification: { ...qualification, deployedSmoke: "" } })).toThrow("qualification");
  expect(() => assertQualified({ provider: provider("Qualified vendor"),
    qualification: { ...qualification, termsUrl: "http://insecure.example" } })).toThrow();
  expect(() => assertQualified({ provider: provider("Yahoo Finance (unofficial chart)"), qualification })).toThrow();
});
