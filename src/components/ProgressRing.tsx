/**
 * LIMINAL — ProgressRing
 *
 * Pure SVG circular progress indicator.
 * Track: var(--color-stroke), fill: var(--color-5).
 * Animated stroke-dashoffset via CSS transition.
 */

import type { FC } from "react";

export type ProgressRingProps = {
  completed: number;
  total: number;
  size?: number;
  strokeWidth?: number;
};

export const ProgressRing: FC<ProgressRingProps> = ({
  completed,
  total,
  size = 48,
  strokeWidth = 3,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(completed / total, 1) : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-stroke)"
        strokeWidth={strokeWidth}
      />
      {/* Fill */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-5)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms ease-out" }}
      />
      {/* Center text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-text)"
        fontFamily="var(--font-mono)"
        fontSize={Math.max(10, Math.round(size * 0.28))}
        fontWeight={600}
      >
        {completed}/{total || 0}
      </text>
    </svg>
  );
};

export default ProgressRing;
