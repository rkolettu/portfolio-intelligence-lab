// Deterministic portfolio with a negative risk contribution (HEDGE), identical to
// the `hedge()` inputs in tests/components/risk.test.tsx. Shared by the release
// audit's component and browser coverage of the negative-contribution display.
import { simulate } from "@/lib/backtest/engine";
import type { BacktestResult } from "@/lib/types/analytics";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "./helpers";

function weekdays(count: number): string[] {
  const out: string[] = [];
  for (
    let d = new Date("2023-01-02T12:00:00Z");
    out.length < count;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  return out;
}
const pricesFrom = (r: number[]) =>
  r.reduce((acc, x) => [...acc, acc.at(-1)! * (1 + x)], [100]);
const stream = (n: number, a: number, b: number, c: number) =>
  Array.from(
    { length: n },
    (_, t) => 0.01 * Math.sin(t * a + c) + 0.006 * Math.cos(t * b) + 0.0004,
  );

export function hedgeResult(): BacktestResult {
  const d = weekdays(280);
  const n = d.length - 1;
  const base = stream(n, 0.9, 0.31, 0);
  const r: Record<string, number[]> = {
    AAA: base,
    BBB: stream(n, 0.4, 0.8, 1),
    SPY: stream(n, 0.9, 0.31, 0.4),
    HEDGE: base.map((x, t) => -0.5 * x + 0.002 * Math.sin(t * 2.3)),
  };
  const rates: TreasuryObservation[] = ["2022-12-29", ...d].map((date) => ({
    date,
    annualYield: 0.04,
    availableAt: `${date}T20:15:00Z`,
    availability: "published",
  }));
  return simulate({
    config: {
      holdings: [
        { ticker: "AAA", weight: 0.7 },
        { ticker: "HEDGE", weight: 0.2 },
        { ticker: "CASH", weight: 0.1 },
      ],
      benchmark: "SPY",
      requestedStartDate: d[0],
      endDate: d.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: Object.entries(r).map(([t, x]) => series(t, d, pricesFrom(x))),
    treasury: { series: "DGS3MO", observations: rates, provenance },
    sessions: sessions(d),
    now: "2030-01-01T00:00:00Z",
  });
}
