"use client";
import { memo, type ReactNode } from "react";
import type { BacktestResult } from "@/lib/types/analytics";
import {
  useWorkspace,
  type ResultStatus,
} from "@/components/workspace/WorkspaceProvider";
import { StatusNotice } from "@/components/ui/StatusNotice";

export function ResultTag({ status }: { status: ResultStatus }) {
  return (
    <span className="tag">
      {status === "current" ? "Historical data" : "Last successful analysis"}
    </span>
  );
}

/** Notice shown when the displayed result no longer matches the builder draft. */
export function StaleResultNotice({ status }: { status: ResultStatus }) {
  if (status === "current") return null;
  return (
    <StatusNotice tone="info" role="status">
      These results belong to the last submitted allocation.{" "}
      {status === "changed"
        ? "Your edited draft has not been analyzed."
        : "A new analysis is pending."}
    </StatusNotice>
  );
}

/** Renders `Body` with the analysis in memory. The body is memoized on the result
 * and status, so context updates elsewhere (current quotes arriving, builder
 * edits) never re-render the page's charts. The analysis shell guarantees a result
 * before any page renders. */
export function withAnalysis(
  Body: (props: { result: BacktestResult; status: ResultStatus }) => ReactNode,
) {
  const Memo = memo(Body);
  return function AnalysisPage() {
    const { result, status } = useWorkspace();
    return result ? <Memo result={result} status={status} /> : null;
  };
}
