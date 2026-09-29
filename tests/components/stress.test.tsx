// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StressLab } from "@/components/stress/StressLab";
import { runStress } from "@/lib/backtest/stress";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { StressAnalytics } from "@/lib/types/analytics";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { sessionTicks } from "@/lib/charts/series";
import { axisDay } from "@/lib/utils/format";
import { series } from "../fixtures/helpers";

const FAR = "2100-01-01T00:00:00Z";
const calendar = sessionsBetween("2020-02-03", "2020-04-09", FAR);
const ds = calendar.map((s) => s.date);
const path = (daily: number) => ds.map((_, i) => 100 * (1 + daily) ** i);
const late = ds.indexOf("2020-03-02");
const config: PortfolioConfig = {
  holdings: [
    { ticker: "AAA", weight: 0.6 },
    { ticker: "BBB", weight: 0.4 },
  ],
  benchmark: "BMK",
  requestedStartDate: "2019-06-03",
  endDate: "2020-05-29",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
const window = (
  id: string,
  name: string,
  startDate: string,
  endDate: string,
) => ({
  id,
  name,
  startDate,
  endDate,
  description: `${name} fixture window.`,
  kind: id === "custom" ? ("custom" as const) : ("preset" as const),
});
function analytics(windows: ReturnType<typeof window>[]): StressAnalytics {
  return runStress({
    config,
    windows,
    prices: [
      series("AAA", ds, path(-0.01)),
      series("BBB", ds.slice(late), path(0.002).slice(late), "2020-03-02"),
      series("BMK", ds, path(-0.015)),
    ],
    treasury: null,
    sessions: calendar,
    unavailable: [],
    now: "2020-06-01T12:00:00Z",
  });
}
const presets = analytics([
  window("gfc", "Global Financial Crisis", "2020-02-19", "2020-03-23"),
  window("covid", "COVID Crash", "2020-03-02", "2020-03-23"),
  window(
    "rate-shock-2022",
    "2022 Inflation / Rate Shock",
    "2020-03-21",
    "2020-03-22",
  ),
]);
const custom = analytics([
  window("custom", "Custom Historical Window", "2020-03-05", "2020-04-03"),
]);
function stubFetch(...bodies: unknown[]) {
  const calls: unknown[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    if (body instanceof Error) throw body;
    return { json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const today = "2020-06-01";

describe("short-window axis helpers", () => {
  it("spaces ticks by sessions and labels days without a trailing comma", () => {
    const dates = ds.slice(
      ds.indexOf("2020-02-19"),
      ds.indexOf("2020-03-23") + 1,
    );
    expect(dates).toHaveLength(24);
    expect(sessionTicks(dates, 6)).toEqual([
      "2020-02-19",
      "2020-02-25",
      "2020-03-02",
      "2020-03-06",
      "2020-03-12",
      "2020-03-18",
    ]);
    expect(axisDay("2020-03-02")).toBe("Mar 2");
  });
});

describe("StressLab", () => {
  it("requests the fixed windows for the displayed portfolio and compares every event", async () => {
    const calls = stubFetch({ ok: true, value: presets });
    render(<StressLab config={config} today={today} />);
    expect(screen.getByRole("status").textContent).toMatch(
      /event-window history/,
    );
    const table = await screen.findByRole("table", {
      name: /Historical stress events/,
    });
    expect(calls).toEqual([{ config }]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toMatch(
      /Global Financial Crisis.*Incomplete Historical Coverage.*BBB/,
    );
    expect(rows[2].textContent).toMatch(/COVID Crash/);
    expect(rows[3].textContent).toMatch(/fewer than two completed sessions/);
  });

  it("explains incomplete coverage with the missing holdings and no shortened result", async () => {
    stubFetch({ ok: true, value: presets });
    render(<StressLab config={config} today={today} />);
    await screen.findByRole("table", { name: /Historical stress events/ });
    fireEvent.click(screen.getByRole("radio", { name: /GFC/ }));
    expect(
      screen.getByRole("heading", { name: "Incomplete Historical Coverage" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This stress result cannot be calculated accurately because one or more holdings lack sufficient historical data during the selected period.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/BBB/, { selector: "li strong" })).toBeTruthy();
  });

  it("shows event metrics, the event path and standalone holding returns", async () => {
    stubFetch({ ok: true, value: presets });
    render(<StressLab config={config} today={today} />);
    await screen.findByRole("table", { name: /Historical stress events/ });
    fireEvent.click(screen.getByRole("radio", { name: /COVID/ }));
    const e = presets.events[1];
    if (e.status !== "complete") throw new Error("fixture");
    const strip = screen.getByLabelText("COVID Crash event metrics");
    expect(within(strip).getByText("Active return")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /Growth of \$10,000 through the event/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /each holding's own compounded return, not its contribution/,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("best").length).toBeGreaterThan(0);
  });

  it("offers a retry when the stress request fails, without touching the analysis", async () => {
    const calls = stubFetch(new Error("network"), { ok: true, value: presets });
    render(<StressLab config={config} today={today} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /historical analysis above is unaffected/,
    );
    fireEvent.click(
      within(alert).getByRole("button", { name: "Retry stress tests" }),
    );
    await screen.findByRole("table", { name: /Historical stress events/ });
    expect(calls).toHaveLength(2);
  });

  it("runs a validated Custom Historical Window, never labeled a hypothetical stress test", async () => {
    const calls = stubFetch(
      { ok: true, value: presets },
      { ok: true, value: custom },
    );
    render(<StressLab config={config} today={today} />);
    await screen.findByRole("table", { name: /Historical stress events/ });
    fireEvent.click(screen.getByRole("radio", { name: "Custom window" }));
    expect(
      screen.getByRole("heading", { name: "Custom Historical Window" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Window start"), {
      target: { value: "2020-04-03" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
      target: { value: "2020-03-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run custom window" }));
    expect(screen.getByText(/start must precede its end/)).toBeTruthy();
    expect(calls).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Window start"), {
      target: { value: "2020-03-05" },
    });
    fireEvent.change(screen.getByLabelText("Window end"), {
      target: { value: "2020-04-03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run custom window" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      config,
      window: { startDate: "2020-03-05", endDate: "2020-04-03" },
    });
    await screen.findByLabelText("Custom Historical Window event metrics");
    expect(screen.queryByText(/hypothetical stress test/i)).toBeNull();
  });
});
