import "server-only";
type Env = Record<string, string | undefined>;
// Any of these means a hosted Vercel build/runtime. Vercel hides AWS_LAMBDA_* under
// Fluid compute, so they are deliberately not relied upon.
const HOSTED_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "VERCEL_DEPLOYMENT_ID"];
/** Yahoo is a local research candidate only; no environment value can qualify
 * redistribution rights. Default-deny: production builds need an explicit local
 * opt-in, and any hosted marker blocks it even with that opt-in. */
export function yahooLocalResearchEnabled(env: Env): boolean {
  if (HOSTED_MARKERS.some((name) => env[name])) return false;
  return env.NODE_ENV !== "production" || env.PORTFOLIO_LAB_LOCAL_YAHOO === "1";
}
export const PROVIDER_POLICY = {
  historyTtlMs: 3600000,
  quoteTtlMs: 60000,
  treasuryTtlMs: 21600000,
  maxConcurrentFetches: 4,
  yahooEnabled: yahooLocalResearchEnabled(process.env),
};
