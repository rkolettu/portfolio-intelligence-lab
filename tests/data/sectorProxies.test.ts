import { expect, it } from "vitest";
import { exactWindowReturn } from "@/lib/server/sectorProxies";
import { series } from "../fixtures/helpers";

it("uses exactly the effective analysis endpoints for a sector proxy return", () => {
  const prices = series(
    "XLK",
    ["2024-01-02", "2024-01-03", "2024-01-04"],
    [100, 500, 110],
  );
  expect(exactWindowReturn(prices, "2024-01-02", "2024-01-04")).toBeCloseTo(
    0.1,
  );
  expect(exactWindowReturn(prices, "2024-01-01", "2024-01-04")).toBeNull();
});
