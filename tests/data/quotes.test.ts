import { expect, it } from "vitest";
import { normalizeQuote, preferRecentQuote } from "@/lib/market-data/quotes";
const raw = {
  ticker: "SPY",
  price: 99,
  previousClose: 100,
  marketTimestamp: "2024-05-31T19:59:00Z",
  fetchedAt: "2024-05-31T20:00:00Z",
  provider: "fixture",
  session: "regular" as const,
};
it("does not infer live latency from a fresh fetch; keeps price-only changes", () => {
  const q = normalizeQuote({ ...raw, claimedStatus: "live" }, raw.fetchedAt);
  expect(q.status).toBe("latest_available");
  expect(q.observationAgeSeconds).toBe(60);
  expect(q.changePercent).toBeCloseTo(-0.01, 12);
});
it("rejects contradictory delay claims and downgrades old live quotes", () => {
  expect(
    normalizeQuote(
      { ...raw, claimedStatus: "live", liveQualified: true, delaySeconds: 900 },
      raw.fetchedAt,
    ).status,
  ).toBe("delayed");
  expect(
    normalizeQuote(
      { ...raw, claimedStatus: "live", liveQualified: true, delaySeconds: 0 },
      "2024-06-03T20:00:00Z",
    ).status,
  ).toBe("latest_available");
});
it("never replaces a newer raw closing quote with an older current quote", () => {
  const old = normalizeQuote(raw, raw.fetchedAt);
  const close = normalizeQuote(
    {
      ...raw,
      price: 100,
      marketTimestamp: "2024-05-31T20:00:00Z",
      claimedStatus: "end_of_day",
    },
    raw.fetchedAt,
  );
  expect(preferRecentQuote(old, close).price).toBe(100);
});
it("rejects invalid/future quotes and keeps premarket separate", () => {
  expect(() => normalizeQuote({ ...raw, price: 0 }, raw.fetchedAt)).toThrow();
  expect(() =>
    normalizeQuote(
      { ...raw, marketTimestamp: "2024-06-01T20:00:00Z" },
      raw.fetchedAt,
    ),
  ).toThrow();
  expect(
    normalizeQuote({ ...raw, session: "pre" }, raw.fetchedAt).session,
  ).toBe("pre");
});

import { quoteAfterElapsed, refreshQuoteFreshness } from "@/lib/market-data/quotes";
const fridayClose = normalizeQuote({ ...raw, previousClose: undefined, marketTimestamp: "2026-09-25T20:00:00Z",
  fetchedAt: "2026-09-26T15:00:00Z", claimedStatus: "end_of_day" }, "2026-09-26T15:00:00Z");
it("keeps a Friday close fresh over the weekend and marks it stale once Monday's close passes", () => {
  const q = { ...fridayClose, staleAfter: "2026-09-28T20:00:00Z" };
  expect(refreshQuoteFreshness(q, "2026-09-27T23:00:00Z").stale).toBe(false);
  const later = refreshQuoteFreshness(q, "2026-09-28T20:00:00Z");
  expect(later.stale).toBe(true);
  expect(later.status).toBe("end_of_day");
  expect(later.provenance.warnings.join()).toMatch(/newer market close/);
  expect(refreshQuoteFreshness({ ...q, staleAfter: null }, "2026-09-27T23:00:00Z").stale).toBe(true);
});
it("expires a delayed claim after its stated delay plus tolerance, never upgrading", () => {
  const delayed = normalizeQuote({ ...raw, delaySeconds: 900 }, "2024-05-31T20:00:00Z");
  expect(delayed.statusExpiresAt).toBe("2024-05-31T20:16:00.000Z");
  expect(refreshQuoteFreshness(delayed, "2024-05-31T20:15:59Z").status).toBe("delayed");
  const lapsed = refreshQuoteFreshness(delayed, "2024-05-31T20:16:00Z");
  expect(lapsed.status).toBe("latest_available");
  expect(refreshQuoteFreshness(lapsed, "2024-05-31T20:17:00Z").status).toBe("latest_available");
});
it("ages displayed quotes from the server clock, immune to browser clock skew", () => {
  const q = { ...fridayClose, staleAfter: "2026-09-28T20:00:00Z" };
  expect(q.observationAgeSeconds).toBe(68400);
  const aged = quoteAfterElapsed(q, 60_000);
  expect(aged.observationAgeSeconds).toBe(68460);
  expect(quoteAfterElapsed(q, -5_000).observationAgeSeconds).toBe(68400);
});
it("reports cache age from the upstream response time when a framework cache serves an older response", () => {
  const q = normalizeQuote({ ...raw, fetchedAt: "2024-05-31T20:00:00Z" }, "2024-05-31T20:29:00Z");
  expect(q.provenance.cacheAgeSeconds).toBe(1740);
  expect(q.provenance.lastSuccessfulRefresh).toBe("2024-05-31T20:00:00Z");
});
