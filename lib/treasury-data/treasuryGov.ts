import "server-only";
import type {
  LatestTreasuryYield,
  TreasuryCurve,
  TreasuryMaturity,
  TreasuryObservation,
  TreasurySeries,
} from "@/lib/types/data";
import type { TreasuryProvider } from "./types";
import { modeledAvailableAt } from "./normalize";
import {
  LATEST_ONE_YEAR_LOOKBACK_DAYS,
  ONE_YEAR_PROXY_WARNING,
  latestOneYear,
} from "./latest";
import { fetchPublic, type Fetcher } from "@/lib/server/http";
import { addDays, marketDate, validDate } from "@/lib/utils/dates";
import { fail, LabError } from "@/lib/utils/errors";

/** Columns of Treasury's Daily Par Yield Curve file and the H.15 series each one
 * is. Since the Federal Reserve's H.15 constant-maturity yields are read from this
 * curve, the "3 Mo" column is DGS3MO itself (verified identical day by day). */
const COLUMNS: Record<string, string> = {
  DGS3MO: "3 Mo",
  DGS1: "1 Yr",
  DGS3: "3 Yr",
  DGS5: "5 Yr",
  DGS10: "10 Yr",
};
/** Treasury publishes this file from 1990. */
const FIRST_YEAR = 1990;

/** Parse one year's Daily Par Yield Curve CSV into observations of `series`. */
export function parseTreasuryGovCsv(
  csv: string,
  series: string,
): TreasuryObservation[] {
  const column = COLUMNS[series];
  if (!column) fail("MALFORMED_DATA", "Unsupported Treasury series or yield basis.");
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const names = header.split(",").map((h) => h.replace(/"/g, "").trim());
  const di = names.indexOf("Date");
  const ci = names.indexOf(column);
  if (di !== 0 || ci < 0) fail("MALFORMED_DATA", "Unexpected Treasury CSV schema.");
  const rows = new Map<string, TreasuryObservation>();
  for (const line of lines) {
    const fields = line.split(",");
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fields[di]?.trim() ?? "");
    if (!m) fail("MALFORMED_DATA", "Invalid Treasury date.");
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    if (!validDate(date)) fail("MALFORMED_DATA", "Invalid Treasury date.");
    const raw = (fields[ci] ?? "").trim();
    if (raw === "" || raw === "N/A") continue;
    const annualYield = Number(raw) / 100;
    if (!Number.isFinite(annualYield) || annualYield <= -1)
      fail("MALFORMED_DATA", "Invalid Treasury yield.");
    if (rows.has(date) && rows.get(date)!.annualYield !== annualYield)
      fail("MALFORMED_DATA", "Conflicting Treasury observations.");
    rows.set(date, {
      date,
      annualYield,
      availableAt: modeledAvailableAt(date),
      availability: "modeled",
    });
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The same H.15 constant-maturity yields, read from their publisher: the U.S.
 * Treasury's Daily Par Yield Curve, one file per calendar year. */
export class TreasuryGovProvider implements TreasuryProvider {
  readonly name = "U.S. Treasury Daily Par Yield Curve (H.15 source)";
  constructor(private fetcher: Fetcher = fetch) {}

  /** Concurrent callers share one download per year file. */
  private inflight = new Map<number, Promise<string>>();

  private year(y: number, now: string): Promise<string> {
    const pending = this.inflight.get(y);
    if (pending) return pending;
    const work = this.download(y, now).finally(() => this.inflight.delete(y));
    this.inflight.set(y, work);
    return work;
  }

  private async download(y: number, now: string): Promise<string> {
    const current = Number(marketDate(now).slice(0, 4));
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
    // Past years never change: cache them for a month; this year for 6 hours.
    const response = await fetchPublic(url, y < current ? 2_592_000 : 21_600, this.fetcher, 25_000);
    return response.text();
  }

  private async series(id: string, start: string, end: string, now: string) {
    const first = Math.max(FIRST_YEAR, Number(start.slice(0, 4)));
    const last = Number(end.slice(0, 4));
    if (Number(start.slice(0, 4)) < FIRST_YEAR)
      fail("TREASURY_UNAVAILABLE", "Treasury's yield curve file begins in 1990.", {
        retryable: false,
      });
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const files = await Promise.all(years.map((y) => this.year(y, now)));
    const observations = files
      .flatMap((csv) => parseTreasuryGovCsv(csv, id))
      .filter((r) => r.date >= start && r.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      observations,
      provenance: {
        provider: this.name,
        fetchedAt: now,
        lastSuccessfulRefresh: now,
        cacheAgeSeconds: 0,
        observationDate: observations.at(-1)?.date ?? null,
        fallbackUsed: true,
        warnings: [
          "FRED was unreachable; the identical H.15 constant-maturity yields were read from the U.S. Treasury's Daily Par Yield Curve.",
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
    const today = marketDate(now);
    const start = addDays(today, -21);
    const mapping: [TreasuryMaturity, string][] = [
      ["3M", "DGS3MO"],
      ["1Y", "DGS1"],
      ["3Y", "DGS3"],
      ["5Y", "DGS5"],
      ["10Y", "DGS10"],
    ];
    const values = await Promise.all(
      mapping.map(async ([maturity, id]) => ({
        maturity,
        ...(await this.series(id, start, today, now)),
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
          "Read from the U.S. Treasury's Daily Par Yield Curve because FRED was unreachable.",
        ],
      },
    };
  }

  /** Only the "1 Yr" column (DGS1) of the year file(s) covering the 21-day window.
   * Why this source was chosen is recorded by the caller that compares sources. */
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
      "Read from the U.S. Treasury's Daily Par Yield Curve (the H.15 source).",
    ]);
  }
}

/** FRED first; the Treasury's own file in parallel as the fallback. Both are the
 * same H.15 series, so the result is the same; the fallback only changes where
 * the numbers were read from, and the provenance says so. */
export class FallbackTreasuryProvider implements TreasuryProvider {
  constructor(
    private primary: TreasuryProvider,
    private secondary: TreasuryProvider,
  ) {}
  get name() {
    return this.primary.name;
  }
  private async race<T>(a: () => Promise<T>, b: () => Promise<T>): Promise<T> {
    const backup = b();
    backup.catch(() => {}); // used only if the primary fails
    try {
      return await a();
    } catch {
      return backup;
    }
  }
  getHistoricalRates(startDate: string, endDate: string, now: string) {
    return this.race(
      () => this.primary.getHistoricalRates(startDate, endDate, now),
      () => this.secondary.getHistoricalRates(startDate, endDate, now),
    );
  }
  getCurrentCurve(now: string) {
    return this.race(
      () => this.primary.getCurrentCurve(now),
      () => this.secondary.getCurrentCurve(now),
    );
  }
  /** Forward 1Y only (the curve and historical reads above keep the race): both
   * sources are read and the LATER official observation wins, the primary (FRED)
   * on equal dates, so "Latest Available" survives FRED's ingestion lag. Rates are
   * never merged or averaged; the selection is recorded in provenance. */
  async getLatestOneYearYield(now: string): Promise<LatestTreasuryYield> {
    const [a, b] = await Promise.allSettled([
      this.primary.getLatestOneYearYield(now),
      this.secondary.getLatestOneYearYield(now),
    ]);
    const why = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled"
        ? ""
        : r.reason instanceof LabError
          ? r.reason.detail.message
          : r.reason instanceof Error
            ? r.reason.message
            : "unknown failure";
    const x = a.status === "fulfilled" ? a.value : null;
    const y = b.status === "fulfilled" ? b.value : null;
    const p = this.primary.name;
    const q = this.secondary.name;
    const note = (
      value: LatestTreasuryYield,
      selection: string,
      fallback: boolean,
      extra: string[] = [],
    ): LatestTreasuryYield => ({
      ...value,
      provenance: {
        ...value.provenance,
        fallbackUsed: fallback,
        fallbackReason: fallback ? selection : undefined,
        warnings: [...value.provenance.warnings, selection, ...extra],
      },
    });
    if (x && !y)
      return note(
        x,
        `Source selection: ${p} (DGS1 ${x.observationDate}); ${q} could not be read for comparison (${why(b)}).`,
        false,
      );
    if (!x && y)
      return note(
        y,
        `Source selection: ${q} (DGS1 ${y.observationDate}); ${p} could not be read (${why(a)}).`,
        true,
      );
    if (!x || !y)
      fail(
        "TREASURY_UNAVAILABLE",
        `No official 1-year Treasury observation could be read (${p}: ${why(a)}; ${q}: ${why(b)}).`,
        { retryable: true },
      );
    if (y.observationDate > x.observationDate)
      return note(
        y,
        `Source selection: ${q} (DGS1 ${y.observationDate}) is later than ${p} (${x.observationDate}); the later official observation is used.`,
        true,
      );
    const differs =
      y.observationDate === x.observationDate && y.annualYield !== x.annualYield
        ? [
            `${p} and ${q} report different 1-year yields for ${x.observationDate} (${(x.annualYield * 100).toFixed(2)}% vs ${(y.annualYield * 100).toFixed(2)}%); ${p}'s is used, never an average.`,
          ]
        : [];
    return note(
      x,
      y.observationDate === x.observationDate
        ? `Source selection: ${p} and ${q} both report DGS1 ${x.observationDate}; ${p} is used on equal dates.`
        : `Source selection: ${p} (DGS1 ${x.observationDate}) is later than ${q} (${y.observationDate}); the later official observation is used.`,
      false,
      differs,
    );
  }
}
