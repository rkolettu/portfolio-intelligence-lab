import type { PortfolioConfig } from "@/lib/types/portfolio";
import { yearsBefore } from "@/lib/utils/dates";
export function samplePortfolio(today: string): PortfolioConfig {
  return {
    holdings: [
      { ticker: "SPY", weight: 0.4 },
      { ticker: "QQQ", weight: 0.15 },
      { ticker: "IWM", weight: 0.1 },
      { ticker: "BND", weight: 0.2 },
      { ticker: "GLD", weight: 0.1 },
      { ticker: "CASH", weight: 0.05 },
    ],
    benchmark: "SPY",
    requestedStartDate: yearsBefore(today, 5),
    endDate: today,
    rebalanceFrequency: "monthly",
    cashPolicy: "historical_proxy",
  };
}
