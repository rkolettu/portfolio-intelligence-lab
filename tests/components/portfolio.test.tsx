// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PortfolioWorkspace } from "@/components/portfolio/PortfolioWorkspace";
import { simulate } from "@/lib/backtest/engine";
import { series, sessions } from "../fixtures/helpers";
import { STORAGE_KEY } from "@/lib/state/persistence";
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("restores a usable sample on corrupt storage and shows accessible validation", async () => {
  localStorage.setItem(STORAGE_KEY, "{broken");
  render(<PortfolioWorkspace today="2024-06-04" />);
  expect(
    await screen.findByText(/Saved preferences were unavailable/),
  ).toBeTruthy();
  expect((screen.getByLabelText("Ticker 1") as HTMLInputElement).value).toBe(
    "SPY",
  );
  fireEvent.change(screen.getByLabelText("Weight 1"), {
    target: { value: "30" },
  });
  expect(
    screen
      .getByRole("button", { name: /Analyze portfolio/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Load Sample Portfolio" }),
  );
  expect(
    screen
      .getByRole("button", { name: /Analyze portfolio/ })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("keeps history when optional current requests fail and marks results stale after an edit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/analysis")
        return Response.json({ ok: true, value: result });
      throw new Error("optional outage");
    }),
  );
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  expect(await screen.findByText("Methodology & data lineage.")).toBeTruthy();
  expect(await screen.findByText(/Current quotes unavailable/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Ticker 1"), {
    target: { value: "VT" },
  });
  expect(
    screen.getByText(/Your edited draft has not been analyzed/),
  ).toBeTruthy();
});
it("discards obsolete responses even when an upstream fetch ignores abort", async () => {
  const completions: ((value: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url === "/api/analysis"
        ? new Promise<Response>((resolve) => completions.push(resolve))
        : Promise.resolve(
            Response.json({
              ok: false,
              error: {
                code: "PROVIDER_ERROR",
                message: "Optional unavailable",
                retryable: true,
              },
            }),
          ),
    ),
  );
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Restart analysis/ }));
  expect(completions).toHaveLength(2);
  await act(async () => {
    completions[1](Response.json({ ok: true, value: result }));
  });
  expect(await screen.findByText("Methodology & data lineage.")).toBeTruthy();
  await act(async () => {
    completions[0](
      Response.json({
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          message: "Obsolete failure",
          retryable: true,
        },
      }),
    );
  });
  await waitFor(() =>
    expect(screen.queryByText("Obsolete failure")).toBeNull(),
  );
});
it("keeps a prominent result-bound zero-CASH warning after the draft policy changes", async () => {
  const zero = simulate({
    config: {
      ...result.config,
      holdings: [{ ticker: "CASH", weight: 1 }],
      cashPolicy: "zero_explicit",
    },
    prices: [],
    treasury: null,
    sessions: sessions(dates),
    now: "2024-06-04T10:00:00Z",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url === "/api/analysis"
          ? { ok: true, value: zero }
          : {
              ok: false,
              error: {
                code: "PROVIDER_ERROR",
                message: "Optional unavailable",
                retryable: true,
              },
            },
      ),
    ),
  );
  render(<PortfolioWorkspace today="2024-06-04" />);
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  expect(
    await screen.findByRole("note", { name: "Zero-return CASH methodology" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Load Sample Portfolio" }),
  );
  expect(
    screen.getByRole("note", { name: "Zero-return CASH methodology" })
      .textContent,
  ).toContain("entire run");
});
