import { PortfolioWorkspace } from "@/components/portfolio/PortfolioWorkspace";
import { MethodologyButton } from "@/components/methodology/MethodologyDrawer";
import { marketDate } from "@/lib/utils/dates";
export const dynamic = "force-dynamic";
const SECTIONS: [string, string][] = [
  ["#overview-title", "Overview"],
  ["#performance-title", "Performance"],
  ["#benchmark-title", "Benchmark"],
  ["#drawdowns-title", "Drawdowns"],
  ["#risk-title", "Risk"],
  ["#diversification-title", "Diversification"],
  ["#rolling-title", "Rolling"],
  ["#stress-title", "Stress"],
  ["#constructor-title", "Constructor"],
  ["#context-title", "Market"],
];
export default function Page() {
  return (
    <>
      <a className="skip-link" href="#builder">
        Skip to portfolio builder
      </a>
      <header className="site-header">
        <a className="brand" href="https://rishabkolettu.vercel.app/">
          Rishab Kolettu <span aria-hidden>↗</span>
        </a>
        <nav aria-label="Sections">
          <a href="#builder">Builder</a>
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
          <MethodologyButton className="nav-button" />
        </nav>
      </header>
      <main className="container">
        <PortfolioWorkspace today={marketDate(new Date().toISOString())} />
        <footer>
          <p>
            For educational and analytical purposes only. Historical results do
            not guarantee future performance and should not be considered
            investment advice.
          </p>
          <div>
            <span>Portfolio Intelligence &amp; Construction Lab</span>
            <span>Historical analytics · portfolio construction</span>
          </div>
        </footer>
      </main>
    </>
  );
}
