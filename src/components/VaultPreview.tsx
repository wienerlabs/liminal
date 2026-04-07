/**
 * LIMINAL — VaultPreview
 *
 * BLOK 4 (Kamino) + BLOK 7 (UX) altında, ExecutionPanel'in içine gömülecek
 * küçük bir preview komponenti. Kullanıcı token seçtiğinde otomatik seçilen
 * Kamino vault'un APY'sini ve execution window boyunca tahmini yield'ını
 * gösterir.
 *
 * Bu component ExecutionPanel'e henüz bağlanmıyor — bir sonraki prompt'ta
 * state machine ile entegre edilecek.
 *
 * Props:
 * - vault: seçilmiş Kamino vault (null → "bulunamadı" uyarısı)
 * - isLoading: vault yüklenirken skeleton göster
 * - amountUsd: kullanıcının girdiği miktarın USD karşılığı (yield formülü için)
 * - windowDurationSeconds: execution window süresi (saniye)
 *
 * Formül (BLOK 4 user spec):
 *   estimatedYield = amountUsd * (supplyAPY/100) * (windowDuration / 31536000)
 */

import type { CSSProperties, FC } from "react";
import type { KaminoVault } from "../services/kamino";

// ---------------------------------------------------------------------------
// Theme — CLAUDE.md BLOK 7 palet
// ---------------------------------------------------------------------------

const THEME = {
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  borderNested: "var(--color-stroke-nested)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  success: "var(--color-success)",
  amber: "var(--color-warn)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

const SECONDS_PER_YEAR = 31_536_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(n: number): string {
  const decimals = Math.abs(n) < 1 ? 4 : 2;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatAPY(apy: number): string {
  return `%${apy.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function computeEstimatedYield(
  amountUsd: number,
  supplyAPY: number,
  windowDurationSeconds: number,
): number {
  if (
    !Number.isFinite(amountUsd) ||
    !Number.isFinite(supplyAPY) ||
    !Number.isFinite(windowDurationSeconds) ||
    amountUsd <= 0 ||
    supplyAPY <= 0 ||
    windowDurationSeconds <= 0
  ) {
    return 0;
  }
  return amountUsd * (supplyAPY / 100) * (windowDurationSeconds / SECONDS_PER_YEAR);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type VaultPreviewProps = {
  vault: KaminoVault | null;
  isLoading: boolean;
  amountUsd: number;
  windowDurationSeconds: number;
};

export const VaultPreview: FC<VaultPreviewProps> = ({
  vault,
  isLoading,
  amountUsd,
  windowDurationSeconds,
}) => {
  // Loading state — henüz vault çekiliyor.
  if (isLoading) {
    return (
      <div style={styles.card} aria-busy="true">
        <div style={styles.label}>KAMINO VAULT</div>
        <SkeletonBox width="70%" height={18} />
        <div style={styles.gap} />
        <SkeletonBox width="40%" height={28} />
        <div style={styles.gap} />
        <SkeletonBox width="90%" height={14} />
      </div>
    );
  }

  // Vault bulunamadı — turuncu uyarı.
  if (!vault) {
    return (
      <div style={styles.warningCard} role="alert">
        <div style={styles.warningTitle}>NO VAULT FOUND</div>
        <div style={styles.warningText}>
          No active Kamino vault found for this token. Idle capital cannot
          be parked.
        </div>
      </div>
    );
  }

  const estimatedYield = computeEstimatedYield(
    amountUsd,
    vault.supplyAPY,
    windowDurationSeconds,
  );

  return (
    <div style={styles.card}>
      <div style={styles.label}>KAMINO VAULT</div>

      <div style={styles.vaultName}>
        {vault.marketName}{" "}
        <span style={styles.vaultSymbol}>· {vault.symbol}</span>
      </div>

      <div style={styles.apyRow}>
        <span style={styles.apyLabel}>Supply APY</span>
        <span style={styles.apyValue}>{formatAPY(vault.supplyAPY)}</span>
      </div>

      <div style={styles.divider} />

      <div style={styles.yieldLabel}>Estimated yield for this execution</div>
      <div style={styles.yieldValue}>{formatUSD(estimatedYield)}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SkeletonBox: FC<{ width: string | number; height: number }> = ({
  width,
  height,
}) => (
  <div
    aria-hidden="true"
    style={{
      width,
      height,
      borderRadius: 4,
      background: `linear-gradient(90deg, ${THEME.panelElevated} 0%, var(--color-3) 50%, ${THEME.panelElevated} 100%)`,
      backgroundSize: "200% 100%",
      animation: "liminal-shimmer 1.4s ease-in-out infinite",
    }}
  />
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  card: {
    fontFamily: MONO,
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-md)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
  },
  warningCard: {
    fontFamily: MONO,
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: "var(--radius-md)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  vaultName: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.text,
    marginBottom: 10,
  },
  vaultSymbol: {
    color: THEME.textMuted,
  },
  apyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  apyLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  apyValue: {
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: 700,
    color: THEME.success,
    fontVariantNumeric: "tabular-nums",
  },
  divider: {
    height: 1,
    background: THEME.border,
    margin: "8px 0",
  },
  yieldLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  yieldValue: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: 600,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  gap: {
    height: 10,
  },
  warningTitle: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.amber,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  warningText: {
    fontFamily: MONO,
    fontSize: 12,
    color: THEME.amber,
    lineHeight: 1.5,
  },
};

export default VaultPreview;
