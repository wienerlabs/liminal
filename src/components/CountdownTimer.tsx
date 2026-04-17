/**
 * LIMINAL — CountdownTimer
 *
 * Displays remaining time as "Xm Ys" or "Xs" with color transitions:
 * - var(--color-text) when >5min
 * - var(--color-warn) when <5min
 * - var(--color-danger) when <1min
 */

import type { CSSProperties, FC } from "react";

export type CountdownTimerProps = {
  remainingMs: number;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getColor(ms: number): string {
  if (ms < 60_000) return "var(--color-danger)";
  if (ms < 300_000) return "var(--color-warn)";
  return "var(--color-text)";
}

export const CountdownTimer: FC<CountdownTimerProps> = ({ remainingMs }) => {
  const display = remainingMs > 0 ? formatCountdown(remainingMs) : "—";
  const color = remainingMs > 0 ? getColor(remainingMs) : "var(--color-text-muted)";

  return (
    <span style={{ ...styles.timer, color }}>
      {display}
    </span>
  );
};

const styles: Record<string, CSSProperties> = {
  timer: {
    fontFamily: "var(--font-mono)",
    fontSize: 16,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    transition: "color 300ms ease",
  },
};

export default CountdownTimer;
