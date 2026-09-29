// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RollingSection } from "@/components/rolling/RollingSection";
import {
  rollingDisplayData,
  rollingDomain,
  rollingGaps,
} from "@/lib/charts/rolling";
import { simulate } from "@/lib/backtest/engine";
import { sessionsBetween } from "@/lib/backtest/calendar";
import type { BacktestResult } from "@/lib/types/analytics";
import { series } from "../fixtures/helpers";

afterEach(cleanup);

describe("rolling display helpers", () => {
  const dates = Array.from(
    { length: 12 },
    (_, i) => `2024-01-${String(i + 2).padStart(2, "0")}`,
  );

  it("keeps a visible break for every null run and never bridges it", () => {
    const values = [
      null,
      null,
      null,
      0.1,
      0.2,
      0.3,
      null,
      null,
      null,
      0.4,
      0.5,
      0.6,
    ];
    const rows = rollingDisplayData(dates, values, 6);
    // Each null run survives as at least one null row between its neighbours.
    const kept = rows.map((r) => r.value);
    const firstValue = kept.findIndex((v) => v !== null);
    expect(kept.slice(0, firstValue).every((v) => v === null)).toBe(true);
    expect(firstValue).toBeGreaterThan(0);
    const gapAt = rows.findIndex((r) => r.date === dates[6]);
    expect(rows[gapAt].value).toBeNull();
    expect(rows.at(-1)).toEqual({ date: dates[11], value: 0.6 });
  });

  it("keeps each value run's extremes when downsampling", () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `d${String(i).padStart(3, "0")}`,
    );
    const values = long.map((_, i) =>
      i === 137 ? 9 : i === 301 ? -9 : Math.sin(i / 7),
    );
    const rows = rollingDisplayData(long, values, 80);
    expect(rows.length).toBeLessThanOrEqual(90);
    expect(rows.some((r) => r.value === 9)).toBe(true);
    expect(rows.some((r) => r.value === -9)).toBe(true);
  });

  it("counts leading and interior gaps", () => {
    expect(rollingGaps([null, null, 1, null, 2, null])).toEqual({
      leading: 2,
      interior: 2,
    });
    expect(rollingGaps([null, null])).toEqual({ leading: 2, interior: 0 });
  });

  it("uses a fixed [-1, 1] correlation axis and zero-anchored volatility", () => {
    expect(rollingDomain("correlation", [0.4, 0.9], 0.8)).toEqual({
      domain: [-1, 1],
      ticks: [-1, -0.5, 0, 0.5, 1],
    });
    const vol = rollingDomain("volatility", [0.08, 0.31], 0.12);
    expect(vol.domain[0]).toBe(0);
    expect(vol.domain[1]).toBeGreaterThanOrEqual(0.31);
    const beta = rollingDomain("beta", [0.6, 1.3], 0.9);
    expect(beta.domain[0]).toBeLessThanOrEqual(0);
    expect(beta.domain[1]).toBeGreaterThanOrEqual(1.3);
  });
});

const FAR = "2100-01-01T00:00:00Z";
const calendar = sessionsBetween("2023-01-03", "2023-08-08", FAR);
const days = calendar.map((s) => s.date);
const wave = (seed: number) =>
  days.map((_, i) => 100 * Math.exp(0.01 * Math.sin(i * seed) + 0.0004 * i));
function result(withBenchmark = true): BacktestResult {
  return simulate({
    config: {
      holdings: [
        { ticker: "AAA", weight: 0.6 },
        { ticker: "BBB", weight: 0.4 },
      ],
      benchmark: "BMK",
      requestedStartDate: days[0],
      endDate: days.at(-1)!,
      rebalanceFrequency: "monthly",
      cashPolicy: "historical_proxy",
    },
    prices: [
      series("AAA", days, wave(0.7)),
      series("BBB", days, wave(1.9)),
      ...(withBenchmark ? [series("BMK", days, wave(1.1))] : []),
    ],
    treasury: null,
    sessions: calendar,
    now: "2023-09-01T12:00:00Z",
  });
}
const view = (r: BacktestResult) => (
  <RollingSection
    rolling={r.rollingAnalytics}
    performance={r.performance}
    benchmark={r.benchmarkAnalytics}
  />
);

describe("RollingSection", () => {
  it("defaults to 60-session rolling volatility and states when values begin", () => {
    render(view(result()));
    expect(
      screen.getByRole("heading", { name: "60-session rolling volatility" }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "60D" })).toHaveProperty(
      "checked",
      true,
    );
    expect(
      screen.getByText(
        /No value before .*: the first 60 consecutive session returns end there\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Data table · month-end values/)).toBeTruthy();
  });

  it("switches metric and window in one control row", () => {
    render(view(result()));
    fireEvent.click(screen.getByRole("radio", { name: "Beta vs BMK" }));
    fireEvent.click(screen.getByRole("radio", { name: "20D" }));
    expect(
      screen.getByRole("heading", { name: "20-session rolling beta vs BMK" }),
    ).toBeTruthy();
    expect(screen.getByText(/Full period/)).toBeTruthy();
  });

  it("disables benchmark statistics with the reason when the benchmark is unavailable", () => {
    render(view(result(false)));
    const beta = screen.getByRole("radio", { name: "Beta vs BMK" });
    expect(beta).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        /Benchmark Data Unavailable for rolling beta and correlation: Benchmark history is unavailable/,
      ),
    ).toBeTruthy();
  });
});
