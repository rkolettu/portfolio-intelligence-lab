// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/analysis/portfolio",
}));
import { PortfolioWorkspace } from "./workspaceHarness";
import { PortfolioPage } from "@/components/pages/PortfolioPage";
import { simulate } from "@/lib/backtest/engine";
import { series, sessions } from "../fixtures/helpers";

const dates = ["2024-05-30", "2024-05-31", "2024-06-03"];
const result = simulate({
  config: {
    holdings: [
      { ticker: "AAPL", weight: 0.5 },
      { ticker: "SPY", weight: 0.5 },
    ],
    benchmark: "SPY",
    requestedStartDate: dates[0],
    endDate: dates[2],
    rebalanceFrequency: "monthly",
    cashPolicy: "historical_proxy",
  },
  prices: [
    series("AAPL", dates, [100, 105, 110]),
    series("SPY", dates, [100, 101, 102]),
  ],
  treasury: null,
  sessions: sessions(dates),
  now: "2024-06-04T10:00:00Z",
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("supports sector and style drilldowns by click and touch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url === "/api/analysis"
          ? { ok: true, value: result }
          : url === "/api/sector-proxies"
            ? {
                ok: true,
                value: [{ ticker: "XLK", available: true, return: 0.07 }],
              }
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
  render(
    <PortfolioWorkspace today="2024-06-04" analysisPage={<PortfolioPage />} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Analyze Sample Portfolio/ }),
  );
  expect(
    await screen.findByRole("heading", { name: "What you actually own." }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /Technology · XLK proxy/ }),
  );
  expect(
    screen.getByText("Selected sector").parentElement?.textContent,
  ).toContain("Technology");
  fireEvent.pointerUp(screen.getByRole("button", { name: /Large Growth/ }), {
    pointerType: "touch",
  });
  fireEvent.click(screen.getByRole("button", { name: /Large Growth/ }));
  expect(
    screen.getByText("Selected cell").parentElement?.textContent,
  ).toContain("Large Growth");
  expect(screen.getAllByText("AAPL").length).toBeGreaterThan(0);
});
