"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { samplePortfolio } from "@/config/samplePortfolio";
import {
  draftConfig,
  portfolioReducer,
  toDraft,
  type Draft,
  type DraftAction,
} from "@/lib/state/portfolioReducer";
import { persistDraft, restoreDraft } from "@/lib/state/persistence";
import {
  clearLastAnalysis,
  readLastAnalysis,
  writeLastAnalysis,
} from "@/lib/state/lastAnalysis";
import { errorResult } from "@/lib/utils/errors";
import { referenceMaturity } from "@/lib/treasury-data/reference";
import type { BacktestResult, StressAnalytics } from "@/lib/types/analytics";
import type {
  CurrentQuote,
  DataError,
  Result,
  TreasuryCurve,
  TreasuryMaturity,
} from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";

export type ResultStatus = "current" | "changed" | "pending";
/** Stages of the Analyze action. Each is shown only while it is actually happening:
 * `waking` only when the market-data service did not answer its readiness check
 * promptly; `loading` is the single analysis request, which loads prices,
 * validates coverage and calculates analytics on the server in one pass. */
export type Stage = "waking" | "loading" | "opening";
export type ResultSource =
  | { kind: "live" }
  | { kind: "cached-sample"; refreshedAt: string };
type SubmitOptions = { navigate?: boolean; recovering?: boolean };

export type Workspace = {
  today: string;
  ready: boolean;
  draft: Draft;
  validated: PortfolioConfig | null;
  validation: string;
  total: number;
  notice: string | null;
  edit: (action: DraftAction) => void;
  submit: (config: PortfolioConfig, options?: SubmitOptions) => Promise<void>;
  analyzeSample: (options?: SubmitOptions) => void;
  reanalyze: () => void;
  loadCachedSample: (options?: SubmitOptions) => Promise<void>;
  /** The failed request's config was the sample, so the cached sample may be offered. */
  cachedSampleOffer: boolean;
  pending: boolean;
  recovering: boolean;
  stage: Stage | null;
  /** The current Analyze action had to wait for the service to wake. */
  woke: boolean;
  /** Waking has taken long enough that the sample may offer its cached copy. */
  wakeSlow: boolean;
  /** The request in flight is the sample portfolio. */
  pendingSample: boolean;
  /** Nonblocking wake of the market-data service (landing page load). */
  wakeService: () => void;
  error: DataError | null;
  result: BacktestResult | null;
  source: ResultSource;
  status: ResultStatus;
  quotes: Result<CurrentQuote>[] | null;
  quotesReceived: number | null;
  curve: Result<TreasuryCurve> | null;
  horizon: TreasuryMaturity | null;
  /** Per-analysis UI state (Stress Lab, Constructor) that survives route changes. */
  slots: Map<string, unknown>;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace outside WorkspaceProvider");
  return value;
}

/** A piece of UI state kept for the current analysis across page navigation,
 * e.g. the Stress Lab's loaded events or the Constructor's proposal. */
export function useSlot<T>(key: string, initial: T | (() => T)) {
  // Outside a workspace (isolated component tests) the state is simply local.
  const [local] = useState(() => new Map<string, unknown>());
  const ctx = useContext(WorkspaceContext);
  const slots = ctx?.slots ?? local;
  const [value, setValue] = useState<T>(() =>
    slots.has(key)
      ? (slots.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial,
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        slots.set(key, v);
        return v;
      }),
    [key, slots],
  );
  return [value, set] as const;
}

const SERVICE_ERRORS = new Set([
  "PROVIDER_ERROR",
  "TIMEOUT",
  "RATE_LIMIT",
  "UNQUALIFIED_PROVIDER",
  "PERMISSION",
  "MALFORMED_DATA",
]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Health = { mode?: string; ready?: boolean };
/** A free Render instance sleeps when idle, so "ready" is trusted for a minute. */
const WAKE_REUSE_MS = 60_000;
/** After this long waking, the sample may offer its cached copy (never automatic). */
const SLOW_WAKE_MS = 20_000;

/** Workspace state for every page: the builder draft (persisted to localStorage),
 * the displayed analysis (memory only, never stored in the browser), current market
 * context and per-analysis page state. Lives in the root layout, so client-side
 * navigation between the landing page and the analysis routes never refetches. */
export function WorkspaceProvider({
  today,
  children,
}: {
  today: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, dispatch] = useReducer(
    portfolioReducer,
    toDraft(samplePortfolio(today)),
  );
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [failedConfig, setFailedConfig] = useState<PortfolioConfig | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [source, setSource] = useState<ResultSource>({ kind: "live" });
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [woke, setWoke] = useState(false);
  const [wakeSlow, setWakeSlow] = useState(false);
  const [pendingSample, setPendingSample] = useState(false);
  const wake = useRef<{
    promise: Promise<Health | null>;
    at: number;
    ready: boolean;
  } | null>(null);
  const [quotes, setQuotes] = useState<Result<CurrentQuote>[] | null>(null);
  const [curve, setCurve] = useState<Result<TreasuryCurve> | null>(null);
  const [horizon, setHorizon] = useState<TreasuryMaturity | null>(null);
  const [quotesReceived, setQuotesReceived] = useState<number | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [slots] = useState(() => new Map<string, unknown>());
  const recovered = useRef(false);

  /** Readiness of the market-data service, checked through Portfolio Lab's own
   * server (the browser never calls the service). One check at a time; each waits
   * up to 45 s and a cold free instance gets two. Advisory only: a null answer
   * (no status route, direct research mode) never blocks the analysis. */
  const ensureAwake = useCallback((): Promise<Health | null> => {
    const w = wake.current;
    if (w && (w.ready ? w.at > Date.now() - WAKE_REUSE_MS : true))
      return w.promise;
    const check = () =>
      fetch("/api/market-data/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitMs: 45_000 }),
      })
        .then((r) => r.json() as Promise<Health>)
        .catch(() => null);
    const entry = {
      at: Date.now(),
      ready: false,
      promise: Promise.resolve<Health | null>(null),
    };
    entry.promise = (async () => {
      let h = await check();
      if (h && h.mode === "service" && !h.ready) h = await check();
      if (h && (h.mode !== "service" || h.ready)) {
        entry.ready = true;
        entry.at = Date.now();
      } else if (wake.current === entry) wake.current = null; // next action retries
      return h;
    })();
    wake.current = entry;
    return entry.promise;
  }, []);
  const wakeService = useCallback(() => {
    void ensureAwake();
  }, [ensureAwake]);

  useEffect(() => {
    // Storage is read only after hydration; SSR never accesses browser state.
    let restored;
    try {
      restored = restoreDraft(
        window.localStorage,
        toDraft(samplePortfolio(today)),
        today,
      );
    } catch {
      restored = {
        draft: toDraft(samplePortfolio(today)),
        notice: "Local storage is disabled; preferences will not persist.",
      };
    }
    dispatch({ type: "replace", draft: restored.draft });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate validated browser preferences
    setNotice(restored.notice);
    setReady(true);
    return () => {
      controller.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- request counter, not a DOM ref; invalidate pending callbacks
      sequence.current++;
    };
  }, [today]);

  let validated: PortfolioConfig | null = null;
  let validation = "";
  try {
    validated = draftConfig(draft, today);
  } catch (e) {
    validation = e instanceof Error ? e.message : "Invalid portfolio.";
  }
  const total = draft.holdings.reduce(
    (sum, h) =>
      sum + (Number.isFinite(Number(h.weight)) ? Number(h.weight) : 0),
    0,
  );

  const edit = useCallback(
    (action: DraftAction) => {
      try {
        if (!persistDraft(window.localStorage, portfolioReducer(draft, action)))
          setNotice("Local storage is disabled; preferences will not persist.");
      } catch {
        setNotice("Local storage is disabled; preferences will not persist.");
      }
      sequence.current++;
      controller.current?.abort();
      setPending(false);
      setStage(null);
      setError(null);
      setQuotes(null);
      setQuotesReceived(null);
      setCurve(null);
      dispatch(action);
    },
    [draft],
  );

  const show = useCallback(
    (value: BacktestResult, from: ResultSource) => {
      slots.clear();
      setResult(value);
      setSource(from);
    },
    [slots],
  );

  const submit = useCallback(
    async (config: PortfolioConfig, options: SubmitOptions = {}) => {
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      const id = ++sequence.current;
      const current = () => sequence.current === id;
      setPending(true);
      setRecovering(!!options.recovering);
      setError(null);
      setFailedConfig(null);
      setQuotes(null);
      setQuotesReceived(null);
      setCurve(null);
      setHorizon(referenceMaturity(config.requestedStartDate, config.endDate));
      const request = async <T,>(path: string, body: unknown): Promise<T> => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: active.signal,
        });
        return response.json() as Promise<T>;
      };
      // Wake stage: shown only if the market-data service does not answer promptly
      // (the landing page already started waking it, without blocking render).
      // A wake started on page load that is still unanswered means the service is
      // asleep right now: say so immediately instead of after the prompt window.
      const known = wake.current;
      const alreadyWaking =
        !!known && !known.ready && Date.now() - known.at > 1200;
      setStage(alreadyWaking ? "waking" : "loading");
      setWoke(alreadyWaking);
      setWakeSlow(false);
      setPendingSample(same(config, samplePortfolio(today)));
      const status = ensureAwake();
      const prompt = await Promise.race([
        status,
        new Promise<"slow">((r) => setTimeout(() => r("slow"), 1200)),
      ]);
      if (!current()) return;
      let health = prompt;
      if (prompt === "slow") {
        setStage("waking");
        setWoke(true);
        const slow = setTimeout(() => {
          if (current()) setWakeSlow(true);
        }, SLOW_WAKE_MS);
        health = await status;
        clearTimeout(slow);
        if (!current()) return;
        setStage("loading");
      }
      if (
        health &&
        health !== "slow" &&
        health.mode === "service" &&
        health.ready === false
      ) {
        setPending(false);
        setRecovering(false);
        setStage(null);
        setFailedConfig(config);
        setError({
          code: "PROVIDER_ERROR",
          message:
            "The market-data service did not wake up. Try again in a minute; nothing was substituted for real data.",
          retryable: true,
        });
        return;
      }
      // Independent requests: current context never gates historical success.
      void request<Result<CurrentQuote>[] | Result<never>>("/api/quotes", [
        ...config.holdings.filter((h) => h.weight > 0).map((h) => h.ticker),
        config.benchmark,
      ])
        .then((q) => {
          if (current()) {
            setQuotes(Array.isArray(q) ? q : [q]);
            setQuotesReceived(Date.now());
          }
        })
        .catch(() => {
          if (current())
            setQuotes([
              {
                ok: false,
                error: {
                  code: "PROVIDER_ERROR",
                  message:
                    "Current quotes unavailable; historical analysis is unaffected.",
                  retryable: true,
                },
              },
            ]);
        });
      void request<Result<TreasuryCurve>>("/api/treasury/current", {})
        .then((q) => {
          if (current()) setCurve(q);
        })
        .catch(() => {
          if (current())
            setCurve({
              ok: false,
              error: {
                code: "TREASURY_UNAVAILABLE",
                message: "Current Treasury Reference unavailable.",
                retryable: true,
              },
            });
        });
      try {
        const response = await request<Result<BacktestResult>>(
          "/api/analysis",
          config,
        );
        if (!current()) return;
        if (response.ok) {
          show(response.value, { kind: "live" });
          writeLastAnalysis({ kind: "live", config });
          if (options.navigate) {
            setStage("opening");
            router.push("/analysis/portfolio");
          }
        } else {
          setError(response.error);
          setFailedConfig(config);
        }
      } catch (e) {
        if (current()) {
          const failure = errorResult(e);
          if (!failure.ok) setError(failure.error);
          setFailedConfig(config);
        }
      } finally {
        if (current()) {
          setPending(false);
          setRecovering(false);
          setStage(null);
        }
      }
    },
    [router, show, ensureAwake, today],
  );

  const loadCachedSample = useCallback(
    async (options: SubmitOptions = {}) => {
      controller.current?.abort();
      const id = ++sequence.current;
      setPending(true);
      setStage("loading");
      setError(null);
      try {
        const response = await fetch("/api/sample-cache");
        const body = (await response.json()) as Result<{
          refreshedAt: string;
          analysis: BacktestResult;
          stress: StressAnalytics | null;
        }>;
        if (sequence.current !== id) return;
        if (!body.ok) {
          setError(body.error);
          return;
        }
        const { analysis, stress, refreshedAt } = body.value;
        show(analysis, { kind: "cached-sample", refreshedAt });
        if (stress)
          slots.set(`${analysis.metadata.snapshotHash}:stress:presets`, {
            state: "done",
            value: stress,
          });
        setQuotes(null);
        setCurve(null);
        setHorizon(null);
        writeLastAnalysis({ kind: "cached-sample" });
        if (options.navigate) router.push("/analysis/portfolio");
      } catch {
        if (sequence.current === id)
          setError({
            code: "PROVIDER_ERROR",
            message: "The cached sample could not be loaded.",
            retryable: true,
          });
      } finally {
        if (sequence.current === id) {
          setPending(false);
          setRecovering(false);
          setStage(null);
        }
      }
    },
    [router, show, slots],
  );

  const analyzeSample = useCallback(
    (options: SubmitOptions = { navigate: true }) => {
      const sample = samplePortfolio(today);
      edit({ type: "replace", draft: toDraft(sample) });
      void submit(sample, options);
    },
    [edit, submit, today],
  );

  const reanalyze = useCallback(() => {
    if (validated) void submit(validated, { navigate: false });
  }, [submit, validated]);

  // Hard refresh on an analysis route: re-run the last analysis of this tab from its
  // small saved configuration (the server cache makes this fast). Nothing large is
  // ever stored in the browser. A deep link in a new tab has none and is guided to
  // the builder instead.
  useEffect(() => {
    if (!ready || recovered.current || result || pending) return;
    recovered.current = true;
    if (!pathname?.startsWith("/analysis")) return;
    const last = readLastAnalysis(today);
    if (!last) return;
    if (last.kind === "cached-sample")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time recovery after a reload
      void loadCachedSample({ navigate: false, recovering: true });
    else void submit(last.config, { navigate: false, recovering: true });
  }, [ready, result, pending, pathname, today, submit, loadCachedSample]);

  const status: ResultStatus = pending
    ? "pending"
    : result && source.kind === "live" && !same(validated, result.config)
      ? "changed"
      : "current";
  const cachedSampleOffer =
    !!error &&
    SERVICE_ERRORS.has(error.code) &&
    !!failedConfig &&
    same(failedConfig, samplePortfolio(today));

  const value = useMemo<Workspace>(
    () => ({
      today,
      ready,
      draft,
      validated,
      validation,
      total,
      notice,
      edit,
      submit,
      analyzeSample,
      reanalyze,
      loadCachedSample,
      cachedSampleOffer,
      pending,
      recovering,
      stage,
      woke,
      wakeSlow,
      pendingSample,
      wakeService,
      error,
      result,
      source,
      status,
      quotes,
      quotesReceived,
      curve,
      horizon,
      slots,
    }),
    // validated is derived from draft/today
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      today,
      ready,
      draft,
      validation,
      total,
      notice,
      edit,
      submit,
      analyzeSample,
      reanalyze,
      loadCachedSample,
      cachedSampleOffer,
      pending,
      recovering,
      stage,
      woke,
      wakeSlow,
      pendingSample,
      wakeService,
      error,
      result,
      source,
      status,
      quotes,
      quotesReceived,
      curve,
      horizon,
      slots,
    ],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export { clearLastAnalysis };
