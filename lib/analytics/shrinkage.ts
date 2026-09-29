import { mean } from "@/lib/utils/numerical";
import { fail } from "@/lib/utils/errors";
import { sampleCovarianceMatrix } from "./covariance";

export type ShrinkageEstimate = {
  /** Daily sample covariance, n − 1 denominator (the Phase 4 convention). */
  sample: number[][];
  /** Daily (1 − δ)S + δμI. */
  shrunk: number[][];
  /** δ ∈ [0, 1]. */
  shrinkage: number;
  /** μ = trace(S) / N on the n − 1 sample covariance. */
  mu: number;
  target: "scaled_identity";
  observations: number;
  /** Reference quantities on the n denominator (Ledoit & Wolf 2004, Lemmas 3.2–3.3). */
  reference: { m: number; d2: number; bBar2: number; b2: number };
};

/** Ledoit–Wolf (2004) linear shrinkage toward a scaled identity.
 *
 * δ is computed exactly as published, on the n-denominator sample covariance S_n:
 *   m = tr(S_n)/N, d² = ‖S_n − mI‖², b̄² = (1/n²) Σ_k ‖x_k x_kᵀ − S_n‖², b² = min(b̄², d²),
 *   δ = b²/d² (0 when d² = 0), with ‖A‖² = tr(AAᵀ)/N and x_k the centered returns.
 * δ is a ratio of quantities that scale together, so it is unchanged by the
 * n versus n − 1 convention. It is applied to the n − 1 sample covariance S with
 * μ = tr(S)/N: (1 − δ)S + δμI = n/(n − 1) × [(1 − δ)S_n + δmI]. That is the
 * published estimator rescaled by the same n/(n − 1) factor as every other
 * covariance in the lab. `columns[i]` is asset i's return series. */
export function ledoitWolf(
  columns: readonly (readonly number[])[],
): ShrinkageEstimate {
  const p = columns.length;
  const n = columns[0]?.length ?? 0;
  if (n < 2)
    fail("INVALID_INPUT", "Shrinkage requires at least two observations.");
  const sample = sampleCovarianceMatrix(columns);
  const centered = columns.map((c) => {
    const m = mean(c);
    return c.map((x) => x - m);
  });
  const sn = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += centered[i][k] * centered[j][k];
      sn[i][j] = sn[j][i] = sum / n;
    }
  const m = sn.reduce((s, row, i) => s + row[i], 0) / p;
  let d2 = 0;
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) d2 += (sn[i][j] - (i === j ? m : 0)) ** 2;
  d2 /= p;
  let bBar2 = 0;
  for (let k = 0; k < n; k++)
    for (let i = 0; i < p; i++)
      for (let j = 0; j < p; j++)
        bBar2 += (centered[i][k] * centered[j][k] - sn[i][j]) ** 2;
  bBar2 /= p * n * n;
  const b2 = Math.min(bBar2, d2);
  const shrinkage = d2 > 0 ? b2 / d2 : 0;
  const mu = sample.reduce((s, row, i) => s + row[i], 0) / p;
  return {
    sample,
    shrunk: sample.map((row, i) =>
      row.map((x, j) => (1 - shrinkage) * x + (i === j ? shrinkage * mu : 0)),
    ),
    shrinkage,
    mu,
    target: "scaled_identity",
    observations: n,
    reference: { m, d2, bBar2, b2 },
  };
}
