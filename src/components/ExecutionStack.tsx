/**
 * LIMINAL — ExecutionStack
 *
 * Fan-out card stack for execution history. Adapted from the kokonutui
 * CardStack pattern, retuned for LIMINAL:
 *   - Pure CSS transitions (no Framer Motion). The stack collapses /
 *     expands by toggling a class that drives `transform` per index.
 *   - Each card represents one HistoricalExecution from analyticsStore;
 *     specs are real metrics (slices, bps, USD gain, duration), not
 *     marketing copy.
 *   - Click anywhere on the stack to fan out → click a card to navigate
 *     to its detail view (handled by the consumer via `onCardOpen`).
 *   - Caps at 6 cards visible — older entries are accessible via the
 *     "view all" affordance the consumer renders alongside.
 *
 * Layout: stacked uses translateX/Y/rotate keyed off index; fanned uses
 * a horizontal arc with overlap. The CSS transitions handle the spring-
 * y feel — values tuned to feel close to the kokonutui cubic-bezier
 * spring without depending on motion/react.
 */

import { useState, type CSSProperties, type FC } from "react";
import type { HistoricalExecution } from "../services/analyticsStore";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

const CARD_WIDTH = 280;
const CARD_OVERLAP = 200; // when fanned out
const STACK_X_STEP = 6;
const STACK_Y_STEP = 4;
const STACK_ROT_STEP = 1.2;

export type ExecutionStackProps = {
  executions: HistoricalExecution[];
  onCardOpen?: (execution: HistoricalExecution) => void;
  className?: string;
  style?: CSSProperties;
};

function formatUsd(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: abs < 1 ? 4 : 2,
    maximumFractionDigits: abs < 1 ? 4 : 2,
  })}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatRelDate(d: Date, now: Date): string {
  const diffMs = now.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export const ExecutionStack: FC<ExecutionStackProps> = ({
  executions,
  onCardOpen,
  className,
  style,
}) => {
  const [expanded, setExpanded] = useState(false);
  const cards = executions.slice(0, 6);
  const totalCards = cards.length;
  const now = new Date();

  if (totalCards === 0) return null;

  // Center offset for the stacked state — half a step per card so the
  // pile centers around the wrapper.
  const stackCenterOffset = ((totalCards - 1) * STACK_X_STEP) / 2;
  const fannedTotalWidth =
    CARD_WIDTH + (totalCards - 1) * (CARD_WIDTH - CARD_OVERLAP);
  const fannedCenterOffset = fannedTotalWidth / 2;

  return (
    <button
      type="button"
      onClick={(e) => {
        // Toggle on backdrop click only — individual card clicks bubble
        // here too, but they already invoked onCardOpen and stopped
        // propagation.
        if (e.target === e.currentTarget) setExpanded((v) => !v);
      }}
      aria-label={expanded ? "Collapse execution stack" : "Expand execution stack"}
      className={className}
      style={{ ...styles.wrapper, ...style }}
    >
      {cards.map((exec, index) => {
        const stackX = index * STACK_X_STEP - stackCenterOffset;
        const stackY = index * STACK_Y_STEP;
        const stackRot = index * STACK_ROT_STEP;

        const fannedX =
          index * (CARD_WIDTH - CARD_OVERLAP) -
          fannedCenterOffset +
          CARD_WIDTH / 2;
        const fannedRot = index * 4 - (totalCards - 1) * 2;

        const transform = expanded
          ? `translate(${fannedX}px, 0) rotate(${fannedRot}deg)`
          : `translate(${stackX}px, ${stackY}px) rotate(${stackRot}deg) scale(${1 - index * 0.015})`;

        const gain = exec.summary.totalValueCaptureUsd;
        const gainColor =
          gain > 0
            ? "var(--color-success)"
            : gain < 0
              ? "var(--color-danger)"
              : "var(--color-text-muted)";

        return (
          <div
            key={exec.id}
            role="button"
            tabIndex={0}
            aria-label={`Execution ${exec.inputSymbol} → ${exec.outputSymbol}, ${formatRelDate(exec.createdAt, now)}`}
            onClick={(e) => {
              e.stopPropagation();
              if (expanded && onCardOpen) onCardOpen(exec);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                if (expanded && onCardOpen) onCardOpen(exec);
              }
            }}
            style={{
              ...styles.card,
              transform,
              zIndex: totalCards - index,
              cursor: expanded && onCardOpen ? "pointer" : "default",
            }}
          >
            <div style={styles.pairRow}>
              <span style={styles.pair}>
                {exec.inputSymbol} → {exec.outputSymbol}
              </span>
              <span style={styles.relDate}>
                {formatRelDate(exec.createdAt, now)}
              </span>
            </div>
            <div style={styles.specsGrid}>
              <Spec
                label="Slices"
                value={`${exec.summary.completedSlices}${
                  exec.summary.skippedSlices > 0
                    ? ` (+${exec.summary.skippedSlices} retry)`
                    : ""
                }`}
              />
              <Spec
                label="Gain"
                value={formatUsd(gain)}
                color={gainColor}
              />
              <Spec
                label="Bps"
                value={`${
                  exec.summary.totalPriceImprovementBps >= 0 ? "+" : ""
                }${exec.summary.totalPriceImprovementBps.toFixed(1)}`}
              />
              <Spec
                label="Duration"
                value={formatDuration(exec.summary.executionDurationMs)}
              />
            </div>
            <div style={styles.tally}>
              <span style={styles.tallyLabel}>Total captured</span>
              <span style={{ ...styles.tallyValue, color: gainColor }}>
                {formatUsd(exec.summary.totalValueCaptureUsd)}
              </span>
            </div>
          </div>
        );
      })}
    </button>
  );
};

const Spec: FC<{ label: string; value: string; color?: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={styles.spec}>
    <span style={{ ...styles.specValue, color: color ?? "var(--color-text)" }}>
      {value}
    </span>
    <span style={styles.specLabel}>{label}</span>
  </div>
);

const styles: Record<string, CSSProperties> = {
  wrapper: {
    position: "relative",
    width: "100%",
    minHeight: 260,
    display: "block",
    appearance: "none",
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  card: {
    position: "absolute",
    top: 20,
    left: "50%",
    width: CARD_WIDTH,
    marginLeft: -(CARD_WIDTH / 2),
    padding: 16,
    borderRadius: 16,
    background:
      "linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-card) 100%)",
    border: "1px solid var(--color-stroke)",
    boxShadow:
      "0 6px 16px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.04)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    transition:
      "transform 540ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow var(--motion-base) var(--ease-out)",
    transformOrigin: "center top",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  pairRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  pair: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 18,
    color: "var(--color-text)",
    letterSpacing: 0,
  },
  relDate: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  specsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    padding: "10px 0",
    borderTop: "1px dashed var(--color-stroke)",
    borderBottom: "1px dashed var(--color-stroke)",
  },
  spec: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  specValue: {
    fontFamily: MONO,
    fontWeight: 700,
    fontSize: 14,
    fontVariantNumeric: "tabular-nums",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  specLabel: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  tally: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  tallyLabel: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  tallyValue: {
    fontFamily: MONO,
    fontWeight: 700,
    fontSize: 18,
    fontVariantNumeric: "tabular-nums",
  },
};

export default ExecutionStack;
