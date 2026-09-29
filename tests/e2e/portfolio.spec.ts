import { expect, test } from "@playwright/test";
import { simulate } from "../../lib/backtest/engine";
import { series, sessions } from "../fixtures/helpers";
const dates = ["2024-05-30", "2024-05-31", "2024-06-03"];
const simulation = simulate({
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
test.beforeEach(async ({ page }) => {
  await page.route("**/api/quotes", (route) =>
    route.fulfill({
      json: [
        {
          ok: false,
          error: {
            code: "PROVIDER_ERROR",
            message: "Optional quotes offline; history remains available.",
            retryable: true,
          },
        },
      ],
    }),
  );
  await page.route("**/api/treasury/current", (route) =>
    route.fulfill({
      json: {
        ok: false,
        error: {
          code: "TREASURY_UNAVAILABLE",
          message: "Current Treasury unavailable.",
          retryable: true,
        },
      },
    }),
  );
});
test("sample workflow, independent quote failure, methodology, and edited-draft isolation", async ({
  page,
}) => {
  await page.route("**/api/analysis", async (route) => {
    const config = route.request().postDataJSON();
    await route.fulfill({
      json: { ok: true, value: { ...simulation, config } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "A traceable return ledger." }),
  ).toBeVisible();
  await expect(
    page.getByText("Optional quotes offline; history remains available."),
  ).toBeVisible();
  await page.getByText("Methodology & data lineage").click();
  await expect(page.getByText(/Snapshot SHA-256/)).toBeVisible();
  await page.getByLabel("Ticker 1", { exact: true }).fill("VT");
  await expect(
    page.getByText(/Your edited draft has not been analyzed/),
  ).toBeVisible();
});
test("invalid weights, add/remove, and preferences survive refresh", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Weight 1", { exact: true }).fill("30");
  await expect(
    page.getByRole("button", { name: "Analyze portfolio" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Load Sample Portfolio" }).click();
  await page.getByRole("button", { name: "+ Add holding" }).click();
  await expect(page.getByLabel("Ticker 7", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove holding 7" }).click();
  await page.getByLabel("Ticker 1", { exact: true }).fill("VT");
  await page.reload();
  await expect(page.getByLabel("Ticker 1", { exact: true })).toHaveValue("VT");
});
test("failed ticker offers retry, edit, and remove", async ({ page }) => {
  let attempt = 0;
  await page.route("**/api/analysis", (route) =>
    route.fulfill({
      json:
        ++attempt === 1
          ? {
              ok: false,
              error: {
                code: "TICKER_NOT_FOUND",
                ticker: "SPY",
                message: "No history for SPY.",
                retryable: true,
              },
            }
          : { ok: true, value: simulation },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No history for SPY." }),
  ).toContainText("No history for SPY.");
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(
    page.getByRole("heading", { name: "A traceable return ledger." }),
  ).toBeVisible();
});
test("mobile keyboard navigation and reduced-motion layout remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to portfolio builder")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Ticker 1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze portfolio" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("real route accepts the browser origin independently of internal Next hostname", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.post("/api/analysis", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { holdings: [] },
  });
  const result = await response.json();
  expect(result.ok).toBe(false);
  expect(result.error.code).toBe("INVALID_INPUT");
});

// Phase 2: ~4 months of weekday sessions with prior-known rates, a recovered
// drawdown and a later unrecovered one, so every metric is defined.
const longDates: string[] = [];
for (let d = new Date("2024-01-02T12:00:00Z"); longDates.length < 90; d.setUTCDate(d.getUTCDate() + 1))
  if (d.getUTCDay() % 6) longDates.push(d.toISOString().slice(0, 10));
const longPrices = longDates.map((_, i) => 100 * (1 + i * 0.002) * (1 + 0.04 * Math.sin(i / 6)));
const longBenchmark = longDates.map((_, i) => 100 * (1 + i * 0.0015));
const longResult = simulate({
  config: {
    holdings: [{ ticker: "QQQ", weight: 0.8 }, { ticker: "CASH", weight: 0.2 }],
    benchmark: "SPY",
    requestedStartDate: longDates[0],
    endDate: longDates.at(-1)!,
    rebalanceFrequency: "monthly",
    cashPolicy: "historical_proxy",
  },
  prices: [series("QQQ", longDates, longPrices), series("SPY", longDates, longBenchmark)],
  treasury: {
    series: "DGS3MO",
    observations: ["2023-12-29", ...longDates].map((date) => ({
      date, annualYield: 0.05, availableAt: `${date}T20:15:00Z`, availability: "published" as const,
    })),
    provenance: series("SPY", [], []).provenance,
  },
  sessions: sessions(longDates),
  now: "2024-06-01T12:00:00Z",
});
async function showLongResult(page: import("@playwright/test").Page) {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({ json: { ok: true, value: longResult } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await expect(page.getByRole("heading", { name: "Performance overview." })).toBeVisible();
}

test("performance overview, growth chart and drawdown lab render real metrics", async ({ page }) => {
  await showLongResult(page);
  const strip = page.locator("dl.kpi-strip");
  for (const label of ["Ending value", "Cumulative return", "CAGR", "Annualized volatility", "Sharpe ratio", "Sortino ratio", "Maximum drawdown"])
    await expect(strip.getByRole("term").filter({ hasText: new RegExp(`^${label}`) })).toBeVisible();
  await expect(strip).not.toContainText("N/A");
  for (const part of await page.locator("dl.kpi-strip, dl.drawdown-stats, figure.chart-figure").all())
    await expect(part).not.toContainText(/NaN|Infinity/);
  // Methodology tooltip appears on keyboard focus.
  await page.getByRole("button", { name: "About Sortino ratio" }).focus();
  await expect(page.getByRole("tooltip").filter({ hasText: "Downside deviation uses every day" })).toBeVisible();
  // Both series draw; hovering shows a crosshair readout with every series.
  const growth = page.locator("figure").filter({ has: page.getByRole("heading", { name: "Growth of $10,000" }) });
  await expect(growth.locator(".recharts-line-curve")).toHaveCount(2);
  await growth.locator(".chart-frame").scrollIntoViewIfNeeded();
  const box = (await growth.locator(".chart-frame").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 });
  await expect(growth.locator(".chart-tooltip")).toContainText("Portfolio");
  await expect(growth.locator(".chart-tooltip")).toContainText("SPY");
  await growth.getByRole("checkbox", { name: /SPY benchmark/ }).uncheck();
  await expect(growth.locator(".recharts-line-curve")).toHaveCount(1);
  // Drawdown lab statistics come from the same result.
  const episode = longResult.performance.maximumDrawdownEpisode!;
  const stats = page.locator("dl.drawdown-stats");
  await expect(stats).toContainText(episode.peakDate);
  await expect(stats).toContainText(episode.troughDate);
  await expect(page.locator("figure").filter({ hasText: "Portfolio drawdown" }).locator(".recharts-area-area")).toHaveCount(1);
});

test("performance sections stay within a mobile viewport with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  await expect(page.getByRole("heading", { name: "Peak-to-trough losses." })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  // Open tooltips in either column stay inside the viewport.
  for (const name of ["About Sortino ratio", "About Maximum drawdown"]) {
    await page.locator("dl.kpi-strip").getByRole("button", { name, exact: true }).focus();
    const tip = (await page.getByRole("tooltip").filter({ visible: true }).boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(390);
  }
  // Reduced motion disables CSS animation on KPI values.
  expect(
    await page.locator(".kpi-value").first().evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});
