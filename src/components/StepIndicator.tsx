/**
 * LIMINAL — StepIndicator
 *
 * Horizontal stepper: Deposit -> Monitor -> Execute -> Repeat -> Withdraw
 * Completed: filled var(--color-5), active: pulsing border, pending: stroke outline.
 */

import type { CSSProperties, FC } from "react";

const STEPS = ["Deposit", "Monitor", "Execute", "Repeat", "Withdraw"];

export type StepIndicatorProps = {
  currentStep: number; // 0-4
};

export const StepIndicator: FC<StepIndicatorProps> = ({ currentStep }) => {
  return (
    <div style={styles.container}>
      {STEPS.map((label, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;
        const isPending = i > currentStep;
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
                  : isPending
                    ? "var(--color-stroke)"
                    : "var(--color-5)",
                animation: isActive
                  ? "liminal-pulse 1.4s ease-in-out infinite"
                  : undefined,
              }}
            >
              {isCompleted && (
                <svg width="10" height="10" viewBox="0 0 10 10">
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
                color: isActive || isCompleted
                  ? "var(--color-text)"
                  : "var(--color-text-muted)",
                fontWeight: isActive ? 700 : 400,
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
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
    marginTop: 4,
    textAlign: "center" as const,
  },
  connector: {
    position: "absolute" as const,
    top: 10,
    right: "50%",
    width: "100%",
    borderTop: "1.5px solid",
    zIndex: 0,
    transform: "translateX(-50%)",
  },
};

export default StepIndicator;
