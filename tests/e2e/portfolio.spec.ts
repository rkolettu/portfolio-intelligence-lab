import { expect, test } from "@playwright/test";
import { simulate } from "../../lib/backtest/engine";
import { runStress } from "../../lib/backtest/stress";
import type { StressWindowDefinition } from "../../lib/types/analytics";
import { runConstruction } from "../../lib/backtest/construction";
import { toDraft } from "../../lib/state/portfolioReducer";
import {
  constructionConfig,
  constructionInput,
} from "../fixtures/construction";
import { series, sessions } from "../fixtures/helpers";
import { hedgeResult } from "../fixtures/hedge";

// Phase 9: the report lives on real routes under /analysis. Pages are opened the way
// a person would, through the workspace navigation (client-side, no reload).
type Page = import("@playwright/test").Page;
const ROUTE_LABEL = {
  overview: "Overview",
  performance: "Performance",
  benchmark: "Benchmark",
  risk: "Risk",
  rolling: "Rolling",
  stress: "Stress Lab",
  constructor: "Constructor",
} as const;
async function openPage(page: Page, route: keyof typeof ROUTE_LABEL) {
  await page
    .locator('nav[aria-label="Workspace"]')
    .getByRole("link", { name: ROUTE_LABEL[route], exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/analysis/${route}$`));
}
async function openBuilder(page: Page) {
  await page
    .locator('nav[aria-label="Workspace"]')
    .getByRole("link", { name: "Builder", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
}
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
  await page.route("**/api/construction", (route) =>
    route.fulfill({ json: { ok: true, value: constructionResult } }),
  );
  // Deterministic Stress Lab data; the fixture is defined below with the long result.
  await page.route("**/api/stress", (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: route.request().postDataJSON().window
          ? customStress
          : presetStress,
      },
    }),
  );
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
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await expect(
    page.getByRole("heading", { name: "Methodology & data lineage." }),
  ).toBeVisible();
  await expect(
    page.getByText("Optional quotes offline; history remains available."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open methodology" }).click();
  const drawer = page.getByRole("dialog", {
    name: "How every number is produced.",
  });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/Snapshot SHA-256/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await openBuilder(page);
  await page.getByLabel("Ticker 1", { exact: true }).fill("VT");
  await expect(page.locator(".resume")).toContainText("not been analyzed");
  await openPage(page, "overview");
  await expect(
    page.getByText(/Your edited draft has not been analyzed/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Re-analyze edited portfolio" }),
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
    page.getByRole("heading", { name: "Methodology & data lineage." }),
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
for (
  let d = new Date("2024-01-02T12:00:00Z");
  longDates.length < 90;
  d.setUTCDate(d.getUTCDate() + 1)
)
  if (d.getUTCDay() % 6) longDates.push(d.toISOString().slice(0, 10));
const longPrices = longDates.map(
  (_, i) => 100 * (1 + i * 0.002) * (1 + 0.04 * Math.sin(i / 6)),
);
const longBenchmark = longDates.map((_, i) => 100 * (1 + i * 0.0015));
const longResult = simulate({
  config: {
    holdings: [
      { ticker: "QQQ", weight: 0.8 },
      { ticker: "CASH", weight: 0.2 },
    ],
    benchmark: "SPY",
    requestedStartDate: longDates[0],
    endDate: longDates.at(-1)!,
    rebalanceFrequency: "monthly",
    cashPolicy: "historical_proxy",
  },
  prices: [
    series("QQQ", longDates, longPrices),
    series("SPY", longDates, longBenchmark),
  ],
  treasury: {
    series: "DGS3MO",
    observations: ["2023-12-29", ...longDates].map((date) => ({
      date,
      annualYield: 0.05,
      availableAt: `${date}T20:15:00Z`,
      availability: "published" as const,
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
  await expect(
    page.getByRole("heading", { name: "Performance overview." }),
  ).toBeVisible();
}

test("performance overview, growth chart and drawdown lab render real metrics", async ({
  page,
}) => {
  await showLongResult(page);
  const strip = page.locator('dl[aria-label="Performance overview"]');
  for (const label of [
    "Ending value",
    "Cumulative return",
    "CAGR",
    "Annualized volatility",
    "Sharpe ratio",
    "Sortino ratio",
    "Maximum drawdown",
  ])
    await expect(
      strip.getByRole("term").filter({ hasText: new RegExp(`^${label}`) }),
    ).toBeVisible();
  await expect(strip).not.toContainText("N/A");
  for (const part of await page
    .locator(
      "dl.kpi-strip, dl.drawdown-stats, figure.chart-figure, table.comparison-table",
    )
    .all())
    await expect(part).not.toContainText(/NaN|Infinity/);
  // Methodology tooltip appears on keyboard focus.
  await page.getByRole("button", { name: "About Sortino ratio" }).focus();
  await expect(
    page
      .getByRole("tooltip")
      .filter({ hasText: "Downside deviation uses every day" }),
  ).toBeVisible();
  // Both series draw; hovering shows a crosshair readout with every series.
  const growth = page
    .locator("figure")
    .filter({ has: page.getByRole("heading", { name: "Growth of $10,000" }) });
  await expect(growth.locator(".recharts-line-curve")).toHaveCount(2);
  await growth.locator(".chart-frame").scrollIntoViewIfNeeded();
  const box = (await growth.locator(".chart-frame").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 8,
  });
  await expect(growth.locator(".chart-tooltip")).toContainText("Portfolio");
  await expect(growth.locator(".chart-tooltip")).toContainText("SPY");
  await growth.getByRole("checkbox", { name: /SPY benchmark/ }).uncheck();
  await expect(growth.locator(".recharts-line-curve")).toHaveCount(1);
  // Drawdown lab statistics come from the same result, on the Performance page.
  await openPage(page, "performance");
  const episode = longResult.performance.maximumDrawdownEpisode!;
  const stats = page.locator("dl.drawdown-stats");
  await expect(stats).toContainText(episode.peakDate);
  await expect(stats).toContainText(episode.troughDate);
  await expect(
    page
      .locator("figure")
      .filter({ hasText: "Portfolio drawdown" })
      .locator(".recharts-area-area"),
  ).toHaveCount(1);
});

test("performance sections stay within a mobile viewport with reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  await openPage(page, "performance");
  await expect(
    page.getByRole("heading", { name: "Peak-to-trough losses." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Open tooltips in either column stay inside the viewport.
  for (const name of ["About Sortino ratio", "About Maximum drawdown"]) {
    await page
      .locator('dl[aria-label="Performance overview"]')
      .getByRole("button", { name, exact: true })
      .focus();
    const tip = (await page
      .getByRole("tooltip")
      .filter({ visible: true })
      .boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(390);
  }
  // Reduced motion disables CSS animation on KPI values.
  expect(
    await page
      .locator(".kpi-value")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("benchmark section and drawdown series toggle use one aligned comparison sample", async ({
  page,
}) => {
  await showLongResult(page);
  await openPage(page, "benchmark");
  const section = page.locator("section:has(#benchmark-title)");
  await expect(
    section.getByRole("heading", { name: "Relative to SPY." }),
  ).toBeVisible();
  const a = longResult.benchmarkAnalytics;
  if (!a.comparison.available)
    throw new Error("fixture must have a comparison sample");
  await expect(section).toContainText(
    `${a.comparison.sample.startDate} → ${a.comparison.sample.endDate}`,
  );
  await expect(
    section.getByText("Aligned observations").locator(".."),
  ).toContainText(String(a.comparison.sample.returnCount));
  for (const label of [
    "Beta",
    "CAPM alpha",
    "Correlation",
    "R²",
    "Active return",
    "Tracking error",
    "Information ratio",
  ])
    await expect(
      section
        .getByRole("term")
        .filter({ hasText: new RegExp(`^${label.replace("²", "\\u00b2")}`) }),
    ).toBeVisible();
  await expect(section.locator("dl.kpi-strip")).toHaveCount(2);
  for (const strip of await section.locator("dl.kpi-strip").all())
    await expect(strip).not.toContainText("N/A");
  await expect(section.locator("table.comparison-table")).toContainText("CAGR");
  await section
    .getByRole("button", { name: "About Information ratio" })
    .focus();
  await expect(
    page.getByRole("tooltip").filter({ visible: true }),
  ).toContainText("per unit of tracking error");
  // The Benchmark page opens its drawdown comparison on both series.
  await expect(
    page.locator("section:has(#benchmark-drawdown-title) dl.drawdown-stats"),
  ).toHaveCount(2);
  // Drawdown series toggle (Performance page): keyboard-operable radio group.
  await openPage(page, "performance");
  const drawdowns = page.locator("section:has(#drawdowns-title)");
  await drawdowns.getByRole("radio", { name: "Portfolio" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(drawdowns.getByRole("radio", { name: "SPY" })).toBeChecked();
  await expect(
    drawdowns.getByRole("heading", { name: "SPY drawdown" }),
  ).toBeVisible();
  await drawdowns.getByRole("radio", { name: "Both" }).check();
  await expect(drawdowns.locator("dl.drawdown-stats")).toHaveCount(2);
  const chart = drawdowns.locator("figure");
  await expect(chart.locator(".recharts-area-area")).toHaveCount(1);
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(chart.locator(".chart-legend")).toContainText("Portfolio");
  await expect(chart.locator(".chart-legend")).toContainText("SPY");
});

test("risk section: overview, capital vs risk sorting, holding table and return contribution", async ({
  page,
}) => {
  await showLongResult(page);
  await openPage(page, "risk");
  const section = page.locator("section:has(#risk-title)");
  await expect(
    section.getByRole("heading", { name: "What drives portfolio risk." }),
  ).toBeVisible();
  const ra = longResult.riskAnalytics;
  if (!ra.sample.available) throw new Error("fixture must have a risk sample");
  await expect(
    section.getByText("Common observations", { exact: true }).locator(".."),
  ).toContainText(String(ra.sample.sample.returnCount));
  const overview = section.locator('dl[aria-label="Risk overview"]');
  for (const label of [
    "Portfolio volatility",
    "Realized volatility",
    "Largest risk contribution",
    "Risky holdings",
  ])
    await expect(
      overview.getByRole("term").filter({ hasText: new RegExp(`^${label}`) }),
    ).toBeVisible();
  await expect(overview).not.toContainText("N/A");
  // Capital vs Risk rows follow the sort control.
  const tickers = () =>
    section
      .locator(".cr-row:not(.cr-axis) .cr-ticker")
      .evaluateAll((els) => els.map((e) => e.childNodes[0].textContent));
  expect(await tickers()).toEqual(["QQQ", "CASH"]);
  await section.getByRole("radio", { name: "Risk contribution" }).check();
  expect((await tickers())[0]).toBe("QQQ");
  await expect(section.locator(".cr-row", { hasText: "CASH" })).toContainText(
    "riskless",
  );
  await expect(
    section.getByRole("table", { name: /Holding risk at target weights/ }),
  ).toContainText("= σ");
  const diversification = page.locator("section:has(#diversification-title)");
  await expect(
    diversification.locator('dl[aria-label="Diversification overview"]'),
  ).toBeVisible();
  for (const part of await page
    .locator(
      "section:has(#risk-title) :is(dl, table, figure), section:has(#diversification-title) :is(dl, table, figure)",
    )
    .all())
    await expect(part).not.toContainText(/NaN|Infinity/);
  // Return contribution lives with performance.
  await openPage(page, "performance");
  await expect(
    page
      .locator("section:has(#performance-title)")
      .getByText("sum of daily portfolio returns", { exact: true }),
  ).toBeVisible();
});

// Phase 5: stress windows inside the long fixture. QQQ reports a first trade on
// session 10, so the first window is Incomplete Historical Coverage.
const stressWindow = (
  id: string,
  name: string,
  from: number,
  to: number,
): StressWindowDefinition => ({
  id,
  name,
  startDate: longDates[from],
  endDate: longDates[to],
  description: `${name} fixture window.`,
  kind: id === "custom" ? "custom" : "preset",
});
const stressFixture = (windows: StressWindowDefinition[]) =>
  runStress({
    config: longResult.config,
    windows,
    prices: [
      series("QQQ", longDates.slice(10), longPrices.slice(10), longDates[10]),
      series("SPY", longDates, longBenchmark),
    ],
    treasury: longResult.snapshot.treasury,
    sessions: sessions(longDates),
    unavailable: [],
    now: "2024-06-01T12:00:00Z",
  });
const presetStress = stressFixture([
  stressWindow("gfc", "Global Financial Crisis", 0, 40),
  stressWindow("covid", "COVID Crash", 30, 60),
  stressWindow("rate-shock-2022", "2022 Inflation / Rate Shock", 50, 88),
]);
const customStress = stressFixture([
  stressWindow("custom", "Custom Historical Window", 20, 80),
]);

test("rolling analytics and Stress Lab: windows, coverage failure and a custom window", async ({
  page,
}) => {
  await showLongResult(page);
  await openPage(page, "rolling");
  const rolling = page.locator("section:has(#rolling-title)");
  await expect(
    rolling.getByRole("heading", { name: "60-session rolling volatility" }),
  ).toBeVisible();
  await expect(rolling.locator(".recharts-line-curve")).toHaveCount(1);
  await rolling.getByRole("radio", { name: "Beta vs SPY" }).check();
  await rolling.getByRole("radio", { name: "20D", exact: true }).check();
  await expect(
    rolling.getByRole("heading", { name: "20-session rolling beta vs SPY" }),
  ).toBeVisible();
  await rolling.getByRole("radio", { name: "120D", exact: true }).check();
  await expect(
    rolling.getByText(/No 120-session window is complete in this sample/),
  ).toBeVisible();

  await openPage(page, "stress");
  const stress = page.locator("section:has(#stress-title)");
  const table = stress.getByRole("table", { name: /Historical stress events/ });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Incomplete Historical Coverage");
  await stress.getByRole("radio", { name: /GFC/ }).check();
  await expect(
    stress.getByRole("heading", { name: "Incomplete Historical Coverage" }),
  ).toBeVisible();
  await expect(
    stress.getByText(
      "This stress result cannot be calculated accurately because one or more holdings lack sufficient historical data during the selected period.",
    ),
  ).toBeVisible();
  await stress.getByRole("radio", { name: /COVID/ }).check();
  await expect(
    stress.locator('dl[aria-label="COVID Crash event metrics"]'),
  ).toBeVisible();
  const path = stress
    .locator("figure")
    .filter({ has: page.getByRole("heading", { name: /through the event/ }) });
  await expect(path.locator(".recharts-line-curve")).toHaveCount(2);
  await expect(stress.locator(".cr-row", { hasText: "CASH" })).toContainText(
    "riskless",
  );

  await stress.getByRole("radio", { name: "Custom window" }).check();
  await stress.getByLabel("Window start").fill(longDates[20]);
  await stress.getByLabel("Window end").fill(longDates[80]);
  await stress.getByRole("button", { name: "Run custom window" }).click();
  await expect(
    stress.locator('dl[aria-label="Custom Historical Window event metrics"]'),
  ).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(stress).not.toContainText(/hypothetical stress test/i);
  for (const part of await page
    .locator(
      "section:has(#rolling-title), section:has(#stress-title) dl, section:has(#stress-title) table",
    )
    .all())
    await expect(part).not.toContainText(/NaN|Infinity/);
});

test("rolling and stress sections stay within a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  await openPage(page, "rolling");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await openPage(page, "stress");
  const stress = page.locator("section:has(#stress-title)");
  await stress.getByRole("radio", { name: /COVID/ }).check();
  await expect(
    stress.locator('dl[aria-label="COVID Crash event metrics"]'),
  ).toBeVisible();
  await stress.getByRole("radio", { name: "Custom window" }).check();
  await expect(stress.getByLabel("Window start")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

// Phase 6: the analyzed portfolio and the construction share one fixture, so the
// constructor's universe (AAA, BBB, zero-weight CCC, CASH) matches the analysis.
const constructionFixture = constructionInput();
const constructionAnalysis = simulate({
  config: constructionConfig,
  prices: constructionFixture.estimation.prices,
  treasury: constructionFixture.estimation.treasury,
  sessions: constructionFixture.estimation.sessions,
  now: constructionFixture.now,
});
const constructionResult = runConstruction(constructionFixture);
async function showConstructionResult(page: import("@playwright/test").Page) {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({ json: { ok: true, value: constructionAnalysis } }),
  );
  // Construction requires the builder to hold the analyzed portfolio, so seed the
  // builder with the fixture portfolio through the app's stored preferences.
  await page.addInitScript(
    (draft) =>
      window.localStorage.setItem(
        "portfolio-lab:preferences:v1",
        JSON.stringify({ version: 1, draft }),
      ),
    toDraft(constructionConfig),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze portfolio" }).click();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await openPage(page, "constructor");
  await expect(
    page.getByRole("heading", {
      name: "Mathematical alternative allocations.",
    }),
  ).toBeVisible();
  return page.locator("section:has(#constructor-title)");
}

test("portfolio constructor: generate, compare, stale guard and full-precision apply", async ({
  page,
}) => {
  const section = await showConstructionResult(page);
  await expect(section.getByLabel("Minimum weight CCC")).toBeVisible();
  await section.getByRole("button", { name: "Generate allocation" }).click();
  await expect(
    section.getByRole("heading", { name: "Minimum-Variance Allocation" }),
  ).toBeVisible();
  await expect(section.getByText("Estimated One-Way Turnover")).toBeVisible();
  await expect(section.getByRole("note")).toContainText(
    "In-Sample Retrospective Analysis",
  );
  await expect(
    section.getByRole("table", { name: /Stress comparison/ }),
  ).toContainText("Incomplete Historical Coverage · missing CCC");
  await expect(
    section
      .locator("figure")
      .filter({ hasText: "Current vs Proposed" })
      .locator(".recharts-line-curve"),
  ).toHaveCount(2);
  await section.getByRole("radio", { name: "Equal Risk Contribution" }).check();
  await expect(
    section.getByRole("heading", {
      name: "Equal-Risk-Contribution Allocation",
    }),
  ).toBeVisible();
  await section.getByRole("radio", { name: "Minimum Variance" }).check();
  // Changing an input makes the proposal stale; restoring it makes it current again.
  const apply = section.getByRole("button", { name: /Apply proposed weights/ });
  await section.getByLabel("Maximum weight AAA").fill("90");
  await expect(
    section.getByText(/Inputs changed since this proposal/),
  ).toBeVisible();
  await expect(apply).toBeDisabled();
  await section.getByLabel("Maximum weight AAA").fill("100");
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(section.getByText(/Applied to the builder/)).toBeVisible();
  for (const part of await section.locator("table, dl, figure").all())
    await expect(part).not.toContainText(/NaN|Infinity/);
  await expect(section).not.toContainText(
    /Recommended Portfolio|Best Allocation|You Should (Buy|Sell)/,
  );
  // Apply updated the shared builder draft: visible on Overview and in the builder.
  await openPage(page, "overview");
  await expect(
    page.getByText(/Your edited draft has not been analyzed/),
  ).toBeVisible();
  const mv = constructionResult.proposals.find(
    (p) => p.method === "minimum_variance",
  )!;
  const aaa = mv.weights!.find((w) => w.ticker === "AAA")!.weight;
  await openBuilder(page);
  const typed = await page.getByLabel("Weight 1", { exact: true }).inputValue();
  expect(Math.abs(Number(typed) / 100 - aaa)).toBeLessThan(1e-15);
  // Returning to the Constructor keeps the generated proposal (no refetch).
  await openPage(page, "constructor");
  await expect(
    section.getByRole("heading", { name: "Minimum-Variance Allocation" }),
  ).toBeVisible();
});

test("portfolio constructor stays within a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const section = await showConstructionResult(page);
  await section.getByRole("button", { name: "Generate allocation" }).click();
  await expect(
    section.getByRole("heading", { name: "Minimum-Variance Allocation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

// Phase 7: one product. Section order, the drawer, recovery and layouts.
test("sections follow one numbered order and the header opens the methodology drawer by keyboard", async ({
  page,
}) => {
  await showLongResult(page);
  // One numbered page per workspace route, in navigation order.
  const numbered: string[] = [];
  for (const route of Object.keys(ROUTE_LABEL) as (keyof typeof ROUTE_LABEL)[]) {
    await openPage(page, route);
    await expect(
      page.locator('nav[aria-label="Workspace"] a[aria-current="page"]'),
    ).toHaveText(ROUTE_LABEL[route]);
    numbered.push(
      ...(await page.locator("main .section-heading .eyebrow").allTextContents())
        .filter((t) => /^\d\d \/ /.test(t)),
    );
  }
  expect(numbered).toEqual([
    "01 / Overview",
    "02 / Performance",
    "03 / Benchmark",
    "04 / Risk",
    "05 / Rolling analytics",
    "06 / Stress Lab",
    "07 / Portfolio Constructor",
  ]);
  await openPage(page, "overview");
  const trigger = page
    .locator('nav[aria-label="Workspace"]')
    .getByRole("button", { name: "Methodology" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", {
    name: "How every number is produced.",
  });
  await expect(drawer).toBeVisible();
  for (const topic of ["Data", "Coverage", "Construction", "Numerics"])
    await expect(drawer.getByRole("heading", { name: topic })).toBeVisible();
  // Focus stays inside the modal; Escape closes it and returns focus.
  await page.keyboard.press("Tab");
  expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  // Required disclaimers.
  await expect(page.locator("footer")).toContainText(
    "For educational and analytical purposes only. Historical results do not guarantee future performance and should not be considered investment advice.",
  );
  await expect(page.locator("body")).not.toContainText(
    /Recommended Portfolio|Best Portfolio|Optimal for You/i,
  );
});

test("remove the failed holding from the error, then the analysis succeeds", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/analysis", (route) => {
    const tickers = route
      .request()
      .postDataJSON()
      .holdings.map((h: { ticker: string }) => h.ticker);
    requests++;
    return route.fulfill({
      json: tickers.includes("IWM")
        ? {
            ok: false,
            error: {
              code: "TICKER_NOT_FOUND",
              ticker: "IWM",
              message: "No history for IWM.",
              retryable: true,
            },
          }
        : { ok: true, value: longResult },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "IWM" });
  await expect(alert).toContainText("Ticker Not Found");
  await alert.getByRole("button", { name: "Edit IWM" }).click();
  await expect(page.getByLabel("Ticker 3", { exact: true })).toBeFocused();
  await alert.getByRole("button", { name: "Remove IWM" }).click();
  // Removing a 10% holding leaves 90%; restore the total before re-running.
  await page.getByLabel("Weight 1", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Analyze portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "Performance overview." }),
  ).toBeVisible();
  expect(requests).toBe(2);
});

for (const [name, width, height] of [
  ["phone", 390, 844],
  ["tablet", 768, 1024],
  ["laptop", 1320, 900],
  ["wide desktop", 1920, 1080],
] as const)
  test(`no page-wide horizontal scroll on ${name} (${width}px), drawer included`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await showLongResult(page);
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    expect(await fits()).toBe(true);
    // Benchmark tooltips stay inside the viewport at every width.
    await openPage(page, "benchmark");
    expect(await fits()).toBe(true);
    const tip = page
      .locator("section:has(#benchmark-title)")
      .getByRole("button", { name: "About Information ratio" });
    await tip.focus();
    const box = (await page
      .getByRole("tooltip")
      .filter({ visible: true })
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page
      .locator('nav[aria-label="Workspace"]')
      .getByRole("button", { name: "Methodology" })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // Measure the settled position, not the 200 ms slide-in.
    await drawer.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const d = (await drawer.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(width + 0.5);
    expect(await fits()).toBe(true);
  });

test("reduced motion disables drawer and skeleton animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  await page.getByRole("button", { name: "Open methodology" }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("tooltips remain hoverable, dismiss with Escape, and fit vertically near the viewport edge", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  const trigger = page.getByRole("button", { name: "About Sortino ratio" });
  await trigger.evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().bottom - window.innerHeight + 24));
  await trigger.hover();
  const tip = page.getByRole("tooltip").filter({ visible: true });
  const box = (await tip.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await tip.hover({ timeout: 2000 });
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveCount(0);
});

test("chart keyboard interaction has a visible focus indicator", async ({ page }) => {
  await showLongResult(page);
  await openPage(page, "performance");
  const chart = page.locator('section:has(#performance-title) .recharts-surface').first();
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  const style = await chart.evaluate((el) => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }));
  expect(style.style).not.toBe("none");
  expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
});

test("identical growth paths retain separate readable endpoint labels and mobile axes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/analysis", route => route.fulfill({ json: { ok: true, value: simulation } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await openPage(page, "performance");
  const chart = page.locator('section:has(#performance-title) .chart-frame');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".end-label")).toHaveCount(2);
  const boxes = await chart.locator(".end-label").evaluateAll(els => els.map(el => { const b = el.getBoundingClientRect(); return { y: b.y, bottom: b.bottom }; }));
  expect(boxes[0].bottom <= boxes[1].y || boxes[1].bottom <= boxes[0].y).toBe(true);
  // A three-session window still needs dates on its horizontal axis.
  expect(await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick').count()).toBeGreaterThan(1);
});

test("route navigation, method switches and builder edits never refetch analysis, stress or construction", async ({ page }) => {
  // API requests only: page navigations fetch route payloads, not market data.
  const counts = { analysis: 0, stress: 0, construction: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    for (const key of Object.keys(counts) as (keyof typeof counts)[])
      if (path === `/api/${key}`) counts[key]++;
  });
  const section = await showConstructionResult(page);
  await section.getByRole("button", { name: "Generate allocation" }).click();
  await expect(section.getByRole("heading", { name: "Minimum-Variance Allocation" })).toBeVisible();
  for (const method of ["Equal Weight", "Inverse Volatility", "Equal Risk Contribution", "Minimum Variance"])
    await section.getByRole("radio", { name: method, exact: true }).check();
  // Stress loads once on first visit; every later page change reuses what is in memory.
  await openPage(page, "stress");
  await expect(page.locator(".stress-select")).toBeVisible();
  for (const route of ["overview", "risk", "stress", "constructor"] as const) await openPage(page, route);
  await expect(section.getByRole("heading", { name: "Minimum-Variance Allocation" })).toBeVisible();
  await openBuilder(page);
  await page.getByLabel("Weight 1", { exact: true }).fill("49");
  await openPage(page, "constructor");
  await expect(section.getByRole("button", { name: /Apply proposed weights/ })).toBeDisabled();
  expect(counts).toEqual({ analysis: 1, stress: 1, construction: 1 });
});

test("keyboard-only sample, chart and methodology workflow keeps focus inside the dialog", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/analysis", route => route.fulfill({ json: { ok: true, value: longResult } }));
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to portfolio builder" })).toBeFocused();
  await page.keyboard.press("Enter");
  // Reach the submit button solely through the browser's focus order.
  let submitted = false;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("button", { name: "Analyze portfolio" }).evaluate(el => el === document.activeElement)) {
      await page.keyboard.press("Enter"); submitted = true; break;
    }
  }
  expect(submitted).toBe(true);
  await expect(page.getByRole("heading", { name: "Performance overview." })).toBeVisible();
  // After Analyze opens the overview, focus moves to its heading (not lost to <body>).
  await expect(page.getByRole("heading", { name: "Performance overview." })).toBeFocused();
  // Keyboard route navigation: the workspace links are reachable and switch pages.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await page.getByRole("link", { name: "Risk", exact: true }).evaluate(el => el === document.activeElement)) break;
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/analysis\/risk$/);
  await expect(page.getByRole("link", { name: "Risk", exact: true })).toHaveAttribute("aria-current", "page");
  // Tab backward through the document to the header trigger.
  let opened = false;
  for (let i = 0; i < 75; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await page.getByRole("button", { name: "Methodology", exact: true }).evaluate(el => el === document.activeElement)) {
      await page.keyboard.press("Enter"); opened = true; break;
    }
  }
  expect(opened).toBe(true);
  const drawer = page.getByRole("dialog");
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Methodology", exact: true })).toBeFocused();
});

for (const width of [390, 768, 1320, 1920])
  test(`release visual review at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const section = await showConstructionResult(page);
    await section.getByRole("button", { name: "Generate allocation" }).click();
    await expect(section.getByRole("heading", { name: "Minimum-Variance Allocation" })).toBeVisible();
    for (const route of Object.keys(ROUTE_LABEL) as (keyof typeof ROUTE_LABEL)[]) {
      await openPage(page, route);
      if (route === "stress") await expect(page.locator(".stress-select")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${route}-${width}.png`), fullPage: true });
    }
    await page.locator('nav[aria-label="Workspace"]').getByRole("button", { name: "Methodology" }).click();
    await page.getByRole("dialog").screenshot({ path: testInfo.outputPath(`drawer-${width}.png`) });
    expect(errors).toEqual([]);
  });

// Phase 8: visual polish. Interaction details that make the analytics explorable.
test("capital vs risk morphs between views and hover focus is shared across analytics", async ({
  page,
}) => {
  await showLongResult(page);
  await openPage(page, "risk");
  const section = page.locator("section:has(#risk-title)");
  const rows = section.locator(".cr-rows");
  await expect(rows).toHaveAttribute("data-view", "both");
  await section.getByRole("radio", { name: "Risk", exact: true }).check();
  await expect(rows).toHaveAttribute("data-view", "risk");
  await expect(section.locator(".cr-main").first()).toHaveCSS("opacity", "1");
  await section.getByRole("radio", { name: "Overlay", exact: true }).check();
  // Hovering a holding dims the others in the same view and lights the heatmap.
  const first = section.locator(".cr-row:not(.cr-axis)").first();
  await first.hover();
  await expect(first).toHaveAttribute("data-focus", "on");
  await expect(
    section.locator(".cr-row:not(.cr-axis)").nth(1),
  ).toHaveAttribute("data-focus", "dim");
  await page.mouse.move(2, 400);
  await expect(first).not.toHaveAttribute("data-focus", /.+/);
});

// Phase 9: a multi-page workspace on real routes.
const PAGE_HEADINGS = {
  overview: "Performance overview.",
  performance: "Growth of wealth.",
  benchmark: "Relative to SPY.",
  risk: "What drives portfolio risk.",
  rolling: "Risk through time.",
  stress: "Historical stress periods.",
  constructor: "Mathematical alternative allocations.",
} as const;

test("Analyze opens the overview; every route renders; back, forward and reload keep the page", async ({
  page,
}) => {
  let analyses = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/analysis") analyses++;
  });
  await showLongResult(page);
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  for (const route of Object.keys(PAGE_HEADINGS) as (keyof typeof PAGE_HEADINGS)[]) {
    await openPage(page, route);
    await expect(page.getByRole("heading", { name: PAGE_HEADINGS[route] })).toBeVisible();
    // The analyzed portfolio stays in view on every page.
    await expect(page.locator(".portfolio-bar")).toContainText("QQQ 80.00%");
  }
  expect(analyses).toBe(1); // navigation never re-runs the analysis
  await page.goBack();
  await expect(page).toHaveURL(/\/analysis\/stress$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/analysis\/rolling$/);
  await expect(page.getByRole("heading", { name: PAGE_HEADINGS.rolling })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: PAGE_HEADINGS.stress })).toBeVisible();
  // A hard refresh re-runs the tab's last analysis from its small saved config and
  // returns to the same page; nothing large is kept in browser storage.
  await openPage(page, "risk");
  await page.reload();
  await expect(page).toHaveURL(/\/analysis\/risk$/);
  await expect(page.getByRole("heading", { name: PAGE_HEADINGS.risk })).toBeVisible();
  expect(analyses).toBe(2);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).length);
  expect(stored).toBeLessThan(4000);
});

test("a deep link without an active analysis guides to the builder or runs the sample in place", async ({
  page,
}) => {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({ json: { ok: true, value: longResult } }),
  );
  await page.goto("/analysis/risk");
  await expect(page.getByText("No active analysis")).toBeVisible();
  await expect(page.locator(".portfolio-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Analyze sample portfolio here" }).click();
  await expect(page.getByRole("heading", { name: PAGE_HEADINGS.risk })).toBeVisible();
  await expect(page).toHaveURL(/\/analysis\/risk$/);
  // A fresh tab has no saved analysis: the builder is offered, not an error.
  const fresh = await page.context().newPage();
  await fresh.goto("/analysis/stress");
  await expect(fresh.getByText("No active analysis")).toBeVisible();
  await fresh.getByRole("link", { name: /Build or analyze a portfolio/ }).click();
  await expect(fresh.getByLabel("Ticker 1", { exact: true })).toBeVisible();
  await fresh.goto("/analysis");
  await expect(fresh).toHaveURL(/\/analysis\/overview$/);
});

test("a Stress Lab failure stays on its page; other routes keep working", async ({ page }) => {
  await page.route("**/api/stress", (route) =>
    route.fulfill({ status: 500, body: "Internal Server Error" }),
  );
  await showLongResult(page);
  await openPage(page, "stress");
  await expect(
    page.locator("section:has(#stress-title)").getByRole("alert"),
  ).toContainText("Stress Lab unavailable");
  await openPage(page, "risk");
  await expect(page.getByRole("heading", { name: PAGE_HEADINGS.risk })).toBeVisible();
  await expect(page.locator('dl[aria-label="Risk overview"]')).toBeVisible();
  await openPage(page, "overview");
  await expect(page.locator('dl[aria-label="Performance overview"]')).toBeVisible();
});

test.describe("mobile routes", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("the workspace tab bar scrolls locally and every route fits the phone", async ({ page }) => {
    await showLongResult(page);
    const nav = page.locator('nav[aria-label="Workspace"]');
    for (const route of Object.keys(ROUTE_LABEL) as (keyof typeof ROUTE_LABEL)[]) {
      await nav.getByRole("link", { name: ROUTE_LABEL[route], exact: true }).tap();
      await expect(page).toHaveURL(new RegExp(`/analysis/${route}$`));
      await expect(nav.locator('a[aria-current="page"]')).toHaveText(ROUTE_LABEL[route]);
      await expect(page.getByRole("heading", { name: PAGE_HEADINGS[route] })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    // The nav scrolls within itself, never the page.
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

test("reduced motion removes page transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showLongResult(page);
  await openPage(page, "risk");
  expect(
    await page.locator(".page").evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("builder shows an allocation strip and a resolved or unresolved total", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".alloc-strip")).toHaveAttribute(
    "data-state",
    "ok",
  );
  await expect(page.locator(".alloc-state")).toContainText("Fully allocated");
  await page.getByLabel("Weight 1", { exact: true }).fill("30");
  await expect(page.locator(".alloc-strip")).toHaveAttribute(
    "data-state",
    "open",
  );
  await expect(page.locator(".alloc-state")).toContainText("unallocated");
  await page.getByLabel("Weight 1", { exact: true }).fill("55");
  await expect(page.locator(".alloc-state")).toContainText("over");
});

test("reduced motion removes decorative animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page
      .locator(".candle")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".alloc-seg")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
});

// Release audit: touch devices and the negative-contribution display.
test.describe("touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("tap drives chart tooltips, definitions and holding focus", async ({
    page,
  }) => {
    await showLongResult(page);
    // Chart tooltip on tap.
    const growth = page
      .locator("figure")
      .filter({ has: page.getByRole("heading", { name: "Growth of $10,000" }) });
    await growth.locator(".chart-frame").scrollIntoViewIfNeeded();
    const box = (await growth.locator(".chart-frame").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(growth.locator(".chart-tooltip")).toBeVisible();
    // Definition tip opens on tap with a 24 px target and closes on an outside tap.
    const trigger = page
      .locator('dl[aria-label="Performance overview"]')
      .getByRole("button", { name: "About Sortino ratio" });
    const t = (await trigger.boundingBox())!;
    await trigger.tap();
    const tip = page.getByRole("tooltip").filter({ visible: true });
    await expect(tip).toContainText("Downside deviation");
    const hit = await trigger.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left - 3, r.top + r.height / 2);
      return el.contains(at);
    });
    expect(hit).toBe(true);
    expect(t.width).toBeGreaterThan(0);
    // Close by tapping plain content (not a holding, which would pin its focus).
    await page.getByRole("heading", { name: "Performance overview." }).tap();
    await expect(tip).toHaveCount(0);
    // Capital vs Risk: tap pins a holding, a second tap releases it.
    await openPage(page, "risk");
    const risk = page.locator("section:has(#risk-title)");
    const row = risk.locator(".cr-row:not(.cr-axis)").first();
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await expect(row).toHaveAttribute("data-focus", "on");
    await expect(risk.locator(".cr-row:not(.cr-axis)").nth(1)).toHaveAttribute(
      "data-focus",
      "dim",
    );
    await row.tap();
    await expect(row).not.toHaveAttribute("data-focus", /.+/);
    // A pinned holding is released by a tap on unrelated content.
    await row.tap();
    await expect(row).toHaveAttribute("data-focus", "on");
    await risk.getByRole("heading", { name: "What drives portfolio risk." }).tap();
    await expect(row).not.toHaveAttribute("data-focus", /.+/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test("negative risk contribution renders hatched, left of zero, with a hedge label", async ({
    page,
  }, testInfo) => {
    await page.route("**/api/analysis", (route) =>
      route.fulfill({ json: { ok: true, value: hedgeResult() } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze Sample Portfolio" }).tap();
    await expect(page).toHaveURL(/\/analysis\/overview$/);
    await openPage(page, "risk");
    const risk = page.locator("section:has(#risk-title)");
    const row = risk.locator(".cr-row", { hasText: "HEDGE" });
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".cr-tag-hedge")).toHaveText("hedge");
    const bar = row.locator(".cr-risk");
    const zero = row.locator(".cr-zero");
    const [b, z] = [(await bar.boundingBox())!, (await zero.boundingBox())!];
    expect(Math.abs(b.x + b.width - z.x)).toBeLessThanOrEqual(1.5);
    expect(b.width).toBeGreaterThan(2);
    expect(
      await bar.evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("repeating-linear-gradient");
    await expect(row.locator(".cr-v-risk")).toHaveText(/^-\d+\.\d{2}%$/);
    await risk.getByRole("radio", { name: "Risk", exact: true }).check();
    const main = row.locator(".cr-main");
    await expect(main).toHaveCSS("opacity", "1");
    expect(
      await main.evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("repeating-linear-gradient");
    await risk
      .locator("figure.capital-risk")
      .screenshot({ path: testInfo.outputPath("negative-contribution.png") });
  });
});

test.describe("touch heatmap and pair cards", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("tap a correlation cell or pair card; tap again or elsewhere to clear", async ({
    page,
  }) => {
    await page.route("**/api/analysis", (route) =>
      route.fulfill({ json: { ok: true, value: hedgeResult() } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze Sample Portfolio" }).tap();
    await expect(page).toHaveURL(/\/analysis\/overview$/);
    await openPage(page, "risk");
    const div = page.locator("section:has(#diversification-title)");
    const cell = div.locator(".heatmap tbody tr").first().locator("td").nth(1);
    await cell.scrollIntoViewIfNeeded();
    await cell.tap();
    await expect(div.locator(".heat-tip")).toBeVisible();
    await expect(div.locator(".heatmap-readout")).toContainText(
      /^AAA \/ HEDGE: -?\d\.\d{4}$/,
    );
    await expect(div.locator(".heatmap th[data-on]")).toHaveCount(2);
    // The same pair lights up in Capital vs Risk.
    await expect(
      page.locator(".cr-row", { hasText: "HEDGE" }),
    ).toHaveAttribute("data-focus", "on");
    await cell.tap();
    await expect(div.locator(".heat-tip")).toHaveCount(0);
    const card = div.getByRole("button", { name: /Most correlated pair/ });
    await card.tap();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(div.locator(".heatmap th[data-on]")).toHaveCount(2);
    await div.getByRole("heading", { name: "Concentration and correlation." }).tap();
    await expect(card).toHaveAttribute("aria-pressed", "false");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  });
});

test("hard failures of quotes, Treasury, Stress Lab and the constructor stay isolated", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Harsher than the default JSON errors: dropped connections and non-JSON 500s.
  await page.route("**/api/quotes", (route) => route.abort("connectionreset"));
  await page.route("**/api/treasury/current", (route) =>
    route.fulfill({ status: 502, body: "<html>Bad gateway</html>" }),
  );
  await page.route("**/api/stress", (route) =>
    route.fulfill({ status: 500, body: "Internal Server Error" }),
  );
  await page.route("**/api/construction", (route) => route.abort("failed"));
  const section = await showConstructionResult(page);
  await section.getByRole("button", { name: "Generate allocation" }).click();
  await expect(section.getByRole("alert")).toContainText("Construction failed");
  await expect(section.getByRole("button", { name: "Retry" })).toBeEnabled();
  // Each failure stays on its own page; every other page still renders.
  await openPage(page, "stress");
  const stress = page.locator("section:has(#stress-title)");
  await expect(stress.getByRole("alert")).toContainText("Stress Lab unavailable");
  await expect(
    stress.getByRole("button", { name: "Retry stress tests" }),
  ).toBeVisible();
  await openPage(page, "overview");
  const market = page.locator("section:has(#context-title)");
  await expect(market).toContainText("Current quotes unavailable");
  await expect(market).toContainText("Treasury");
  await expect(page.locator('dl[aria-label="Performance overview"]')).toBeVisible();
  await openPage(page, "risk");
  for (const label of ["Risk overview", "Diversification overview"])
    await expect(page.locator(`dl[aria-label="${label}"]`)).toBeVisible();
  await openPage(page, "performance");
  await expect(
    page.locator("section:has(#performance-title) .recharts-line-curve").first(),
  ).toBeVisible();
  await openPage(page, "rolling");
  await expect(page.locator("section:has(#rolling-title) figure")).toBeVisible();
  // Returning to the Constructor shows its failure again, not a blank page.
  await openPage(page, "constructor");
  await expect(section.getByRole("alert")).toContainText("Construction failed");
  // The methodology drawer's own text mentions "NaN"; check rendered analytics only.
  for (const part of await page.locator("section.results :is(dl, table, figure)").all())
    await expect(part).not.toContainText(/NaN|Infinity/);
  expect(errors).toEqual([]);
});

test("the wake stage appears only when the market-data service is slow to answer", async ({ page }) => {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({ json: { ok: true, value: longResult } }),
  );
  let slow = true;
  await page.route("**/api/market-data/status", async (route) => {
    if (slow) await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ json: { mode: "service", ready: true, latencyMs: slow ? 2500 : 5 } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await expect(page.getByText("Waking market-data service…")).toBeVisible();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  slow = false;
  await openBuilder(page);
  let sawWake = false;
  const watcher = page.waitForSelector("text=Waking market-data service…", { timeout: 2000 })
    .then(() => (sawWake = true), () => {});
  await page.getByRole("button", { name: "Analyze portfolio" }).click();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await watcher;
  expect(sawWake).toBe(false); // a prompt answer never shows the wake step
});

test("service outage: the sample offers a clearly labelled cached copy; custom portfolios do not", async ({ page }) => {
  const outage = {
    ok: false,
    error: { code: "PROVIDER_ERROR", message: "The market-data service could not be reached.", retryable: true },
  };
  await page.route("**/api/analysis", (route) => route.fulfill({ json: outage }));
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  const offer = page.getByRole("button", { name: "View cached sample" });
  await expect(offer).toBeVisible();
  // Nothing switches silently: the builder stays until the visitor chooses.
  await expect(page).toHaveURL(/\/$/);
  await offer.click();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await expect(page.locator(".portfolio-bar")).toContainText(/Cached sample · Last refreshed/);
  await expect(page.getByRole("heading", { name: "Performance overview." })).toBeVisible();
  // Stress Lab events come with the cached copy; the Constructor explains why it is off.
  await openPage(page, "stress");
  await expect(page.locator(".stress-select")).toBeVisible();
  await openPage(page, "constructor");
  await expect(page.getByText("Constructor needs live market data")).toBeVisible();
  // A custom portfolio that fails the same way is never offered the sample.
  await openBuilder(page);
  await page.getByLabel("Ticker 1", { exact: true }).fill("VT");
  await page.getByRole("button", { name: "Analyze portfolio" }).click();
  await expect(page.locator(".status-notice").filter({ hasText: "could not be reached" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View cached sample" })).toHaveCount(0);
});

test("the landing page wakes the service without blocking; a long wake offers the sample's cached copy only", async ({ page }) => {
  await page.clock.install();
  let wakes = 0;
  // A cold free-tier service: readiness never answers during this test.
  await page.route("**/api/market-data/status", () => {
    wakes++;
  });
  await page.goto("/");
  await expect(page.getByLabel("Ticker 1", { exact: true })).toBeVisible(); // render not blocked
  await expect.poll(() => wakes).toBe(1); // nonblocking wake on load
  await page.getByRole("button", { name: "Analyze Sample Portfolio" }).click();
  await page.clock.fastForward(1_300);
  await expect(page.getByText("Waking market-data service…")).toBeVisible();
  expect(wakes).toBe(1); // Analyze reuses the wake already in flight
  await expect(page.getByRole("button", { name: "View cached sample" })).toHaveCount(0);
  await page.clock.fastForward(20_000);
  const offer = page.getByRole("button", { name: "View cached sample" });
  await expect(offer).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // never substituted automatically
  await offer.click();
  await expect(page).toHaveURL(/\/analysis\/overview$/);
  await expect(page.locator(".portfolio-bar")).toContainText(/Cached sample · Last refreshed/);
  // A custom portfolio waking just as long is never offered the sample.
  await openBuilder(page);
  await page.getByLabel("Ticker 1", { exact: true }).fill("VT");
  await page.getByRole("button", { name: "Analyze portfolio" }).click();
  await page.clock.fastForward(25_000);
  await expect(page.getByText("Waking market-data service…")).toBeVisible();
  await expect(page.getByRole("button", { name: "View cached sample" })).toHaveCount(0);
});
