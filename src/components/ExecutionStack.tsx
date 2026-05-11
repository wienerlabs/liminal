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
import type {
  HistoricalExecution,
  SessionSummary,
  SliceAnalytics,
} from "../services/analyticsStore";

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
  /**
   * Demo mode — when true and `executions` is empty, render 4 sample
   * cards so the user can see what the stack looks like before they've
   * actually run anything. Demo cards are visually marked with a
   * "demo" pill so users don't confuse them with real history.
   */
  demoMode?: boolean;
  /** Optional headline rendered above the stack ("Your history" /
   * "Preview"). When omitted, no header renders. */
  title?: string;
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
  demoMode = false,
  title,
}) => {
  const [expanded, setExpanded] = useState(false);
  // Demo mode kicks in when the consumer asks for it AND there's no
  // real history to show. Real history always wins over demos.
  const useDemo = demoMode && executions.length === 0;
  const cards = useDemo
    ? DEMO_EXECUTIONS
    : executions.slice(0, 6);
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
    <div
      className={className}
      style={{ ...styles.outer, ...style }}
    >
      {(title || useDemo) && (
        <div style={styles.titleRow}>
          {title && <span style={styles.titleText}>{title}</span>}
          {useDemo && (
            <span style={styles.demoPill} aria-label="Demo cards — not real history">
              demo
            </span>
          )}
          {!useDemo && executions.length > 0 && (
            <span style={styles.titleHint}>
              {expanded ? "Click backdrop to collapse" : "Click stack to fan out"}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={(e) => {
          // Toggle on backdrop click only — individual card clicks bubble
          // here too, but they already invoked onCardOpen and stopped
          // propagation.
          if (e.target === e.currentTarget) setExpanded((v) => !v);
        }}
        aria-label={expanded ? "Collapse execution stack" : "Expand execution stack"}
        style={styles.wrapper}
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
                label="vs Jupiter"
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
    </div>
  );
};

// ---------------------------------------------------------------------------
// Demo executions — used when the consumer passes `demoMode` and the
// real history is empty. Numbers are illustrative ("here's roughly what
// you'd capture on a SOL→USDC TWAP"). Visually marked with a "demo"
// pill so users don't read these as their own.
// ---------------------------------------------------------------------------

function makeDemoSummary(
  totalUsd: number,
  bps: number,
  yieldUsd: number,
  durationMs: number,
  completedSlices: number,
  skippedSlices: number,
): SessionSummary {
  return {
    totalInputAmount: 0,
    totalOutputAmount: 0,
    averageExecutionPrice: 0,
    baselinePrice: 0,
    totalPriceImprovementBps: bps,
    totalPriceImprovementUsd: totalUsd - yieldUsd,
    totalKaminoYieldUsd: yieldUsd,
    totalValueCaptureUsd: totalUsd,
    executionDurationMs: durationMs,
    completedSlices,
    skippedSlices,
    startedAt: new Date(Date.now() - durationMs - 1000),
    completedAt: new Date(Date.now() - 1000),
  };
}

const DEMO_EXECUTIONS: HistoricalExecution[] = [
  {
    id: "demo-1",
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inputSymbol: "SOL",
    outputSymbol: "USDC",
    summary: makeDemoSummary(58.42, 18.4, 11.20, 60 * 60 * 1000, 4, 0),
    slices: [] as SliceAnalytics[],
    createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30m ago
  },
  {
    id: "demo-2",
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    inputSymbol: "USDC",
    outputSymbol: "USDT",
    summary: makeDemoSummary(2.81, 4.2, 0.67, 30 * 60 * 1000, 3, 0),
    slices: [] as SliceAnalytics[],
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago
  },
  {
    id: "demo-3",
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inputSymbol: "SOL",
    outputSymbol: "USDC",
    summary: makeDemoSummary(124.7, 22.1, 28.3, 2 * 60 * 60 * 1000, 6, 1),
    slices: [] as SliceAnalytics[],
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000), // 1d ago
  },
  {
    id: "demo-4",
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: "So11111111111111111111111111111111111111112",
    inputSymbol: "USDC",
    outputSymbol: "SOL",
    summary: makeDemoSummary(7.15, 9.8, 1.44, 60 * 60 * 1000, 4, 0),
    slices: [] as SliceAnalytics[],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3d ago
  },
];

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
  outer: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 8px",
  },
  titleText: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    letterSpacing: "0.08em",
  },
  titleHint: {
    marginLeft: "auto",
    fontFamily: MONO,
    fontSize: 12,
    color: "var(--color-text-subtle)",
    letterSpacing: 0,
  },
  demoPill: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    padding: "2px 7px",
    borderRadius: 999,
    background: "var(--color-accent-bg-soft)",
    color: "var(--color-5-strong)",
    border: "1px solid var(--color-accent-border)",
  },
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
    fontSize: 20,
    color: "var(--color-text)",
    letterSpacing: 0,
  },
  relDate: {
    fontFamily: MONO,
    fontSize: 13,
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
    fontSize: 16,
    fontVariantNumeric: "tabular-nums",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  specLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    letterSpacing: "0.05em",
  },
  tally: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  tallyLabel: {
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text-muted)",
    letterSpacing: "0.05em",
  },
  tallyValue: {
    fontFamily: MONO,
    fontWeight: 700,
    fontSize: 20,
    fontVariantNumeric: "tabular-nums",
  },
};

export default ExecutionStack;
