import type { Metadata } from "next";
import { ConstructorPage } from "@/components/pages/ConstructorPage";

export const metadata: Metadata = { title: "Portfolio Constructor" };

export default function Page() {
  return <ConstructorPage />;
}
