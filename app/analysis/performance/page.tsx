import type { Metadata } from "next";
import { PerformancePage } from "@/components/pages/PerformancePage";

export const metadata: Metadata = { title: "Performance" };

export default function Page() {
  return <PerformancePage />;
}
