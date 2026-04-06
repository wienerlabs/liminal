/**
 * LIMINAL — Sparkline
 *
 * Pure SVG inline sparkline. No dependencies.
 * Accent stroke if trend up, warn stroke if trend down.
 */

import type { FC } from "react";

export type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
};

export const Sparkline: FC<SparklineProps> = ({
  data,
  width = 60,
  height = 20,
}) => {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padY + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const trendUp = data[data.length - 1] >= data[0];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={trendUp ? "var(--color-5)" : "var(--color-warn)"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default Sparkline;
