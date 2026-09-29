// Deterministic construction fixture: three risky assets over ~350 real XNYS sessions
// (CCC is a zero-weight candidate that lists 40 sessions in), a benchmark, a flat
// 4% Treasury series and two stress windows inside the data.
import type { ConstructionInput } from "@/lib/backtest/construction";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { TreasurySeries } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { provenance, series } from "./helpers";

const FAR = "2100-01-01T00:00:00Z";
export const constructionNow = "2024-06-03T12:00:00Z";
export const constructionCalendar = sessionsBetween(
  "2023-01-03",
  "2024-05-31",
  FAR,
);
export const constructionDates = constructionCalendar.map((s) => s.date);
const ds = constructionDates;
const wave = (seed: number, drift: number, amp: number) =>
  ds.map((_, i) => 100 * Math.exp(amp * Math.sin(i * seed) + drift * i));
export const LATE = 40;
export const constructionConfig: PortfolioConfig = {
  holdings: [
    { ticker: "AAA", weight: 0.5 },
    { ticker: "BBB", weight: 0.3 },
    { ticker: "CCC", weight: 0 },
    { ticker: "CASH", weight: 0.2 },
  ],
  benchmark: "BMK",
  requestedStartDate: ds[0],
  endDate: ds.at(-1)!,
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
const treasury: TreasurySeries = {
  series: "DGS3MO",
  observations: sessionsBetween("2022-12-15", "2024-05-31", FAR).map((s) => ({
    date: s.date,
    annualYield: 0.04,
    availableAt: `${s.date}T23:59:00-05:00`,
    availability: "modeled",
  })),
  provenance,
};
export function constructionInput(
  overrides: Partial<ConstructionInput> = {},
): ConstructionInput {
  const prices = [
    series("AAA", ds, wave(0.7, 0.0005, 0.02)),
    series("BBB", ds, wave(1.9, 0.0002, 0.01)),
    series(
      "CCC",
      ds.slice(LATE),
      wave(1.1, 0.0003, 0.015).slice(LATE),
      ds[LATE],
    ),
    series("BMK", ds, wave(0.4, 0.0004, 0.012)),
  ];
  const window = (id: string, name: string, from: number, to: number) => ({
    id,
    name,
    startDate: ds[from],
    endDate: ds[to],
    description: `${name} fixture window.`,
    kind: "preset" as const,
  });
  return {
    config: constructionConfig,
    constraints: [],
    cash: { mode: "current" },
    estimation: {
      prices,
      treasury,
      sessions: constructionCalendar,
      eligibleEndDate: ds.at(-1)!,
    },
    stress: {
      windows: [
        window("gfc", "Global Financial Crisis", 10, 30),
        window("covid", "COVID Crash", 200, 230),
      ],
      prices,
      treasury,
      sessions: constructionCalendar,
      unavailable: [],
    },
    now: constructionNow,
    ...overrides,
  };
}

/** Maximum portfolio: 20 risky holdings plus CASH (CASH never uses a risky slot). */
export const MAX_TICKERS = Array.from(
  { length: 20 },
  (_, i) => `R${String(i + 1).padStart(2, "0")}`,
);
export const maxConfig: PortfolioConfig = {
  ...constructionConfig,
  holdings: [
    ...MAX_TICKERS.map((ticker) => ({ ticker, weight: 0.045 })),
    { ticker: "CASH", weight: 0.1 },
  ],
};
export function maxConstructionInput(): ConstructionInput {
  const base = constructionInput();
  const prices = [
    ...MAX_TICKERS.map((ticker, k) =>
      series(
        ticker,
        ds,
        wave(0.3 + k * 0.17, 0.0002 + k * 0.00001, 0.01 + k * 0.001),
      ),
    ),
    base.estimation.prices.find((p) => p.ticker === "BMK")!,
  ];
  return {
    ...base,
    config: maxConfig,
    estimation: { ...base.estimation, prices },
    stress: { ...base.stress, prices },
  };
}
