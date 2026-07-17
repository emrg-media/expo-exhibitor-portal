"use client";

import { useEffect, useRef, useState } from "react";

// Animate a number toward its target over ~250ms (easeOutCubic). Honors
// prefers-reduced-motion by jumping straight to the value. Used for line
// prices and the running total so digits tick up instead of snapping.
export function useCountUp(value: number, duration = 260): number {
  const [display, setDisplay] = useState(value);
  const raf = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = display;
    if (reduce || from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // Intentionally start from the currently displayed value on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display;
}

// Format US phone as (XXX) XXX-XXXX while typing.
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
