import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import "./analytics.css";
import "./observatory.css";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { MethodologyHost } from "@/components/workspace/MethodologyHost";
import { SiteHeader, SkipLink } from "@/components/layout/SiteHeader";
import { MethodologyButton } from "@/components/methodology/MethodologyDrawer";
import { marketDate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Portfolio Intelligence & Construction Lab | Rishab Kolettu",
    template: "%s · Portfolio Intelligence Lab",
  },
  description:
    "Reproducible portfolio simulations with explicit historical data coverage and methodology.",
};

/** The workspace (builder draft, displayed analysis, per-analysis page state)
 * lives here, above every route, so client-side navigation never refetches. */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const today = marketDate(new Date().toISOString());
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider today={today}>
          <SkipLink />
          <SiteHeader>
            <MethodologyButton className="nav-button" />
          </SiteHeader>
          <main className="container" id="main">
            {children}
            <footer>
              <p>
                For educational and analytical purposes only. Historical results
                do not guarantee future performance and should not be considered
                investment advice.
              </p>
              <div>
                <span>Portfolio Intelligence &amp; Construction Lab</span>
                <span>Historical analytics · portfolio construction</span>
              </div>
            </footer>
          </main>
          <MethodologyHost />
        </WorkspaceProvider>
        <Analytics />
      </body>
    </html>
  );
}
