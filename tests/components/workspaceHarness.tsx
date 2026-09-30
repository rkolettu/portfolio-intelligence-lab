import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { Landing } from "@/components/workspace/Landing";
import { AnalysisShell } from "@/components/workspace/AnalysisShell";
import { OverviewPage } from "@/components/pages/OverviewPage";

/** The real workspace provider with the landing page and the analysis shell
 * (Overview) mounted side by side: the state they share is what route changes
 * preserve. Tests mock next/navigation, so navigation itself is a no-op here. */
export function PortfolioWorkspace({ today }: { today: string }) {
  return (
    <WorkspaceProvider today={today}>
      <Landing />
      <AnalysisShell>
        <OverviewPage />
      </AnalysisShell>
    </WorkspaceProvider>
  );
}
