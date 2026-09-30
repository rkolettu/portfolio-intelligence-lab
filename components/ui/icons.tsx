import type { Tone } from "@/lib/ui/quality";

const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
} as const;

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  switch (tone) {
    case "warning":
      return (
        <svg {...base} className={className}>
          <path d="M8 2.2 14.2 13H1.8L8 2.2Z" />
          <path d="M8 6.5v3.2M8 11.4v.1" />
        </svg>
      );
    case "error":
      return (
        <svg {...base} className={className}>
          <circle cx="8" cy="8" r="6" />
          <path d="m5.7 5.7 4.6 4.6M10.3 5.7l-4.6 4.6" />
        </svg>
      );
    case "ok":
      return (
        <svg {...base} className={className}>
          <circle cx="8" cy="8" r="6" />
          <path d="m5.3 8.2 1.9 1.9 3.5-3.9" />
        </svg>
      );
    default:
      return (
        <svg {...base} className={className}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.2v3.6M8 5v.1" />
        </svg>
      );
  }
}

export type UnavailableKind = "history" | "data" | "solver" | "stale" | "matrix";

/** Bordered-panel icons for states where a result is intentionally absent. */
export function UnavailableIcon({ kind }: { kind: UnavailableKind }) {
  switch (kind) {
    case "history":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="5.6" />
          <path d="M8 4.8V8l2.2 1.4" />
        </svg>
      );
    case "solver":
      return (
        <svg {...base}>
          <path d="M2.5 12.5 6 7l2.5 3L13.5 3.5" />
          <path d="M2 14h12" strokeDasharray="1.5 2.2" />
        </svg>
      );
    case "stale":
      return (
        <svg {...base}>
          <path d="M13.3 8A5.3 5.3 0 1 1 11.7 4.2" />
          <path d="M13.5 2.5v3h-3" />
        </svg>
      );
    case "matrix":
      return (
        <svg {...base}>
          <rect x="2.5" y="2.5" width="4.2" height="4.2" rx=".8" />
          <rect x="9.3" y="2.5" width="4.2" height="4.2" rx=".8" strokeDasharray="1.6 1.8" />
          <rect x="2.5" y="9.3" width="4.2" height="4.2" rx=".8" strokeDasharray="1.6 1.8" />
          <rect x="9.3" y="9.3" width="4.2" height="4.2" rx=".8" />
        </svg>
      );
    default:
      return (
        <svg {...base}>
          <path d="M2.5 13V3M2.5 13h11" />
          <path d="m5 10 2.5-3 2 1.6 3-4" strokeDasharray="1.8 2" />
        </svg>
      );
  }
}
