/**
 * LIMINAL — ProgressRingsCard
 *
 * Apple-Activity-style concentric progress rings, retuned for LIMINAL's
 * pastel palette and inline-style stack. Three rings stacked at the
 * same centre, each one a different metric with its own progress
 * proportion + colour. Rings paint clockwise from 12 o'clock; each
 * stroke uses a linear gradient for depth.
 *
 * For an in-flight TWAP execution we surface three meaningful metrics:
 *   - SLICES   — outer ring (largest), pink — completed / total
 *   - WINDOW   — mid ring, sky/teal — elapsed / total time
 *   - YIELD    — inner ring (smallest), mint/green — accrued / target
 *
 * Each metric also renders its own row of explanatory text on the right
 * side (count, denominator, unit). Pure SVG + inline styles + CSS
 * transitions on `stroke-dashoffset` (no Framer Motion).
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

export type RingMetric = {
  label: string;
  /** Hex color anchor. The component derives a slightly lighter sibling
   * for the stroke gradient. */
  color: string;
  size: number;
  current: number;
  target: number;
  unit: string;
};

export type ProgressRingsCardProps = {
  title?: string;
  metrics: RingMetric[];
  className?: string;
  style?: CSSProperties;
};

const STROKE_WIDTH = 14;

// Clamp + percent
function clampPct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

// Hex color → slight lighten, used for the gradient stop.
function lighten(hex: string, amt = 0.4): string {
  // Accept #RRGGBB; fall back to the original color for var(--…) tokens.
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amt);
  const lg = Math.round(g + (255 - g) * amt);
  const lb = Math.round(b + (255 - b) * amt);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

const Ring: FC<{ metric: RingMetric; index: number; mounted: boolean }> = ({
  metric,
  index,
  mounted,
}) => {
  const radius = (metric.size - STROKE_WIDTH) / 2;
  const circumference = radius * 2 * Math.PI;
  const pct = clampPct(metric.current, metric.target);
  const offset = ((100 - pct) / 100) * circumference;
  const id = `liminal-rings-grad-${metric.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={metric.size}
        height={metric.size}
        viewBox={`0 0 ${metric.size} ${metric.size}`}
        style={{
          transform: "rotate(-90deg)",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.06))",
        }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={metric.color} stopOpacity="1" />
            <stop offset="100%" stopColor={lighten(metric.color, 0.45)} stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* Track (faint) */}
        <circle
          cx={metric.size / 2}
          cy={metric.size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-stroke)"
          strokeWidth={STROKE_WIDTH}
          opacity={0.4}
        />
        {/* Progress */}
        <circle
          cx={metric.size / 2}
          cy={metric.size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? offset : circumference}
          style={{
            transition: `stroke-dashoffset 1.4s cubic-bezier(0.4, 0, 0.2, 1) ${index * 200}ms`,
          }}
        />
      </svg>
    </div>
  );
};

export const ProgressRingsCard: FC<ProgressRingsCardProps> = ({
  title = "Live progress",
  metrics,
  className,
  style,
}) => {
  // Mount-time cue so the rings draw on instead of just being there.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The largest metric size determines the canvas — we float the
  // smaller rings inside it concentrically.
  const canvas = Math.max(...metrics.map((m) => m.size));

  return (
    <section
      className={className}
      style={{ ...styles.root, ...style }}
      aria-label={title}
    >
      <header style={styles.header}>{title}</header>
      <div style={styles.body}>
        <div
          style={{
            position: "relative",
            width: canvas,
            height: canvas,
            flexShrink: 0,
          }}
        >
          {metrics.map((m, i) => (
            <Ring key={m.label} metric={m} index={i} mounted={mounted} />
          ))}
        </div>
        <ul style={styles.legend}>
          {metrics.map((m) => (
            <li key={m.label} style={styles.legendRow}>
              <span style={styles.legendLabel}>{m.label}</span>
              <span style={{ ...styles.legendValue, color: m.color }}>
                {formatNumber(m.current)}
                <span style={styles.legendDen}>
                  /{formatNumber(m.target)}
                </span>
                <span style={styles.legendUnit}>{m.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

function formatNumber(n: number): string {
  if (n === 0) return "0";
  if (n < 1) return n.toFixed(2);
  if (n < 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "16px 18px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 14,
  },
  header: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  body: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    flexWrap: "wrap",
  },
  legend: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  legendRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  legendLabel: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  legendValue: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 22,
    lineHeight: 1.1,
    fontVariantNumeric: "tabular-nums",
  },
  legendDen: {
    color: "var(--color-text-muted)",
    fontWeight: 500,
    fontSize: 14,
    marginLeft: 2,
  },
  legendUnit: {
    color: "var(--color-text-muted)",
    fontWeight: 500,
    fontSize: 13,
    marginLeft: 6,
  },
};

export default ProgressRingsCard;
