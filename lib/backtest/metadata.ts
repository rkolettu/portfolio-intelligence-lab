import { createHash } from "node:crypto";
import type { Sample } from "@/lib/types/analytics";
import type { Session } from "@/lib/types/data";
export function snapshotHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function sampleMetadata(
  sessions: Session[],
  excludedIntervalCount = 0,
  excludedReasons: string[] = [],
): Sample {
  return {
    startDate: sessions[0].date,
    endDate: sessions.at(-1)!.date,
    returnCount: sessions.length - 1,
    intervalSetId: snapshotHash(
      sessions
        .map((s, i) => (i ? [sessions[i - 1].date, s.date] : null))
        .slice(1),
    ),
    excludedIntervalCount,
    excludedReasons,
  };
}
