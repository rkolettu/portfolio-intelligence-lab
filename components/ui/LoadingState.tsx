/** Subtle skeleton plus one honest status line. It names the work actually in
 * flight (no fake multi-stage progress) and never hides already-loaded sections. */
export function LoadingState({
  label,
  detail,
  rows = 3,
}: {
  label: string;
  detail?: string;
  rows?: number;
}) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <p className="loading-label">
        <span className="loading-dot" aria-hidden />
        {label}
      </p>
      {detail && <p className="hint">{detail}</p>}
      <div className="skeleton" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} style={{ width: `${92 - i * 17}%` }} />
        ))}
      </div>
    </div>
  );
}
