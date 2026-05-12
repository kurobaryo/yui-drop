/**
 * CountUp — animates a number from 0 to `value` over `duration` ms.
 *
 * Uses requestAnimationFrame; no external dep. Respects
 * prefers-reduced-motion by snapping to the final value immediately.
 */
import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  duration?: number; // ms
  /** Optional formatter (e.g. humanBytes). Defaults to integer string. */
  format?: (v: number) => string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CountUp({
  value,
  duration = 900,
  format,
  className,
}: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (value - from) * easeOutCubic(t));
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  const shown = format ? format(display) : Math.round(display).toLocaleString();
  return <span className={className}>{shown}</span>;
}
