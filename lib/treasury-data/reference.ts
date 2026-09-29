import type { TreasuryMaturity } from "@/lib/types/data";

const MATURITIES: [TreasuryMaturity, number][] = [
  ["3M", 0.25],
  ["1Y", 1],
  ["3Y", 3],
  ["5Y", 5],
  ["10Y", 10],
];

/** Current Treasury Reference maturity for a requested analysis horizon (spec §19):
 * 1Y→1Y, 3Y→3Y, 5Y→5Y, 10Y and MAX→10Y; custom ranges take the nearest supported
 * maturity, measured in completed calendar months, with ties going to the longer
 * maturity. Informational context only: it never enters historical calculations. */
export function referenceMaturity(
  start: string,
  end: string,
): TreasuryMaturity {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  const years = Math.max(0, months) / 12;
  let best = MATURITIES[0];
  for (const m of MATURITIES)
    if (Math.abs(years - m[1]) <= Math.abs(years - best[1])) best = m;
  return best[0];
}
