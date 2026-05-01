/**
 * LIMINAL — PairQueuePanel
 *
 * Renders the active pair queue as a vertical list of steps with
 * status pills, current-step pulse, and a Cancel button. Sits above
 * the FormCards in ExecutionPanel (sibling to RiskAdvisor /
 * DcaSchedulesPanel) when a queue exists. Hidden otherwise.
 *
 * The queue itself is created via PairQueueComposer (a separate
 * sub-component, also in this file) — a small builder UI that
 * lets the user add 2-5 steps with the same controls as the main
 * form.
 */

import { useEffect, useMemo, useState, type CSSProperties, type FC } from "react";
import {
  clearQueue,
  createQueue,
  getActiveQueue,
  isQueueComplete,
  subscribePairQueue,
  totalCapturedUsd,
  type PairQueue,
  type QueueStep,
} from "../services/pairQueue";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

function formatUsd(n: number): string {
  return `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PairQueuePanel: FC = () => {
  const [queue, setQueue] = useState<PairQueue | null>(getActiveQueue);
  useEffect(() => subscribePairQueue(() => setQueue(getActiveQueue())), []);

  if (!queue) return null;

  const total = totalCapturedUsd();
  const complete = isQueueComplete();

  return (
    <section style={styles.root} aria-label="Pair queue">
      <header style={styles.header}>
        <span style={styles.headerIcon} aria-hidden="true">
          ⇒
        </span>
        <span>Pair queue</span>
        <span style={styles.headerCount}>
          {queue.steps.filter((s) => s.status === "done").length} /{" "}
          {queue.steps.length}
        </span>
      </header>
      <ol style={styles.list}>
        {queue.steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            isActive={s.status === "active"}
            isLast={i === queue.steps.length - 1}
          />
        ))}
      </ol>
      <div style={styles.footer}>
        <span style={styles.footerStat}>
          Total captured: <strong>{formatUsd(total)}</strong>
        </span>
        <button
          type="button"
          onClick={() => clearQueue()}
          style={styles.cancelButton}
          className="liminal-press"
        >
          {complete ? "Dismiss" : "Cancel queue"}
        </button>
      </div>
    </section>
  );
};

const StepRow: FC<{ step: QueueStep; isActive: boolean; isLast: boolean }> = ({
  step,
  isActive,
  isLast,
}) => {
  const accent =
    step.status === "done"
      ? "var(--color-success)"
      : step.status === "active"
        ? "var(--color-5-strong)"
        : step.status === "error"
          ? "var(--color-danger)"
          : step.status === "skipped"
            ? "var(--color-warn)"
            : "var(--color-text-subtle)";
  const statusLabel: Record<QueueStep["status"], string> = {
    pending: "Pending",
    active: "Active",
    done: "Done",
    error: "Error",
    skipped: "Skipped",
  };

  return (
    <li style={{ ...styles.row, borderLeftColor: accent }}>
      <div style={styles.rowMain}>
        <div style={styles.rowTitle}>
          {step.inputSymbol} → {step.outputSymbol}
          <span
            style={{
              ...styles.statusPill,
              color: accent,
              borderColor: accent,
            }}
          >
            {isActive && <span style={styles.activeDot} aria-hidden="true" />}
            {statusLabel[step.status]}
          </span>
        </div>
        <div style={styles.rowMeta}>
          {step.amount.toLocaleString("en-US", {
            maximumFractionDigits: 4,
          })}{" "}
          {step.inputSymbol} ·{" "}
          {Math.round(step.windowDurationMs / 60_000)}m window ·{" "}
          {step.sliceCount} slices
          {step.resultGainUsd != null && (
            <span style={{ marginLeft: 8, color: "var(--color-success)" }}>
              {formatUsd(step.resultGainUsd)}
            </span>
          )}
        </div>
      </div>
      {!isLast && (
        <span aria-hidden="true" style={styles.connector}>
          ↓
        </span>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// Composer — small inline UI to build a queue step-by-step.
// Imported separately by ExecutionPanel; tucked under the START button.
// ---------------------------------------------------------------------------

export type PairQueueComposerProps = {
  /** Used to seed the first step from the user's current form. */
  seed: {
    inputMint: string;
    outputMint: string;
    inputSymbol: string;
    outputSymbol: string;
    amount: number;
    windowDurationMs: number;
    sliceCount: number;
    slippageBps: number;
    preSignEnabled: boolean;
  };
};

export const PairQueueComposer: FC<PairQueueComposerProps> = ({ seed }) => {
  const [extraSteps, setExtraSteps] = useState<
    PairQueueComposerProps["seed"][]
  >([]);
  const [created, setCreated] = useState<boolean>(false);

  const allSteps = useMemo(
    () => [seed, ...extraSteps],
    [seed, extraSteps],
  );

  if (created) {
    return (
      <div style={styles.composerDone}>
        ✓ Queued {allSteps.length} steps — runner will pick up the first one
        once the wallet is idle.
      </div>
    );
  }

  return (
    <div style={styles.composer}>
      <span style={styles.composerHint}>
        ⇒ Or queue this as step 1 of a multi-pair run:
      </span>
      <span style={styles.composerStepCount}>
        {allSteps.length} {allSteps.length === 1 ? "step" : "steps"}
      </span>
      <button
        type="button"
        onClick={() => {
          // Add a duplicate of the seed (user can edit later — for
          // now we only support same-config repeat as a v1).
          if (allSteps.length >= 5) return;
          setExtraSteps((prev) => [...prev, seed]);
        }}
        disabled={allSteps.length >= 5}
        style={styles.addStepButton}
        className="liminal-press"
      >
        + Add step
      </button>
      <button
        type="button"
        onClick={() => {
          createQueue({ steps: allSteps });
          setCreated(true);
          setTimeout(() => setCreated(false), 2400);
        }}
        disabled={allSteps.length < 2}
        style={styles.createButton}
        className="liminal-press"
      >
        Queue {allSteps.length} steps
      </button>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  root: {
    margin: "10px 16px",
    padding: "14px 16px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  headerIcon: { fontSize: 14 },
  headerCount: {
    marginLeft: "auto",
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    background: "var(--color-accent-bg-soft)",
    color: "var(--color-5-strong)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: 999,
    padding: "1px 7px",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  row: {
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px",
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderRadius: 8,
    fontFamily: MONO,
    position: "relative",
  },
  rowMain: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  rowTitle: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 14,
    color: "var(--color-text)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  rowMeta: {
    fontFamily: MONO,
    fontSize: 12,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 8px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    border: "1px solid",
    borderRadius: 999,
    fontFamily: MONO,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "currentColor",
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
  },
  connector: {
    fontFamily: MONO,
    color: "var(--color-text-muted)",
    fontSize: 14,
    textAlign: "center",
    margin: "2px 0 -2px",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 6,
    borderTop: "1px dashed var(--color-stroke)",
  },
  footerStat: {
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text-muted)",
  },
  cancelButton: {
    padding: "6px 12px",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-warn)",
    background: "transparent",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    cursor: "pointer",
  },

  // Composer (inline under START button)
  composer: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px dashed var(--color-stroke)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text-muted)",
  },
  composerHint: { flex: 1, minWidth: 200 },
  composerStepCount: {
    fontFamily: MONO,
    fontWeight: 700,
    color: "var(--color-text)",
  },
  addStepButton: {
    padding: "5px 10px",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    cursor: "pointer",
  },
  createButton: {
    padding: "5px 12px",
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-text-inverse)",
    background: "var(--color-text)",
    border: "1px solid var(--color-text)",
    borderRadius: 6,
    cursor: "pointer",
  },
  composerDone: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(34, 197, 94, 0.12)",
    border: "1px solid rgba(34, 197, 94, 0.4)",
    color: "var(--color-success)",
    fontFamily: MONO,
    fontSize: 13,
  },
};

export default PairQueuePanel;
