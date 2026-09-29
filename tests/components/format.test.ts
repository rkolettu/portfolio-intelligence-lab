import { expect, it } from "vitest";
import {
  axisPercent,
  decimal,
  fixed,
  money,
  percent,
  percentagePoints,
  ratio,
  unsignedPercent,
  wholeMoney,
  yieldPercent,
} from "@/lib/utils/format";

// Values that round to zero must never print a minus sign ("-0.00%", "-0%").
const tiny = [-0, -1e-9, -0.000001, -0.00004];

it("never renders a signed zero in any display formatter", () => {
  for (const v of tiny) {
    expect(percent(v)).toBe("0.00%");
    expect(unsignedPercent(v)).toBe("0.00%");
    expect(ratio(v)).toBe("0.00");
    expect(decimal(v)).toBe("0.00");
    expect(axisPercent(v)).toBe("0%");
    expect(money(v)).toBe("$0.00");
    expect(wholeMoney(v)).toBe("$0");
    expect(percentagePoints(v)).toBe("0.00 pp");
    expect(fixed(v, 1)).toBe("0.0");
    expect(fixed(v, 4)).toBe("0.0000");
    expect(yieldPercent(v)).toBe("0.00%");
  }
});

it("keeps real signs and the established precision", () => {
  expect(percent(0.1234)).toBe("+12.34%");
  expect(percent(-0.1234)).toBe("-12.34%");
  expect(unsignedPercent(0.1289)).toBe("12.89%");
  expect(unsignedPercent(-0.02)).toBe("-2.00%");
  expect(ratio(0.571)).toBe("+0.57");
  expect(decimal(-0.1349)).toBe("-0.13");
  expect(percentagePoints(-0.0046)).toBe("-0.46 pp");
  expect(percentagePoints(0.2797)).toBe("+27.97 pp");
  expect(fixed(-0.26, 1)).toBe("-0.3");
  expect(yieldPercent(0.04123)).toBe("4.12%");
  expect(yieldPercent(-0.0021)).toBe("-0.21%");
  expect(money(16781.494)).toBe("$16,781.49");
});

it("keeps fractional percentage axis ticks distinct", () => {
  expect([0, -0.002, -0.004, -0.006].map(axisPercent)).toEqual(["0%", "-0.2%", "-0.4%", "-0.6%"]);
});
