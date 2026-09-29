import { construct } from "@/lib/server/construction";
import { handleJson } from "@/lib/server/route";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleJson(request, construct);
}
