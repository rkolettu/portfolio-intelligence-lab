// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { simulate } from "@/lib/backtest/engine";
import {
  displayIndices,
  downsample,
  growthData,
  monthEndRows,
} from "@/lib/charts/series";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

afterEach(cleanup);
const dates = [
  "2024-05-29",
  "2024-05-30",
  "2024-05-31",
  "2024-06-03",
  "2024-06-04",
];
const rates: TreasuryObservation[] = ["2024-05-28", ...dates].map((date) => ({
  date,
  annualYield: 0.05,
  availableAt: `${date}T20:15:00Z`,
  availability: "published",
}));
const run = (
  prices: number[],
  withRates: boolean,
  benchmark = "SPY",
  benchmarkPrices = prices,
) =>
  simulate({
    config: {
      holdings: [{ ticker: "QQQ", weight: 1 }],
      benchmark,
      requestedStartDate: dates[0],
      endDate: dates[4],
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("QQQ", dates, prices),
      series(benchmark, dates, benchmarkPrices),
    ],
    treasury: withRates
      ? { series: "DGS3MO", observations: rates, provenance }
      : null,
    sessions: sessions(dates),
    now: "2024-06-05T12:00:00Z",
  });

it("renders the seven overview KPIs from precomputed metrics", () => {
  const r = run([100, 104, 101, 106, 103], true);
  const { container } = render(<MetricStrip performance={r.performance} />);
  const strip = container.querySelector<HTMLElement>("dl.kpi-strip")!;
  const labels = within(strip)
    .getAllByRole("term")
    .map((t) => t.childNodes[0].textContent);
  expect(labels).toEqual([
    "Ending value",
    "Cumulative return",
    "CAGR",
    "Annualized volatility",
    "Sharpe ratio",
    "Sortino ratio",
    "Maximum drawdown",
  ]);
  expect(screen.getByText("$10,300")).toBeTruthy();
  expect(screen.getByText("+3.00%")).toBeTruthy();
  expect(screen.getByText("Annualized from < 1 year")).toBeTruthy();
  expect(screen.getByText("Peak 2024-05-30")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("shows N/A with an accessible reason when Sharpe and Sortino are undefined", () => {
  const r = run([100, 104, 101, 106, 103], false);
  render(<MetricStrip performance={r.performance} />);
  expect(screen.getAllByText("N/A")).toHaveLength(2);
  const trigger = screen.getByRole("button", { name: "About Sharpe ratio" });
  const tip = document.getElementById(
    trigger.getAttribute("aria-describedby")!,
  )!;
  expect(tip.getAttribute("role")).toBe("tooltip");
  expect(tip.textContent).toMatch(
    /Not available: Historical risk-free returns are missing for 4 of 4 intervals/,
  );
});

it("drawdown lab reports peak, trough, unrecovered state and current drawdown", () => {
  const r = run([100, 104, 101, 106, 103], true);
  render(<DrawdownLab performance={r.performance} />);
  const stat = (label: string) =>
    screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
  expect(stat("Maximum drawdown")).toBe("-2.88%"); // 101/104 - 1
  expect(stat("Peak date")).toBe("2024-05-30");
  expect(stat("Trough date")).toBe("2024-05-31");
  expect(stat("Recovery date")).toBe("2024-06-03");
  expect(stat("Calendar days to recovery")).toBe("4");
  expect(stat("Trading days to recovery")).toBe("2");
  expect(stat("Current drawdown")).toBe("-2.83%"); // 103/106 - 1
  expect(
    screen.getByText(/Portfolio · deepest drawdown episodes · 2 of 2/),
  ).toBeTruthy();
});

it("drawdown lab states no drawdown and at-peak without inventing dates", () => {
  const r = run([100, 101, 102, 103, 104], true);
  render(<DrawdownLab performance={r.performance} />);
  expect(
    screen.getByText(
      /Portfolio: no drawdown; wealth never closed below a prior peak\./,
    ),
  ).toBeTruthy();
  expect(
    screen.getByText("Current drawdown", { selector: "dt" }).nextElementSibling!
      .textContent,
  ).toBe("At peak");
  expect(
    screen.getByText("Peak date", { selector: "dt" }).nextElementSibling!
      .textContent,
  ).toBe("—");
});

it("growth chart summarizes both series, and the benchmark toggle removes it", () => {
  const r = run(
    [100, 104, 101, 106, 103],
    true,
    "SPY",
    [100, 101, 102, 103, 104],
  );
  render(<GrowthChart result={r} />);
  expect(
    screen.getByText(/portfolio \$10,300\.00, SPY \$10,400\.00/),
  ).toBeTruthy();
  const toggle = screen.getByRole("checkbox", { name: /SPY benchmark/ });
  fireEvent.click(toggle);
  expect(screen.getByText(/portfolio \$10,300\.00\.$/)).toBeTruthy();
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
    ["Date", "Portfolio"],
  );
});

it("growth chart disables the benchmark with the Phase 1 reason when its path is unavailable", () => {
  const r = simulate({
    config: {
      holdings: [{ ticker: "QQQ", weight: 1 }],
      benchmark: "VT",
      requestedStartDate: dates[0],
      endDate: dates[4],
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [series("QQQ", dates, [100, 101, 102, 103, 104])],
    treasury: null,
    sessions: sessions(dates),
    now: "2024-06-05T12:00:00Z",
  });
  render(<GrowthChart result={r} />);
  expect(
    (screen.getByRole("checkbox", { name: /VT benchmark/ }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/Benchmark path unavailable/)).toBeTruthy();
});

it("display downsampling keeps endpoints, every bucket extreme and required dates", () => {
  const values = Array.from(
    { length: 5_000 },
    (_, i) => Math.sin(i / 50) - (i === 3_217 ? 5 : 0),
  );
  const kept = displayIndices(values.length, 400, [values]);
  expect(kept.length).toBeLessThanOrEqual(400);
  expect(kept[0]).toBe(0);
  expect(kept.at(-1)).toBe(4_999);
  expect(kept).toContain(3_217); // the global minimum (a drawdown trough) survives
  const rows = values.map((v, i) => ({ date: String(i).padStart(5, "0"), v }));
  expect(
    downsample(
      rows,
      400,
      (r) => [r.v],
      (r) => r.date === "01234",
    ).map((r) => r.date),
  ).toContain("01234");
  expect(displayIndices(10, 400, [values.slice(0, 10)])).toHaveLength(10);
});

it("growth data selects the full portfolio path or the normalized overlap path verbatim", () => {
  const r = run([100, 104, 101, 106, 103], true);
  expect(growthData(r, false).map((d) => d.portfolio)).toEqual(
    r.performance.growth.map((g) => g.wealth),
  );
  expect(growthData(r, true)[0]).toEqual({
    date: dates[0],
    portfolio: 10_000,
    benchmark: 10_000,
  });
  expect(monthEndRows(growthData(r, false)).map((d) => d.date)).toEqual([
    "2024-05-31",
    "2024-06-04",
  ]);
});

import { axisTicks, drawdownTicks } from "@/lib/charts/series";
it("axis helpers produce clean, non-repeating ticks", () => {
  expect(drawdownTicks(-0.2163)).toEqual([0, -0.05, -0.1, -0.15, -0.2, -0.25]);
  expect(drawdownTicks(-0.0379)).toEqual([0, -0.01, -0.02, -0.03, -0.04]);
  expect(drawdownTicks(0)).toEqual([0, -0.002, -0.004, -0.006, -0.008, -0.01]);
  const days = Array.from({ length: 400 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10),
  );
  const monthly = axisTicks(days);
  expect(monthly.unit).toBe("month");
  expect(new Set(monthly.ticks.map((d) => d.slice(0, 7))).size).toBe(
    monthly.ticks.length,
  );
  expect(monthly.ticks.length).toBeLessThanOrEqual(8);
  expect(
    axisTicks(["2020-01-02", "2021-06-01", "2022-01-03", "2024-01-02"]).unit,
  ).toBe("year");
});
