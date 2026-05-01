/**
 * LIMINAL — ExecutionSummaryCard
 *
 * BLOK 7 "DONE" state'inin ExecutionPanel içindeki görsel karşılığı. Tam
 * ekran overlay değil — config form'unun yerini alan inline kart. Kullanıcı
 * "Yeni Execution Başlat" ile reset, "Detayları Gör" ile AnalyticsPanel'in
 * Geçmiş sekmesine yönlenir.
 *
 * Veri disiplini: bu component hiçbir şey üretmez, state machine'in DONE
 * snapshot'ını render eder.
 */

import type { CSSProperties, FC } from "react";
import type { ExecutionState } from "../state/executionMachine";
import { resolveTokenSymbol } from "../services/quicknode";
import { requestAnalyticsTab } from "../state/analyticsNav";
import Button from "./Button";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME = {
  panel: "var(--color-1)",
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  success: "var(--color-success)",
  amber: "var(--color-warn)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs < 1 ? 4 : 2;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatAmount(n: number, decimals = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function formatBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${bps.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type ExecutionSummaryCardProps = {
  state: ExecutionState;
  onReset: () => void;
};

export const ExecutionSummaryCard: FC<ExecutionSummaryCardProps> = ({
  state,
  onReset,
}) => {
  const completedSlices = state.slices.filter(
    (s) => s.status === "completed" && s.result,
  );

  const totalInput = completedSlices.reduce(
    (s, x) => s + (x.result?.inputAmount ?? 0),
    0,
  );
  const totalOutput = completedSlices.reduce(
    (s, x) => s + (x.result?.outputAmount ?? 0),
    0,
  );
  const averageFill = totalInput > 0 ? totalOutput / totalInput : 0;

  // Baseline: ilk slice'ın marketPrice'ı
  const baselinePrice =
    completedSlices.length > 0
      ? (completedSlices[0].result?.marketPrice ?? 0)
      : 0;

  const durationMs =
    state.startedAt && state.completedAt
      ? state.completedAt.getTime() - state.startedAt.getTime()
      : 0;

  const inputSymbol = state.config
    ? resolveTokenSymbol(state.config.inputMint)
    : "—";
  const outputSymbol = state.config
    ? resolveTokenSymbol(state.config.outputMint)
    : "—";

  // Kamino yield input token cinsinden; burada gösterilebilir ama
  // USD değeri için Pyth'e ihtiyacımız var. AnalyticsPanel bunu yapıyor —
  // burada input token miktarı + dolar karşılığını totalPriceImprovementUsd
  // üzerinden sadece DFlow için gösteriyoruz. Toplam value capture
  // hesabında Kamino yield token cinsinden ekleniyor (approximation).
  // Gerçek USD Kamino yield ile birleştirilmiş Toplam Kazanım AnalyticsPanel
  // Geçmiş sekmesindeki kart modal'ında daha doğru gösterilir.
  const kaminoYieldTokens = state.totalYieldEarned;
  const totalValueCaptureUsd = state.totalPriceImprovementUsd; // USD kesin kısım

  const handleViewDetails = (): void => {
    requestAnalyticsTab("history");
  };

  return (
    <div style={styles.card}>
      <div style={styles.checkmark}>
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="2"
            opacity="0.3"
          />
          <path
            d="M15 27L23 35L37 18"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="40"
            strokeDashoffset="0"
            style={{ animation: "liminal-checkmark-draw 600ms ease-out" }}
          />
        </svg>
      </div>
      <div style={styles.title}>Execution completed</div>

      <div style={styles.pairRow}>
        <span style={styles.pairText}>
          {inputSymbol} → {outputSymbol}
        </span>
      </div>
      <div style={styles.amountRow}>
        {formatAmount(totalInput, 4)} {inputSymbol}
      </div>
      <div style={styles.durationRow}>
        Duration: {formatDuration(durationMs)}
      </div>

      <div style={styles.divider} />

      <div style={styles.metricsGrid}>
        <Metric
          label="Average fill"
          value={formatAmount(averageFill, 6)}
        />
        <Metric
          label="Baseline"
          value={formatAmount(baselinePrice, 6)}
        />
        <Metric
          label="DFlow gain"
          value={formatUSD(state.totalPriceImprovementUsd)}
          sub={`${formatBps(state.totalPriceImprovementBps)} bps`}
          color={
            state.totalPriceImprovementUsd >= 0
              ? THEME.success
              : THEME.amber
          }
        />
        <Metric
          label="Kamino yield"
          value={`${formatAmount(kaminoYieldTokens, 6)} ${inputSymbol}`}
          sub="actual yield (tokens)"
          color={THEME.success}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.valueCaptureLabel}>TOTAL GAIN (DFLOW)</div>
      <div
        style={{
          ...styles.valueCaptureValue,
          color:
            totalValueCaptureUsd >= 0 ? THEME.success : THEME.amber,
        }}
      >
        {formatUSD(totalValueCaptureUsd)}
      </div>
      <div style={styles.valueCaptureHint}>
        Kamino yield USD value is shown in detail under Analytics → History.
      </div>

      <div style={styles.actions}>
        <Button variant="primary" onClick={onReset} style={{ width: "100%" }}>
          START NEW EXECUTION
        </Button>
        <Button variant="secondary" onClick={handleViewDetails} style={{ width: "100%" }}>
          VIEW DETAILS
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const Metric: FC<{
  label: string;
  value: string;
  sub?: string;
  color?: string;
}> = ({ label, value, sub, color }) => (
  <div style={styles.metric}>
    <div style={styles.metricLabel}>{label}</div>
    <div style={{ ...styles.metricValue, color: color ?? THEME.text }}>
      {value}
    </div>
    {sub && <div style={styles.metricSub}>{sub}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "28px 24px",
    gap: 10,
    background: "var(--color-accent-bg-soft)",
    border: `1px solid var(--color-accent-border)`,
    borderRadius: "var(--radius-lg)",
    margin: "16px",
    fontFamily: MONO,
  },
  checkmark: {
    lineHeight: 1,
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 19,
    fontWeight: 700,
    color: THEME.success,
    letterSpacing: 0,
    textTransform: "none",
  },
  pairRow: {
    marginTop: 6,
  },
  pairText: {
    fontSize: 21,
    fontWeight: 600,
    color: THEME.text,
  },
  amountRow: {
    fontSize: 18,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  durationRow: {
    fontSize: 16,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  divider: {
    width: "100%",
    height: 1,
    background: THEME.border,
    margin: "12px 0 4px",
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    width: "100%",
  },
  metric: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    alignItems: "center",
    textAlign: "center",
  },
  metricLabel: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  metricValue: {
    fontSize: 19,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  metricSub: {
    fontSize: 14,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  valueCaptureLabel: {
    fontSize: 15,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
    marginTop: 8,
  },
  valueCaptureValue: {
    fontSize: 36,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    marginTop: 2,
    lineHeight: 1.1,
    animation: "liminal-scale-in 600ms ease-out",
  },
  valueCaptureHint: {
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 1.5,
    marginTop: 6,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
    marginTop: 14,
  },
  primaryButton: {
    fontFamily: MONO,
    fontSize: 17,
    fontWeight: 700,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 8,
    padding: "14px 20px",
    width: "100%",
    letterSpacing: 0,
    cursor: "pointer",
    boxShadow: "0 0 28px var(--color-accent-bg-strong)",
  },
  secondaryButton: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: THEME.text,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "12px 20px",
    width: "100%",
    letterSpacing: 0,
    cursor: "pointer",
  },
};

export default ExecutionSummaryCard;
