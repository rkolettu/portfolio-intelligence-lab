import type { Metadata } from "next";
import { BenchmarkPage } from "@/components/pages/BenchmarkPage";

export const metadata: Metadata = { title: "Benchmark" };

export default function Page() {
  return <BenchmarkPage />;
}
