"use client";
import { useEffect, useRef, useState } from "react";
import type { StressAnalytics, StressTestResult } from "@/lib/types/analytics";
import type { DataError, Result } from "@/lib/types/data";
import type { PortfolioConfig } from "@/lib/types/portfolio";
import { customStressWindow } from "@/lib/validation/stress";
import { LabError } from "@/lib/utils/errors";
import { percent, percentagePoints, timestamp } from "@/lib/utils/format";
import { errorState } from "@/lib/ui/quality";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { Segmented } from "@/components/ui/Segmented";
import { useSlot } from "@/components/workspace/WorkspaceProvider";
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

const tone = (m: { available: boolean; value?: number }) =>
  m.available && m.value! !== 0 ? (m.value! > 0 ? "is-pos" : "is-neg") : undefined;

/** Event windows on one shared time axis: the selected event is the bright one. */
function StressTimeline({
  events,
  selected,
  today,
}: {
  events: { id: string; start: string; end: string }[];
  selected: string;
  today: string;
}) {
  if (!events.length) return null;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const lo = Math.min(...events.map((e) => t(e.start)));
  const hi = Math.max(...events.map((e) => t(e.end)), t(today));
  const at = (d: string) => ((t(d) - lo) / (hi - lo || 1)) * 100;
  const firstYear = new Date(lo).getUTCFullYear();
  const lastYear = new Date(hi).getUTCFullYear();
  const step = lastYear - firstYear > 12 ? 5 : 2;
  return (
    <div className="stress-timeline" aria-hidden>
      {Array.from(
        { length: Math.floor((lastYear - firstYear) / step) + 1 },
        (_, i) => firstYear + i * step,
      ).map((y) => (
        <span
          key={y}
          className="tl-tick"
          style={{ left: `${at(`${y}-01-01`)}%` }}
        />
      ))}
      {events.map((e) => (
        <span
          key={e.id}
          className="tl-event"
          data-on={e.id === selected ? "" : undefined}
          style={{
            left: `${at(e.start)}%`,
            width: `max(4px, ${at(e.end) - at(e.start)}%)`,
          }}
        />
      ))}
    </div>
  );
}

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
          <td className={tone(e.portfolioReturn)}>
            {cell(e.portfolioReturn, percent)}
          </td>
          <td className={tone(e.benchmarkReturn)}>
            {cell(e.benchmarkReturn, percent)}
          </td>
          <td className={tone(e.activeReturn)}>
            {cell(e.activeReturn, percentagePoints)}
          </td>
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
  slot = "local",
}: {
  config: PortfolioConfig;
  today: string;
  /** Workspace slot prefix (the analysis hash): loaded events, the selected event
   * and the custom window survive page navigation instead of refetching. */
  slot?: string;
}) {
  const key = JSON.stringify(config);
  const [presets, setPresets] = useSlot<Load>(`${slot}:stress:presets`, {
    state: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useSlot(`${slot}:stress:selected`, "gfc");
  const [custom, setCustom] = useSlot<Load | null>(`${slot}:stress:custom`, null);
  const [draft, setDraft] = useSlot(`${slot}:stress:draft`, {
    startDate: "",
    endDate: "",
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const customRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    // Only while loading: events already loaded for this analysis are reused, and
    // a request cut short by leaving the page is simply made again on return.
    if (presets.state !== "loading") return;
    const controller = new AbortController();
    post({ config: JSON.parse(key) as PortfolioConfig }, controller.signal)
      .then((r) => setPresets(loaded(r)))
      .catch(() => {
        if (!controller.signal.aborted)
          setPresets(failed("The stress request failed."));
      });
    return () => controller.abort();
  }, [key, attempt, presets.state, setPresets]);
  useEffect(() => {
    const pending = customRequest;
    // A custom run interrupted by navigation is not left spinning.
    setCustom((c) => (c?.state === "loading" ? null : c));
    return () => pending.current?.abort();
  }, [setCustom]);

  function runCustom() {
    let bounds;
    try {
      bounds = customStressWindow(draft.startDate, draft.endDate, today);
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
        window: { startDate: bounds.startDate, endDate: bounds.endDate },
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
    ...events.map((e) => ({
      value: e.id,
      label: (
        <>
          <span className="ev-name">{SHORT[e.id] ?? e.name}</span>
          <span className="ev-dates">
            {e.startDate ?? e.requestedStartDate} →{" "}
            {e.endDate ?? e.requestedEndDate}
          </span>
          {e.status === "complete" && e.portfolioReturn.available ? (
            <span className={`ev-ret ${tone(e.portfolioReturn) ?? ""}`}>
              {percent(e.portfolioReturn.value)}
            </span>
          ) : (
            <span className="ev-ret ev-flag">
              {e.status === "incomplete_coverage" ? "Incomplete" : "N/A"}
            </span>
          )}
        </>
      ),
    })),
    { value: "custom", label: "Custom window" },
  ];
  const timeline = [
    ...events.map((e) => ({
      id: e.id,
      start: e.startDate ?? e.requestedStartDate,
      end: e.endDate ?? e.requestedEndDate,
    })),
    ...(customEvent
      ? [
          {
            id: "custom",
            start: customEvent.startDate ?? customEvent.requestedStartDate,
            end: customEvent.endDate ?? customEvent.requestedEndDate,
          },
        ]
      : []),
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
        <LoadingState
          label="Loading stress history and running each event…"
          detail="Stress runs on its own request; the sections above are already complete."
          rows={2}
        />
      )}
      {presets.state === "error" && (
        <StatusNotice
          tone={errorState(presets.error.code).tone}
          title={`Stress Lab unavailable · ${errorState(presets.error.code).title}`}
          actions={
            presets.error.code !== "UNQUALIFIED_PROVIDER" && (
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
            )
          }
        >
          <p>{presets.error.message} The rest of the analysis is unaffected.</p>
        </StatusNotice>
      )}
      {presets.state === "done" && (
        <>
          <div className="table-wrap">
            <table className="stress-table stress-overview">
              <caption>
                Historical stress events · target weights re-initialized at each
                event start
              </caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Window (closes)</th>
                  <th scope="col">Portfolio</th>
                  <th scope="col">{config.benchmark}</th>
                  <th scope="col">Active return</th>
                  <th scope="col">Maximum drawdown</th>
                  <th scope="col">Best holding</th>
                  <th scope="col">Worst holding</th>
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
            <Segmented
              className="event-tabs"
              legend="Stress event"
              name="stress-event"
              options={options}
              value={selected}
              onChange={setSelected}
            />
            <StressTimeline
              events={timeline}
              selected={selected}
              today={today}
            />
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
                <LoadingState
                  label="Loading history for the custom window…"
                  rows={1}
                />
              )}
              {custom?.state === "error" && (
                <StatusNotice
                  tone={errorState(custom.error.code).tone}
                  title={errorState(custom.error.code).title}
                >
                  {custom.error.message}
                </StatusNotice>
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
