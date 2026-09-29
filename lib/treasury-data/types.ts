import type { TreasuryCurve, TreasurySeries } from "@/lib/types/data";
export interface TreasuryProvider {
  name: string;
  getHistoricalRates(
    startDate: string,
    endDate: string,
    now: string,
  ): Promise<TreasurySeries>;
  getCurrentCurve(now: string): Promise<TreasuryCurve>;
}
