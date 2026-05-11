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
        <span style={styles.headerLabel}>Schedules</span>
        <span style={styles.headerCount}>{list.length}</span>
      </header>
      <ul style={styles.list}>
        {list.map((s) => (
          <li key={s.id} style={styles.row}>
            <span
              style={{
                ...styles.statusDot,
                background: s.paused
                  ? "var(--color-text-muted)"
                  : "var(--color-5)",
                boxShadow: s.paused
                  ? "none"
                  : "0 0 6px var(--color-5)",
              }}
              aria-hidden="true"
            />
            <div style={styles.rowMain}>
              <div style={styles.rowTitle}>
                <span style={styles.pair}>
                  {s.plan.inputSymbol} → {s.plan.outputSymbol}
                </span>
                <span style={styles.dot} aria-hidden="true">·</span>
                <span style={styles.cadence}>
                  every {humanInterval(s.cadence.intervalMs)}
                </span>
              </div>
              <div style={styles.rowMeta}>
                {s.plan.amountPerCycle.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                })}{" "}
                {s.plan.inputSymbol}
                <span style={styles.metaDivider} aria-hidden="true">·</span>
                {s.cyclesDone}/
                {s.cadence.totalCycles > 0 ? s.cadence.totalCycles : "∞"}
                <span style={styles.metaDivider} aria-hidden="true">·</span>
                {s.paused
                  ? "paused"
                  : formatCountdown(new Date(s.nextFireAt), now)}
              </div>
            </div>
            <div style={styles.rowActions}>
              <button
                type="button"
                onClick={() => pauseSchedule(s.id, !s.paused)}
                style={styles.ghostButton}
                className="liminal-press"
                aria-label={s.paused ? "Resume schedule" : "Pause schedule"}
              >
                {s.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={() => cancelSchedule(s.id)}
                style={styles.ghostButton}
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
        Local-first — keep this tab open for cycles to fire.
      </div>
    </section>
  );
};

const styles: Record<string, CSSProperties> = {
  root: {
    margin: "10px 16px",
    padding: "12px 14px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBottom: 2,
  },
  headerLabel: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    letterSpacing: "0.14em",
  },
  headerCount: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.06em",
    marginLeft: "auto",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  row: {
    display: "flex",
    gap: 10,
    padding: "8px 10px",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 8,
    alignItems: "center",
    transition:
      "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
    transition: "background var(--motion-base) var(--ease-out)",
  },
  rowMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
  },
  pair: {
    fontWeight: 600,
    letterSpacing: "0.01em",
  },
  cadence: {
    fontWeight: 400,
    color: "var(--color-text-muted)",
  },
  dot: {
    color: "var(--color-text-muted)",
    opacity: 0.5,
  },
  rowMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  metaDivider: {
    opacity: 0.4,
  },
  rowActions: {
    display: "inline-flex",
    gap: 4,
    flexShrink: 0,
  },
  ghostButton: {
    padding: "4px 10px",
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    cursor: "pointer",
    letterSpacing: "0.04em",
    transition:
      "color var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  footnote: {
    fontFamily: MONO,
    fontSize: 10,
    color: "var(--color-text-muted)",
    letterSpacing: "0.04em",
    paddingTop: 2,
    borderTop: "1px dashed var(--color-stroke)",
    marginTop: 2,
    paddingLeft: 2,
  },
};

export default DcaSchedulesPanel;
