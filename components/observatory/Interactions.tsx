"use client";
import { useEffect } from "react";

const SPOT =
  ".panel, .chart-figure, .mixer, .dossier, .summary-grid > div, .side-panel, .table-wrap, .ch-events, .portfolio-bar";
const TILT = ".mixer, .dossier, .obs-builder .panel, .construct-field .cf-side";
const MAGNET = ".primary, .mixer-use";

/** One document-level pointer layer for the tactile details:
 *  - spotlight: surfaces carry --mx/--my so a soft light follows the cursor;
 *  - tilt: feature cards lean toward the cursor with a glare (--rx/--ry/--gx/--gy);
 *  - magnet: primary buttons are drawn a few pixels toward the cursor.
 * Mouse only, one rAF per frame, and nothing under prefers-reduced-motion. */
export function Interactions() {
  useEffect(() => {
    const media = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media?.matches || reduced?.matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    let tilted: HTMLElement | null = null;
    let magnet: HTMLElement | null = null;
    const release = (el: HTMLElement | null, props: string[]) => {
      if (!el) return;
      for (const p of props) el.style.removeProperty(p);
      el.removeAttribute("data-live");
    };
    const run = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target as Element | null;
      const spot = target?.closest?.(SPOT) as HTMLElement | null;
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--mx", `${e.clientX - r.left}px`);
        spot.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      const tilt = target?.closest?.(TILT) as HTMLElement | null;
      if (tilt !== tilted) {
        release(tilted, ["--rx", "--ry", "--gx", "--gy"]);
        tilted = tilt;
      }
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const k = Math.max(1.2, 5 - r.width / 180);
        tilt.dataset.live = "";
        tilt.style.setProperty("--rx", `${((0.5 - py) * k).toFixed(2)}deg`);
        tilt.style.setProperty("--ry", `${((px - 0.5) * k).toFixed(2)}deg`);
        tilt.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
        tilt.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
      }
      const mag = target?.closest?.(MAGNET) as HTMLElement | null;
      if (mag !== magnet) {
        release(magnet, ["--tx", "--ty"]);
        magnet = mag;
      }
      if (mag && !(mag as HTMLButtonElement).disabled) {
        const r = mag.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        mag.dataset.live = "";
        mag.style.setProperty("--tx", `${(dx * 0.16).toFixed(1)}px`);
        mag.style.setProperty("--ty", `${(dy * 0.28).toFixed(1)}px`);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(run);
    };
    const out = () => {
      release(tilted, ["--rx", "--ry", "--gx", "--gy"]);
      release(magnet, ["--tx", "--ty"]);
      tilted = magnet = null;
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", out);
    window.addEventListener("blur", out);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", out);
      window.removeEventListener("blur", out);
    };
  }, []);
  return null;
}
