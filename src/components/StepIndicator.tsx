/**
 * LIMINAL — StepIndicator
 *
 * Horizontal stepper: Deposit -> Monitor -> Execute -> Repeat -> Withdraw
 * Completed: filled var(--color-5), active: pulsing ring, pending: grey outline.
 *
 * Pass `currentStep = -1` to render all steps as pending (pre-execution state).
 */

import type { CSSProperties, FC } from "react";

const STEPS = ["Deposit", "Monitor", "Execute", "Repeat", "Withdraw"];

export type StepIndicatorProps = {
  currentStep: number; // -1 = no step active; 0-4 = active step
};

export const StepIndicator: FC<StepIndicatorProps> = ({ currentStep }) => {
  return (
    <div style={styles.container}>
      {STEPS.map((label, i) => {
        const isCompleted = currentStep >= 0 && i < currentStep;
        const isActive = currentStep >= 0 && i === currentStep;
        // isPending covers both "not yet reached" and "no execution" (currentStep = -1)
        return (
          <div key={label} style={styles.stepGroup}>
            {i > 0 && (
              <div
                style={{
                  ...styles.connector,
                  borderTopStyle: isCompleted ? "solid" : "dashed",
                  borderTopColor: isCompleted
                    ? "var(--color-5)"
                    : "var(--color-stroke)",
                }}
              />
            )}
            <div
              style={{
                ...styles.circle,
                background: isCompleted ? "var(--color-5)" : "transparent",
                borderColor: isActive
                  ? "var(--color-5)"
                  : isCompleted
                    ? "var(--color-5)"
                    : "var(--color-stroke)",
                boxShadow: isActive
                  ? "0 0 0 4px var(--color-accent-bg-soft)"
                  : undefined,
                animation: isActive
                  ? "liminal-pulse 1.4s ease-in-out infinite"
                  : undefined,
              }}
            >
              {isCompleted && (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="var(--color-text-inverse)"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
  );
};

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 0,
    padding: "12px 16px",
  },
  stepGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: 1,
    position: "relative",
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    zIndex: 1,
    transition: "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    marginTop: 6,
    textAlign: "center" as const,
    lineHeight: 1.2,
  },
  // Connector tam circle vertical center'da: circle 20px, top: 9 (10 - borderTop/2)
  connector: {
    position: "absolute" as const,
    top: 9,
    right: "50%",
    width: "100%",
    borderTop: "2px solid",
    zIndex: 0,
    transform: "translateX(-50%)",
  },
};

export default StepIndicator;
