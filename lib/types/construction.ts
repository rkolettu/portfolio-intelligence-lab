// Shared contracts only; construction is not implemented in Phase 1.
import type { PortfolioHolding } from "./portfolio";
export type OptimizationConstraint = {
  ticker: string;
  minWeight: number;
  maxWeight: number;
  required: boolean;
};
export type ConstructionResult = {
  method: string;
  holdings: PortfolioHolding[];
  converged: boolean;
  iterations: number;
  tolerance: number;
  reason?: string;
};
