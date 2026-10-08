import type {
  LatestTreasuryYield,
  TreasuryCurve,
  TreasurySeries,
} from "@/lib/types/data";
export interface TreasuryProvider {
  name: string;
  getHistoricalRates(
    startDate: string,
    endDate: string,
    now: string,
  ): Promise<TreasurySeries>;
  getCurrentCurve(now: string): Promise<TreasuryCurve>;
  /** The latest available official DGS1 observation, read on its own (1Y only),
   * for the V2 forward risk-free rate. The curve above is unaffected. */
  getLatestOneYearYield(now: string): Promise<LatestTreasuryYield>;
}
