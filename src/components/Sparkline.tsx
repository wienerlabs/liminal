/**
 * LIMINAL — Sparkline
 *
 * Pure SVG inline sparkline. No dependencies. Semantic stroke:
 * success when trending up, danger when down. Includes a subtle gradient
 * fill below the line to give context without overpowering the line.
 */

import { useId, type FC } from "react";

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
  const gradientId = useId();
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;

  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });
  const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath =
    `M0,${height} L${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${width},${height} Z`;

  const trendUp = data[data.length - 1] >= data[0];
  const stroke = trendUp ? "var(--color-success)" : "var(--color-danger)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "inline-block", verticalAlign: "middle" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default Sparkline;
