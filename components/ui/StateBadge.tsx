import type { StateLabel } from "@/lib/ui/quality";

/** Compact data-quality badge. The text carries the meaning; color only reinforces it. */
export function StateBadge({ state }: { state: StateLabel }) {
  return (
    <span className={`tag state-badge tone-${state.tone}`}>{state.label}</span>
  );
}
