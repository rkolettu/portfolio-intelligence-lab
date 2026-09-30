import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui/quality";
import { ToneIcon, UnavailableIcon, type UnavailableKind } from "./icons";

/** The one warning/error/info surface: a toned left rule, an icon, a short title,
 * the exact reason and optional recovery actions. Errors are announced as alerts;
 * warnings and information as polite status updates, unless `role` overrides it. */
export function StatusNotice({
  tone,
  title,
  children,
  actions,
  role,
  label,
}: {
  tone: Tone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status" | "note";
  label?: string;
}) {
  return (
    <div
      className={`status-notice tone-${tone}`}
      role={role ?? (tone === "error" ? "alert" : "status")}
      aria-label={label}
    >
      <ToneIcon tone={tone} className="notice-icon" />
      {title && <p className="status-title">{title}</p>}
      {children && <div className="status-body">{children}</div>}
      {actions && <div className="actions status-actions">{actions}</div>}
    </div>
  );
}

/** Inline "this analytic is intentionally absent" panel: a quiet dashed frame with
 * an icon, a short title and the exact reason. No role: it is content, not an alert. */
export function Unavailable({
  kind = "data",
  title,
  children,
}: {
  kind?: UnavailableKind;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="unavailable">
      <UnavailableIcon kind={kind} />
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}
