import { PortfolioWorkspace } from "@/components/portfolio/PortfolioWorkspace";
import { marketDate } from "@/lib/utils/dates";
export const dynamic = "force-dynamic";
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
        <span className="header-status">
          Portfolio lab <span>/ Construction</span>
        </span>
        <nav aria-label="Primary">
          <a href="#builder">Workspace</a>
          <a href="#overview-title">Overview</a>
          <a href="#risk-title">Risk</a>
          <a href="#benchmark-title">Benchmark</a>
          <a href="#drawdowns-title">Drawdowns</a>
          <a href="#rolling-title">Rolling</a>
          <a href="#stress-title">Stress</a>
          <a href="#constructor-title">Constructor</a>
          <a href="#context-title">Market context</a>
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
            <span>Phase 6 · Construction</span>
          </div>
        </footer>
      </main>
    </>
  );
}
