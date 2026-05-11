/**
 * LIMINAL — ExecutionTimeline
 *
 * BLOK 7 "Aktif Execution Timeline Komponenti": state machine'in tüm
 * durumunu görsel olarak yansıtan yapı. ExecutionPanel içine gömülür.
 *
 * Üst özet bar (her status'ta görünür):
 *  - Tamamlanan dilim / toplam dilim
 *  - Toplam price improvement (bps + USD)
 *  - Tahmini kalan süre
 *  - Status label (Türkçe, dilim no ile enrich)
 *
 * Dilim listesi: pending (gri + hedef saat), executing (mor pulse),
 * completed (yeşil check + bps + süre), skipped (sarı uyarı).
 *
 * Hata kartı (ERROR state): mesaj + retry/reset butonları.
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import {
  ErrorCode,
  ExecutionStatus,
  type ExecutionState,
} from "../state/executionMachine";
import type { TWAPSlice } from "../services/dflow";
import ErrorCard from "./ErrorCard";
import ProgressRing from "./ProgressRing";
import Button from "./Button";
import CountdownTimer from "./CountdownTimer";

// ---------------------------------------------------------------------------
// Theme — CLAUDE.md BLOK 7 palet
// ---------------------------------------------------------------------------

const THEME = {
  panel: "var(--color-1)",
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  borderNested: "var(--color-stroke-nested)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  success: "var(--color-success)",
  amber: "var(--color-warn)",
  danger: "var(--color-danger)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatUSD(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs < 1 ? 4 : 2;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${bps.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} bps`;
}

/** Status → English label enriched with slice number. */
function statusLabel(state: ExecutionState): string {
  const n = state.currentSliceIndex + 1;
  switch (state.status) {
    case ExecutionStatus.IDLE:
      return "Ready";
    case ExecutionStatus.CONFIGURED:
      return "Configured";
    case ExecutionStatus.PREPARING:
      return "Preparing pre-signed plan...";
    case ExecutionStatus.DEPOSITING:
      return "Depositing to Kamino...";
    case ExecutionStatus.ACTIVE:
      return "Execution active";
    case ExecutionStatus.SLICE_WITHDRAWING:
      return `Slice ${n} withdrawing...`;
    case ExecutionStatus.SLICE_EXECUTING:
      return `Slice ${n} executing...`;
    case ExecutionStatus.COMPLETING:
      return "Completing...";
    case ExecutionStatus.DONE:
      return "Completed";
    case ExecutionStatus.ERROR:
      return "Error";
  }
}

function statusLabelColor(status: ExecutionStatus): string {
  switch (status) {
    case ExecutionStatus.DONE:
      return THEME.success;
    case ExecutionStatus.ERROR:
      return THEME.danger;
    case ExecutionStatus.ACTIVE:
    case ExecutionStatus.SLICE_WITHDRAWING:
    case ExecutionStatus.SLICE_EXECUTING:
    case ExecutionStatus.DEPOSITING:
    case ExecutionStatus.COMPLETING:
      return THEME.accent;
    default:
      return THEME.textMuted;
  }
}

// NOT: Hata başlıklarını ErrorCard üretiyor; bu dosyadan kaldırıldı.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type ExecutionTimelineProps = {
  state: ExecutionState;
  onRetry: () => void;
  onReset: () => void;
};

export const ExecutionTimeline: FC<ExecutionTimelineProps> = ({
  state,
  onRetry,
  onReset,
}) => {
  // 1s tick — kalan süre / "X saniye kaldı" gösterimi için.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const completedCount = state.slices.filter(
    (s) => s.status === "completed",
  ).length;
  const totalCount = state.slices.length;

  const remainingMs = state.estimatedCompletionAt
    ? Math.max(0, state.estimatedCompletionAt.getTime() - now.getTime())
    : 0;

  // SLIPPAGE_EXCEEDED error kodu timeline içinde bir HATA değil,
  // inline defer uyarısıdır — alt banner olarak gösterilir.
  const inlineSlippageWarning =
    state.error?.code === ErrorCode.SLIPPAGE_EXCEEDED;
  const isHardError =
    state.status === ExecutionStatus.ERROR && !inlineSlippageWarning;

  return (
    <section style={styles.card} aria-label="Execution timeline">
      {/* Üst özet bar */}
      <header style={styles.summaryBar}>
        <div style={styles.summaryLeft}>
          <div style={styles.summaryLabel}>Status</div>
          <div
            style={{
              ...styles.summaryValue,
              color: statusLabelColor(state.status),
            }}
          >
            {statusLabel(state)}
          </div>
        </div>

        <div style={{ ...styles.summaryCell, alignItems: "center" }}>
          <div style={styles.summaryLabel}>Slices</div>
          <ProgressRing
            completed={completedCount}
            total={totalCount}
            size={36}
            strokeWidth={3}
          />
        </div>

        <div style={styles.summaryCell}>
          <div style={styles.summaryLabel}>Bps</div>
          <div
            style={{
              ...styles.summaryValue,
              color:
                state.totalPriceImprovementBps > 0
                  ? THEME.success
                  : state.totalPriceImprovementBps < 0
                    ? THEME.danger
                    : THEME.textMuted,
            }}
          >
            {state.totalPriceImprovementBps !== 0
              ? formatBps(state.totalPriceImprovementBps)
              : "—"}
          </div>
        </div>

        <div style={styles.summaryCell}>
          <div style={styles.summaryLabel}>Usd</div>
          <div
            style={{
              ...styles.summaryValue,
              color:
                state.totalPriceImprovementUsd > 0
                  ? THEME.success
                  : state.totalPriceImprovementUsd < 0
                    ? THEME.danger
                    : THEME.textMuted,
            }}
          >
            {state.totalPriceImprovementUsd !== 0
              ? formatUSD(state.totalPriceImprovementUsd)
              : "—"}
          </div>
        </div>

        <div style={styles.summaryCell}>
          <div style={styles.summaryLabel}>Remaining</div>
          <CountdownTimer remainingMs={remainingMs} />
        </div>
      </header>

      {/* Inline slippage defer uyarısı (hata değil) */}
      {inlineSlippageWarning && state.error && (
        <div style={styles.slippageBanner} role="status">
          <span style={styles.slippageIcon}>⚠</span>
          <span>{state.error.message}</span>
        </div>
      )}

      {/* Dilim listesi with vertical connector line */}
      {state.slices.length > 0 && (
        <div style={styles.slicesList}>
          {state.slices.map((slice, idx) => (
            <div key={slice.sliceIndex} style={{ position: "relative" }}>
              {/* Vertical connector to the next slice — border longhands
                  (no shorthand) so React doesn't warn about mixed style
                  properties. Matches the slicesList gap (8px) exactly. */}
              {idx < state.slices.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 22,
                    top: "100%",
                    width: 0,
                    height: 8,
                    borderLeftWidth: 2,
                    borderLeftStyle:
                      slice.status === "completed" ? "solid" : "dashed",
                    borderLeftColor:
                      slice.status === "completed"
                        ? "var(--color-5)"
                        : "var(--color-stroke)",
                    zIndex: 0,
                  }}
                />
              )}
              <SliceRow
                slice={slice}
                isActive={
                  slice.sliceIndex === state.currentSliceIndex &&
                  (state.status === ExecutionStatus.SLICE_WITHDRAWING ||
                    state.status === ExecutionStatus.SLICE_EXECUTING ||
                    state.status === ExecutionStatus.ACTIVE)
                }
                now={now}
              />
            </div>
          ))}
        </div>
      )}

      {/* Hata kartı — ErrorCard'a delege */}
      {isHardError && state.error && (
        <ErrorCard
          error={state.error}
          onRetry={onRetry}
          onReset={onReset}
        />
      )}

      {/* DONE summary */}
      {state.status === ExecutionStatus.DONE && (
        <div style={styles.doneCard}>
          <div style={styles.doneTitle}>Execution completed</div>
          <div style={styles.doneGrid}>
            <DoneMetric
              label="Total improvement"
              value={formatBps(state.totalPriceImprovementBps)}
              color={
                state.totalPriceImprovementBps >= 0
                  ? THEME.success
                  : THEME.amber
              }
            />
            <DoneMetric
              label="In USD"
              value={formatUSD(state.totalPriceImprovementUsd)}
              color={
                state.totalPriceImprovementUsd >= 0
                  ? THEME.success
                  : THEME.amber
              }
            />
            <DoneMetric
              label="Kamino yield"
              value={formatUSD(state.totalYieldEarned)}
              color={THEME.success}
            />
            <DoneMetric
              label="Duration"
              value={
                state.startedAt && state.completedAt
                  ? formatDuration(
                      state.completedAt.getTime() -
                        state.startedAt.getTime(),
                    )
                  : "—"
              }
              color={THEME.text}
            />
          </div>
          <Button variant="primary" onClick={onReset}>
            NEW EXECUTION
          </Button>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SliceRow: FC<{
  slice: TWAPSlice;
  isActive: boolean;
  now: Date;
}> = ({ slice, isActive, now }) => {
  const status = slice.status;
  const [expanded, setExpanded] = useState(false);

  const iconColor =
    status === "completed"
      ? THEME.success
      : status === "executing"
        ? THEME.accent
        : status === "skipped"
          ? THEME.amber
          : THEME.textMuted;

  const isExecutingNow = status === "executing" || isActive;

  const secondsUntil = Math.max(
    0,
    Math.floor((slice.targetExecutionTime.getTime() - now.getTime()) / 1000),
  );

  // Time-elapsed counter (mm:ss) for the actively-executing slice. Counts
  // from targetExecutionTime if it has passed, otherwise from now.
  const elapsedSec =
    status === "executing"
      ? Math.max(
          0,
          Math.floor((now.getTime() - slice.targetExecutionTime.getTime()) / 1000),
        )
      : 0;

  const expandable = status === "completed" && slice.result != null;

  return (
    <div
      style={{
        ...styles.sliceRow,
        cursor: expandable ? "pointer" : "default",
        // Soft halo when active so the eye locks onto the row that's
        // currently working.
        boxShadow: isExecutingNow
          ? "0 0 0 1px var(--color-accent-border), 0 0 12px rgba(249, 178, 215, 0.25)"
          : undefined,
      }}
      onClick={() => expandable && setExpanded((v) => !v)}
      role={expandable ? "button" : undefined}
      aria-expanded={expandable ? expanded : undefined}
      aria-label={
        expandable
          ? `Slice ${slice.sliceIndex + 1} details — ${expanded ? "collapse" : "expand"}`
          : undefined
      }
    >
      <div
        style={{
          ...styles.sliceIcon,
          color: iconColor,
        }}
      >
        {status === "completed" ? (
          <CheckmarkSvg color={iconColor} />
        ) : status === "executing" ? (
          <span style={styles.executingDot} aria-hidden="true" />
        ) : status === "skipped" ? (
          <span style={{ fontSize: 20 }}>⚠</span>
        ) : (
          <span style={styles.pendingRing} aria-hidden="true" />
        )}
      </div>
      <div style={styles.sliceBody}>
        <div style={styles.sliceHeader}>
          <span style={styles.sliceNumber}>
            Slice {slice.sliceIndex + 1}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {status === "executing" && (
              <span style={styles.elapsedBadge} aria-label="Time elapsed">
                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
              </span>
            )}
            <span style={styles.sliceAmount}>
              {slice.amount.toLocaleString("en-US", {
                maximumFractionDigits: 6,
              })}
            </span>
          </span>
        </div>
        <div style={styles.sliceSubtle}>
          {status === "pending" && (
            <>
              {secondsUntil > 0
                ? `~${formatTime(slice.targetExecutionTime)}`
                : "Awaiting turn..."}
            </>
          )}
          {status === "executing" && "Executing..."}
          {status === "skipped" && "Slippage exceeded, deferred"}
          {status === "completed" && slice.result && (
            <CompletedDetails result={slice.result} />
          )}
        </div>
        {/* Expanded — explorer details, fee, signature copy. Only on
            completed slices with a result. */}
        {expanded && slice.result && (
          <SliceExpanded result={slice.result} />
        )}
      </div>
      {expandable && (
        <span
          aria-hidden="true"
          style={{
            ...styles.expandChevron,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 4l3 3 3-3"
              stroke="var(--color-text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </div>
  );
};

// Animated draw-on checkmark — replaces the static "✓" glyph for
// completed slices. The path animates from 0 to full length over 360ms
// using stroke-dasharray, then settles at the success color. Each row
// animates independently when it transitions to "completed", giving the
// timeline a satisfying "tick, tick, tick" rhythm during execution.
const CheckmarkSvg: FC<{ color: string }> = ({ color }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style={{ display: "block" }}
  >
    <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" opacity="0.4" />
    <path
      d="M7 12.5l3 3 7-7"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        // Existing keyframe `liminal-checkmark-draw` animates
        // `stroke-dashoffset` from 40 → 0; matching dasharray here keeps
        // the path invisible at start and fully drawn at end.
        strokeDasharray: 40,
        strokeDashoffset: 40,
        animation: "liminal-checkmark-draw 360ms var(--ease-out) forwards",
      }}
    />
  </svg>
);

const SliceExpanded: FC<{
  result: NonNullable<TWAPSlice["result"]>;
}> = ({ result }) => {
  const [copied, setCopied] = useState(false);
  const sigShort = `${result.signature.slice(0, 8)}…${result.signature.slice(-8)}`;
  const explorerUrl = `https://solscan.io/tx/${result.signature}`;
  return (
    <div
      style={styles.sliceExpanded}
      // Don't propagate row click into the expanded panel.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={styles.expandedRow}>
        <span style={styles.expandedLabel}>Tx</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(result.signature).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          style={styles.expandedSig}
          title="Click to copy full signature"
        >
          {copied ? "Copied" : sigShort}
        </button>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.explorerLink}
          aria-label="View on Solscan"
        >
          Explorer ↗
        </a>
      </div>
      <div style={styles.expandedRow}>
        <span style={styles.expandedLabel}>Fee</span>
        <span style={styles.expandedValue}>
          {result.fee.toFixed(6)} SOL
        </span>
      </div>
      <div style={styles.expandedRow}>
        <span style={styles.expandedLabel}>Confirmed</span>
        <span style={styles.expandedValue}>
          {result.confirmedAt.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
};

const CompletedDetails: FC<{
  result: NonNullable<TWAPSlice["result"]>;
}> = ({ result }) => {
  const bpsColor =
    result.priceImprovementBps > 0
      ? THEME.success
      : result.priceImprovementBps < 0
        ? THEME.danger
        : THEME.textMuted;
  return (
    <span>
      <span>
        fill {result.executionPrice.toLocaleString("en-US", {
          maximumFractionDigits: 6,
        })}
      </span>
      <span style={{ color: bpsColor, marginLeft: 8 }}>
        {formatBps(result.priceImprovementBps)}
      </span>
    </span>
  );
};

const DoneMetric: FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={styles.doneMetric}>
    <div style={styles.doneMetricLabel}>{label}</div>
    <div style={{ ...styles.doneMetricValue, color }}>{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  card: {
    fontFamily: MONO,
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-lg)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  summaryBar: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.7fr 1fr 1fr 1fr",
    gap: 8,
    padding: "10px 0",
    borderBottom: `1px solid ${THEME.border}`,
    alignItems: "end",
  },
  summaryLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  summaryCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "right",
  },
  summaryLabel: {
    fontSize: 15,
    color: THEME.textMuted,
    letterSpacing: 0,
    fontWeight: 600,
    textTransform: "none",
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 600,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  slippageBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 6,
    fontSize: 17,
    color: THEME.amber,
  },
  slippageIcon: {
    fontSize: 19,
  },
  slicesList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sliceRow: {
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    position: "relative",
    overflow: "hidden",
    transition:
      "box-shadow var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out)",
  },
  sliceIcon: {
    fontSize: 23,
    width: 22,
    height: 22,
    textAlign: "center",
    flexShrink: 0,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // Pulsing dot for the actively-executing slice — replaces the bare
  // "●" glyph, larger and with a soft accent halo.
  executingDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "var(--color-5)",
    boxShadow: "0 0 0 4px rgba(249, 178, 215, 0.18), 0 0 12px var(--color-5)",
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
  },
  // Pending ring — replaces the "○" character so it actually looks like
  // a thin outline, not a fat zero.
  pendingRing: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    border: "1.5px solid var(--color-text-subtle)",
    background: "transparent",
  },
  elapsedBadge: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-5-strong)",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    padding: "2px 6px",
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
  },
  expandChevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    flexShrink: 0,
    alignSelf: "flex-start",
    marginTop: 2,
    transition: "transform var(--motion-base) var(--ease-out)",
  },
  // Expanded panel — appears under the slice subtitle when a completed
  // slice is clicked. Three rows: tx (with copy + explorer), fee,
  // confirmed timestamp. Light-touch border so it reads as a sub-pane,
  // not a separate card.
  sliceExpanded: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 8,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    fontFamily: MONO,
    fontSize: 13,
  },
  expandedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  expandedLabel: {
    color: "var(--color-text-muted)",
    width: 64,
    flexShrink: 0,
    letterSpacing: "0.04em",
    fontSize: 12,
  },
  expandedSig: {
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text)",
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontVariantNumeric: "tabular-nums",
  },
  expandedValue: {
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
  },
  explorerLink: {
    marginLeft: "auto",
    color: "var(--color-5-strong)",
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
  },
  sliceBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },
  sliceHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  sliceNumber: {
    fontSize: 17,
    color: THEME.text,
    fontWeight: 600,
  },
  sliceAmount: {
    fontSize: 17,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  sliceSubtle: {
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  // NOT: errorCard ve ilgili stiller ErrorCard'a taşındı.
  doneCard: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "16px 18px",
    background: "var(--color-accent-bg-soft)",
    border: `1px solid var(--color-accent-border)`,
    borderRadius: 8,
  },
  doneTitle: {
    fontSize: 15,
    color: THEME.success,
    letterSpacing: 0,
    textTransform: "none",
    fontWeight: 700,
  },
  doneGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  doneMetric: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  doneMetricLabel: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  doneMetricValue: {
    fontSize: 20,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  doneResetButton: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 6,
    padding: "10px 18px",
    cursor: "pointer",
    letterSpacing: 0,
    alignSelf: "flex-start",
  },
};

export default ExecutionTimeline;
