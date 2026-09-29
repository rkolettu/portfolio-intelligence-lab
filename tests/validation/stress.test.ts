import { expect, it } from "vitest";
import { customStressWindow } from "@/lib/validation/stress";

const today = "2026-09-29";

it("builds a labeled Custom Historical Window from valid dates", () => {
  expect(customStressWindow("2018-10-01", "2018-12-24", today)).toEqual({
    id: "custom",
    name: "Custom Historical Window",
    startDate: "2018-10-01",
    endDate: "2018-12-24",
    description:
      "User-selected historical window under the same event rules as the fixed windows; not a hypothetical scenario.",
    kind: "custom",
  });
});

it.each([
  ["2018-13-01", "2018-12-24", /valid YYYY-MM-DD/],
  ["2018-12-24", "2018-12-24", /start must precede/i],
  ["2018-12-24", "2018-10-01", /start must precede/i],
  ["2026-09-01", "2026-10-01", /future/i],
  ["2008-01-01", "2018-01-02", /10 years/],
])("rejects %s → %s", (start, end, message) => {
  expect(() => customStressWindow(start, end, today)).toThrow(message);
});

it("accepts exactly ten years", () => {
  expect(customStressWindow("2008-01-02", "2018-01-02", today).startDate).toBe(
    "2008-01-02",
  );
});
