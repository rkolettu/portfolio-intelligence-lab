export type GlyphKind =
  | "overview"
  | "performance"
  | "benchmark"
  | "drawdowns"
  | "risk"
  | "diversification"
  | "rolling"
  | "stress"
  | "constructor"
  | "market"
  | "methodology";

/** A 72×20 finance-native mark per section, drawn once with the section's own
 * motif: return bars, paired traces, weighted nodes, a correlation grid, peak and
 * trough markers, a moving window, an event flag, before/after allocation bars,
 * price ticks. Decorative only; the settle animation is CSS on `[data-seen]`. */
export function SectionGlyph({ kind }: { kind: GlyphKind }) {
  const stroke = { stroke: "currentColor", fill: "none", strokeWidth: 1.2 } as const;
  let body;
  switch (kind) {
    case "overview":
      body = [7, 14, 10, 17, 12].map((h, i) => (
        <g key={i} className="g-rise" style={{ ["--i" as string]: i }}>
          <line x1={10 + i * 9} x2={10 + i * 9} y1={10 - h / 2 - 2} y2={10 + h / 2 + 2} {...stroke} opacity="0.5" />
          <rect x={7 + i * 9} y={10 - h / 2 + 2} width="6" height={h - 4} rx="1" fill={i % 2 ? "var(--negative)" : "var(--positive)"} opacity="0.75" />
        </g>
      ));
      break;
    case "performance":
      body = [3, 6, -2, 8, 5, -4, 9, 6, 11].map((v, i) => (
        <rect
          key={i}
          className="g-rise"
          style={{ ["--i" as string]: i }}
          x={4 + i * 7}
          y={v >= 0 ? 12 - v : 12}
          width="4"
          height={Math.abs(v)}
          rx="0.8"
          fill={v >= 0 ? "var(--positive)" : "var(--negative)"}
          opacity={i === 8 ? 1 : 0.6}
        />
      ));
      body.push(<line key="z" x1="2" x2="70" y1="12" y2="12" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />);
      break;
    case "benchmark":
      body = (
        <>
          <path className="g-draw" pathLength={1} d="M3 15 C14 14 18 9 28 10 S44 6 52 5 S62 4 68 3" {...stroke} stroke="var(--series-portfolio)" />
          <path className="g-draw" pathLength={1} d="M3 16 C14 15 20 12 30 12 S44 9 52 9 S62 8 68 7" {...stroke} stroke="var(--series-benchmark)" />
          <circle cx="68" cy="3" r="2" fill="var(--series-portfolio)" />
          <circle cx="68" cy="7" r="2" fill="var(--series-benchmark)" />
        </>
      );
      break;
    case "drawdowns":
      body = (
        <>
          <path className="g-draw" pathLength={1} d="M3 3 L14 4 L24 9 L30 8 L38 16 L46 12 L56 6 L68 3" {...stroke} />
          <line x1="3" x2="68" y1="3" y2="3" stroke="currentColor" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.4" />
          <circle cx="3" cy="3" r="2" fill="var(--text)" />
          <circle cx="38" cy="16" r="2.2" fill="var(--negative)" />
          <circle cx="68" cy="3" r="2" fill="none" stroke="var(--positive)" strokeWidth="1.2" />
        </>
      );
      break;
    case "risk":
      body = (
        <>
          <line x1="16" y1="11" x2="36" y2="8" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
          <line x1="36" y1="8" x2="52" y2="13" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
          <line x1="16" y1="11" x2="52" y2="13" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
          <circle className="g-pop" cx="16" cy="11" r="6.5" fill="var(--series-portfolio)" opacity="0.8" />
          <circle className="g-pop" style={{ ["--i" as string]: 1 }} cx="36" cy="8" r="4" fill="var(--series-capital)" opacity="0.85" />
          <circle className="g-pop" style={{ ["--i" as string]: 2 }} cx="52" cy="13" r="2.6" fill="var(--series-capital)" opacity="0.7" />
          <circle className="g-pop" style={{ ["--i" as string]: 3 }} cx="63" cy="7" r="1.8" fill="var(--series-capital)" opacity="0.5" />
        </>
      );
      break;
    case "diversification":
      body = Array.from({ length: 12 }, (_, k) => {
        const c = k % 4;
        const r = Math.floor(k / 4);
        const hot = c === r || c === r + 1 ? 0.95 : 0.3;
        return (
          <circle
            key={k}
            className="g-pop"
            style={{ ["--i" as string]: k }}
            cx={12 + c * 15}
            cy={4 + r * 6}
            r="2.1"
            fill={hot > 0.5 ? "var(--negative)" : "var(--series-portfolio)"}
            opacity={hot > 0.5 ? 0.85 : 0.5}
          />
        );
      });
      break;
    case "rolling":
      body = (
        <>
          {Array.from({ length: 13 }, (_, i) => (
            <line key={i} x1={4 + i * 5.4} x2={4 + i * 5.4} y1={i % 4 ? 14 : 12} y2="17" stroke="currentColor" strokeWidth="0.9" opacity={i % 4 ? 0.35 : 0.7} />
          ))}
          <path d="M4 10 C12 4 18 12 26 8 S40 4 48 9 S60 6 68 8" {...stroke} stroke="var(--series-portfolio)" opacity="0.85" />
          <rect className="g-window" x="30" y="2" width="20" height="13" rx="2" fill="var(--accent)" opacity="0.14" stroke="var(--accent)" strokeWidth="0.9" />
        </>
      );
      break;
    case "stress":
      body = (
        <>
          <line x1="30" x2="30" y1="1" y2="19" stroke="var(--warning)" strokeWidth="1" strokeDasharray="2 1.5" />
          <path d="M30 2 L40 2 L37.5 5 L40 8 L30 8" fill="var(--warning)" opacity="0.85" />
          <path className="g-draw" pathLength={1} d="M3 9 L14 10 L22 9 L30 12 L36 19 L42 15 L50 11 L58 8 L68 6" {...stroke} stroke="var(--negative)" />
          <circle cx="36" cy="19" r="2" fill="var(--negative)" />
        </>
      );
      break;
    case "constructor":
      body = (
        <>
          {[26, 18, 12, 8].map((w, i) => (
            <rect key={`a${i}`} x={4 + [0, 26, 44, 56][i]} y="3" width={w - 2} height="4" rx="1" fill="var(--series-portfolio)" opacity="0.8" />
          ))}
          {[14, 10, 30, 16].map((w, i) => (
            <rect key={`b${i}`} className="g-slide" style={{ ["--i" as string]: i }} x={4 + [0, 14, 24, 54][i]} y="13" width={w - 2} height="4" rx="1" fill="var(--series-proposed)" opacity="0.85" />
          ))}
          {[8, 26, 44, 58].map((x) => (
            <line key={x} x1={x} x2={x + 2} y1="8" y2="12" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
          ))}
        </>
      );
      break;
    case "market":
      body = (
        <>
          {Array.from({ length: 22 }, (_, i) => (
            <line key={i} x1={4 + i * 3} x2={4 + i * 3} y1={10 - (i % 5 === 0 ? 7 : 3)} y2={10 + (i % 5 === 0 ? 7 : 3)} stroke="currentColor" strokeWidth="0.9" opacity={i % 5 === 0 ? 0.7 : 0.35} />
          ))}
          <circle cx="49" cy="10" r="2.2" fill="var(--accent)" className="g-pop" />
        </>
      );
      break;
    default:
      body = Array.from({ length: 15 }, (_, k) => (
        <circle key={k} className="g-pop" style={{ ["--i" as string]: k }} cx={10 + (k % 5) * 13} cy={4 + Math.floor(k / 5) * 6} r="1.6" fill="currentColor" opacity={0.25 + ((k * 37) % 5) * 0.12} />
      ));
  }
  return (
    <svg className="glyph" viewBox="0 0 72 20" aria-hidden focusable="false">
      {body}
    </svg>
  );
}
