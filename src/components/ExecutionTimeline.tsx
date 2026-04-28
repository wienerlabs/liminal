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

  const iconColor =
    status === "completed"
      ? THEME.success
      : status === "executing"
        ? THEME.accent
        : status === "skipped"
          ? THEME.amber
          : THEME.textMuted;

  const iconGlyph =
    status === "completed"
      ? "✓"
      : status === "executing"
        ? "●"
        : status === "skipped"
          ? "⚠"
          : "○";

  const isExecutingNow = status === "executing" || isActive;

  const secondsUntil = Math.max(
    0,
    Math.floor((slice.targetExecutionTime.getTime() - now.getTime()) / 1000),
  );

  return (
    <div
      style={styles.sliceRow}
      className={undefined}
    >
      <div
        style={{
          ...styles.sliceIcon,
          color: iconColor,
          animation: isExecutingNow
            ? "liminal-pulse 1.2s ease-in-out infinite"
            : undefined,
        }}
      >
        {iconGlyph}
      </div>
      <div style={styles.sliceBody}>
        <div style={styles.sliceHeader}>
          <span style={styles.sliceNumber}>
            Slice {slice.sliceIndex + 1}
          </span>
          <span style={styles.sliceAmount}>
            {slice.amount.toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}
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
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: 0,
    fontWeight: 600,
    textTransform: "none",
  },
  summaryValue: {
    fontSize: 16,
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
    fontSize: 15,
    color: THEME.amber,
  },
  slippageIcon: {
    fontSize: 17,
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
  },
  sliceIcon: {
    fontSize: 21,
    width: 22,
    textAlign: "center",
    flexShrink: 0,
    lineHeight: 1,
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
    fontSize: 15,
    color: THEME.text,
    fontWeight: 600,
  },
  sliceAmount: {
    fontSize: 15,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  sliceSubtle: {
    fontSize: 13,
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
    fontSize: 13,
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
    fontSize: 12,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  doneMetricValue: {
    fontSize: 18,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  doneResetButton: {
    fontFamily: MONO,
    fontSize: 14,
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
