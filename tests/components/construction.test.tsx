// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConstructionSection } from "@/components/construction/ConstructionSection";
import { runConstruction } from "@/lib/backtest/construction";
import { toDraft, type Draft } from "@/lib/state/portfolioReducer";
import type { ConstructionAnalytics } from "@/lib/types/construction";
import {
  constructionConfig,
  constructionInput,
} from "../fixtures/construction";

const today = "2024-06-03";
const result = runConstruction(constructionInput());
const approx = runConstruction(
  constructionInput({
    constraints: [
      { ticker: "AAA", minWeight: 0.5, maxWeight: 0.5, required: true },
      { ticker: "BBB", minWeight: 0.3, maxWeight: 0.3, required: true },
      { ticker: "CCC", minWeight: 0, maxWeight: 0, required: false },
    ],
  }),
);
function stub(body: ConstructionAnalytics) {
  const calls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true, value: body }) } as Response;
    }),
  );
  return calls;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function view(onApply = vi.fn()) {
  const builder: Draft = toDraft(constructionConfig);
  render(
    <ConstructionSection
      config={constructionConfig}
      analysisHash="hash-1"
      today={today}
      builder={builder}
      onApply={onApply}
    />,
  );
  return { onApply, builder };
}
const generate = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Generate allocation" }));
  await screen.findByRole("table", { name: /Proposed Allocation/ });
};

describe("ConstructionSection", () => {
  it("lists the whole eligible universe, zero-weight candidates included", () => {
    stub(result);
    view();
    for (const t of ["AAA", "BBB", "CCC"])
      expect(screen.getByLabelText(`Minimum weight ${t}`)).toBeTruthy();
    expect(screen.getByLabelText(/Fixed at current/)).toHaveProperty(
      "checked",
      true,
    );
  });

  it("shows infeasible bounds before any request and disables generation", () => {
    const calls = stub(result);
    view();
    for (const t of ["AAA", "BBB", "CCC"])
      fireEvent.change(screen.getByLabelText(`Maximum weight ${t}`), {
        target: { value: "20" },
      });
    expect(screen.getByText(/60\.00%.*80\.00%/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Generate allocation" }),
    ).toHaveProperty("disabled", true);
    expect(calls).toHaveLength(0);
  });

  it("generates all methods once and switches the viewed proposal without re-solving", async () => {
    const calls = stub(result);
    view();
    await generate();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      cash: { mode: "current" },
      constraints: expect.any(Array),
    });
    expect(
      screen.getByRole("heading", { name: "Minimum-Variance Allocation" }),
    ).toBeTruthy();
    expect(screen.getByText("Estimated One-Way Turnover")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("radio", { name: "Equal Risk Contribution" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Equal-Risk-Contribution Allocation",
      }),
    ).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(screen.getByRole("note").textContent).toMatch(
      /^In-Sample Retrospective Analysis/,
    );
    expect(
      screen.getByRole("table", { name: /Stress comparison/ }),
    ).toBeTruthy();
  });

  it("labels a Constrained Risk-Balance Approximation honestly", async () => {
    stub(approx);
    view();
    await generate();
    fireEvent.click(
      screen.getByRole("radio", { name: "Equal Risk Contribution" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Constrained Risk-Balance Approximation",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Exact equal risk contribution is infeasible under the selected constraints/,
      ),
    ).toBeTruthy();
  });

  it("marks a proposal stale when inputs change and blocks Apply", async () => {
    stub(result);
    const { onApply } = view();
    await generate();
    fireEvent.change(screen.getByLabelText("Maximum weight AAA"), {
      target: { value: "90" },
    });
    expect(
      screen.getByText(/inputs changed since this proposal was generated/i),
    ).toBeTruthy();
    const apply = screen.getByRole("button", {
      name: /Apply proposed weights/,
    });
    expect(apply).toHaveProperty("disabled", true);
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("disables generation while the builder differs from the analyzed portfolio", () => {
    const calls = stub(result);
    const builder = { ...toDraft(constructionConfig), benchmark: "SPY" };
    render(
      <ConstructionSection
        config={constructionConfig}
        analysisHash="hash-1"
        today={today}
        builder={builder}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/The builder has changed since this analysis/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Generate allocation" }),
    ).toHaveProperty("disabled", true);
    expect(calls).toHaveLength(0);
  });

  it("marks a proposal stale when the builder changes while the request is outstanding", async () => {
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const onApply = vi.fn();
    const props = {
      config: constructionConfig,
      analysisHash: "hash-1",
      today,
      onApply,
    };
    const { rerender } = render(
      <ConstructionSection {...props} builder={toDraft(constructionConfig)} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate allocation" }),
    );
    // The user edits a weight in the builder while construction is running.
    const edited = toDraft(constructionConfig);
    edited.holdings = edited.holdings.map((h) =>
      h.ticker === "AAA"
        ? { ...h, weight: "45" }
        : h.ticker === "BBB"
          ? { ...h, weight: "35" }
          : h,
    );
    rerender(<ConstructionSection {...props} builder={edited} />);
    release({ json: async () => ({ ok: true, value: result }) });
    await screen.findByRole("table", { name: /Proposed Allocation/ });
    expect(
      screen.getByText(/Inputs changed since this proposal was generated/),
    ).toBeTruthy();
    const apply = screen.getByRole("button", {
      name: /Apply proposed weights/,
    });
    expect(apply).toHaveProperty("disabled", true);
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("blocks Apply after a builder edit made once the proposal exists", async () => {
    stub(result);
    const onApply = vi.fn();
    const props = {
      config: constructionConfig,
      analysisHash: "hash-1",
      today,
      onApply,
    };
    const { rerender } = render(
      <ConstructionSection {...props} builder={toDraft(constructionConfig)} />,
    );
    await generate();
    rerender(
      <ConstructionSection
        {...props}
        builder={{
          ...toDraft(constructionConfig),
          requestedStartDate: "2023-02-01",
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Apply proposed weights/ }),
    ).toHaveProperty("disabled", true);
  });

  it("applies full-precision weights through the revalidating Apply", async () => {
    stub(result);
    const { onApply, builder } = view();
    const before = JSON.stringify(builder);
    await generate();
    fireEvent.click(
      screen.getByRole("button", { name: /Apply proposed weights/ }),
    );
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const applied = onApply.mock.calls[0][0] as Draft;
    const mv = result.proposals.find((p) => p.method === "minimum_variance")!;
    const aaa = applied.holdings.find((h) => h.ticker === "AAA")!;
    expect(
      Math.abs(
        Number(aaa.weight) / 100 -
          mv.weights!.find((w) => w.ticker === "AAA")!.weight,
      ),
    ).toBeLessThan(1e-15);
    expect(JSON.stringify(builder)).toBe(before);
  });

  it("puts solver and covariance diagnostics in an expandable panel", async () => {
    stub(result);
    view();
    await generate();
    const panel = screen
      .getByText(/Solver & covariance diagnostics/)
      .closest("details")!;
    expect(within(panel).getByText(/Ledoit–Wolf/)).toBeTruthy();
    expect(
      within(panel).getByText(
        "Stationarity (projected gradient) / KKT residual",
      ),
    ).toBeTruthy();
    expect(within(panel).getByText(/Tie rule/)).toBeTruthy();
  });

  it("carries the required disclaimer and never uses recommendation language", async () => {
    stub(result);
    const { container } = render(<div />);
    view();
    await generate();
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "Portfolio allocations shown are mathematical outputs based on the selected inputs, assumptions, and constraints, not personalized recommendations.",
    );
    for (const banned of [
      /Recommended Portfolio/i,
      /Optimal Portfolio for You/i,
      /Best Allocation/i,
      /You Should Buy/i,
      /You Should Sell/i,
      /Best Portfolio/i,
      /Optimal for You/i,
    ])
      expect(text).not.toMatch(banned);
    expect(container).toBeTruthy();
  });
});
