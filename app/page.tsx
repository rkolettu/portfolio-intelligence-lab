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
          Portfolio lab <span>/ Foundation</span>
        </span>
        <nav aria-label="Primary">
          <a href="#builder">Workspace</a>
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
            <span>Portfolio Risk &amp; Analytics Lab</span>
            <span>Phase 1 · Foundation</span>
          </div>
        </footer>
      </main>
    </>
  );
}
