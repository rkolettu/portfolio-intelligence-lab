"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

type Holding = { ticker: string; weight: number };

const CENTER = { x: 360, y: 260 };
const TAU = Math.PI * 2;

/** A deterministic map of the entered portfolio. Radius encodes capital and the
 * angular position is stable for a ticker, so this is a view of the allocation,
 * not decorative randomness. */
function tickerAngle(ticker: string, index: number) {
  const hash = [...ticker].reduce((value, char) => value * 31 + char.charCodeAt(0), 17);
  return ((hash % 360) / 360) * TAU + index * 0.36;
}

function PortfolioInstrument({ holdings }: { holdings: Holding[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const nodes = useMemo(() => {
    const live = holdings
      .filter((holding) => holding.ticker && holding.weight > 0)
      .map((holding) => ({ ...holding, ticker: holding.ticker.toUpperCase() }));
    const total = live.reduce((sum, holding) => sum + holding.weight, 0) || 1;

    return live.map((holding, index) => {
      const share = holding.weight / total;
      const angle = tickerAngle(holding.ticker, index);
      const orbit = 92 + index * 24;
      return {
        ...holding,
        share,
        x: CENTER.x + Math.cos(angle) * orbit * 1.32,
        y: CENTER.y + Math.sin(angle) * orbit * 0.72,
        radius: 8 + Math.sqrt(share) * 54,
      };
    });
  }, [holdings]);

  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    const element = root.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 720;
    const y = ((event.clientY - bounds.top) / bounds.height) * 520;
    element.style.setProperty("--px", `${((x / 720) * 100).toFixed(2)}%`);
    element.style.setProperty("--py", `${((y / 520) * 100).toFixed(2)}%`);
    element.style.setProperty("--shift-x", ((x / 720 - 0.5) * 2).toFixed(3));
    element.style.setProperty("--shift-y", ((y / 520 - 0.5) * 2).toFixed(3));
    let nearest: number | null = null;
    let distance = 46;
    nodes.forEach((node, index) => {
      const candidate = Math.hypot(node.x - x, node.y - y) - node.radius;
      if (candidate < distance) {
        nearest = index;
        distance = candidate;
      }
    });
    setActive(nearest);
  };

  return (
    <div
      className="portfolio-instrument"
      ref={root}
      onPointerMove={pointer}
      onPointerDown={pointer}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        setActive(null);
        root.current?.style.setProperty("--shift-x", "0");
        root.current?.style.setProperty("--shift-y", "0");
      }}
      data-inspecting={active === null ? undefined : ""}
      aria-label="Portfolio allocation constellation. Node area represents capital weight."
      role="img"
    >
      <div className="instrument-coordinate micro" aria-hidden>
        ALLOCATION FIELD / 100.00
      </div>
      <svg viewBox="0 0 720 520" focusable="false" aria-hidden>
        <defs>
          <radialGradient id="field-light">
            <stop offset="0" stopColor="var(--accent)" stopOpacity=".12" />
            <stop offset=".62" stopColor="var(--accent)" stopOpacity=".025" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>
        <ellipse className="field-light" cx="360" cy="260" rx="310" ry="215" fill="url(#field-light)" />
        {[92, 140, 188, 236].map((radius) => (
          <ellipse key={radius} className="orbit" cx="360" cy="260" rx={radius * 1.32} ry={radius * .72} />
        ))}
        <path className="instrument-axis" d="M18 260H702M360 18V502" />
        <g className="portfolio-core">
          <circle cx="360" cy="260" r="3" />
          <circle cx="360" cy="260" r="12" />
          <path d="M338 260h-13m57 0h13M360 238v-13m0 57v13" />
        </g>
        {nodes.map((node, index) => (
          <g
            className="allocation-node"
            data-active={active === index ? "" : undefined}
            data-muted={active !== null && active !== index ? "" : undefined}
            key={`${node.ticker}-${index}`}
            style={{ "--node-index": index } as CSSProperties}
          >
            <line x1="360" y1="260" x2={node.x} y2={node.y} />
            <circle className="node-aura" cx={node.x} cy={node.y} r={node.radius + 11} />
            <circle className="node-body" cx={node.x} cy={node.y} r={node.radius} />
            <circle className="node-ring" cx={node.x} cy={node.y} r={node.radius + 5} />
            <text className="node-ticker" x={node.x} y={node.y + 3} textAnchor="middle">{node.ticker}</text>
            <text className="node-weight" x={node.x} y={node.y + node.radius + 18} textAnchor="middle">
              {(node.share * 100).toFixed(2)}%
            </text>
          </g>
        ))}
        <g className="field-scale">
          <text x="18" y="250">−1.00</text><text x="684" y="250">+1.00</text>
          <text x="370" y="28">CAPITAL / RELATIVE MASS</text>
          <text x="370" y="498">HOLDINGS / {nodes.length.toString().padStart(2, "0")}</text>
        </g>
      </svg>
      <div className="inspection-lens" aria-hidden />
      <div className="instrument-readout" aria-live="polite">
        <span>{active === null ? "MOVE TO INSPECT" : nodes[active].ticker}</span>
        <strong>{active === null ? "CAPITAL MAP" : `${(nodes[active].share * 100).toFixed(2)}%`}</strong>
      </div>
    </div>
  );
}

export function Hero({ holdings, onAnalyze, onBuild }: {
  holdings: Holding[];
  onAnalyze: () => void;
  onBuild: () => void;
}) {
  const live = holdings.filter((holding) => holding.ticker && holding.weight > 0);
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-index micro" aria-hidden>PI / CL — 001</div>
      <div className="hero-heading">
        <p className="hero-kicker"><span aria-hidden /> Financial observatory</p>
        <h1 id="hero-title"><span>Portfolio</span><span>Intelligence</span></h1>
      </div>
      <div className="hero-observatory">
        <PortfolioInstrument holdings={holdings} />
      </div>
      <div className="hero-context">
        <p>Understand the architecture of a portfolio—where capital sits, where risk originates, and how both change through time.</p>
        <div className="actions hero-actions">
          <button type="button" className="primary" aria-label="Analyze Sample Portfolio" onClick={onAnalyze}>Analyze sample <span aria-hidden>↗</span></button>
          <button type="button" className="secondary" onClick={onBuild}>Construct portfolio</button>
        </div>
      </div>
      <div className="market-spine" aria-label="Sample portfolio allocation">
        <span className="micro">CAPITAL / 100</span>
        <div className="market-spine-track" aria-hidden>
          {live.map((holding, index) => (
            <i key={`${holding.ticker}-${index}`} style={{ flexGrow: Math.max(holding.weight, .2) } as CSSProperties} />
          ))}
        </div>
        <span className="micro">{live.length.toString().padStart(2, "0")} POSITIONS</span>
      </div>
      <a className="hero-scroll micro" href="#builder">ENTER WORKSPACE <span aria-hidden>↓</span></a>
    </section>
  );
}
