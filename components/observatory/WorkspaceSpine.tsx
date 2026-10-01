"use client";
import { memo, useMemo } from "react";
import type { BacktestResult } from "@/lib/types/analytics";
import { STRESS_WINDOWS } from "@/config/stressWindows";
import { MarketSpine, type SpineData } from "./MarketSpine";
import { monthlyCandles } from "./geometry";

const dot = (d: string) => d.slice(0, 7).replace("-", ".");

/** The Market Spine for the analysis workspace. The shell keeps one instance
 * mounted across routes, so moving between pages re-assembles the same rail with
 * the page's meaning rather than drawing a new object. */
export const WorkspaceSpine = memo(function WorkspaceSpine({
  result,
  route,
}: {
  result: BacktestResult;
  route: string;
}) {
  const candles = useMemo(
    () =>
      monthlyCandles(
        result.performance.growth.map((p) => ({
          date: p.date,
          value: p.wealth,
        })),
      ),
    [result],
  );
  const relative = useMemo(() => {
    if (!result.benchmark.ok) return [];
    const pc = monthlyCandles(
      result.benchmark.value.points.map((p) => ({
        date: p.date,
        value: p.portfolioWealth,
      })),
    );
    const bc = monthlyCandles(
      result.benchmark.value.points.map((p) => ({
        date: p.date,
        value: p.benchmarkWealth,
      })),
    );
    return pc.slice(1).map((c, i) => ({
      key: c.key,
      p: c.c / c.o - 1,
      b: bc[i + 1] ? bc[i + 1].c / bc[i + 1].o - 1 : 0,
    }));
  }, [result]);
  const window = `${dot(result.initialDate)} — ${dot(result.metadata.effectiveEndDate)}`;
  const obs = `${result.ledger.length.toLocaleString()} obs`;
  let data: SpineData;
  let label: string;
  switch (route) {
    case "benchmark":
      data = {
        kind: "relative",
        marks: relative,
        benchmark: result.config.benchmark,
      };
      label = `Spine / monthly change · portfolio vs ${result.config.benchmark}`;
      break;
    case "risk":
      data = {
        kind: "capital-risk",
        rows: result.riskAnalytics.holdings.map((h) => ({
          ticker: h.ticker,
          weight: h.weight,
          risk: h.percentage.available ? h.percentage.value : null,
        })),
      };
      label = "Spine / capital · risk contribution";
      break;
    case "rolling": {
      const r = result.rollingAnalytics;
      data = {
        kind: "candles",
        candles,
        windows: r.windows.map((w) => ({
          sessions: w,
          total: r.dates.length,
          active: w === r.defaultWindow,
        })),
      };
      label = `Spine / rolling windows ${r.windows.join(" · ")} sessions`;
      break;
    }
    case "stress":
      data = {
        kind: "events",
        events: STRESS_WINDOWS.map((w) => ({
          id: w.id,
          name: w.name,
          start: w.startDate,
          end: w.endDate,
        })),
        selected: null,
        bracket: [result.initialDate, result.metadata.effectiveEndDate],
        today: result.metadata.effectiveEndDate,
      };
      label = "Spine / historical environments · analysis bracketed";
      break;
    case "constructor":
      data = {
        kind: "allocation",
        current: result.config.holdings.map((h) => ({
          ticker: h.ticker,
          weight: h.weight,
        })),
      };
      label = "Spine / current allocation";
      break;
    default:
      data = { kind: "candles", candles };
      label = "Spine / monthly wealth · $10,000";
  }
  return (
    <MarketSpine
      className="ws-spine"
      data={data}
      label={label}
      caption={
        <>
          <b>{window}</b> · {obs}
        </>
      }
    />
  );
});
