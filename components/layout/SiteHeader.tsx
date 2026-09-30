"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Sticky header with scroll-spy navigation. The active section is the last one
 * whose top has passed a reading line under the header; a hairline along the
 * header's bottom edge shows page progress. Sections that are not on the page yet
 * (before an analysis) are dimmed but keep their anchors. */
export function SiteHeader({
  sections,
  children,
}: {
  sections: [string, string][];
  children?: ReactNode;
}) {
  const header = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string>("#builder");
  const [present, setPresent] = useState<Set<string>>(new Set(["#builder"]));
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      header.current?.style.setProperty(
        "--scroll",
        max > 0 ? String(Math.min(1, window.scrollY / max)) : "0",
      );
      const line = window.innerHeight * 0.32;
      let current = "#builder";
      const found = new Set<string>();
      for (const [href] of sections) {
        const target = document.querySelector(href);
        if (!target) continue;
        found.add(href);
        const top = (target.closest("section") ?? target).getBoundingClientRect().top;
        if (top <= line) current = href;
      }
      // Bottom of the page: the final section is active even if it is short.
      if (max > 0 && window.scrollY >= max - 4) {
        const last = [...found].at(-1);
        if (last) current = last;
      }
      setActive((prev) => (prev === current ? prev : current));
      setPresent((prev) =>
        prev.size === found.size && [...found].every((h) => prev.has(h))
          ? prev
          : found,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.querySelector("main") ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mutations.disconnect();
    };
  }, [sections]);
  useEffect(() => {
    // Keep the active link visible when the nav scrolls horizontally (narrow screens).
    const el = nav.current;
    const link = el?.querySelector<HTMLElement>('a[aria-current="location"]');
    if (!el || !link || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({
      left: link.offsetLeft - (el.clientWidth - link.offsetWidth) / 2,
      behavior: "smooth",
    });
  }, [active]);
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
      <nav aria-label="Sections" ref={nav}>
        {[["#builder", "Builder"], ...sections].map(([href, label]) => (
          <a
            key={href}
            href={href}
            aria-current={active === href ? "location" : undefined}
            data-absent={present.has(href) ? undefined : ""}
          >
            {label}
          </a>
        ))}
        {children}
      </nav>
    </header>
  );
}
