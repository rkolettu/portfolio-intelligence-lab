import type { Metadata } from "next";
import { StressPage } from "@/components/pages/StressPage";

export const metadata: Metadata = { title: "Stress Lab" };

export default function Page() {
  return <StressPage />;
}
