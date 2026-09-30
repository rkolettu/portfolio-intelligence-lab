import type { Metadata } from "next";
import { RollingPage } from "@/components/pages/RollingPage";

export const metadata: Metadata = { title: "Rolling analytics" };

export default function Page() {
  return <RollingPage />;
}
