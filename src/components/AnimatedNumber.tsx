/**
 * LIMINAL — AnimatedNumber
 *
 * Smoothly interpolates between numeric values using requestAnimationFrame.
 * Respects `prefers-reduced-motion` — when set, the number snaps to the new
 * value with no animation. RAF is properly cancelled on unmount and on
 * re-trigger to prevent stale ticks updating an unmounted component.
 */

import { useEffect, useRef, useState, type FC } from "react";

export type AnimatedNumberProps = {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function format(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const AnimatedNumber: FC<AnimatedNumberProps> = ({
  value,
  duration = 600,
  prefix = "",
  suffix = "",
  decimals = 2,
}) => {
  const [display, setDisplay] = useState<string>(format(value, decimals));
  const prevRef = useRef<number>(value);
  const rafRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;

    // Reduced motion: snap directly to target.
    if (prefersReducedMotion() || duration <= 0) {
      setDisplay(format(to, decimals));
      prevRef.current = to;
      return;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();

    const tick = (now: number): void => {
      if (!mountedRef.current) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(format(current, decimals));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
        rafRef.current = 0;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, decimals]);

  return (
    <span className="liminal-num" style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}{display}{suffix}
    </span>
  );
};

export default AnimatedNumber;
