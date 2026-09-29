// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PortfolioWorkspace } from "@/components/portfolio/PortfolioWorkspace";
import {
  MethodologyDrawer,
  openMethodology,
} from "@/components/methodology/MethodologyDrawer";
import { InfoTip } from "@/components/metrics/InfoTip";
import { simulate } from "@/lib/backtest/engine";
import type { CurrentQuote, TreasuryCurve } from "@/lib/types/data";
import { provenance, series, sessions } from "../fixtures/helpers";

const dates = ["2024-05-30", "2024-05-31", "2024-06-03"];
const result = simulate({
  config: {
    holdings: [{ ticker: "SPY", weight: 1 }],
    benchmark: "SPY",
    requestedStartDate: dates[0],
    endDate: dates[2],
    rebalanceFrequency: "monthly",
    cashPolicy: "historical_proxy",
  },
  prices: [series("SPY", dates, [100, 110, 99])],
  treasury: null,
  sessions: sessions(dates),
  now: "2024-06-04T10:00:00Z",
});
const curve: TreasuryCurve = {
  points: (["3M", "1Y", "3Y", "5Y", "10Y"] as const).map((maturity, i) => ({
    maturity,
    date: "2024-06-03",
    annualYield: 0.05 - i * 0.002,
  })),
  mixedDates: false,
  provenance,
};
const quote = (ticker: string, over: Partial<CurrentQuote>): CurrentQuote => ({
  ticker,
  price: 500,
  marketTimestamp: "2024-06-03T20:00:00Z",
  marketDate: "2024-06-03",
  fetchedAt: "2024-06-04T10:00:00Z",
  status: "latest_available",
  provider: "test",
  session: "regular",
  observationAgeSeconds: 50_000,
  staleAfter: "2099-01-01T20:00:00Z",
  provenance,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(
  analysis: unknown,
  quotes: unknown = [],
  treasury: unknown = { ok: true, value: curve },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url === "/api/analysis"
          ? analysis
          : url === "/api/quotes"
            ? quotes
            : treasury,
      ),
    ),
  );
}

it("methodology drawer opens from anywhere, lists every topic and shows this run's lineage", () => {
  render(<MethodologyDrawer result={result} />);
  act(() => openMethodology("construction"));
  const dialog = screen.getByRole("dialog", {
    name: "How every number is produced.",
  });
  expect(dialog.hasAttribute("open")).toBe(true);
  for (const topic of [
    "Data",
    "Coverage",
    "Portfolio",
    "Performance",
    "Benchmark",
    "Risk",
    "Stress",
    "Construction",
    "Numerics",
  ])
    expect(within(dialog).getByRole("heading", { name: topic })).toBeTruthy();
  expect(within(dialog).getByText(result.metadata.snapshotHash)).toBeTruthy();
  expect(within(dialog).getByText(/Ledoit–Wolf shrinkage/)).toBeTruthy();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close methodology" }),
  );
  expect(dialog.hasAttribute("open")).toBe(false);
});

it("a failed ticker offers Retry, Edit and Remove for that holding", async () => {
  stub({
    ok: false,
    error: {
      code: "TICKER_NOT_FOUND",
      ticker: "QQQ",
      message: "No history for QQQ.",
      retryable: true,
    },
  });
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/^QQQ · Ticker Not Found/);
  expect(within(alert).getByRole("button", { name: "Retry analysis" }));
  const index = [
    ...document.querySelectorAll<HTMLInputElement>("[id^=ticker-]"),
  ]
    .map((i) => i.value)
    .indexOf("QQQ");
  expect(
    screen.getByLabelText(`Ticker ${index + 1}`).getAttribute("aria-invalid"),
  ).toBe("true");
  fireEvent.click(within(alert).getByRole("button", { name: "Edit QQQ" }));
  expect(document.activeElement).toBe(
    screen.getByLabelText(`Ticker ${index + 1}`),
  );
  fireEvent.click(within(alert).getByRole("button", { name: "Remove QQQ" }));
  expect(
    [...document.querySelectorAll<HTMLInputElement>("[id^=ticker-]")].map(
      (i) => i.value,
    ),
  ).not.toContain("QQQ");
});

it("Build Portfolio moves focus to the first holding", () => {
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(screen.getByRole("button", { name: "Build Portfolio" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Ticker 1"));
});

it("current market highlights the horizon maturity and never shows a stale quote as Live", async () => {
  stub({ ok: true, value: result }, [
    // A newer close exists (staleAfter passed) while the live claim has not lapsed:
    // freshness is re-derived on display and stale must win over Live.
    {
      ok: true,
      value: quote("SPY", {
        status: "live",
        statusExpiresAt: "2099-01-01T00:00:00Z",
        staleAfter: "2024-06-03T21:00:00Z",
      }),
    },
    { ok: true, value: quote("QQQ", {}) },
  ]);
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  const section = (
    await screen.findByRole("heading", {
      name: /^Current Treasury Reference · latest official/,
    })
  ).closest("section")!;
  // The sample requests five years, so the 5Y point is the horizon reference.
  const selected = section.querySelector(".curve-selected")!;
  expect(selected.textContent).toMatch(/^5Y \(analysis horizon\)/);
  const table = within(section).getByRole("table");
  expect(within(table).getByText("Stale Current Data")).toBeTruthy();
  expect(within(table).getByText("Latest Available")).toBeTruthy();
  expect(within(table).queryByText("Live")).toBeNull();
});

it("Escape dismisses an open tooltip until the next focus", () => {
  render(<InfoTip label="Beta">Sensitivity to the benchmark.</InfoTip>);
  const trigger = screen.getByRole("button", { name: "About Beta" });
  fireEvent.focus(trigger);
  const wrapper = trigger.parentElement!;
  expect(wrapper.hasAttribute("data-dismissed")).toBe(false);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(wrapper.hasAttribute("data-dismissed")).toBe(true);
  fireEvent.focus(trigger);
  expect(wrapper.hasAttribute("data-dismissed")).toBe(false);
});

it("builder total never displays a negative rounded zero", () => {
  render(<PortfolioWorkspace today="2024-06-04" />);
  for (const field of screen.getAllByLabelText(/^Weight \d+$/))
    fireEvent.change(field, { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Weight 1"), { target: { value: "-0.00001" } });
  expect(document.querySelector(".allocation-footer strong")!.textContent).toBe("0.00%");
});
