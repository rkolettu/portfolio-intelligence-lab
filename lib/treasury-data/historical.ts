import "server-only";
import type {
  LatestTreasuryYield,
  TreasuryCurve,
  TreasuryMaturity,
  TreasurySeries,
} from "@/lib/types/data";
import type { TreasuryProvider } from "./types";
import { parseTreasuryCsv } from "./normalize";
import {
  LATEST_ONE_YEAR_LOOKBACK_DAYS,
  ONE_YEAR_PROXY_WARNING,
  latestOneYear,
} from "./latest";
import { fetchPublic, type Fetcher } from "@/lib/server/http";
import { addDays, marketDate } from "@/lib/utils/dates";
import { fail } from "@/lib/utils/errors";
export class FredProvider implements TreasuryProvider {
  readonly name = "Federal Reserve H.15 via FRED";
  constructor(private fetcher: Fetcher = fetch) {}
  private async series(id: string, start: string, end: string, now: string) {
    const query = new URLSearchParams({ id, cosd: start, coed: end });
    const response = await fetchPublic(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?${query}`,
      21600,
      this.fetcher,
    );
    const observations = parseTreasuryCsv(await response.text(), id).filter(
      (r) => r.date >= start && r.date <= end,
    );
    const responseDate = response.headers.get("date");
    const fetchedAt =
      responseDate && Number.isFinite(Date.parse(responseDate))
        ? new Date(responseDate).toISOString()
        : now;
    return {
      observations,
      provenance: {
        provider: this.name,
        fetchedAt,
        lastSuccessfulRefresh: fetchedAt,
        cacheAgeSeconds: Math.max(
          0,
          (Date.parse(now) - Date.parse(fetchedAt)) / 1000,
        ),
        observationDate: observations.at(-1)?.date ?? null,
        fallbackUsed: false,
        warnings: [
          "Latest-vintage yields; historical publication availability is conservatively modeled, not proven point-in-time.",
        ],
      },
    };
  }
  async getHistoricalRates(
    startDate: string,
    endDate: string,
    now: string,
  ): Promise<TreasurySeries> {
    return {
      ...(await this.series("DGS3MO", addDays(startDate, -14), endDate, now)),
      series: "DGS3MO",
    };
  }
  async getCurrentCurve(now: string): Promise<TreasuryCurve> {
    const mapping: [TreasuryMaturity, string][] = [
      ["3M", "DGS3MO"],
      ["1Y", "DGS1"],
      ["3Y", "DGS3"],
      ["5Y", "DGS5"],
      ["10Y", "DGS10"],
    ];
    const today = marketDate(now);
    const values = await Promise.all(
      mapping.map(async ([maturity, id]) => ({
        maturity,
        ...(await this.series(id, addDays(today, -21), today, now)),
      })),
    );
    const common = values[0].observations
      .filter((r) =>
        values.every((v) => v.observations.some((p) => p.date === r.date)),
      )
      .at(-1)?.date;
    if (!common)
      fail(
        "TREASURY_UNAVAILABLE",
        "No recent common official Treasury curve date is available.",
        { retryable: true },
      );
    return {
      points: values.map((v) => ({
        maturity: v.maturity,
        date: common,
        annualYield: v.observations.find((r) => r.date === common)!.annualYield,
      })),
      mixedDates: false,
      provenance: {
        ...values[0].provenance,
        observationDate: common,
        warnings: [
          "Latest common official observation; informational context only.",
        ],
      },
    };
  }

  /** Only DGS1, over the same 21-day window (and so the same request URL and
   * fetch cache entry) as the curve's 1Y leg; its latest observation, whatever
   * dates the other maturities have. */
  async getLatestOneYearYield(now: string): Promise<LatestTreasuryYield> {
    const today = marketDate(now);
    const { observations, provenance } = await this.series(
      "DGS1",
      addDays(today, -LATEST_ONE_YEAR_LOOKBACK_DAYS),
      today,
      now,
    );
    return latestOneYear(observations, today, provenance, [
      ONE_YEAR_PROXY_WARNING,
    ]);
  }
}
