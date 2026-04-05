/**
 * LIMINAL — ErrorCard
 *
 * BLOK 7 + BLOK 2 error handling disiplinine göre `ExecutionError` objesini
 * render eden standalone kart. `ExecutionTimeline` ERROR state'inde bu
 * bileşeni gösterir. `retryable` bayrağı retry/reset butonları ve başlık
 * ikonunu belirler.
 *
 * KAMINO_INSUFFICIENT_LIQUIDITY ve KAMINO_WITHDRAW_FAILED için ekstra
 * "fonlarınız güvende" mesajı gösterilir — kullanıcının paniklememesi için
 * kritik (Kamino fonları on-chain güvende, sadece manuel çekim gerekebilir).
 */

import type { CSSProperties, FC } from "react";
import {
  ErrorCode,
  type ExecutionError,
} from "../state/executionMachine";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME = {
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  border: "var(--color-stroke)",
  accent: "var(--color-5)",
  success: "var(--color-5)",
  amber: "var(--color-warn)",
  danger: "var(--color-warn)", // palette'te kırmızı yok — amber severity
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Error code → Türkçe başlık
// ---------------------------------------------------------------------------

function errorTitle(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.KAMINO_DEPOSIT_FAILED:
      return "Kamino Deposit Başarısız";
    case ErrorCode.KAMINO_WITHDRAW_FAILED:
      return "Kamino Çekim Başarısız";
    case ErrorCode.KAMINO_INSUFFICIENT_LIQUIDITY:
      return "Yetersiz Vault Likiditesi";
    case ErrorCode.DFLOW_QUOTE_EXPIRED:
      return "DFlow Quote Süresi Doldu";
    case ErrorCode.DFLOW_QUOTE_FAILED:
      return "DFlow Quote Alınamadı";
    case ErrorCode.DFLOW_SIMULATION_FAILED:
      return "Transaction Simulation Başarısız";
    case ErrorCode.DFLOW_EXECUTION_FAILED:
      return "DFlow Swap Başarısız";
    case ErrorCode.SLIPPAGE_EXCEEDED:
      return "Slippage Limiti Aşıldı";
    case ErrorCode.TRANSACTION_TIMEOUT:
      return "Transaction Zaman Aşımı";
    case ErrorCode.WALLET_REJECTED:
      return "Cüzdan Reddetti";
    case ErrorCode.UNKNOWN:
      return "Beklenmeyen Hata";
  }
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type ErrorCardProps = {
  error: ExecutionError;
  onRetry: () => void;
  onReset: () => void;
};

export const ErrorCard: FC<ErrorCardProps> = ({ error, onRetry, onReset }) => {
  const title = errorTitle(error.code);
  const iconColor = error.retryable ? THEME.amber : THEME.danger;
  const iconGlyph = error.retryable ? "⚠" : "✕";

  const showFundsSafeMessage =
    error.code === ErrorCode.KAMINO_INSUFFICIENT_LIQUIDITY ||
    error.code === ErrorCode.KAMINO_WITHDRAW_FAILED;

  return (
    <div
      style={{
        ...styles.card,
        borderColor: error.retryable
          ? "var(--color-warn-border)"
          : "var(--color-warn-border)",
        background: error.retryable
          ? "var(--color-warn-bg)"
          : "var(--color-warn-bg)",
      }}
      role="alert"
    >
      <div style={styles.header}>
        <div
          style={{
            ...styles.iconBadge,
            color: iconColor,
            borderColor: iconColor,
          }}
          aria-hidden="true"
        >
          {iconGlyph}
        </div>
        <div style={styles.titleBlock}>
          <div style={{ ...styles.title, color: iconColor }}>{title}</div>
          <div style={styles.timestamp}>
            {formatTime(error.timestamp)}'de oluştu
            {error.sliceIndex !== null && (
              <span style={styles.sliceBadge}>
                · Dilim {error.sliceIndex + 1}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={styles.message}>{error.message}</div>

      {showFundsSafeMessage && (
        <div style={styles.fundsSafe}>
          Bu hata otomatik düzeltilemez. Kamino'daki fonlarınız güvende,
          manuel çekim gerekebilir.
        </div>
      )}

      <div style={styles.actions}>
        {error.retryable ? (
          <button
            type="button"
            onClick={onRetry}
            style={styles.retryButton}
          >
            TEKRAR DENE
          </button>
        ) : (
          <button
            type="button"
            onClick={onReset}
            style={styles.resetButton}
          >
            EXECUTION'I SIFIRLA
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  card: {
    fontFamily: MONO,
    borderRadius: 8,
    padding: "14px 16px",
    border: "1px solid",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 4,
    border: "1px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    fontWeight: 700,
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  timestamp: {
    fontSize: 10,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  sliceBadge: {
    marginLeft: 4,
    color: THEME.textMuted,
  },
  message: {
    fontSize: 12,
    color: THEME.text,
    lineHeight: 1.5,
  },
  fundsSafe: {
    fontSize: 10,
    color: THEME.textMuted,
    lineHeight: 1.5,
    padding: "8px 10px",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: 4,
  },
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 2,
  },
  retryButton: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 6,
    padding: "10px 18px",
    cursor: "pointer",
    letterSpacing: 1,
  },
  resetButton: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.danger,
    border: "none",
    borderRadius: 6,
    padding: "10px 18px",
    cursor: "pointer",
    letterSpacing: 1,
  },
};

export default ErrorCard;
