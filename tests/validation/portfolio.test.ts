import { describe, expect, it } from "vitest";
import { parsePortfolio } from "@/lib/validation/portfolio";
import {
  validDate,
  calendarDays,
  addDays,
  marketDate,
  yearsBefore,
} from "@/lib/utils/dates";
const base = {
  holdings: [
    { ticker: " spy ", weight: 0.6 },
    { ticker: "CASH", weight: 0.4 },
  ],
  benchmark: "spy",
  requestedStartDate: "2020-01-01",
  endDate: "2024-01-01",
  rebalanceFrequency: "monthly",
  cashPolicy: "historical_proxy",
};
describe("portfolio validation", () => {
  it("normalizes symbols and accepted budget residuals explicitly", () => {
    const p = parsePortfolio(
      { ...base, holdings: [{ ticker: " spy ", weight: 1.0000005 }] },
      "2024-01-02",
    );
    expect(p.holdings).toEqual([{ ticker: "SPY", weight: 1 }]);
    expect(p.benchmark).toBe("SPY");
  });
  it.each([
    [],
    Array.from({ length: 21 }, (_, i) => ({ ticker: `A${i}`, weight: 1 / 21 })),
    [
      { ticker: "SPY", weight: -1 },
      { ticker: "QQQ", weight: 2 },
    ],
    [{ ticker: "SPY", weight: NaN }],
    [{ ticker: "SPY", weight: Infinity }],
    [{ ticker: "SPY", weight: 0.99 }],
    [{ ticker: "SPY", weight: 1.01 }],
    [
      { ticker: "spy", weight: 0.5 },
      { ticker: " SPY ", weight: 0.5 },
    ],
    [{ ticker: "../../x", weight: 1 }],
    [{ ticker: "VOD.L", weight: 1 }],
  ])("rejects malformed holdings %#", (holdings) =>
    expect(() => parsePortfolio({ ...base, holdings }, "2024-01-02")).toThrow(),
  );
  it("keeps zero weight entries without permitting an empty active budget", () =>
    expect(
      parsePortfolio(
        {
          ...base,
          holdings: [
            { ticker: "SPY", weight: 1 },
            { ticker: "QQQ", weight: 0 },
          ],
        },
        "2024-01-02",
      ).holdings,
    ).toHaveLength(2));
  it.each([
    { requestedStartDate: "2023-02-29" },
    { endDate: "2024-01-03" },
    { requestedStartDate: "2024-01-01" },
    { requestedStartDate: "1970-01-01" },
    { benchmark: "CASH" },
    { rebalanceFrequency: "daily" },
  ])("rejects invalid bounds or unsupported policy %j", (change) =>
    expect(() =>
      parsePortfolio({ ...base, ...change }, "2024-01-02"),
    ).toThrow(),
  );
});
describe("date-only arithmetic", () => {
  it("rejects rolled dates and timestamps", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2023-02-29")).toBe(false);
    expect(validDate("2024-01-01T00:00Z")).toBe(false);
  });
  it("counts calendar days across DST and leap day", () => {
    expect(calendarDays("2024-03-08", "2024-03-11")).toBe(3);
    expect(calendarDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("uses New York market dates and clamps leap-year presets", () => {
    expect(marketDate("2024-01-02T01:00:00Z")).toBe("2024-01-01");
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-02-28");
  });
});
