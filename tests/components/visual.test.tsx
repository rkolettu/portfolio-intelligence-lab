// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { CapitalVsRisk } from "@/components/risk/CapitalVsRisk";
import { CorrelationHeatmap } from "@/components/risk/CorrelationHeatmap";
import { AllocationStrip } from "@/components/ui/AllocationStrip";
import { HoldingFocusProvider } from "@/components/ui/HoldingFocus";
import { Segmented } from "@/components/ui/Segmented";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Unavailable } from "@/components/ui/StatusNotice";
import { BetaMarker, PairDots, Sparkline } from "@/components/ui/motifs";
import type { HoldingRisk, Metric } from "@/lib/types/analytics";

afterEach(cleanup);

const sample = {
  startDate: "2024-01-02",
  endDate: "2024-06-28",
  returnCount: 100,
  intervalSetId: "x",
  excludedIntervalCount: 0,
  excludedReasons: [],
};
const m = (value: number): Metric => ({ available: true, value, sample });
const holding = (
  ticker: string,
  weight: number,
  pcr: number,
  riskless = false,
): HoldingRisk => ({
  ticker,
  weight,
  riskless,
  volatility: m(0.2),
  beta: m(1),
  marginal: m(0.1),
  component: m(0.05),
  percentage: m(pcr),
});
const holdings = [
  holding("AAA", 0.4, 0.516),
  holding("HEDGE", 0.2, -0.05),
  holding("CASH", 0.4, 0, true),
];

function Harness() {
  const [v, set] = useState("a");
  return (
    <Segmented
      legend="Pick"
      name="pick"
      value={v}
      onChange={set}
      options={[
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Gamma", disabled: true },
      ]}
    />
  );
}

it("segmented control is a native radio group with one selected label", () => {
  render(<Harness />);
  expect(screen.getByRole("radio", { name: "Alpha" })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.getByRole("radio", { name: "Gamma" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
  expect(
    screen.getByRole("radio", { name: "Beta" }).closest("label")!.className,
  ).toBe("selected");
  expect(
    screen.getByRole("radio", { name: "Alpha" }).closest("label")!.className,
  ).toBe("");
});

it("allocation strip resolves at 100%, shows an open track under and a hatch over", () => {
  const render100 = (weights: number[]) =>
    render(
      <AllocationStrip
        holdings={weights.map((weight, i) => ({ ticker: `T${i}`, weight }))}
        format={(w) => `${w}%`}
      />,
    ).container.querySelector(".alloc-strip")!;
  expect(render100([60, 40]).getAttribute("data-state")).toBe("ok");
  cleanup();
  const under = render100([60, 30]);
  expect(under.getAttribute("data-state")).toBe("open");
  expect(under.querySelector(".alloc-open")).not.toBeNull();
  cleanup();
  const over = render100([60, 60]);
  expect(over.getAttribute("data-state")).toBe("over");
  expect(over.querySelector(".alloc-over")).not.toBeNull();
  cleanup();
  const seg = render100([50, 50]).querySelectorAll<HTMLElement>(".alloc-seg");
  expect(seg[0].getAttribute("data-tip")).toBe("T0 · 50%");
});

it("capital vs risk keeps the default overlay geometry and morphs on the view control", () => {
  const { container } = render(<CapitalVsRisk holdings={holdings} />);
  const rows = container.querySelector<HTMLElement>(".cr-rows")!;
  expect(rows.dataset.view).toBe("both");
  const row = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith("HEDGE"))!;
  // Overlay: the thin risk bar keeps its zero-anchored, left-extending geometry.
  const risk = row.querySelector<HTMLElement>(".cr-risk")!;
  expect(risk.classList.contains("cr-negative")).toBe(true);
  expect(row.textContent).toContain("hedge");
  const aaa = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith("AAA"))!;
  const capitalWidth = aaa.querySelector<HTMLElement>(".cr-main")!.style.width;
  fireEvent.click(screen.getByRole("radio", { name: "Risk" }));
  expect(rows.dataset.view).toBe("risk");
  // The one main bar now spans the risk value; the capital value becomes the ghost.
  const riskWidth = aaa.querySelector<HTMLElement>(".cr-main")!.style.width;
  expect(parseFloat(riskWidth)).toBeGreaterThan(parseFloat(capitalWidth));
  expect(aaa.querySelector<HTMLElement>(".cr-ghost")!.style.width).toBe(
    capitalWidth,
  );
  // The difference shown is risk − capital, in percentage points.
  expect(aaa.querySelector(".cr-v-delta")!.textContent).toBe("+11.60 pp");
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("hovering a holding dims the others and lights the heatmap row and column", () => {
  const matrix = [
    [1, 0.5, 0.1],
    [0.5, 1, -0.2],
    [0.1, -0.2, 1],
  ];
  const { container } = render(
    <HoldingFocusProvider>
      <CapitalVsRisk holdings={holdings} />
      <CorrelationHeatmap
        tickers={["AAA", "BBB", "CCC"]}
        matrix={matrix}
        highest={{ a: "AAA", b: "BBB", correlation: 0.5 }}
        lowest={{ a: "BBB", b: "CCC", correlation: -0.2 }}
        undefinedTickers={[]}
      />
    </HoldingFocusProvider>,
  );
  const rows = container.querySelectorAll<HTMLElement>(".cr-row:not(.cr-axis)");
  expect(rows[0].dataset.focus).toBeUndefined();
  fireEvent.pointerEnter(rows[0]);
  expect(rows[0].dataset.focus).toBe("on");
  expect(rows[1].dataset.focus).toBe("dim");
  fireEvent.pointerLeave(rows[0]);
  expect(rows[1].dataset.focus).toBeUndefined();
  // Heatmap: entering a cell lights its row and column headers and opens the panel.
  const cells = container.querySelectorAll<HTMLElement>(".heatmap tbody td");
  fireEvent.mouseEnter(cells[1]);
  expect(
    container.querySelectorAll(".heatmap th[data-on]"),
  ).toHaveLength(2);
  expect(container.querySelectorAll(".heatmap td[data-cell]")).toHaveLength(1);
  expect(container.querySelectorAll(".heatmap td[data-line]")).toHaveLength(5);
  expect(container.querySelector(".heat-tip")).not.toBeNull();
  expect(screen.getByText(/^AAA \/ BBB: 0\.5000$/)).toBeTruthy();
});

it("section headings keep their numbered eyebrow and add a subtitle and motif", () => {
  const { container } = render(
    <SectionHeading
      number={4}
      eyebrow="Drawdowns"
      id="drawdowns-title"
      title="Peak-to-trough losses."
      subtitle="How deep."
      glyph="drawdowns"
    />,
  );
  expect(container.querySelector(".eyebrow")!.textContent).toBe(
    "04 / Drawdowns",
  );
  expect(screen.getByRole("heading", { name: "Peak-to-trough losses." })).toBeTruthy();
  expect(container.querySelector("svg.glyph")!.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

it("micro-visualizations are decorative: hidden from assistive tech and text-free", () => {
  const { container } = render(
    <div>
      <Sparkline values={[1, 2, 3, 2, 4]} marker="last" />
      <BetaMarker beta={0.73} />
      <PairDots rho={0.95} />
    </div>,
  );
  const svgs = container.querySelectorAll("svg");
  expect(svgs).toHaveLength(3);
  svgs.forEach((svg) => {
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.textContent).toBe("");
  });
});

it("unavailable states are quiet bordered panels, not alerts", () => {
  render(<Unavailable kind="history" title="Not enough history">Only 39 sessions.</Unavailable>);
  expect(screen.getByText("Not enough history")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Only 39 sessions.")).toBeTruthy();
});
