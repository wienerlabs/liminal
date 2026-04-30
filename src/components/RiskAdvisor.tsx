/**
 * LIMINAL — RiskAdvisor
 *
 * Renders the tips returned by `riskAdvisor.generateTips()` as a
 * collapsible card stack. Subscribes to `analyticsStore` so new tips
 * appear after each completed execution; also re-runs when the user
 * edits their slippage so a "lower it" tip vanishes once the user
 * already lowered it.
 *
 * Position: rendered inside ExecutionPanel above the FormCards when
 * the user is in IDLE / CONFIGURED state and has at least one prior
 * execution. Hidden during in-flight states (form is locked anyway,
 * no point in surfacing settings advice).
 *
 * Interaction:
 *   - Each tip can carry an optional `cta` with a `key` like
 *     "slippage:75". The consumer wires onApply to translate that
 *     into a real form mutation (setSlippageBps in this case).
 *   - "Dismiss" hides the tip for the current session via component
 *     state (no persistence — next execution may bring it back if
 *     conditions still warrant).
 */

import { useEffect, useMemo, useState, type CSSProperties, type FC } from "react";
import {
  generateTips,
  type AdvisorTip,
  type AdvisorContext,
} from "../services/riskAdvisor";
import {
  getHistory,
  type HistoricalExecution,
} from "../services/analyticsStore";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

export type RiskAdvisorProps = {
  currentSlippageBps: number;
  onApply?: (key: string) => void;
};

export const RiskAdvisor: FC<RiskAdvisorProps> = ({
  currentSlippageBps,
  onApply,
}) => {
  const [history, setHistory] = useState<HistoricalExecution[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Re-poll history every 5s so a new completed run shows fresh tips
  // without forcing a tab change. analyticsStore doesn't expose a
  // subscriber yet — minor follow-up to add one. For now the polling
  // is cheap (in-memory map read).
  useEffect(() => {
    setHistory(getHistory());
    const id = setInterval(() => setHistory(getHistory()), 5000);
    return () => clearInterval(id);
  }, []);

  const ctx: AdvisorContext = useMemo(
    () => ({ history, currentSlippageBps }),
    [history, currentSlippageBps],
  );

  const tips = useMemo(
    () => generateTips(ctx).filter((t) => !dismissed.has(t.id)),
    [ctx, dismissed],
  );

  if (tips.length === 0) return null;

  return (
    <section style={styles.root} aria-label="Risk advisor">
      <header style={styles.header}>
        <span style={styles.headerIcon} aria-hidden="true">
          ⚙
        </span>
        <span>Tips for you</span>
        <span style={styles.headerCount}>{tips.length}</span>
      </header>
      <ul style={styles.list}>
        {tips.map((tip) => (
          <TipRow
            key={tip.id}
            tip={tip}
            onApply={onApply}
            onDismiss={() => {
              setDismissed((prev) => {
                const next = new Set(prev);
                next.add(tip.id);
                return next;
              });
            }}
          />
        ))}
      </ul>
    </section>
  );
};

const TipRow: FC<{
  tip: AdvisorTip;
  onApply?: (key: string) => void;
  onDismiss: () => void;
}> = ({ tip, onApply, onDismiss }) => {
  const accent =
    tip.severity === "danger"
      ? "var(--color-danger)"
      : tip.severity === "warn"
        ? "var(--color-warn)"
        : "var(--color-success)";

  return (
    <li style={{ ...styles.row, borderLeftColor: accent }}>
      <div style={styles.rowMain}>
        <div style={{ ...styles.rowTitle, color: accent }}>
          {tip.title}
        </div>
        <div style={styles.rowBody}>{tip.body}</div>
        {tip.cta && onApply && (
          <button
            type="button"
            onClick={() => onApply(tip.cta!.key)}
            style={styles.applyButton}
            className="liminal-press"
          >
            {tip.cta.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss tip"
        onClick={onDismiss}
        style={styles.dismissButton}
        className="liminal-press"
      >
        ×
      </button>
    </li>
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
    backdropFilter: "blur(12px) saturate(130%)",
    WebkitBackdropFilter: "blur(12px) saturate(130%)",
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
  headerIcon: {
    fontSize: 14,
  },
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
    gap: 8,
  },
  row: {
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderRadius: 8,
  },
  rowMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 14,
  },
  rowBody: {
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
  },
  applyButton: {
    alignSelf: "flex-start",
    marginTop: 6,
    padding: "5px 10px",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: 6,
    cursor: "pointer",
  },
  dismissButton: {
    alignSelf: "flex-start",
    width: 24,
    height: 24,
    flexShrink: 0,
    background: "transparent",
    border: "none",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    fontFamily: MONO,
  },
};

export default RiskAdvisor;
