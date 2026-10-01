"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

export const ANALYSIS_ROUTES: { href: string; label: string }[] = [
  { href: "/analysis/portfolio", label: "Your Portfolio" },
  { href: "/analysis/overview", label: "Overview" },
  { href: "/analysis/performance", label: "Performance" },
  { href: "/analysis/benchmark", label: "Benchmark" },
  { href: "/analysis/risk", label: "Risk" },
  { href: "/analysis/rolling", label: "Rolling" },
  { href: "/analysis/stress", label: "Stress Lab" },
  { href: "/analysis/constructor", label: "Constructor" },
];

/** Sticky application header with the workspace navigation: real routes, the
 * current one marked with aria-current="page". Analysis links are dimmed (not
 * disabled) before an analysis exists; following one shows builder guidance. A
 * hairline along the header's bottom edge shows scroll progress on long pages. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { result } = useWorkspace();
  const header = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      header.current?.style.setProperty(
        "--scroll",
        max > 0 ? String(Math.min(1, window.scrollY / max)) : "0",
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pathname]);
  useEffect(() => {
    // Keep the current page's link in view when the nav scrolls (narrow screens).
    const el = nav.current;
    const link = el?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!el || !link || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: link.offsetLeft - (el.clientWidth - link.offsetWidth) / 2 });
  }, [pathname]);
  return (
    <header className="site-header" ref={header}>
      <a className="brand" href="https://rishabkolettu.vercel.app/">
        <svg className="brand-mark" viewBox="0 0 18 14" aria-hidden focusable="false">
          <rect x="0" y="6" width="4" height="8" rx="1" />
          <rect x="7" y="2" width="4" height="12" rx="1" />
          <rect x="14" y="0" width="4" height="14" rx="1" />
        </svg>
        <span>
          Rishab Kolettu <span aria-hidden>↗</span>
        </span>
      </a>
      <nav aria-label="Workspace" ref={nav}>
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
          Builder
        </Link>
        <span className="nav-divider" aria-hidden />
        {ANALYSIS_ROUTES.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            data-absent={result ? undefined : ""}
          >
            {label}
          </Link>
        ))}
        {children}
      </nav>
    </header>
  );
}

/** Skip link targeting the main work area of the current page. */
export function SkipLink() {
  const pathname = usePathname() ?? "/";
  return pathname === "/" ? (
    <a className="skip-link" href="#builder">
      Skip to portfolio builder
    </a>
  ) : (
    <a className="skip-link" href="#main">
      Skip to analysis
    </a>
  );
}
