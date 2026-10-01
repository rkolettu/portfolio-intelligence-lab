// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RiskSection } from "@/components/risk/RiskSection";
import { DiversificationSection } from "@/components/risk/DiversificationSection";
import { ReturnContribution } from "@/components/risk/ReturnContribution";
import { simulate } from "@/lib/backtest/engine";
import {
  contrast,
  DIVERGING,
  divergingColor,
  inkFor,
  toOklab,
} from "@/lib/charts/diverging";
import { capitalRiskScale, sortHoldings } from "@/lib/charts/riskDisplay";
import type { BacktestResult, HoldingRisk } from "@/lib/types/analytics";
import type { TreasuryObservation } from "@/lib/types/data";
import { unsignedPercent } from "@/lib/utils/format";
import { provenance, series, sessions } from "../fixtures/helpers";

afterEach(cleanup);
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
function build(
  holdings: { ticker: string; weight: number }[],
  count = 280,
  extra: Record<string, number[]> = {},
): BacktestResult {
  const d = weekdays(count);
  const n = d.length - 1;
  const r: Record<string, number[]> = {
    AAA: stream(n, 0.9, 0.31, 0),
    BBB: stream(n, 0.4, 0.8, 1),
    SPY: stream(n, 0.9, 0.31, 0.4),
    ...extra,
  };
  const rates: TreasuryObservation[] = ["2022-12-29", ...d].map((date) => ({
    date,
    annualYield: 0.04,
    availableAt: `${date}T20:15:00Z`,
    availability: "published",
  }));
  return simulate({
    config: {
      holdings,
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
const hedge = () => {
  const n = 279;
  const base = stream(n, 0.9, 0.31, 0);
  return build(
    [
      { ticker: "AAA", weight: 0.7 },
      { ticker: "HEDGE", weight: 0.2 },
      { ticker: "CASH", weight: 0.1 },
    ],
    280,
    { HEDGE: base.map((x, t) => -0.5 * x + 0.002 * Math.sin(t * 2.3)) },
  );
};

it("diverging scale: neutral midpoint at 0, monotonic OKLab lightness on each arm, readable ink", () => {
  expect(divergingColor(0)).toBe(DIVERGING.midpoint);
  for (const sign of [-1, 1]) {
    const L = Array.from(
      { length: 11 },
      (_, i) => toOklab(divergingColor((sign * i) / 10))[0],
    );
    // Paper theme: lightness falls monotonically away from the neutral midpoint.
    L.slice(1).forEach((x, i) => expect(x).toBeLessThan(L[i]));
  }
  for (let v = -1; v <= 1.0001; v += 0.05) {
    const bg = divergingColor(v);
    expect(contrast(bg, inkFor(bg))).toBeGreaterThanOrEqual(4.5);
  }
});

it("capital/risk axis always includes zero and extends left for negative contributions", () => {
  const s = capitalRiskScale([0.4, 0.15, -0.12, 0.62]);
  expect(s.min).toBeLessThan(0);
  expect(s.ticks).toContain(0);
  expect(s.position(s.min)).toBe(0);
  expect(s.position(s.max)).toBe(1);
  expect(s.position(0)).toBeGreaterThan(0);
  expect(capitalRiskScale([0.5, 0.5]).min).toBe(0);
});

it('never produces a negative-zero tick (rendered as "-0%") when the axis extends left', () => {
  const s = capitalRiskScale([-0.5, 0.05]);
  expect(s.ticks.some((t) => Object.is(t, -0))).toBe(false);
  expect(s.ticks).toContain(0);
});

it("sorting orders by the chosen key, puts N/A last and keeps ties in portfolio order", () => {
  const holdings = hedge().riskAnalytics.holdings;
  expect(sortHoldings(holdings, "weight").map((h) => h.ticker)).toEqual([
    "AAA",
    "HEDGE",
    "CASH",
  ]);
  expect(sortHoldings(holdings, "risk").map((h) => h.ticker)).toEqual([
    "AAA",
    "CASH",
    "HEDGE",
  ]); // HEDGE negative
  expect(sortHoldings(holdings, "beta").at(-1)!.ticker).toBe("CASH"); // CASH beta N/A → last
  const tie = [
    { ticker: "X", weight: 0.5 },
    { ticker: "Y", weight: 0.5 },
  ] as HoldingRisk[];
  expect(sortHoldings(tie, "weight").map((h) => h.ticker)).toEqual(["X", "Y"]);
});

it("risk section renders the overview, a negative contribution to the left of zero, and identity footer", () => {
  const r = hedge();
  const ra = r.riskAnalytics;
  render(<RiskSection risk={ra} performance={r.performance} />);
  const overview = within(screen.getByLabelText("Risk overview"));
  expect(
    overview.getAllByRole("term").map((t) => t.childNodes[0].textContent),
  ).toEqual([
    "Portfolio volatility",
    "Realized volatility",
    "Largest risk contribution",
    "Risky holdings",
  ]);
  const pv = ra.portfolio.volatility;
  expect(
    overview.getByText(unsignedPercent(pv.available ? pv.value : NaN)),
  ).toBeTruthy();
  expect(overview.getByText("Target weights · sample Σ")).toBeTruthy();
  // The largest contributor is the holding with the highest precomputed PCR.
  const pcr = ra.holdings.filter((h) => h.percentage.available);
  const top = pcr.reduce((a, b) =>
    a.percentage.available &&
    b.percentage.available &&
    a.percentage.value >= b.percentage.value
      ? a
      : b,
  );
  expect(overview.getByText(new RegExp(`^${top.ticker} · `))).toBeTruthy();
  const hedgeRisk = ra.holdings[1].percentage;
  expect(hedgeRisk.available && hedgeRisk.value).toBeLessThan(0);
  const row = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith("HEDGE"))!;
  const riskBar = row.querySelector<HTMLElement>(".cr-risk")!;
  expect(riskBar.classList.contains("cr-negative")).toBe(true);
  const zero = parseFloat(
    row.querySelector<HTMLElement>(".cr-zero")!.style.left,
  );
  expect(
    parseFloat(riskBar.style.left) + parseFloat(riskBar.style.width),
  ).toBeCloseTo(zero, 6);
  const table = screen.getByRole("table", {
    name: /Holding risk at target weights/,
  });
  expect(within(table).getByText(/= σ/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("sort control reorders both the chart rows and the table", () => {
  const r = hedge();
  render(<RiskSection risk={r.riskAnalytics} performance={r.performance} />);
  fireEvent.click(screen.getByRole("radio", { name: "Risk contribution" }));
  expect(
    screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".cr-ticker")!.childNodes[0].textContent),
  ).toEqual(["AAA", "CASH", "HEDGE"]);
  const table = screen.getByRole("table", { name: /Holding risk/ });
  const firstCells = within(table)
    .getAllByRole("row")
    .slice(1, 4)
    .map((tr) => tr.querySelector("td")!.childNodes[0].textContent);
  expect(firstCells).toEqual(["AAA", "CASH", "HEDGE"]);
});

it("diversification section: concentration, correlation benefit and extreme pairs", () => {
  const r = build([
    { ticker: "AAA", weight: 0.5 },
    { ticker: "BBB", weight: 0.3 },
    { ticker: "CASH", weight: 0.2 },
  ]);
  render(<DiversificationSection risk={r.riskAnalytics} />);
  const strip = within(screen.getByLabelText("Diversification overview"));
  expect(
    strip.getAllByRole("term").map((t) => t.childNodes[0].textContent),
  ).toEqual([
    "Weighted standalone volatility",
    "Diversification ratio",
    "Effective holdings",
    "Top-3 concentration",
    "Highest correlation",
    "Lowest correlation",
  ]);
  const c = r.riskAnalytics.concentration;
  expect(strip.getByText(c.effectiveHoldings.toFixed(1))).toBeTruthy();
  expect(strip.getAllByText("AAA / BBB")).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("heatmap prints every value, marks the diagonal, and names the extreme pairs", () => {
  const r = build([
    { ticker: "AAA", weight: 0.5 },
    { ticker: "BBB", weight: 0.3 },
    { ticker: "CASH", weight: 0.2 },
  ]);
  render(<DiversificationSection risk={r.riskAnalytics} />);
  const heat = screen.getByRole("table", {
    name: /Correlation matrix of AAA, BBB/,
  });
  expect(
    within(heat)
      .getAllByRole("columnheader")
      .map((h) => h.textContent),
  ).toEqual(["AAA", "BBB"]);
  expect(heat.querySelectorAll(".heat-diagonal")).toHaveLength(2);
  expect(screen.getByText(/Highest: AAA\/BBB/)).toBeTruthy();
  fireEvent.mouseEnter(heat.querySelectorAll("tbody td")[1]);
  expect(screen.getByText(/^AAA \/ BBB: -?\d\.\d{4}$/)).toBeTruthy();
});

it("insufficient history and all-CASH states render explicit reasons, never NaN", () => {
  const short = build(
    [
      { ticker: "AAA", weight: 0.6 },
      { ticker: "BBB", weight: 0.4 },
    ],
    40,
  );
  render(
    <RiskSection risk={short.riskAnalytics} performance={short.performance} />,
  );
  expect(screen.getByRole("status").textContent).toMatch(
    /^Insufficient History.*Only 39 common daily observations/,
  );
  expect(screen.getAllByText("N/A").length).toBeGreaterThan(3);
  cleanup();
  const cash = build([{ ticker: "CASH", weight: 1 }], 80);
  render(<DiversificationSection risk={cash.riskAnalytics} />);
  expect(
    screen.getByText(
      /Correlation matrix unavailable: The portfolio is entirely CASH/,
    ),
  ).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("return contribution shows arithmetic period totals equal to the sum of daily returns", () => {
  const r = hedge();
  render(
    <ReturnContribution
      contribution={r.riskAnalytics.returnContribution}
      cumulativeReturn={null}
    />,
  );
  expect(
    screen.getByRole("heading", {
      name: /Return contribution · daily \/ period arithmetic/,
    }),
  ).toBeTruthy();
  expect(screen.getByText("sum of daily portfolio returns")).toBeTruthy();
  expect(screen.getByText(/max residual 0\.0e\+0/)).toBeTruthy();
});

import { CorrelationHeatmap } from "@/components/risk/CorrelationHeatmap";
it("heatmap never prints a signed zero", () => {
  render(
    <CorrelationHeatmap
      tickers={["IEF", "XLF"]}
      matrix={[
        [1, -0.004],
        [-0.004, 1],
      ]}
      highest={null}
      lowest={null}
      undefinedTickers={[]}
    />,
  );
  expect(screen.getAllByText("0.00")).toHaveLength(2);
  expect(screen.queryByText("-0.00")).toBeNull();
});
