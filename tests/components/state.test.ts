import { expect, it } from "vitest";
import {
  toDraft,
  draftConfig,
  portfolioReducer,
} from "@/lib/state/portfolioReducer";
import { persistDraft, restoreDraft } from "@/lib/state/persistence";
import { samplePortfolio } from "@/config/samplePortfolio";
const today = "2024-06-04";
it("restores sample percentages without changing finance units", () => {
  const sample = samplePortfolio(today);
  const draft = toDraft(sample);
  expect(draft.holdings[0].weight).toBe("40");
  expect(draftConfig(draft, today)).toEqual(sample);
});
it("supports immutable edit, add, remove, and period updates", () => {
  const original = toDraft(samplePortfolio(today));
  const edited = portfolioReducer(original, {
    type: "holding",
    index: 0,
    field: "ticker",
    value: "qqq",
  });
  expect(edited.holdings[0].ticker).toBe("QQQ");
  expect(original.holdings[0].ticker).toBe("SPY");
  expect(portfolioReducer(original, { type: "add" }).holdings).toHaveLength(7);
  expect(
    portfolioReducer(original, { type: "remove", index: 0 }).holdings,
  ).toHaveLength(5);
  expect(
    portfolioReducer(original, { type: "period", period: "1Y" })
      .requestedStartDate,
  ).toBe("2023-06-04");
});
it("recovers safely from corrupt/unsupported/denied localStorage", () => {
  const fallback = toDraft(samplePortfolio(today));
  for (const raw of ["bad", '{"version":9}', '{"version":1,"draft":{}}'])
    expect(restoreDraft({ getItem: () => raw }, fallback, today)).toEqual({
      draft: fallback,
      notice: expect.any(String),
    });
  expect(
    restoreDraft(
      {
        getItem: () => {
          throw new Error("denied");
        },
      },
      fallback,
      today,
    ).draft,
  ).toEqual(fallback);
  expect(
    persistDraft(
      {
        setItem: () => {
          throw new Error("denied");
        },
      },
      fallback,
    ),
  ).toBe(false);
});
it("round trips versioned preferences with validation", () => {
  const d = toDraft(samplePortfolio(today));
  let value = "";
  expect(
    persistDraft(
      {
        setItem: (_k, v) => {
          value = v;
        },
      },
      d,
    ),
  ).toBe(true);
  expect(restoreDraft({ getItem: () => value }, d, today)).toEqual({
    draft: d,
    notice: null,
  });
});
it("does not turn empty or invalid display weights into zero", () => {
  const d = toDraft(samplePortfolio(today));
  d.holdings[0].weight = "";
  expect(() => draftConfig(d, today)).toThrow();
});
