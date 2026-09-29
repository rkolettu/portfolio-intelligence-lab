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
