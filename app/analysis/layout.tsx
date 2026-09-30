import { AnalysisShell } from "@/components/workspace/AnalysisShell";

export default function AnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AnalysisShell>{children}</AnalysisShell>;
}
