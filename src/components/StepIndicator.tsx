/**
 * LIMINAL — StepIndicator
 *
 * Horizontal stepper: Deposit → Monitor → Execute → Repeat → Withdraw
 *
 * Rewritten with CSS grid so the rail between circles is geometrically
 * aligned: every step sits in a 1fr column, the circle is vertically
 * centered within its column, and the connector rail sits underneath all
 * circles on a single row rather than being stitched together from
 * per-group absolute-positioned segments. That was the source of the
 * "çizgiler düzgün değil" complaint — a single continuous rail can't
 * misalign.
 *
 * States:
 *   isCompleted → rail segment + circle filled with accent, check icon
 *   isActive    → circle has glowing ring + step number badge, rail up
 *                 to this circle is solid, after it is dashed
 *   pending     → grey outline circle with step number
 *
 * Pass `currentStep = -1` to render all steps as pending (pre-start).
 */

import type { CSSProperties } from "react";

const STEPS = ["Deposit", "Monitor", "Execute", "Repeat", "Withdraw"];

export interface StepIndicatorProps {
  /** -1 = no step active yet; 0..4 = active step. */
  currentStep: number;
}

const CIRCLE_SIZE = 24;
const RAIL_THICKNESS = 2;

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  // Completed steps are everything strictly before `currentStep`. The
  // rail progress fraction is therefore `currentStep / (STEPS.length - 1)`
  // with a floor of 0 when no step is active.
  const progressFraction =
    currentStep <= 0 ? 0 : currentStep / (STEPS.length - 1);

  return (
    <div style={styles.wrap} role="group" aria-label="Execution progress">
      {/* Rail — single continuous line behind all circles */}
      <div style={styles.railTrack} aria-hidden="true" />
      <div
        style={{
          ...styles.railFill,
          width: `${progressFraction * 100}%`,
        }}
        aria-hidden="true"
      />

      {/* Step columns */}
      <div style={styles.row}>
        {STEPS.map((label, i) => {
          const isCompleted = currentStep >= 0 && i < currentStep;
          const isActive = currentStep >= 0 && i === currentStep;
          return (
            <div key={label} style={styles.col}>
              <div
                style={{
                  ...styles.circle,
                  background: isCompleted ? "var(--color-5)" : "var(--color-2)",
                  borderColor: isActive
                    ? "var(--color-5)"
                    : isCompleted
                      ? "var(--color-5)"
                      : "var(--color-stroke)",
                  boxShadow: isActive
                    ? "0 0 0 4px var(--color-accent-bg-soft)"
                    : "none",
                  animation: isActive
                    ? "liminal-pulse 1.4s ease-in-out infinite"
                    : undefined,
                  color: isCompleted
                    ? "var(--color-text-inverse)"
                    : isActive
                      ? "var(--color-5-strong)"
                      : "var(--color-text-muted)",
                }}
              >
                {isCompleted ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6.5L5 9L9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span style={styles.circleNumber}>{i + 1}</span>
                )}
              </div>
              <div
                style={{
                  ...styles.label,
                  color:
                    isActive || isCompleted
                      ? "var(--color-text)"
                      : "var(--color-text-muted)",
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    padding: "14px 12px 10px",
  },
  // Continuous pending rail spanning the first-circle center to the
  // last-circle center. `calc(100% / N)` leaves one column-width of margin
  // on each side so the rail stops exactly where the outer circles sit.
  railTrack: {
    position: "absolute",
    top: 14 + CIRCLE_SIZE / 2 - RAIL_THICKNESS / 2,
    left: `calc(100% / ${STEPS.length * 2} + 12px)`,
    right: `calc(100% / ${STEPS.length * 2} + 12px)`,
    height: RAIL_THICKNESS,
    background: "var(--color-stroke)",
    borderRadius: RAIL_THICKNESS,
  },
  railFill: {
    position: "absolute",
    top: 14 + CIRCLE_SIZE / 2 - RAIL_THICKNESS / 2,
    left: `calc(100% / ${STEPS.length * 2} + 12px)`,
    height: RAIL_THICKNESS,
    background: "var(--color-5)",
    borderRadius: RAIL_THICKNESS,
    transition: "width var(--motion-slow) var(--ease-out)",
    // Account for the same right-margin as the track — width is a
    // percentage of the *available* rail, not of the container.
    maxWidth: `calc(100% - 2 * (100% / ${STEPS.length * 2} + 12px))`,
  },
  row: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`,
    gap: 0,
  },
  col: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: "50%",
    border: `${RAIL_THICKNESS}px solid`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    zIndex: 1,
    transition:
      "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out), box-shadow var(--motion-base) var(--ease-out)",
  },
  circleNumber: {
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  },
};

export default StepIndicator;
