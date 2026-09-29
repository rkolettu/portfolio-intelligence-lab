"use client";
import { useEffect, useRef, useState } from "react";
import type { StressAnalytics, StressTestResult } from "@/lib/types/analytics";
import type { DataError, Result } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { customStressWindow } from "@/lib/validation/stress";
import { LabError } from "@/lib/utils/errors";
import { percent, percentagePoints, timestamp } from "@/lib/utils/format";
import { StressEventDetail } from "./StressEventDetail";

type Load =
  | { state: "loading" }
  | { state: "done"; value: StressAnalytics }
  | { state: "error"; error: DataError };

const SHORT: Record<string, string> = {
  gfc: "GFC 2007–09",
  covid: "COVID 2020",
  "rate-shock-2022": "2022 rate shock",
};
const failed = (message: string): Load => ({
  state: "error",
  error: { code: "PROVIDER_ERROR", message, retryable: true },
});
async function post(
  body: unknown,
  signal: AbortSignal,
): Promise<Result<StressAnalytics>> {
  const response = await fetch("/api/stress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return response.json() as Promise<Result<StressAnalytics>>;
}
const loaded = (r: Result<StressAnalytics>): Load =>
  r.ok ? { state: "done", value: r.value } : { state: "error", error: r.error };

function Row({ e }: { e: StressTestResult }) {
  const cell = (
    m: { available: boolean; value?: number },
    f: (v: number) => string,
  ) => (m.available ? f(m.value!) : "N/A");
  return (
    <tr>
      <td>{e.name}</td>
      <td>
        {e.startDate ?? e.requestedStartDate} →{" "}
        {e.endDate ?? e.requestedEndDate}
      </td>
      {e.status === "complete" ? (
        <>
          <td>{cell(e.portfolioReturn, percent)}</td>
          <td>{cell(e.benchmarkReturn, percent)}</td>
          <td>{cell(e.activeReturn, percentagePoints)}</td>
          <td>{cell(e.maximumDrawdown, percent)}</td>
          <td>{e.best.join(", ")}</td>
          <td>{e.worst.join(", ")}</td>
        </>
      ) : e.status === "incomplete_coverage" ? (
        <td colSpan={6} className="warning">
          Incomplete Historical Coverage · missing{" "}
          {e.missing.map((m) => m.ticker).join(", ")}
        </td>
      ) : (
        <td colSpan={6} className="muted">
          Unavailable · {e.reason}
        </td>
      )}
    </tr>
  );
}

/** Stress Lab for the displayed analysis. Requests the fixed windows on its own
 * route (independent of the analysis) and runs a Custom Historical Window on
 * demand. Mounted per result, so its events always belong to that portfolio. */
export function StressLab({
  config,
  today,
}: {
  config: PortfolioConfig;
  today: string;
}) {
  const key = JSON.stringify(config);
  const [presets, setPresets] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("gfc");
  const [custom, setCustom] = useState<Load | null>(null);
  const [draft, setDraft] = useState({ startDate: "", endDate: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const customRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    post({ config: JSON.parse(key) as PortfolioConfig }, controller.signal)
      .then((r) => setPresets(loaded(r)))
      .catch(() => {
        if (!controller.signal.aborted)
          setPresets(failed("The stress request failed."));
      });
    return () => controller.abort();
  }, [key, attempt]);
  useEffect(() => {
    const pending = customRequest;
    return () => pending.current?.abort();
  }, []);

  function runCustom() {
    let window;
    try {
      window = customStressWindow(draft.startDate, draft.endDate, today);
    } catch (error) {
      setInvalid(
        error instanceof LabError ? error.detail.message : "Invalid window.",
      );
      return;
    }
    setInvalid(null);
    customRequest.current?.abort();
    const controller = new AbortController();
    customRequest.current = controller;
    setCustom({ state: "loading" });
    post(
      {
        config,
        window: { startDate: window.startDate, endDate: window.endDate },
      },
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) setCustom(loaded(r));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCustom(failed("The custom window request failed."));
      });
  }

  const events = presets.state === "done" ? presets.value.events : [];
  const customEvent = custom?.state === "done" ? custom.value.events[0] : null;
  const event = events.find((e) => e.id === selected);
  const options = [
    ...events.map((e) => ({ value: e.id, label: SHORT[e.id] ?? e.name })),
    { value: "custom", label: "Custom window" },
  ];
  return (
    <>
      <div className="summary-grid">
        <div>
          <span>Windows</span>
          <strong>
            {presets.state === "done"
              ? `${events.length} fixed · ${presets.value.windowsVersion}`
              : "Fixed in configuration"}
          </strong>
        </div>
        <div>
          <span>Initialization</span>
          <strong>Target weights at each start close</strong>
        </div>
        <div>
          <span>Rebalancing</span>
          <strong>Monthly closing resets</strong>
        </div>
        <div>
          <span>ETF benchmark</span>
          <strong>{config.benchmark}</strong>
        </div>
      </div>
      {presets.state === "loading" && (
        <div className="loading" role="status">
          <span className="loading-line" />
          <p>Loading event-window history and running each event…</p>
        </div>
      )}
      {presets.state === "error" && (
        <div className="error" role="alert">
          <strong>{presets.error.code.replaceAll("_", " ")}</strong>
          <p>
            {presets.error.message} The historical analysis above is unaffected.
          </p>
          {presets.error.code !== "UNQUALIFIED_PROVIDER" && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPresets({ state: "loading" });
                  setAttempt((a) => a + 1);
                }}
              >
                Retry stress tests
              </button>
            </div>
          )}
        </div>
      )}
      {presets.state === "done" && (
        <>
          <div className="table-wrap">
            <table className="stress-table">
              <caption>
                Historical stress events · target weights re-initialized at each
                event start
              </caption>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Window (closes)</th>
                  <th>Portfolio</th>
                  <th>{config.benchmark}</th>
                  <th>Active</th>
                  <th>Max drawdown</th>
                  <th>Best</th>
                  <th>Worst</th>
                </tr>
              </thead>
              <tbody>
                {[...events, ...(customEvent ? [customEvent] : [])].map((e) => (
                  <Row key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="series-control stress-select">
            <fieldset className="segmented">
              <legend className="sr-only">Stress event</legend>
              {options.map((o) => (
                <label
                  key={o.value}
                  className={selected === o.value ? "selected" : undefined}
                >
                  <input
                    type="radio"
                    name="stress-event"
                    value={o.value}
                    checked={selected === o.value}
                    onChange={() => setSelected(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          </div>
          {selected !== "custom" && event && (
            <StressEventDetail event={event} benchmark={config.benchmark} />
          )}
          {selected === "custom" && (
            <div className="stress-detail">
              <h3 className="stress-name">Custom Historical Window</h3>
              <p className="hint">
                The fixed-window rules on dates you choose: target weights at
                the first session on or after the start, monthly closing resets,
                and full coverage for every holding. Historical data only, up to
                10 years; not a hypothetical scenario.
              </p>
              <form
                className="custom-window"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  runCustom();
                }}
              >
                <div>
                  <label htmlFor="stress-start">Window start</label>
                  <input
                    id="stress-start"
                    type="date"
                    value={draft.startDate}
                    max={today}
                    onChange={(ev) =>
                      setDraft((d) => ({ ...d, startDate: ev.target.value }))
                    }
                  />
                </div>
                <div>
                  <label htmlFor="stress-end">Window end</label>
                  <input
                    id="stress-end"
                    type="date"
                    value={draft.endDate}
                    max={today}
                    onChange={(ev) =>
                      setDraft((d) => ({ ...d, endDate: ev.target.value }))
                    }
                  />
                </div>
                <button
                  type="submit"
                  className="secondary"
                  aria-busy={custom?.state === "loading"}
                >
                  Run custom window
                </button>
              </form>
              {invalid && (
                <p className="warning" role="status">
                  {invalid}
                </p>
              )}
              {custom?.state === "loading" && (
                <p className="muted" role="status">
                  Loading history for the custom window…
                </p>
              )}
              {custom?.state === "error" && (
                <p className="warning" role="status">
                  {custom.error.message}
                </p>
              )}
              {customEvent && (
                <StressEventDetail
                  event={customEvent}
                  benchmark={config.benchmark}
                  showName={false}
                />
              )}
            </div>
          )}
          <p className="hint">
            Windows are fixed in configuration and chosen as documented
            historical periods, not universal definitions of each crisis. Each
            event starts fresh at target weights, so no result depends on
            another backtest&apos;s drifted weights. Today&apos;s holdings
            applied to past windows carry selection bias; results are gross of
            costs and describe the past, not a forecast.
          </p>
          <p className="hash">
            Stress snapshot SHA-256: {presets.value.metadata.snapshotHash} ·
            generated {timestamp(presets.value.metadata.generatedAt)} ·{" "}
            {presets.value.methodologyVersion}
          </p>
        </>
      )}
    </>
  );
}
