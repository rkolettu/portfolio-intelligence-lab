import { CONSTRUCTION_METHODOLOGY } from "@/config/methodology";
import type { SolverStart } from "@/lib/types/construction";
import { jacobiEigen } from "@/lib/analytics/matrix";
import {
  allocationFeasible,
  kktResidual,
  projectBudgetBox,
  projectedGradientResidual,
} from "@/lib/analytics/optimization";
import {
  dot,
  failed,
  matVec,
  residualsOf,
  solveLinear,
  type MethodResult,
} from "./common";

const { tolerances: T, limits } = CONSTRUCTION_METHODOLOGY;
type Matrix = readonly (readonly number[])[];

type State = { F: number; g: number[]; p: number[]; V: number };

/** F(w) = Σ_i (PCR_i − 1/N)², PCR_i = w_i(Σw)_i / wᵀΣw, and its gradient
 * ∇F = (2/V)[e∘m + Σ(e∘w)] − (4/V)(Σ_i e_i PCR_i) m, with m = Σw, e = PCR − 1/N.
 * Null outside the domain (zero or non-finite portfolio variance). */
function state(S: Matrix, w: readonly number[], n: number): State | null {
  const m = matVec(S, w);
  const V = dot(m, w);
  const scale =
    w.reduce(
      (s, x, i) => s + Math.abs(x) * Math.sqrt(Math.max(0, S[i][i])),
      0,
    ) ** 2;
  if (!Number.isFinite(V) || V <= 1e-12 * scale) return null;
  const p = w.map((x, i) => (x * m[i]) / V);
  const e = p.map((x) => x - 1 / n);
  const F = dot(e, e);
  const a = dot(e, p);
  const sew = matVec(
    S,
    e.map((x, i) => x * w[i]),
  );
  const g = m.map((mi, j) => (2 / V) * (e[j] * mi + sew[j]) - (4 / V) * a * mi);
  return Number.isFinite(F) && g.every(Number.isFinite) ? { F, g, p, V } : null;
}

const parityOf = (p: readonly number[], n: number) =>
  Math.max(...p.map((x) => Math.abs(x - 1 / n)));

type Direction = { d: number[]; curvature: number; bidirectional: boolean };

/** Analytic Hessian of F. With J = ∂PCR/∂w = (1/V)[diag(m) + diag(w)Σ − 2p mᵀ],
 * a = eᵀp and c = e∘m + Σ(e∘w) (so ∇F = 2Jᵀe = (2/V)(c − 2a m)):
 *   ∇²F = 2JᵀJ + 2Σ_i e_i ∇²p_i, where
 *   Σ_i e_i ∇²p_i = (e_j + e_k − 2a)Σ_jk / V − 2(c_j m_k + m_j c_k) / V² + 8a m_j m_k / V².
 * No step size is involved, so tiny weights are handled exactly. `magnitude` is the
 * same expression over absolute values, with |e| replaced by |p| + 1/N (e = p − 1/N is
 * formed by subtraction): the elementwise scale of the roundoff. `cancellation` =
 * |w|ᵀ|Σ||w| / V amplifies it when the portfolio variance cancels. Null outside the
 * objective domain. */
export function ercHessian(
  S: Matrix,
  w: readonly number[],
): { hessian: number[][]; magnitude: number[][]; cancellation: number } | null {
  const n = w.length;
  const st = state(S, w, n);
  if (!st) return null;
  const { V, p } = st;
  const m = matVec(S, w);
  const e = p.map((x) => x - 1 / n);
  const a = dot(e, p);
  const sew = matVec(
    S,
    e.map((x, i) => x * w[i]),
  );
  const c = m.map((mi, j) => e[j] * mi + sew[j]);
  const absS = S.map((row) => row.map(Math.abs));
  const absW = w.map(Math.abs);
  const eBar = p.map((x) => Math.abs(x) + 1 / n);
  const mBar = matVec(absS, absW);
  const aBar = eBar.reduce((s, x, i) => s + x * Math.abs(p[i]), 0);
  const sewBar = matVec(
    absS,
    eBar.map((x, i) => x * absW[i]),
  );
  const cBar = mBar.map((mi, j) => eBar[j] * mi + sewBar[j]);
  const J = w.map((_, i) =>
    w.map(
      (_, j) => ((i === j ? m[i] : 0) + w[i] * S[i][j] - 2 * p[i] * m[j]) / V,
    ),
  );
  const JBar = w.map((_, i) =>
    w.map(
      (_, j) =>
        ((i === j ? mBar[i] : 0) +
          absW[i] * absS[i][j] +
          2 * Math.abs(p[i]) * mBar[j]) /
        V,
    ),
  );
  // sign = −1 gives ∇²F; sign = +1 over absolute values gives its magnitude bound.
  const build = (
    Jm: number[][],
    E: readonly number[],
    A: number,
    C: readonly number[],
    M: readonly number[],
    Sm: Matrix,
    sign: 1 | -1,
  ) =>
    w.map((_, j) =>
      w.map((_, k) => {
        let jj = 0;
        for (let i = 0; i < n; i++) jj += Jm[i][j] * Jm[i][k];
        const second =
          ((E[j] + E[k] + sign * 2 * A) * Sm[j][k]) / V +
          (sign * 2 * (C[j] * M[k] + M[j] * C[k])) / (V * V) +
          (8 * A * M[j] * M[k]) / (V * V);
        return 2 * jj + 2 * second;
      }),
    );
  const hessian = build(J, e, a, c, m, S, -1);
  for (let j = 0; j < n; j++)
    for (let k = 0; k < j; k++)
      hessian[j][k] = hessian[k][j] = (hessian[j][k] + hessian[k][j]) / 2;
  return {
    hessian,
    magnitude: build(JBar, eBar, aBar, cBar, mBar, absS, 1).map((row) =>
      row.map(Math.abs),
    ),
    cancellation: dot(absW, mBar) / V,
  };
}

export type SecondOrderCheck = {
  status: "verified" | "violated" | "unverifiable";
  /** Normalized curvature (× B²): the cone minimum when violated; otherwise the
   * smallest curvature found on the critical cone or a subspace containing it. */
  curvature: number | null;
  /** Roundoff bound on that curvature, same units. */
  error: number | null;
  direction: Direction | null;
  /** Weakly active bounds released into the critical cone. */
  released: number;
  reason: string | null;
};

/** Second-order necessary condition for a local minimum of the ERC objective at a
 * first-order stationary point, on the critical cone. The constraints are linear,
 * so the condition is dᵀ∇²F d ≥ 0 for every d in
 *   C = {d : Σd = 0, d_i = 0 if l_i = u_i, d_i ≥ 0 at a lower bound, d_i ≤ 0 at an
 *        upper bound, ∇Fᵀd = 0}.
 * ∇Fᵀd = 0 forces d_i = 0 for every bound with a positive multiplier under some
 * valid KKT multiplier (with free coordinates, ν = mean ∇F over them; with none, ν
 * ranges over [max ∇F at upper bounds, min ∇F at lower bounds] and each bound takes
 * its most favorable ν). The remaining weakly active bounds (normalized multiplier ≤
 * weakMultiplier) are released: they may move inward, alone or jointly.
 *
 * The cone's minimum curvature lies in the relative interior of one face (free
 * coordinates plus a subset of released bounds) and is there a minimum eigenvector
 * of the Hessian restricted to that face's budget-preserving subspace. So: if the
 * subspace of all released bounds has no curvature below −tolerance, the cone has
 * none; otherwise every face is enumerated and a face's minimum eigenvector counts
 * only if it (or its negation) moves each released bound strictly inward.
 * Curvature comes from the analytic Hessian with an explicit roundoff bound: within
 * that bound of −tolerance, or with an unresolved eigenspace, the verdict is
 * unverifiable, never verified. */
export function ercSecondOrder(input: {
  covariance: Matrix;
  weights: readonly number[];
  lower: readonly number[];
  upper: readonly number[];
  budget: number;
}): SecondOrderCheck {
  const { covariance: S, weights: w, lower, upper, budget: B } = input;
  const n = w.length;
  const unverifiable = (reason: string): SecondOrderCheck => ({
    status: "unverifiable",
    curvature: null,
    error: null,
    direction: null,
    released: 0,
    reason,
  });
  const st = state(S, w, n);
  const hess = st ? ercHessian(S, w) : null;
  if (!st || !hess)
    return unverifiable(
      "The point lies outside the ERC objective domain (zero or non-finite portfolio variance).",
    );
  const H = hess.hessian;
  const error =
    T.curvatureRoundoff *
    n *
    Number.EPSILON *
    hess.cancellation *
    Math.hypot(...hess.magnitude.flat()) *
    B *
    B;
  if (!H.flat().every(Number.isFinite) || !Number.isFinite(error))
    return unverifiable("The Hessian of the ERC objective is not finite.");
  const fixed = (i: number) => upper[i] - lower[i] <= T.binding;
  const atLower = (i: number) => !fixed(i) && w[i] - lower[i] <= T.binding;
  const atUpper = (i: number) =>
    !fixed(i) && !atLower(i) && upper[i] - w[i] <= T.binding;
  const free = w.flatMap((_, i) =>
    fixed(i) || atLower(i) || atUpper(i) ? [] : [i],
  );
  const active = w.flatMap((_, i) => (atLower(i) || atUpper(i) ? [i] : []));
  let lo: number;
  let hi: number;
  if (free.length)
    lo = hi = free.reduce((s, i) => s + st.g[i], 0) / free.length;
  else {
    lo = Math.max(-Infinity, ...active.filter(atUpper).map((i) => st.g[i]));
    hi = Math.min(Infinity, ...active.filter(atLower).map((i) => st.g[i]));
    if (lo > hi) lo = hi = (lo + hi) / 2;
  }
  const released = active.filter(
    (i) => (atLower(i) ? st.g[i] - lo : hi - st.g[i]) * B <= T.weakMultiplier,
  );
  if (released.length > limits.ercConeBounds)
    return unverifiable(
      `${released.length} weakly active bounds exceed the ${limits.ercConeBounds} the critical-cone check enumerates.`,
    );
  const inward = (i: number) => (atLower(i) ? 1 : -1);
  // Minimum eigenpair of H on {d supported on `members`, Σd = 0} (Helmert basis).
  const face = (members: number[]) => {
    if (members.length < 2) return null;
    const basis = members.slice(1).map((_, k) => {
      const d = new Array<number>(n).fill(0);
      const c = 1 / Math.sqrt((k + 1) * (k + 2));
      for (let a = 0; a <= k; a++) d[members[a]] = c;
      d[members[k + 1]] = -(k + 1) * c;
      return d;
    });
    const reduced = basis.map((u) => basis.map((v) => dot(u, matVec(H, v))));
    const eig = jacobiEigen(reduced, { maxSweeps: limits.eigenSweeps });
    if (!eig.converged) return "failed" as const;
    const d = new Array<number>(n).fill(0);
    eig.vectors[0].forEach((c, b) =>
      basis[b].forEach((x, i) => (d[i] += c * x)),
    );
    return {
      l1: eig.values[0] * B * B,
      l2: (eig.values[1] ?? Infinity) * B * B,
      d,
    };
  };
  const sorted = (idx: number[]) => [...idx].sort((a, b) => a - b);
  const base = { error, released: released.length };
  const whole = face(sorted([...free, ...released]));
  if (whole === null)
    return {
      ...base,
      status: "verified",
      curvature: null,
      direction: null,
      reason: null,
    };
  if (whole === "failed")
    return unverifiable("The reduced-Hessian eigensolver did not converge.");
  if (whole.l1 >= -T.curvature + error)
    return {
      ...base,
      status: "verified",
      curvature: whole.l1,
      direction: null,
      reason: null,
    };
  let worst: Direction | null = null;
  let minimum = Infinity;
  let doubtful = false;
  for (let mask = 0; mask < 2 ** released.length; mask++) {
    const subset = released.filter((_, b) => mask & (2 ** b));
    const f = face(sorted([...free, ...subset]));
    if (f === null) continue;
    if (f === "failed") {
      doubtful = true;
      continue;
    }
    const ambiguous = f.l2 - f.l1 <= 2 * error;
    const sign = ([1, -1] as const).find((s) =>
      subset.every((i) => s * f.d[i] * inward(i) > T.coneDirection),
    );
    if (sign === undefined) {
      // The face's minimum is not inside it, unless the eigenspace is unresolved.
      if (ambiguous && f.l1 < -T.curvature + error) doubtful = true;
      continue;
    }
    minimum = Math.min(minimum, f.l1);
    if (f.l1 < -T.curvature - error && !ambiguous) {
      if (!worst || f.l1 < worst.curvature)
        worst = {
          d: f.d.map((x) => sign * x),
          curvature: f.l1,
          bidirectional: subset.length === 0,
        };
    } else if (f.l1 < -T.curvature + error) doubtful = true;
  }
  if (worst)
    return {
      ...base,
      status: "violated",
      curvature: worst.curvature,
      direction: worst,
      reason: null,
    };
  const curvature = Number.isFinite(minimum) ? minimum : null;
  return doubtful
    ? {
        ...base,
        status: "unverifiable",
        curvature,
        direction: null,
        reason:
          "Curvature on the critical cone is within its roundoff bound of the threshold, or an eigenspace is not resolved.",
      }
    : {
        ...base,
        status: "verified",
        curvature,
        direction: null,
        reason: null,
      };
}

/** Move along a negative-curvature direction until F strictly decreases. */
function escape(
  S: Matrix,
  x: readonly number[],
  F0: number,
  dir: Direction,
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
  n: number,
): { x: number[]; st: State } | null {
  const size = Math.max(...dir.d.map(Math.abs));
  let best: { x: number[]; st: State } | null = null;
  for (const sign of dir.bidirectional ? [1, -1] : [1]) {
    let t = (0.1 * budget) / size;
    for (let k = 0; k < 60; k++, t /= 2) {
      const cand = projectBudgetBox(
        x.map((v, i) => v + sign * t * dir.d[i]),
        lower,
        upper,
        budget,
      );
      const cs = state(S, cand, n);
      if (cs && cs.F < F0 - 1e-12 * Math.max(F0, 1e-12)) {
        if (!best || cs.F < best.st.F) best = { x: cand, st: cs };
        break;
      }
    }
  }
  return best;
}

/** Unconstrained long-only ERC by the convex log-barrier formulation (Spinu 2013):
 * minimize ½yᵀΣy − (1/N)Σ log y_i over y > 0 (damped Newton), then w = y / Σy.
 * Used only to initialize a start and to prove infeasibility of exact parity; the
 * ERC objective and its certification are unchanged. Null unless it converges and
 * the result verifiably has PCR_i = 1/N. */
function logBarrierRiskBudget(S: Matrix, n: number): number[] | null {
  if (S.some((row, i) => !(row[i] > 0))) return null;
  let y = S.map((row, i) => 1 / Math.sqrt(row[i]));
  const f = (v: readonly number[]) =>
    0.5 * dot(v, matVec(S, v)) - v.reduce((s, x) => s + Math.log(x), 0) / n;
  for (let it = 0; it < 200; it++) {
    const Sy = matVec(S, y);
    const g = Sy.map((x, i) => x - 1 / (n * y[i]));
    if (Math.max(...g.map((x, i) => Math.abs(x * y[i]))) <= 1e-15) break;
    const H = S.map((row, i) =>
      row.map((x, j) => (i === j ? x + 1 / (n * y[i] * y[i]) : x)),
    );
    const step = solveLinear(H, g);
    if (!step) return null;
    let t = 1;
    while (y.some((v, i) => v - t * step[i] <= 0) && t > 1e-20) t /= 2;
    const f0 = f(y);
    const slope = dot(g, step);
    while (
      t > 1e-20 &&
      !(f(y.map((v, i) => v - t * step[i])) <= f0 - 1e-4 * t * slope)
    )
      t /= 2;
    if (t <= 1e-20) break;
    y = y.map((v, i) => v - t * step[i]);
  }
  const total = y.reduce((s, x) => s + x, 0);
  const w = y.map((x) => x / total);
  const st = state(S, w, n);
  return st && parityOf(st.p, n) <= 1e-9 ? w : null;
}

/** Proof that exact parity is infeasible under the bounds: with Σ positive
 * definite, the long-only ERC allocation is unique (Maillard, Roncalli & Teiletche
 * 2010), so if that allocation (scaled to the risky budget) breaks a bound, no
 * feasible allocation has equal risk contributions. Null when not demonstrated. */
function parityInfeasibility(
  S: Matrix,
  lower: readonly number[],
  upper: readonly number[],
  budget: number,
  n: number,
): { index: number; required: number } | null {
  const eig = jacobiEigen(S, { maxSweeps: limits.eigenSweeps });
  const lmax = eig.values.at(-1)!;
  if (!eig.converged || !(eig.values[0] > T.matrixRelative * lmax)) return null;
  const unit = logBarrierRiskBudget(S, n);
  if (!unit) return null;
  let worst: { index: number; required: number; violation: number } | null =
    null;
  unit.forEach((x, i) => {
    const required = x * budget;
    const violation = Math.max(lower[i] - required, required - upper[i]);
    if (violation > T.weight && (!worst || violation > worst.violation))
      worst = { index: i, required, violation };
  });
  return worst;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** minimize Σ(PCR_i − 1/N)² subject to Σw = B, l ≤ w ≤ u, over Σ_construction.
 * N is the number of eligible risky assets, fixed before solving.
 *
 * Starts, in fixed order: the caller's (constrained equal weight, constrained
 * inverse volatility, current allocation), then the log-barrier risk-budget
 * allocation projected onto the bounds, then one tilt per asset (the projection of
 * B(1 + e_k)/(N + 1)). A start within 1e-9·B of an earlier one is recorded as
 * coincident and not run again.
 *
 * Each start runs projected gradient with Armijo backtracking and Barzilai–Borwein
 * steps. An endpoint with exact parity (max|PCR_i − 1/N| ≤ tolerance) is the
 * global minimum of the nonnegative objective and is accepted as is. Any other
 * first-order stationary endpoint is checked for negative curvature on the critical
 * cone; a saddle is escaped along that direction and the run continues. A start
 * certifies only with exact parity, or first-order stationarity (projected-gradient
 * and KKT residuals) AND a verified second-order check; "unverifiable" never
 * certifies. The best certified start wins (objective, then parity, then order). Solver certification and parity are reported
 * separately, and constraint-impossibility is claimed only when proven. */
export function equalRiskContribution(input: {
  covariance: Matrix;
  lower: readonly number[];
  upper: readonly number[];
  budget: number;
  starts: {
    name: string;
    weights: readonly number[] | null;
    reason: string | null;
  }[];
  /** Asset names for diagnostics and messages (canonical order). */
  names?: readonly string[];
  maxIterations?: number;
}): MethodResult {
  const { covariance: S, lower, upper, budget } = input;
  const n = lower.length;
  const names = input.names ?? lower.map((_, i) => `asset ${i + 1}`);
  const maxIterations = input.maxIterations ?? limits.ercIterationsPerStart;
  const name = "Σ(PCR_i − 1/N)²";
  if (!n || budget === 0)
    return failed(
      "invalid_inputs",
      "Equal risk contribution is unavailable when the risky budget is zero: there is no risky allocation and no risk-budget problem (zero portfolio variance lies outside its objective domain).",
      { objective: { name, value: null } },
    );
  const s0 = budget * budget;
  const stationarity = (w: readonly number[], g: readonly number[]) =>
    projectedGradientResidual(w, g, s0, lower, upper, budget);
  const kkt = (w: readonly number[], g: readonly number[]) =>
    kktResidual(w, g, lower, upper).residual * budget;
  const secondOrder = (w: readonly number[]) =>
    ercSecondOrder({ covariance: S, weights: w, lower, upper, budget });
  const barrier = logBarrierRiskBudget(S, n);
  const candidates = [
    ...input.starts,
    {
      name: "log_barrier_risk_budget",
      weights: barrier
        ? projectBudgetBox(
            barrier.map((x) => x * budget),
            lower,
            upper,
            budget,
          )
        : null,
      reason: barrier
        ? null
        : "The log-barrier risk-budget initialization did not converge (Σ not positive definite or ill-conditioned).",
    },
    ...names.map((ticker, k) => ({
      name: `tilt_${ticker}`,
      weights: projectBudgetBox(
        lower.map((_, i) => ((i === k ? 2 : 1) * budget) / (n + 1)),
        lower,
        upper,
        budget,
      ),
      reason: null,
    })),
  ];
  const starts: SolverStart[] = [];
  const runs: { w: number[]; F: number; parity: number; index: number }[] = [];
  const seen: { name: string; weights: readonly number[] }[] = [];
  let nonFinite = false;
  let totalIterations = 0;
  for (const start of candidates) {
    const record: SolverStart = {
      name: start.name,
      used: false,
      reason: start.reason,
      iterations: 0,
      objective: null,
      stationarity: null,
      parity: null,
      termination: "skipped",
      selected: false,
      escapes: 0,
      secondOrder: null,
      curvature: null,
    };
    starts.push(record);
    if (!start.weights) continue;
    const twin = seen.find(
      (s) =>
        Math.max(...s.weights.map((x, i) => Math.abs(x - start.weights![i]))) <=
        T.distinctStart * budget,
    );
    if (twin) {
      record.reason = `Coincides with the ${twin.name} start.`;
      continue;
    }
    seen.push({ name: start.name, weights: start.weights });
    if (!allocationFeasible(start.weights, lower, upper, budget)) {
      record.reason = "The start violates the constraints.";
      continue;
    }
    let x = [...start.weights];
    const initial = state(S, x, n);
    if (!initial) {
      record.reason =
        "The start has zero portfolio variance, which lies outside the ERC objective domain.";
      continue;
    }
    let st: State = initial;
    record.used = true;
    record.reason = null;
    let s = s0;
    let k = 0;
    let termination = "iteration_limit";
    let best = Infinity;
    let sinceBest = 0;
    for (;;) {
      const r = stationarity(x, st.g);
      if (!Number.isFinite(r)) {
        nonFinite = true;
        termination = "non_finite";
        break;
      }
      if (r < best) {
        best = r;
        sinceBest = 0;
      } else sinceBest++;
      // Precision floor: no progress for 2,000 iterations while already within the
      // certification threshold (the 1e-14 target can be below floating-point noise).
      const floor = sinceBest > 2000 && r <= T.stationarity;
      if (r <= T.solverTarget || floor || k >= maxIterations) {
        if (r <= T.solverTarget) termination = "converged";
        else if (floor) termination = "precision_floor";
        if (r > T.stationarity) break;
        // Exact parity is the global minimum of the nonnegative objective: no
        // curvature test can overturn it.
        if (parityOf(st.p, n) <= T.parity) {
          record.secondOrder = "parity_achieved";
          break;
        }
        // First-order stationary: check curvature on the critical cone before stopping.
        const so = secondOrder(x);
        record.curvature = so.curvature;
        if (so.status !== "violated") {
          record.secondOrder = so.status;
          break;
        }
        record.secondOrder = "violated";
        const moved =
          record.escapes < limits.ercEscapes && k < maxIterations
            ? escape(S, x, st.F, so.direction!, lower, upper, budget, n)
            : null;
        if (!moved) break;
        record.escapes++;
        record.secondOrder = null;
        x = moved.x;
        st = moved.st;
        s = s0;
        termination = "iteration_limit";
        k++;
        continue;
      }
      let trial = s;
      let accepted: { x: number[]; st: State } | null = null;
      while (trial >= 1e-20 * s0) {
        const cand = projectBudgetBox(
          x.map((v, i) => v - trial * st.g[i]),
          lower,
          upper,
          budget,
        );
        const cs = state(S, cand, n);
        const decrease = dot(
          st.g,
          cand.map((v, i) => v - x[i]),
        );
        if (cs && cs.F <= st.F + 1e-4 * decrease) {
          accepted = { x: cand, st: cs };
          break;
        }
        trial /= 2;
      }
      if (!accepted) {
        termination = "line_search_stalled";
        // A stalled search at a stationary point still gets the same checks.
        if (
          stationarity(x, st.g) <= T.stationarity &&
          parityOf(st.p, n) > T.parity
        ) {
          const so = secondOrder(x);
          record.curvature = so.curvature;
          record.secondOrder = so.status;
          if (so.status === "violated" && record.escapes < limits.ercEscapes) {
            const moved = escape(
              S,
              x,
              st.F,
              so.direction!,
              lower,
              upper,
              budget,
              n,
            );
            if (moved) {
              record.escapes++;
              record.secondOrder = null;
              x = moved.x;
              st = moved.st;
              s = s0;
              termination = "iteration_limit";
              k++;
              continue;
            }
          }
        }
        break;
      }
      // Barzilai–Borwein step for the next iteration, safeguarded.
      const dx = accepted.x.map((v, i) => v - x[i]);
      const dg = accepted.st.g.map((v, i) => v - st.g[i]);
      const curvature = dot(dx, dg);
      s = curvature > 0 ? dot(dx, dx) / curvature : 2 * trial;
      s = Math.min(1e10 * s0, Math.max(1e-10 * s0, s));
      x = accepted.x;
      st = accepted.st;
      k++;
    }
    totalIterations += k;
    record.iterations = k;
    record.termination = termination;
    record.objective = st.F;
    record.stationarity = stationarity(x, st.g);
    record.parity = parityOf(st.p, n);
    const feasible = allocationFeasible(x, lower, upper, budget);
    // Exact-parity acceptance: a feasible, finite point with max|PCR_i − 1/N| ≤ the
    // parity tolerance has F ≤ N·tol², within N·tol² of the objective's global
    // minimum (F ≥ 0). It is accepted whatever a curvature estimate says.
    if (
      feasible &&
      Number.isFinite(st.F) &&
      record.parity <= T.parity &&
      st.F <= n * T.parity ** 2
    )
      record.secondOrder = "parity_achieved";
    const certified =
      feasible &&
      (record.secondOrder === "parity_achieved" ||
        (record.stationarity <= T.stationarity &&
          kkt(x, st.g) <= T.stationarity &&
          record.secondOrder === "verified"));
    if (certified)
      runs.push({
        w: x,
        F: st.F,
        parity: record.parity,
        index: starts.length - 1,
      });
  }
  const base = {
    constrained: false,
    iterations: totalIterations,
    reference: null,
    starts,
    tieRule: null,
    notes: [] as string[],
  };
  if (!runs.length) {
    const ran = starts.some((s) => s.used);
    const saddles = starts.some((s) => s.secondOrder === "violated");
    const doubtful = starts.some((s) => s.secondOrder === "unverifiable");
    return failed(
      nonFinite || !ran ? "numerical_failure" : "non_converged",
      !ran
        ? "No start lies inside the ERC objective domain (every start has zero portfolio variance, violates the constraints or coincides with another)."
        : nonFinite
          ? "The ERC solver produced non-finite values."
          : saddles
            ? "No start reached a certified local minimum: stationary points found had feasible negative curvature and could not be escaped within the limits."
            : doubtful
              ? "No start reached a certified local minimum: second-order optimality could not be verified reliably at the stationary points found."
              : "No start reached certified first- and second-order optimality within the iteration limit.",
      {
        ...base,
        objective: { name, value: null },
        termination: ran ? "iteration_limit" : "no_valid_start",
      },
    );
  }
  const chosen = runs.reduce((a, b) =>
    b.F < a.F - 1e-15 || (Math.abs(b.F - a.F) <= 1e-15 && b.parity < a.parity)
      ? b
      : a,
  );
  starts[chosen.index].selected = true;
  const final = state(S, chosen.w, n)!;
  const res = residualsOf(chosen.w, lower, upper, budget);
  const parity = parityOf(final.p, n);
  const result = {
    ...base,
    objective: { name, value: final.F },
    termination: starts[chosen.index].termination,
    residuals: {
      budget: res.budget,
      bound: res.bound,
      stationarity: stationarity(chosen.w, final.g),
      kkt: kkt(chosen.w, final.g),
      parity,
    },
    reason: null,
    weights: chosen.w,
  };
  if (parity <= T.parity) return { ...result, status: "success" };
  const deviation = `${(parity * 100).toFixed(2)} percentage points`;
  const proof = parityInfeasibility(S, lower, upper, budget, n);
  return {
    ...result,
    status: "converged_but_parity_not_achieved",
    reason: proof
      ? `Exact equal risk contribution is infeasible under the selected constraints: Σ_construction is positive definite, so the long-only equal-risk allocation is unique, and it would need ${names[proof.index]} at ${pct(proof.required)}, outside its ${pct(lower[proof.index])}–${pct(upper[proof.index])} bounds. The certified solution's largest deviation from 1/${n} is ${deviation}.`
      : `Exact risk parity was not achieved by the solver under the selected constraints; the largest deviation from 1/${n} is ${deviation}. It has not been shown that the constraints make exact parity impossible.`,
  };
}
