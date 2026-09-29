import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui/quality";

/** The one warning/error/info surface: a toned left rule, a short title, the exact
 * reason and optional recovery actions. Errors are announced as alerts; warnings
 * and information as polite status updates, unless `role` overrides it. */
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
      {title && <p className="status-title">{title}</p>}
      {children && <div className="status-body">{children}</div>}
      {actions && <div className="actions status-actions">{actions}</div>}
    </div>
  );
}
