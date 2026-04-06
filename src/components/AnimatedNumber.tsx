/**
 * LIMINAL — AnimatedNumber
 *
 * Smoothly interpolates between numeric values using requestAnimationFrame.
 * Uses design-system.css variables only — zero hardcoded hex.
 */

import { useEffect, useRef, useState, type FC } from "react";

export type AnimatedNumberProps = {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

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

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;

    const startTime = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(format(current, decimals));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, decimals]);

  return (
    <span className="liminal-num" style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}{display}{suffix}
    </span>
  );
};

function format(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default AnimatedNumber;
