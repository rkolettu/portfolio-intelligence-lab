"use client";
import { MethodologyDrawer } from "@/components/methodology/MethodologyDrawer";
import { useWorkspace } from "./WorkspaceProvider";

/** The one methodology drawer, available on every page for the displayed result. */
export function MethodologyHost() {
  const { result } = useWorkspace();
  return <MethodologyDrawer result={result} />;
}
