/**
 * LIMINAL — DcaSchedulesPanel
 *
 * Lists active DCA schedules + lets the user pause / cancel each one.
 * Subscribes to dcaScheduler so changes from the runner (markRan,
 * deferSchedule) reflect immediately.
 *
 * Rendered inside ExecutionPanel above the FormCards (sibling to
 * RiskAdvisor) when there's at least one schedule. Empty state
 * suppressed — the "Repeat as DCA" button on the form is the entry
 * point; once a schedule exists, this panel surfaces it.
 *
 * Each row shows:
 *   - Pair + cadence label
 *   - cyclesDone / totalCycles progress
 *   - Next fire countdown (mm:ss for < 1h, otherwise hours/days)
 *   - Pause toggle + Cancel button
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import {
  cancelSchedule,
  listSchedules,
  pauseSchedule,
  subscribeSchedules,
  humanInterval,
  type DcaSchedule,
} from "../services/dcaScheduler";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

function formatCountdown(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return day === 1 ? "in 1 day" : `in ${day} days`;
}

export const DcaSchedulesPanel: FC = () => {
  const [list, setList] = useState<DcaSchedule[]>(listSchedules);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => subscribeSchedules(() => setList(listSchedules())), []);

  // Tick once a second for the countdown text. Cheap; the rendered
  // strings don't change unless target crosses a boundary anyway.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (list.length === 0) return null;

  return (
    <section style={styles.root} aria-label="DCA schedules">
      <header style={styles.header}>
        <span style={styles.headerIcon} aria-hidden="true">
          ↻
        </span>
        <span>DCA schedules</span>
        <span style={styles.headerCount}>{list.length}</span>
      </header>
      <ul style={styles.list}>
        {list.map((s) => (
          <li key={s.id} style={styles.row}>
            <div style={styles.rowMain}>
              <div style={styles.rowTitle}>
                {s.plan.inputSymbol} → {s.plan.outputSymbol}
                <span style={styles.rowCadence}>
                  · every {humanInterval(s.cadence.intervalMs)}
                </span>
              </div>
              <div style={styles.rowMeta}>
                {s.plan.amountPerCycle.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                })}{" "}
                {s.plan.inputSymbol} per cycle ·{" "}
                {s.cyclesDone} / {s.cadence.totalCycles > 0 ? s.cadence.totalCycles : "∞"}
                {" · next "}
                {s.paused ? "paused" : formatCountdown(new Date(s.nextFireAt), now)}
              </div>
            </div>
            <div style={styles.rowActions}>
              <button
                type="button"
                onClick={() => pauseSchedule(s.id, !s.paused)}
                style={styles.pauseButton}
                className="liminal-press"
                aria-label={s.paused ? "Resume schedule" : "Pause schedule"}
              >
                {s.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={() => cancelSchedule(s.id)}
                style={styles.cancelButton}
                className="liminal-press"
                aria-label="Cancel schedule"
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div style={styles.footnote}>
        DCA is local-first: this tab must stay open for cycles to fire.
        Closing the tab pauses the schedule until you return.
      </div>
    </section>
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
    borderRadius: 8,
    alignItems: "center",
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
    color: "var(--color-text)",
  },
  rowCadence: {
    fontWeight: 400,
    color: "var(--color-text-muted)",
    marginLeft: 6,
  },
  rowMeta: {
    fontFamily: MONO,
    fontSize: 12,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  rowActions: {
    display: "inline-flex",
    gap: 6,
    flexShrink: 0,
  },
  pauseButton: {
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
  cancelButton: {
    padding: "5px 10px",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-warn)",
    background: "transparent",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    cursor: "pointer",
  },
  footnote: {
    fontFamily: SANS,
    fontSize: 12,
    color: "var(--color-text-muted)",
    fontStyle: "italic",
    lineHeight: 1.4,
  },
};

export default DcaSchedulesPanel;
