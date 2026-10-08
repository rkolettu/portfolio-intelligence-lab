import { describe, expect, it } from "vitest";
import { buildForwardRiskModel, type ForwardRiskModelInput } from "@/lib/forward/riskModel";
import { forwardRiskSessions, forwardRiskWindowDates } from "@/lib/forward/sample";
import { ledoitWolf } from "@/lib/analytics/shrinkage";
import { annualizeCovariance } from "@/lib/analytics/covariance";
import { validateCovariance } from "@/lib/analytics/matrix";
import { arithmeticReturn } from "@/lib/analytics/returns";
import { sampleStandardDeviation } from "@/lib/utils/numerical";
import { FORWARD_METHODOLOGY } from "@/config/methodology";
import type { ForwardRiskModel, ForwardRiskModelOutcome } from "@/lib/types/forward";
import type { HistoricalSeries } from "@/lib/types/data";
import {
  FORWARD_END,
  FORWARD_START_3Y,
  fixtureDates,
  fixtureSeries,
} from "../fixtures/forward";

const SESSIONS_3Y = forwardRiskSessions(FORWARD_START_3Y, FORWARD_END);
const PRICES = ["AAA", "BBB", "CCC", "VTI", "SPY", "VT", "DDD"].map((t) =>
  fixtureSeries(t),
);
const input = (o: Partial<ForwardRiskModelInput> = {}): ForwardRiskModelInput => ({
  universe: ["AAA", "BBB", "CCC"],
  marketProxy: "VTI",
  riskWindow: "3Y",
  requestedStartDate: FORWARD_START_3Y,
  endDate: FORWARD_END,
  prices: PRICES,
  sessions: SESSIONS_3Y,
  ...o,
});
const model = (o: Partial<ForwardRiskModelInput> = {}): ForwardRiskModel => {
  const r = buildForwardRiskModel(input(o));
  if (!r.available) throw new Error(`unavailable: ${r.code} ${r.reason}`);
  return r.model;
};
const failure = (o: Partial<ForwardRiskModelInput>) => {
  const r = buildForwardRiskModel(input(o));
  if (r.available) throw new Error("expected an unavailable model");
  return r as Extract<ForwardRiskModelOutcome, { available: false }>;
};
/** Independent recomputation: aligned returns of `tickers` over `dates`. */
const columns = (tickers: string[], dates: string[], prices = PRICES) =>
  tickers.map((t) => {
    const p = new Map(
      prices.find((s) => s.ticker === t)!.observations.map((o) => [o.date, o.adjustedClose]),
    );
    return dates.slice(1).map((d, k) => arithmeticReturn(p.get(dates[k])!, p.get(d)!));
  });

describe("risk window dates", () => {
  it("ends at the latest finalized session and starts N years before it", () => {
    expect(forwardRiskWindowDates("3Y", "2024-06-04T15:00:00Z")).toEqual({
      endDate: "2024-06-03",
      requestedStartDate: "2021-06-03",
    });
    expect(forwardRiskWindowDates("1Y", "2024-06-04T15:00:00Z").requestedStartDate).toBe(
      "2023-06-03",
    );
    expect(forwardRiskWindowDates("5Y", "2024-06-04T15:00:00Z").requestedStartDate).toBe(
      "2019-06-03",
    );
  });

  it("excludes the current New York day's bar even after the close, and skips weekends and holidays", () => {
    // 19:00 New York on Tuesday 4 June: today's bar is still excluded.
    expect(forwardRiskWindowDates("3Y", "2024-06-04T23:00:00Z").endDate).toBe("2024-06-03");
    // Monday morning: the latest finalized session is Friday.
    expect(forwardRiskWindowDates("3Y", "2024-06-03T13:00:00Z").endDate).toBe("2024-05-31");
    // 5 July: 4 July is a holiday, so the end is 3 July.
    expect(forwardRiskWindowDates("3Y", "2024-07-05T15:00:00Z").endDate).toBe("2024-07-03");
  });

  it("is independent of any analysis period: only the risk window and the clock matter", () => {
    const a = forwardRiskWindowDates("3Y", "2024-06-04T15:00:00Z");
    expect(forwardRiskSessions(a.requestedStartDate, a.endDate)[0].date).toBe("2021-06-03");
    expect(forwardRiskSessions(a.requestedStartDate, a.endDate).at(-1)!.date).toBe(
      "2024-06-03",
    );
  });
});

describe("one Ledoit–Wolf covariance over universe ∪ proxy on one common sample", () => {
  it("is exactly the existing estimator on the common aligned returns, annualized and validated", () => {
    const m = model();
    expect(m.modelTickers).toEqual(["AAA", "BBB", "CCC", "VTI"]);
    const dates = SESSIONS_3Y.map((s) => s.date);
    const lw = ledoitWolf(columns(m.modelTickers, dates));
    expect(m.modelCovariance).toEqual(annualizeCovariance(lw.shrunk));
    expect(m.shrinkage.delta).toBe(lw.shrinkage);
    expect(m.shrinkage.mu).toBe(lw.mu * 252);
    expect(m.annualization.factor).toBe(252);
    expect(validateCovariance(m.modelCovariance, { tolerance: 1e-10 }).ok).toBe(true);
    expect(m.validation.tolerance).toBe(1e-10);
    expect(m.validation.model.singular).toBe(false);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        expect(m.modelCovariance[i][j]).toBe(m.modelCovariance[j][i]);
    // The risky block is the same numbers, not a second estimate.
    expect(m.covariance).toEqual([0, 1, 2].map((i) => [0, 1, 2].map((j) => m.modelCovariance[i][j])));
    expect(m.modelVolatility).toEqual([0, 1, 2].map((i) => Math.sqrt(m.modelCovariance[i][i])));
  });

  it("reports the requested and effective window and the aligned-return count", () => {
    const w = model().window;
    expect(w.requested).toBe("3Y");
    expect(w.requestedStartDate).toBe("2021-06-03");
    expect(w.requestedFirstSession).toBe("2021-06-03");
    expect(w.endDate).toBe("2024-06-03");
    expect(w.effectiveStartDate).toBe("2021-06-03");
    expect(w.effectiveEndDate).toBe("2024-06-03");
    expect(w.alignedReturns).toBe(SESSIONS_3Y.length - 1);
    expect(w.sample.returnCount).toBe(w.alignedReturns);
    expect(w.status).toBe("normal");
    expect(w.shortened).toBe(false);
    expect(w.limitingTickers).toEqual([]);
  });
});

describe("Forward Model Beta and market volatility from the same matrix", () => {
  it("β_i = Σ_im / Σ_mm and σ_m = √Σ_mm", () => {
    const m = model();
    const mi = m.modelTickers.indexOf("VTI");
    m.tickers.forEach((t, k) => {
      const i = m.modelTickers.indexOf(t);
      expect(m.modelBeta[k]).toBe(m.modelCovariance[i][mi] / m.modelCovariance[mi][mi]);
    });
    expect(m.marketVolatility).toBe(Math.sqrt(m.modelCovariance[mi][mi]));
    // The factor loadings are recovered approximately (shrinkage pulls toward 0).
    expect(m.modelBeta[0]).toBeGreaterThan(m.modelBeta[1]);
    expect(m.modelBeta[1]).toBeGreaterThan(m.modelBeta[2]);
  });

  it("gives a held proxy β = 1 exactly and places it on the market point", () => {
    const m = model({ universe: ["AAA", "VTI", "BBB"] });
    expect(m.proxyInUniverse).toBe(true);
    expect(m.modelTickers).toEqual(["AAA", "BBB", "VTI"]);
    const k = m.tickers.indexOf("VTI");
    expect(m.modelBeta[k]).toBe(1);
    expect(m.modelVolatility[k]).toBe(m.marketVolatility);
  });

  it("guarantees β_p σ_m ≤ σ_p for every long-only portfolio (one consistent covariance)", () => {
    const m = model({ universe: ["AAA", "BBB", "CCC", "SPY", "VT", "DDD"] });
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = m.tickers.length;
    const portfolios = [
      ...m.tickers.map((_, i) => m.tickers.map((__, j) => (i === j ? 1 : 0))),
      ...Array.from({ length: 200 }, () => {
        const raw = m.tickers.map(() => rand() ** 3);
        const s = raw.reduce((a, b) => a + b, 0);
        return raw.map((x) => x / s);
      }),
    ];
    for (const w of portfolios) {
      const beta = w.reduce((s, x, i) => s + x * m.modelBeta[i], 0);
      const variance = w.reduce(
        (s, x, i) => s + x * m.covariance[i].reduce((t, c, j) => t + c * w[j], 0),
        0,
      );
      expect(beta * m.marketVolatility).toBeLessThanOrEqual(Math.sqrt(variance) * (1 + 1e-12));
      expect(w).toHaveLength(n);
    }
  });
});

describe("historical correlation on the same sample", () => {
  it("is the Pearson correlation of the common returns, not the shrunk model matrix", () => {
    const m = model();
    const c = m.sampleCorrelation;
    expect(c.tickers).toEqual(m.modelTickers);
    const dates = SESSIONS_3Y.map((s) => s.date);
    const [a, , , v] = columns(m.modelTickers, dates);
    const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length;
    const ma = mean(a);
    const mv = mean(v);
    const cov = a.reduce((s, x, k) => s + (x - ma) * (v[k] - mv), 0) / (a.length - 1);
    const pearson = cov / (sampleStandardDeviation(a) * sampleStandardDeviation(v));
    expect(c.matrix[0][3]).toBeCloseTo(pearson, 12);
    expect(c.matrix[0][0]).toBe(1);
    const shrunkCorr =
      m.modelCovariance[0][3] / Math.sqrt(m.modelCovariance[0][0] * m.modelCovariance[3][3]);
    expect(Math.abs(c.matrix[0][3]! - shrunkCorr)).toBeGreaterThan(1e-6);
  });
});

describe("short history and observation thresholds (aligned returns)", () => {
  const lateBy = (aligned: number) => fixtureDates.length - 1 - aligned;
  const withLate = (aligned: number, extra: Partial<ForwardRiskModelInput> = {}) =>
    input({
      universe: ["AAA", "DDD"],
      prices: [...PRICES.filter((p) => p.ticker !== "DDD"), fixtureSeries("DDD", { from: lateBy(aligned) })],
      ...extra,
    });

  it("shortens to the common sample, says why, and names the limiting security", () => {
    const r = buildForwardRiskModel(withLate(300));
    if (!r.available) throw new Error(r.reason);
    const w = r.model.window;
    expect(w.shortened).toBe(true);
    expect(w.limitingTickers).toEqual(["DDD"]);
    expect(w.alignedReturns).toBe(300);
    expect(w.effectiveStartDate).toBe(fixtureDates[lateBy(300)]);
    expect(w.requestedFirstSession).toBe("2021-06-03");
    expect(w.status).toBe("normal");
    expect(w.notes[0]).toBe(
      `The requested 3Y window starts 2021-06-03; the common aligned sample starts ${fixtureDates[lateBy(300)]} because DDD has no earlier provider-reported history.`,
    );
  });

  it("is unavailable below 60 aligned returns, limited from 60 to 251, normal from 252", () => {
    const f = buildForwardRiskModel(withLate(59));
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.code).toBe("insufficient_history");
      expect(f.alignedReturns).toBe(59);
      expect(f.tickers).toEqual(["DDD"]);
      expect(f.reason).toMatch(/Only 59 aligned daily returns.*needs at least 60.*because DDD has no earlier/);
    }
    for (const [aligned, status] of [[60, "limited"], [251, "limited"], [252, "normal"]] as const) {
      const r = buildForwardRiskModel(withLate(aligned));
      if (!r.available) throw new Error(r.reason);
      expect(r.model.window.alignedReturns).toBe(aligned);
      expect(r.model.window.status).toBe(status);
      expect(r.model.window.notes.some((n) => n.startsWith("Limited History"))).toBe(status === "limited");
    }
  });

  it("refuses an unexplained leading gap and an interior missing session", () => {
    const gap = failure({
      universe: ["AAA", "DDD"],
      prices: [...PRICES.filter((p) => p.ticker !== "DDD"), fixtureSeries("DDD", { from: lateBy(300), firstTradeDate: null })],
    });
    expect(gap.code).toBe("coverage_gap");
    expect(gap.tickers).toEqual(["DDD"]);
    const hole = failure({
      prices: [...PRICES.filter((p) => p.ticker !== "BBB"), fixtureSeries("BBB", { dropDates: ["2023-03-15"] })],
    });
    expect(hole.code).toBe("coverage_gap");
    expect(hole.tickers).toEqual(["BBB"]);
    expect(hole.reason).toMatch(/no return is bridged/);
  });

  it("treats a missing proxy session like any other gap: the whole model is unavailable", () => {
    const r = failure({
      prices: [...PRICES.filter((p) => p.ticker !== "VTI"), fixtureSeries("VTI", { dropDates: ["2024-05-31"] })],
    });
    expect(r.code).toBe("coverage_gap");
    expect(r.tickers).toEqual(["VTI"]);
  });
});

describe("zero-volatility securities", () => {
  it("are a typed model error naming the ticker, never a synthetic risk-free asset", () => {
    const r = failure({
      prices: [...PRICES.filter((p) => p.ticker !== "CCC"), fixtureSeries("CCC", { constant: true })],
    });
    expect(r.code).toBe("zero_volatility");
    expect(r.tickers).toEqual(["CCC"]);
    expect(r.reason).toMatch(/never treated as a risk-free asset/);
    const proxy = failure({
      prices: [...PRICES.filter((p) => p.ticker !== "VTI"), fixtureSeries("VTI", { constant: true })],
    });
    expect(proxy.tickers).toEqual(["VTI"]);
  });
});

describe("all-CASH and single-asset universes", () => {
  it("estimates only the proxy when there are no risky assets", () => {
    const m = model({ universe: [] });
    expect(m.noRiskyAssets).toBe(true);
    expect(m.tickers).toEqual([]);
    expect(m.modelTickers).toEqual(["VTI"]);
    expect(m.covariance).toEqual([]);
    expect(m.modelBeta).toEqual([]);
    expect(m.shrinkage.delta).toBe(0); // one security: the target equals the sample
    const [vti] = columns(["VTI"], SESSIONS_3Y.map((s) => s.date));
    expect(m.marketVolatility).toBeCloseTo(sampleStandardDeviation(vti) * Math.sqrt(252), 14);
    expect(m.window.notes.at(-1)).toMatch(/^No risky assets/);
  });

  it("accepts a single risky asset with its own Σ_im / Σ_mm beta", () => {
    const m = model({ universe: ["AAA"] });
    expect(m.modelTickers).toEqual(["AAA", "VTI"]);
    expect(m.covariance).toEqual([[m.modelCovariance[0][0]]]);
    expect(m.modelBeta).toEqual([m.modelCovariance[0][1] / m.modelCovariance[1][1]]);
    expect(m.noRiskyAssets).toBe(false);
  });
});

describe("inputs, failures and reproducibility", () => {
  it("is invariant to universe and price ordering, and its hash is stable", () => {
    const a = model();
    const b = model({ universe: ["CCC", "AAA", "BBB"], prices: [...PRICES].reverse() });
    expect(b).toEqual(a);
    expect(model().hash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes its hash when the proxy, window or data change", () => {
    const base = model().hash;
    expect(model({ marketProxy: "SPY" }).hash).not.toBe(base);
    const oneYear = forwardRiskWindowDates("1Y", "2024-06-04T15:00:00Z");
    expect(
      model({
        riskWindow: "1Y",
        requestedStartDate: oneYear.requestedStartDate,
        sessions: forwardRiskSessions(oneYear.requestedStartDate, oneYear.endDate),
      }).hash,
    ).not.toBe(base);
    const bumped: HistoricalSeries = {
      ...PRICES[0],
      observations: PRICES[0].observations.map((o, i) =>
        i === PRICES[0].observations.length - 1 ? { ...o, adjustedClose: o.adjustedClose * 1.01 } : o,
      ),
    };
    expect(model({ prices: [bumped, ...PRICES.slice(1)] }).hash).not.toBe(base);
  });

  it("reports fetch failures for any model security, the proxy included", () => {
    const r = failure({
      unavailable: [
        { ticker: "VTI", error: { code: "TIMEOUT", message: "Provider request timed out.", retryable: true } },
        { ticker: "QQQ", error: { code: "TIMEOUT", message: "unrelated", retryable: true } },
      ],
    });
    expect(r.code).toBe("history_unavailable");
    expect(r.tickers).toEqual(["VTI"]);
    expect(r.reason).toMatch(/VTI: Provider request timed out/);
  });

  it("rejects CASH, non-canonical or duplicate tickers, and disallowed proxies or windows", () => {
    for (const o of [
      { universe: ["AAA", "CASH"] },
      { universe: ["aaa"] },
      { universe: ["AAA", "AAA"] },
      { marketProxy: "BND" as never },
      { riskWindow: "10Y" as never },
      { requestedStartDate: FORWARD_END },
    ])
      expect(failure(o).code).toBe("invalid_inputs");
  });

  it("records methodology, version and conventions for audit", () => {
    const m = model();
    expect(m.methodologyVersion).toBe(FORWARD_METHODOLOGY.version);
    expect(m.covarianceVersion).toBe("forward-lw-augmented-v1");
    expect(m.shrinkage.estimator).toBe("ledoit-wolf-2004");
    expect(m.shrinkage.target).toBe("scaled_identity");
    expect(m.annualization.convention).toMatch(/252 × Σ_daily/);
  });
});
