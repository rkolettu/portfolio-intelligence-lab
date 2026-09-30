import type { Metadata } from "next";
import { RiskPage } from "@/components/pages/RiskPage";

export const metadata: Metadata = { title: "Risk" };

export default function Page() {
  return <RiskPage />;
}
