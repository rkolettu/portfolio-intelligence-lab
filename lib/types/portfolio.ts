export type PortfolioHolding = { ticker: string; weight: number };
export type CashPolicy = "historical_proxy" | "zero_explicit";
export type PortfolioConfig = {
  holdings: PortfolioHolding[];
  benchmark: string;
  requestedStartDate: string;
  endDate: string;
  rebalanceFrequency: "monthly";
  cashPolicy: CashPolicy;
};
export type Period = "1Y" | "3Y" | "5Y" | "10Y" | "MAX" | "Custom";
