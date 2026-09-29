import { describe, expect, it } from "vitest";
import { simulate, type SimulationInput } from "@/lib/backtest/engine";
import { sessionsBetween } from "@/lib/backtest/calendar";
import { annualizedVolatility } from "@/lib/analytics/risk";
import { beta, correlation } from "@/lib/analytics/benchmark";
import { ROLLING_METHODOLOGY } from "@/config/methodology";
import { series } from "../fixtures/helpers";

const FAR = "2100-01-01T00:00:00Z";
// 150 real XNYS sessions, so every window length (20/60/120) completes.
const calendar = sessionsBetween("2023-01-03", "2023-08-08", FAR);
const dates = calendar.map((s) => s.date);
const wave = (seed: number) =>
  dates.map((_, i) => 100 * Math.exp(0.01 * Math.sin(i * seed) + 0.0004 * i));

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    config: {
      holdings: [
        { ticker: "AAA", weight: 0.6 },
        { ticker: "BBB", weight: 0.4 },
      ],
      benchmark: "BMK",
      requestedStartDate: dates[0],
      endDate: dates.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("AAA", dates, wave(0.7)),
      series("BBB", dates, wave(1.9)),
      series("BMK", dates, wave(1.1)),
    ],
    treasury: null,
    sessions: calendar,
    now: "2023-09-01T12:00:00Z",
    ...overrides,
  };
}
const valueOf = (c: ReturnType<typeof beta>) => (c.ok ? c.value : null);

describe("summarizeRolling via simulate", () => {
  it("ships 20/60/120 windows with a 60-session default on the ledger's dates", () => {
    expect(dates.length).toBe(150);
    const r = simulate(input()).rollingAnalytics;
    expect(r.methodologyVersion).toBe(ROLLING_METHODOLOGY.version);
    expect(r.windows).toEqual([20, 60, 120]);
    expect(r.defaultWindow).toBe(60);
    expect(r.benchmarkTicker).toBe("BMK");
    expect(r.dates).toEqual(dates.slice(1));
  });

  it("equals the Phase 2/3 full-sample functions applied to each window", () => {
    const result = simulate(input());
    const r = result.rollingAnalytics;
    const p = result.ledger.map((row) => row.return);
    const b = dates.slice(1).map((d, i) => {
      const bm = wave(1.1);
      return bm[i + 1] / bm[i] - 1;
    });
    if (
      !r.volatility.available ||
      !r.beta.available ||
      !r.correlation.available
    )
      throw new Error("expected available rolling metrics");
    for (const [k, N] of r.windows.entries()) {
      const vol = r.volatility.series[k];
      const bet = r.beta.series[k];
      const cor = r.correlation.series[k];
      expect(vol.window).toBe(N);
      expect(vol.values.slice(0, N - 1).every((v) => v === null)).toBe(true);
      expect(vol.firstDate).toBe(r.dates[N - 1]);
      expect(vol.validCount).toBe(p.length - N + 1);
      for (const i of [N - 1, p.length - 1]) {
        const window = (x: number[]) => x.slice(i - N + 1, i + 1);
        expect(vol.values[i]).toBe(valueOf(annualizedVolatility(window(p))));
        expect(bet.values[i]).toBe(valueOf(beta(window(p), window(b))));
        expect(cor.values[i]).toBe(valueOf(correlation(window(p), window(b))));
      }
    }
  });

  it("invalidates every window touching an interior benchmark gap and resumes after N clean intervals", () => {
    const i = input();
    const gap = 80; // session index missing from the benchmark only
    i.prices[2].observations.splice(gap, 1);
    const r = simulate(i).rollingAnalytics;
    if (!r.beta.available || !r.volatility.available)
      throw new Error("expected available");
    const k = r.windows.indexOf(20);
    const beta20 = r.beta.series[k].values;
    // Intervals (gap-1 → gap) and (gap → gap+1) are ledger rows gap-1 and gap.
    for (let row = gap - 1; row < gap + 20; row++)
      expect(beta20[row]).toBeNull();
    expect(beta20[gap - 2]).not.toBeNull();
    expect(beta20[gap + 20]).not.toBeNull();
    // Portfolio volatility has no gap: the portfolio ledger is continuous.
    expect(r.volatility.series[k].values[gap]).not.toBeNull();
  });

  it("starts rolling beta only after N aligned intervals when the benchmark starts later", () => {
    const i = input();
    i.prices[2] = series("BMK", dates.slice(30), wave(1.1).slice(30));
    const r = simulate(i).rollingAnalytics;
    if (!r.beta.available) throw new Error("expected available");
    const k = r.windows.indexOf(60);
    expect(r.beta.series[k].firstDate).toBe(dates[30 + 60]);
  });

  it("keeps rolling volatility when the benchmark is unavailable", () => {
    const i = input();
    i.prices = i.prices.slice(0, 2);
    const r = simulate(i).rollingAnalytics;
    expect(r.volatility.available).toBe(true);
    expect(r.beta).toEqual({
      available: false,
      reason:
        "Benchmark history is unavailable; portfolio history is unaffected.",
    });
    expect(r.correlation.available).toBe(false);
  });
});
