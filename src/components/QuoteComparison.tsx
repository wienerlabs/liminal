/**
 * LIMINAL — QuoteComparison
 *
 * BLOK 3 (DFlow) + BLOK 7 (UX) altında ExecutionPanel'in içine gömülecek
 * quote karşılaştırma kartı. Jüri "integration depth" kriteri için bu
 * component kritik: DFlow'un price improvement'ını sayısal kanıt olarak
 * gösterir.
 *
 * Görsel düzen:
 * - Sol: market (baseline) fiyat, gri
 * - Sağ: DFlow quote fiyatı, mor/yeşil
 * - Orta: bps farkı büyük font, pozitifse yeşil "+X.XX bps DFlow avantajı",
 *          negatifse sarı "-X.XX bps" uyarısı
 * - Alt: USD cinsinden karşılık ("$X.XX ekstra" / "$X.XX daha az")
 * - Countdown: "Quote N saniye içinde sona eriyor" (10s altı kırmızı)
 * - Expiry'de onRefresh callback'ini tetikler ve "Quote yenilendi" bildirimi gösterir
 * - Slippage error'ı props.error üzerinden algılar → sarı "fiyat bekleniyor" state'i
 *
 * Bu component ExecutionPanel'e henüz bağlanmıyor — bir sonraki prompt'ta
 * state machine ile entegre edilecek.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  isDFlowSlippageError,
  type DFlowQuote,
} from "../services/dflow";

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
  danger: "var(--color-danger)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBps(bps: number): string {
  return bps.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUSD(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs < 1 ? 4 : 2;
  return `$${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatRate(leg: { inAmount: number; outAmount: number }): string {
  if (leg.inAmount <= 0) return "—";
  const rate = leg.outAmount / leg.inAmount;
  const decimals = rate < 1 ? 6 : 4;
  return rate.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type QuoteComparisonProps = {
  quote: DFlowQuote | null;
  isLoading: boolean;
  error?: string | null;
  /**
   * Quote expiry olduğunda çağrılır. Sağlanırsa component otomatik
   * yeni quote almayı tetikler ve "Quote yenilendi" bildirimi gösterir.
   */
  onRefresh?: () => void | Promise<void>;
};

export const QuoteComparison: FC<QuoteComparisonProps> = ({
  quote,
  isLoading,
  error,
  onRefresh,
}) => {
  // 1s tick — countdown için.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh durumu.
  const [refreshNotice, setRefreshNotice] = useState<boolean>(false);
  const refreshingRef = useRef<boolean>(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quote expiry check → onRefresh tetikle.
  useEffect(() => {
    if (!quote || !onRefresh) return;
    const msLeft = quote.dflowQuote.expiresAt - now.getTime();
    if (msLeft > 0 || refreshingRef.current) return;

    refreshingRef.current = true;
    (async () => {
      try {
        await onRefresh();
      } finally {
        refreshingRef.current = false;
        setRefreshNotice(true);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => {
          setRefreshNotice(false);
        }, 3000);
      }
    })();
  }, [now, quote, onRefresh]);

  // Temizlik.
  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Render: slippage uyarısı (BLOK 3 slippage disiplini)
  // -----------------------------------------------------------------------
  if (isDFlowSlippageError(error)) {
    return (
      <div style={styles.warningCard} role="alert">
        <div style={styles.warningTitle}>WAITING FOR PRICE</div>
        <div style={styles.warningText}>
          Current slippage exceeds limit, waiting for price to recover...
        </div>
        <div style={styles.warningDetail}>{error}</div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: generic error
  // -----------------------------------------------------------------------
  if (error && !quote) {
    return (
      <div style={styles.errorCard} role="alert">
        <div style={styles.errorTitle}>QUOTE FAILED</div>
        <div style={styles.errorText}>{error}</div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: loading skeleton
  // -----------------------------------------------------------------------
  if (isLoading && !quote) {
    return (
      <div style={styles.card} aria-busy="true">
        <div style={styles.label}>QUOTE COMPARISON</div>
        <div style={styles.columns}>
          <SkeletonColumn />
          <SkeletonCenter />
          <SkeletonColumn />
        </div>
        <div style={styles.gap} />
        <SkeletonBox width="60%" height={14} />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: boş durum
  // -----------------------------------------------------------------------
  if (!quote) {
    return (
      <div style={styles.card}>
        <div style={styles.label}>QUOTE COMPARISON</div>
        <div style={styles.hintText}>
          Select a token pair and amount to fetch a quote.
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: full comparison
  // -----------------------------------------------------------------------
  const { marketQuote, dflowQuote } = quote;
  const bps = dflowQuote.priceImprovementBps;
  const isImprovement = bps > 0;
  const isLoss = bps < 0;

  const msLeft = dflowQuote.expiresAt - now.getTime();
  const secondsLeft = Math.max(0, Math.floor(msLeft / 1000));
  const countdownCritical = secondsLeft < 10;
  const countdownExpired = secondsLeft === 0;

  return (
    <div style={styles.card}>
      <div style={styles.label}>QUOTE COMPARISON</div>

      {refreshNotice && (
        <div style={styles.refreshNotice} role="status">
          Quote refreshed
        </div>
      )}

      <div style={styles.columns}>
        {/* Market (baseline) — sol, gri */}
        <div style={styles.columnLeft}>
          <div style={styles.columnLabel}>MARKET</div>
          <div style={styles.marketRate}>{formatRate(marketQuote)}</div>
          <div style={styles.columnSubtle}>
            {marketQuote.outAmount.toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}{" "}
            out
          </div>
        </div>

        {/* Orta — bps farkı büyük font */}
        <div style={styles.columnCenter}>
          <div
            style={{
              ...styles.bpsValue,
              color: isImprovement
                ? THEME.success
                : isLoss
                  ? THEME.amber
                  : THEME.textMuted,
            }}
          >
            {bps >= 0 ? "+" : ""}
            {formatBps(bps)} bps
          </div>
          <div
            style={{
              ...styles.bpsLabel,
              color: isImprovement
                ? THEME.success
                : isLoss
                  ? THEME.amber
                  : THEME.textMuted,
            }}
          >
            {isImprovement
              ? "DFlow advantage"
              : isLoss
                ? "DFlow disadvantage"
                : "equal"}
          </div>
        </div>

        {/* DFlow — sağ, mor/yeşil */}
        <div style={styles.columnRight}>
          <div style={styles.columnLabelAccent}>DFLOW</div>
          <div
            style={{
              ...styles.dflowRate,
              color: isImprovement ? THEME.success : THEME.accent,
            }}
          >
            {formatRate(dflowQuote)}
          </div>
          <div style={styles.columnSubtle}>
            {dflowQuote.outAmount.toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}{" "}
            out
          </div>
        </div>
      </div>

      <div style={styles.divider} />

      {/* USD equivalent */}
      <div style={styles.usdRow}>
        <span style={styles.usdLabel}>In USD</span>
        <span
          style={{
            ...styles.usdValue,
            color: isImprovement
              ? THEME.success
              : isLoss
                ? THEME.amber
                : THEME.textMuted,
          }}
        >
          {dflowQuote.priceImprovement === 0
            ? "—"
            : isImprovement
              ? `${formatUSD(dflowQuote.priceImprovement)} extra`
              : `${formatUSD(dflowQuote.priceImprovement)} less`}
        </span>
      </div>

      {/* Countdown */}
      <div
        style={{
          ...styles.countdown,
          color: countdownCritical ? THEME.danger : THEME.textMuted,
        }}
      >
        {countdownExpired
          ? "Quote expired, refreshing..."
          : `Quote expires in ${secondsLeft}s`}
      </div>
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

const SkeletonColumn: FC = () => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
    <SkeletonBox width="50%" height={10} />
    <SkeletonBox width="80%" height={20} />
    <SkeletonBox width="60%" height={10} />
  </div>
);

const SkeletonCenter: FC = () => (
  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
    }}
  >
    <SkeletonBox width="70%" height={24} />
    <SkeletonBox width="50%" height={10} />
  </div>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  card: {
    fontFamily: MONO,
    background: THEME.panelElevated,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
  },
  label: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  columns: {
    display: "flex",
    alignItems: "stretch",
    gap: 12,
  },
  columnLeft: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-start",
  },
  columnCenter: {
    flex: 1.2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderLeft: `1px dashed ${THEME.border}`,
    borderRight: `1px dashed ${THEME.border}`,
    padding: "0 12px",
  },
  columnRight: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-end",
  },
  columnLabel: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.textMuted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  columnLabelAccent: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  marketRate: {
    fontFamily: MONO,
    fontSize: 16,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  dflowRate: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  columnSubtle: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  bpsValue: {
    fontFamily: MONO,
    fontSize: 20,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
  },
  bpsLabel: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 4,
  },
  divider: {
    height: 1,
    background: THEME.border,
    margin: "14px 0 10px",
  },
  usdRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  usdLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  usdValue: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  countdown: {
    fontFamily: MONO,
    fontSize: 10,
    fontVariantNumeric: "tabular-nums",
    marginTop: 10,
    textAlign: "right",
  },
  refreshNotice: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.success,
    background: "var(--color-accent-bg-soft)",
    border: `1px solid var(--color-accent-border)`,
    borderRadius: 4,
    padding: "6px 10px",
    marginBottom: 10,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  warningCard: {
    fontFamily: MONO,
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  warningTitle: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.amber,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  warningText: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.amber,
    lineHeight: 1.5,
  },
  warningDetail: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  errorCard: {
    fontFamily: MONO,
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  errorTitle: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.danger,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 12,
    color: THEME.danger,
    lineHeight: 1.5,
  },
  hintText: {
    fontFamily: MONO,
    fontSize: 11,
    color: THEME.textMuted,
    lineHeight: 1.6,
  },
  gap: {
    height: 12,
  },
};

export default QuoteComparison;
