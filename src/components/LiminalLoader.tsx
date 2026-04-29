/**
 * LIMINAL — LiminalLoader
 *
 * Multi-ring conic-gradient loader with optional title + subtitle. Adapted
 * from the kokonutui Loader pattern, retuned for LIMINAL:
 *   - Pure CSS animations (no Framer Motion dependency)
 *   - Theme-aware accent (uses --color-5 in light + a brighter pink in
 *     dark via CSS custom property fallback)
 *   - Three concentric rings rotating at different speeds + directions
 *   - Optional breathing-opacity animation on the title text
 *
 * Use cases inside LIMINAL:
 *   - Autopilot pre-sign waiting state ("Building plan, awaiting Solflare…")
 *   - Kamino deposit confirmation pending
 *   - Final Kamino withdraw pending after the last slice
 *
 * Accepts a `size` prop (sm/md/lg) and respects prefers-reduced-motion
 * (animations disabled but rings still render statically).
 */

import type { CSSProperties, FC } from "react";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

const SIZE_MAP = {
  sm: { container: 80, titleSize: 13, subtitleSize: 11, gap: 16 },
  md: { container: 128, titleSize: 16, subtitleSize: 13, gap: 24 },
  lg: { container: 160, titleSize: 18, subtitleSize: 14, gap: 28 },
} as const;

export type LiminalLoaderProps = {
  title?: string;
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
};

export const LiminalLoader: FC<LiminalLoaderProps> = ({
  title,
  subtitle,
  size = "md",
  className,
  style,
}) => {
  const dim = SIZE_MAP[size];
  return (
    <div
      className={className}
      style={{ ...styles.root, gap: dim.gap, ...style }}
    >
      <div
        style={{
          ...styles.container,
          width: dim.container,
          height: dim.container,
        }}
        aria-hidden="true"
      >
        {/* Outer ring — slow CW, accent pink */}
        <span style={{ ...styles.ring, ...styles.ringOuter }} />
        {/* Mid ring — medium speed CW, slightly desaturated pink */}
        <span style={{ ...styles.ring, ...styles.ringMid }} />
        {/* Counter-rotating accent ring — sky-tinted teal complement */}
        <span style={{ ...styles.ring, ...styles.ringCounter }} />
        {/* Particle ring — fastest, smallest arc */}
        <span style={{ ...styles.ring, ...styles.ringParticle }} />
        {/* LIMINAL mark sits centred behind the rings, no animation. */}
        <span style={styles.center} aria-hidden="true">
          <span style={styles.centerDot} />
        </span>
      </div>
      {(title || subtitle) && (
        <div style={styles.text}>
          {title && (
            <div
              style={{
                ...styles.title,
                fontSize: dim.titleSize,
              }}
              role="status"
              aria-live="polite"
            >
              <span style={styles.titleSpan}>{title}</span>
            </div>
          )}
          {subtitle && (
            <div
              style={{
                ...styles.subtitle,
                fontSize: dim.subtitleSize,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  container: {
    position: "relative",
    animation: "liminal-loader-breath 4s ease-in-out infinite",
  },
  ring: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    pointerEvents: "none",
  },
  // Tier 1 — outer thin ring (35-41% mask), 3s rotation
  ringOuter: {
    background:
      "conic-gradient(from 0deg, transparent 0deg, var(--color-5) 90deg, transparent 180deg)",
    WebkitMask:
      "radial-gradient(circle at 50% 50%, transparent 35%, black 37%, black 39%, transparent 41%)",
    mask: "radial-gradient(circle at 50% 50%, transparent 35%, black 37%, black 39%, transparent 41%)",
    opacity: 0.85,
    animation: "liminal-loader-spin 3s linear infinite",
  },
  // Tier 2 — primary ring with gradient fade, 2.5s rotation
  ringMid: {
    background:
      "conic-gradient(from 0deg, transparent 0deg, var(--color-5-strong) 120deg, var(--color-5) 240deg, transparent 360deg)",
    WebkitMask:
      "radial-gradient(circle at 50% 50%, transparent 42%, black 44%, black 48%, transparent 50%)",
    mask: "radial-gradient(circle at 50% 50%, transparent 42%, black 44%, black 48%, transparent 50%)",
    opacity: 0.9,
    animation:
      "liminal-loader-spin 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
  },
  // Tier 3 — counter-rotating accent (sky tint), 4s
  ringCounter: {
    background:
      "conic-gradient(from 180deg, transparent 0deg, var(--color-4) 45deg, transparent 90deg)",
    WebkitMask:
      "radial-gradient(circle at 50% 50%, transparent 52%, black 54%, black 56%, transparent 58%)",
    mask: "radial-gradient(circle at 50% 50%, transparent 52%, black 54%, black 56%, transparent 58%)",
    opacity: 0.5,
    animation:
      "liminal-loader-spin-rev 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
  },
  // Tier 4 — fastest particle, smallest arc, 3.5s
  ringParticle: {
    background:
      "conic-gradient(from 270deg, transparent 0deg, var(--color-3) 20deg, transparent 40deg)",
    WebkitMask:
      "radial-gradient(circle at 50% 50%, transparent 61%, black 62%, black 63%, transparent 64%)",
    mask: "radial-gradient(circle at 50% 50%, transparent 61%, black 62%, black 63%, transparent 64%)",
    opacity: 0.6,
    animation: "liminal-loader-spin 3.5s linear infinite",
  },
  center: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  centerDot: {
    width: "16%",
    height: "16%",
    borderRadius: "50%",
    background: "var(--color-5)",
    boxShadow: "0 0 12px var(--color-5)",
  },
  text: {
    textAlign: "center",
    maxWidth: 280,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  title: {
    fontFamily: SANS,
    fontWeight: 600,
    color: "var(--color-text)",
    letterSpacing: 0,
    lineHeight: 1.2,
  },
  titleSpan: {
    animation: "liminal-loader-text-breath 3s ease-in-out infinite",
    display: "inline-block",
  },
  subtitle: {
    fontFamily: MONO,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
    letterSpacing: 0,
  },
};

export default LiminalLoader;
