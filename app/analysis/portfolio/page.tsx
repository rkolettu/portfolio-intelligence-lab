import type { Metadata } from "next";
import { PortfolioPage } from "@/components/pages/PortfolioPage";
export const metadata: Metadata = { title: "Your Portfolio" };
export default function Page() {
  return <PortfolioPage />;
}
