"use client";
import { useEffect, useRef } from "react";

/** A field of fine ink dots behind the hero. Static until the cursor moves near
 * it; then dots within reach swell and take the accent, like a lens passing
 * over paper. Draws only on pointer movement, never on a timer. */
export function DotField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const gap = 22;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let pointer: { x: number; y: number } | null = null;
    let eased: { x: number; y: number } | null = null;
    let frame = 0;
    const draw = () => {
      frame = 0;
      ctx.clearRect(0, 0, w, h);
      if (pointer && eased) {
        eased.x += (pointer.x - eased.x) * 0.22;
        eased.y += (pointer.y - eased.y) * 0.22;
      }
      const reach = 170;
      for (let y = gap / 2; y < h; y += gap)
        for (let x = gap / 2; x < w; x += gap) {
          // Radial fade toward the right, where the stage sits.
          const base = Math.max(
            0,
            1 -
              Math.hypot((x - w * 0.72) / (w * 0.6), (y - h * 0.5) / (h * 0.9)),
          );
          let k = 0;
          if (eased) {
            const d = Math.hypot(x - eased.x, y - eased.y);
            k = d < reach ? 1 - d / reach : 0;
            k = k * k * (3 - 2 * k);
          }
          const alpha = 0.07 * base + 0.5 * k;
          if (alpha < 0.012) continue;
          const r = 0.9 + 1.5 * k;
          ctx.fillStyle =
            k > 0.02
              ? `rgba(29, 78, 216, ${alpha.toFixed(3)})`
              : `rgba(23, 23, 23, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      if (
        pointer &&
        eased &&
        Math.hypot(pointer.x - eased.x, pointer.y - eased.y) > 0.5
      )
        frame = requestAnimationFrame(draw);
    };
    const size = () => {
      const r = c.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const move = (e: PointerEvent) => {
      if (reduced || e.pointerType !== "mouse") return;
      const r = c.getBoundingClientRect();
      const inside = e.clientY >= r.top && e.clientY <= r.bottom;
      pointer = inside ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      if (pointer && !eased) eased = { ...pointer };
      if (!pointer) eased = null;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    size();
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(size);
    ro?.observe(c);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("pointermove", move);
    };
  }, []);
  return <canvas ref={canvas} className="dot-field" aria-hidden />;
}
