// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BenchmarkSection } from "@/components/benchmark/BenchmarkSection";
import { DrawdownLab } from "@/components/drawdown/DrawdownLab";
import { simulate } from "@/lib/backtest/engine";
import { decimal, percent } from "@/lib/utils/format";
import type { TreasuryObservation } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

afterEach(cleanup);
const dates = [
  "2024-05-28",
  "2024-05-29",
  "2024-05-30",
  "2024-05-31",
  "2024-06-03",
  "2024-06-04",
  "2024-06-05",
];
const rates: TreasuryObservation[] = ["2024-05-24", ...dates].map((date) => ({
  date,
  annualYield: 0.05,
  availableAt: `${date}T20:15:00Z`,
  availability: "published",
}));
const run = (
  withRates = true,
  spy = [100, 102, 99, 101, 104, 103, 106],
  benchDates = dates,
) =>
  simulate({
    config: {
      holdings: [{ ticker: "QQQ", weight: 1 }],
      benchmark: "SPY",
      requestedStartDate: dates[0],
      endDate: dates.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("QQQ", dates, [100, 103, 98, 100, 106, 104, 108]),
      series("SPY", benchDates, spy),
    ],
    treasury: withRates
      ? { series: "DGS3MO", observations: rates, provenance }
      : null,
    sessions: sessions(dates),
    now: "2024-06-06T12:00:00Z",
  });
const value = (m: { available: boolean; value?: number }) =>
  m.available ? m.value! : NaN;

it("benchmark section shows period, count, every relative metric and the geometric table", () => {
  const r = run();
  const a = r.benchmarkAnalytics;
  render(<BenchmarkSection analytics={a} />);
  expect(screen.getByText("SPY · ETF")).toBeTruthy();
  expect(screen.getByText("2024-05-28 → 2024-06-05")).toBeTruthy();
  expect(
    screen.getByText("Aligned observations").nextElementSibling!.textContent,
  ).toBe("6");
  expect(
    screen.getByText("Historical Risk-Free coverage").nextElementSibling!
      .textContent,
  ).toBe("Complete");
  const strip = (label: string) => screen.getByLabelText(label);
  const terms = (label: string) =>
    within(strip(label))
      .getAllByRole("term")
      .map((t) => t.childNodes[0].textContent);
  expect(terms("Regression and co-movement")).toEqual([
    "Beta",
    "CAPM alpha",
    "Correlation",
    "R²",
  ]);
  expect(terms("Arithmetic active returns")).toEqual([
    "Active return",
    "Tracking error",
    "Information ratio",
  ]);
  expect(
    within(strip("Regression and co-movement")).getByText(
      decimal(value(a.relative.beta)),
    ),
  ).toBeTruthy();
  expect(
    within(strip("Regression and co-movement")).getByText(
      percent(value(a.relative.alpha)),
    ),
  ).toBeTruthy();
  const table = screen.getByRole("table");
  const rows = within(table)
    .getAllByRole("row")
    .map((row) =>
      [...row.querySelectorAll("th, td")].map((c) => c.textContent),
    );
  expect(rows).toEqual([
    ["Measure", "Portfolio", "SPY"],
    [
      "Cumulative return",
      percent(value(a.geometric.portfolioCumulativeReturn)),
      percent(value(a.geometric.benchmarkCumulativeReturn)),
    ],
    [
      "CAGR",
      percent(value(a.geometric.portfolioCagr)),
      percent(value(a.geometric.benchmarkCagr)),
    ],
  ]);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("tooltips say what beta, alpha, tracking error, information ratio and active return are", () => {
  render(<BenchmarkSection analytics={run().benchmarkAnalytics} />);
  const tip = (name: string) => {
    const button = screen.getByRole("button", { name: `About ${name}` });
    return document.getElementById(button.getAttribute("aria-describedby")!)!
      .textContent;
  };
  // One or two short "what is this?" sentences; formulas live in the drawer.
  expect(tip("Beta")).toMatch(/Sensitivity of daily portfolio returns/);
  expect(tip("CAPM alpha")).toMatch(/not explained by benchmark exposure/);
  expect(tip("Tracking error")).toMatch(/deviates from the benchmark/);
  expect(tip("Information ratio")).toMatch(/per unit of tracking error/);
  expect(tip("Active return")).toMatch(
    /not the difference between the two CAGRs/,
  );
  for (const name of [
    "Beta",
    "CAPM alpha",
    "Correlation",
    "R²",
    "Active return",
    "Tracking error",
    "Information ratio",
  ])
    expect(tip(name)).not.toMatch(/√252|sampleStdDev|OLS/);
});

it("alpha shows N/A with the risk-free reason while other metrics stay available", () => {
  render(<BenchmarkSection analytics={run(false).benchmarkAnalytics} />);
  expect(
    screen.getByText("Historical Risk-Free coverage").nextElementSibling!
      .textContent,
  ).toBe("0 / 6");
  const button = screen.getByRole("button", { name: "About CAPM alpha" });
  expect(
    document.getElementById(button.getAttribute("aria-describedby")!)!
      .textContent,
  ).toMatch(
    /Not available: Historical risk-free returns are missing for 6 of 6 comparison intervals/,
  );
  expect(screen.getAllByText("N/A")).toHaveLength(2); // alpha and R²
});

it("renders an explicit unavailable state when there is no comparison sample", () => {
  const r = run(true, [100, 101], ["2024-05-28", "2024-05-30"]);
  render(<BenchmarkSection analytics={r.benchmarkAnalytics} />);
  expect(screen.getByRole("status").textContent).toMatch(
    /^Benchmark Data UnavailableThe benchmark has no return interval overlapping/,
  );
});

it("drawdown lab toggles portfolio, benchmark and both without changing portfolio statistics", () => {
  const r = run();
  render(
    <DrawdownLab
      performance={r.performance}
      benchmark={r.benchmarkAnalytics}
    />,
  );
  const stat = (dl: string, label: string) =>
    within(screen.getByLabelText(`${dl} drawdown statistics`)).getByText(
      label,
      { selector: "dt" },
    ).nextElementSibling!.textContent;
  expect(stat("Portfolio", "Maximum drawdown")).toBe(percent(98 / 103 - 1));
  expect(screen.queryByLabelText("SPY drawdown statistics")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "SPY" }));
  expect(screen.queryByLabelText("Portfolio drawdown statistics")).toBeNull();
  expect(stat("SPY", "Maximum drawdown")).toBe(percent(99 / 102 - 1));
  expect(stat("SPY", "Recovery date")).toBe("2024-06-03");
  expect(screen.getByRole("heading", { name: "SPY drawdown" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Both" }));
  expect(stat("Portfolio", "Maximum drawdown")).toBe(percent(98 / 103 - 1));
  expect(stat("SPY", "Current drawdown")).toBe("At peak");
  expect(
    screen.getByRole("heading", { name: "Portfolio vs SPY drawdown" }),
  ).toBeTruthy();
  expect(
    screen
      .getAllByRole("columnheader")
      .slice(0, 3)
      .map((h) => h.textContent),
  ).toEqual(["Date", "Portfolio", "SPY"]);
});

it("disables the benchmark drawdown options with the reason when the path is unavailable", () => {
  const gap = dates.filter((d) => d !== "2024-05-31");
  const r = run(true, [100, 102, 99, 104, 103, 106], gap);
  render(
    <DrawdownLab
      performance={r.performance}
      benchmark={r.benchmarkAnalytics}
    />,
  );
  expect(
    (screen.getByRole("radio", { name: "SPY" }) as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("radio", { name: "Both" }) as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    screen.getByText(/Benchmark Data Unavailable: .*interior gaps/),
  ).toBeTruthy();
});
