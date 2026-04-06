/**
 * LIMINAL — WalletPanel
 *
 * BLOK 7 (Frontend Mimari ve UX Akışı) altında sol panel:
 * Solflare bağlantı durumu + SOL/SPL token bakiyeleri + disconnect.
 *
 * Tasarım kuralları (CLAUDE.md + design-system.css):
 * - Tüm renkler src/styles/design-system.css CSS değişkenlerinden gelir
 * - Bricolage Grotesque (sans), monospace fallback tx/adresler için
 * - Sayısal değerler tabular-nums ile layout kaymasız
 * - Türkçe UX metinleri
 * - Loading: skeleton loader; Error: açıklayıcı mesaj + retry
 *
 * Veri kaynakları (BLOK 5):
 * - SOL ve SPL bakiyeleri: Quicknode RPC (`./services/quicknode`)
 * - SOL USD fiyatı: Pyth feed (usePriceMonitor hook'u ile canlı)
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  connectWallet,
  disconnectWallet,
  getSOLBalance,
  getSPLTokenBalances,
  initSolflare,
  subscribeWallet,
  type TokenBalance,
  type WalletState,
} from "../services/solflare";
import { usePriceMonitor } from "../hooks/usePriceMonitor";
import {
  getHistory,
  type HistoricalExecution,
} from "../services/analyticsStore";
import { requestAnalyticsTab } from "../state/analyticsNav";
import Button from "./Button";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// ---------------------------------------------------------------------------
// Theme tokens — CLAUDE.md BLOK 7 renk paleti
// ---------------------------------------------------------------------------

const THEME = {
  bg: "var(--color-1)",
  panel: "var(--color-2)",
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  borderNested: "var(--color-stroke-nested)",
  borderHover: "var(--color-stroke-hover)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  accentGlow: "var(--shadow-accent-glow)",
  danger: "var(--color-danger)",
  success: "var(--color-success)",
  shadow: "var(--shadow-component)",
} as const;

// Tüm metinler Bricolage Grotesque sans-serif.
// Wallet adresleri / signature gibi tek-kolon okuma gereken yerlerde MONO.
const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatAmount(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatUSD(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function decimalsFor(symbol: string): number {
  if (symbol === "SOL") return 4;
  if (symbol === "BONK") return 0;
  return 2;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WalletPanel: FC = () => {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    connecting: false,
    address: null,
  });
  const [sol, setSol] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenBalance[] | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // SOL USD fiyatı için canlı Pyth feed'i (BLOK 5 Senaryo 1).
  // Wallet bağlıyken poll eder; disconnect'te boş array ile idle kalır.
  const solPriceMonitor = usePriceMonitor(
    wallet.connected ? [SOL_MINT] : [],
    5000,
  );
  const solUsdPrice: number | null = solPriceMonitor.prices[SOL_MINT] ?? null;

  // Geçmiş execution'lar — son 3 özet olarak gösterilir.
  const [recentHistory, setRecentHistory] = useState<HistoricalExecution[]>([]);
  useEffect(() => {
    if (!wallet.connected) {
      setRecentHistory([]);
      return;
    }
    setRecentHistory(getHistory().slice(0, 3));
  }, [wallet.connected]);

  // DONE geçişini yakalayıp history'i taze çekebilmek için periodik refresh.
  // (Aynı sayfada execution tamamlandığında yeni kayıt anında görünsün.)
  useEffect(() => {
    if (!wallet.connected) return;
    const id = setInterval(() => {
      setRecentHistory(getHistory().slice(0, 3));
    }, 5000);
    return () => clearInterval(id);
  }, [wallet.connected]);

  // Mount: session persistence init + subscribe
  useEffect(() => {
    void initSolflare();
    const unsubscribe = subscribeWallet(setWallet);
    return unsubscribe;
  }, []);

  const loadBalances = useCallback(async (address: string) => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const [solBalance, tokenBalances] = await Promise.all([
        getSOLBalance(address),
        getSPLTokenBalances(address),
      ]);
      setSol(solBalance);
      setTokens(tokenBalances);
    } catch (err) {
      setBalanceError(
        err instanceof Error ? err.message : "An error occurred while loading balances.",
      );
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // Connected olduğunda bakiyeleri yükle
  useEffect(() => {
    if (wallet.connected && wallet.address) {
      void loadBalances(wallet.address);
    } else {
      setSol(null);
      setTokens(null);
      setBalanceError(null);
    }
  }, [wallet.connected, wallet.address, loadBalances]);

  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try {
      await connectWallet();
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : "An error occurred while connecting.",
      );
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    await disconnectWallet();
  }, []);

  const handleRetryBalances = useCallback(() => {
    if (wallet.address) void loadBalances(wallet.address);
  }, [wallet.address, loadBalances]);

  // -----------------------------------------------------------------------
  // Disconnected state: tek merkez "Connect Solflare" butonu
  // -----------------------------------------------------------------------
  if (!wallet.connected) {
    return (
      <aside style={styles.panel} aria-label="Wallet panel">
        <header style={styles.header}>WALLET</header>
        <div style={styles.emptyBody}>
          <div style={styles.emptyHint}>
            Connect your Solflare wallet to start using LIMINAL.
          </div>
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={wallet.connecting}
            style={{ padding: "14px 28px" }}
          >
            {wallet.connecting ? "CONNECTING..." : "CONNECT SOLFLARE"}
          </Button>
          {connectError && (
            <div role="alert" style={styles.errorText}>
              {connectError}
            </div>
          )}
        </div>
      </aside>
    );
  }

  // -----------------------------------------------------------------------
  // Connected state: adres + bakiyeler + disconnect
  // -----------------------------------------------------------------------
  return (
    <aside style={styles.panel} aria-label="Wallet panel">
      <header style={styles.header}>WALLET</header>

      <section style={styles.section}>
        <div style={styles.sectionLabel}>ADDRESS</div>
        <div style={styles.addressValue}>
          {wallet.address ? shortAddress(wallet.address) : "—"}
        </div>
      </section>

      <div style={styles.divider} />

      <section style={styles.section}>
        <div style={styles.sectionLabel}>BALANCES</div>

        {balanceError ? (
          <div style={styles.errorBlock} role="alert">
            <div style={styles.errorText}>
              Failed to load balances. Solana RPC did not respond.
            </div>
            <div style={styles.errorDetail}>{balanceError}</div>
            <button
              type="button"
              onClick={handleRetryBalances}
              style={styles.secondaryButton}
            >
              Retry
            </button>
          </div>
        ) : balanceLoading || sol === null || tokens === null ? (
          <div style={styles.balanceList} aria-busy="true">
            <BalanceSkeleton />
            <BalanceSkeleton />
            <BalanceSkeleton />
            <BalanceSkeleton />
          </div>
        ) : (
          <div style={styles.balanceList}>
            <BalanceRow
              symbol="SOL"
              amount={sol}
              usd={solUsdPrice != null ? sol * solUsdPrice : null}
            />
            {tokens.map((t) => (
              <BalanceRow
                key={t.mint}
                symbol={t.symbol}
                amount={t.balance}
                usd={t.usdValue > 0 ? t.usdValue : null}
              />
            ))}
          </div>
        )}
      </section>

      <div style={styles.divider} />

      {/* Kompakt geçmiş — son 3 execution */}
      <section style={styles.section}>
        <div style={styles.historyHeaderRow}>
          <div style={styles.sectionLabel}>HISTORY</div>
          {recentHistory.length > 0 && (
            <button
              type="button"
              onClick={() => requestAnalyticsTab("history")}
              style={styles.historyAllLink}
            >
              View All →
            </button>
          )}
        </div>

        {recentHistory.length === 0 ? (
          <div style={styles.historyEmpty}>No executions yet.</div>
        ) : (
          <div style={styles.historyList}>
            {recentHistory.map((h) => (
              <HistoryRowCompact key={h.id} execution={h} />
            ))}
          </div>
        )}
      </section>

      <div style={styles.flexSpacer} />

      <section style={styles.footer}>
        <button
          type="button"
          onClick={handleDisconnect}
          style={styles.secondaryButton}
        >
          DISCONNECT
        </button>
      </section>
    </aside>
  );
};

// ---------------------------------------------------------------------------
// Compact history row
// ---------------------------------------------------------------------------

const HistoryRowCompact: FC<{ execution: HistoricalExecution }> = ({
  execution,
}) => {
  const total = execution.summary.totalValueCaptureUsd;
  const positive = total >= 0;
  const dateStr = execution.createdAt.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
  return (
    <button
      type="button"
      onClick={() => requestAnalyticsTab("history")}
      style={styles.historyRow}
    >
      <div style={styles.historyRowTop}>
        <span style={styles.historyRowPair}>
          {execution.inputSymbol} → {execution.outputSymbol}
        </span>
        <span style={styles.historyRowDate}>{dateStr}</span>
      </div>
      <div
        style={{
          ...styles.historyRowValue,
          color: positive ? THEME.success : THEME.danger,
        }}
      >
        {positive ? "+" : ""}
        {`$${Math.abs(total).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`}
      </div>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const BalanceRow: FC<{
  symbol: string;
  amount: number;
  usd: number | null;
}> = ({ symbol, amount, usd }) => {
  return (
    <div style={styles.balanceRow}>
      <span style={styles.balanceSymbol}>{symbol}</span>
      <div style={styles.balanceValues}>
        <span style={styles.balanceAmount}>
          {formatAmount(amount, decimalsFor(symbol))}
        </span>
        <span style={styles.balanceUsd}>
          {usd != null ? formatUSD(usd) : "— $"}
        </span>
      </div>
    </div>
  );
};

const BalanceSkeleton: FC = () => (
  <div style={styles.skeleton} aria-hidden="true" />
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: 440,
    background: THEME.panel,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    fontFamily: MONO,
    overflow: "hidden",
  },
  header: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 2,
    color: THEME.accent,
    padding: "16px 20px 14px",
    borderBottom: `1px solid ${THEME.border}`,
    textTransform: "uppercase",
  },
  emptyBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    padding: "40px 24px",
  },
  emptyHint: {
    fontFamily: MONO,
    fontSize: 12,
    color: THEME.textMuted,
    textAlign: "center",
    maxWidth: 240,
    lineHeight: 1.6,
  },
  primaryButton: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 8,
    padding: "14px 28px",
    letterSpacing: 1,
    boxShadow: `0 0 28px ${THEME.accentGlow}`,
    transition: "transform 120ms ease, box-shadow 120ms ease",
  },
  secondaryButton: {
    fontFamily: MONO,
    fontSize: 11,
    color: THEME.textMuted,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "10px 16px",
    width: "100%",
    cursor: "pointer",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  section: {
    padding: "16px 20px",
  },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  addressValue: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.text,
    letterSpacing: 0.5,
    fontVariantNumeric: "tabular-nums",
  },
  divider: {
    height: 1,
    background: THEME.border,
    margin: "0 20px",
  },
  balanceList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  balanceRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "8px 0",
    borderBottom: `1px dashed ${THEME.border}`,
  },
  balanceSymbol: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    color: THEME.text,
    letterSpacing: 0.5,
  },
  balanceValues: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  balanceAmount: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  balanceUsd: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  skeleton: {
    height: 36,
    borderRadius: 4,
    background: `linear-gradient(90deg, ${THEME.panelElevated} 0%, var(--color-3) 50%, ${THEME.panelElevated} 100%)`,
    backgroundSize: "200% 100%",
    animation: "liminal-shimmer 1.4s ease-in-out infinite",
  },
  errorBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px 14px",
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 6,
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 12,
    color: THEME.danger,
    lineHeight: 1.5,
  },
  errorDetail: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  flexSpacer: {
    flex: 1,
  },
  footer: {
    padding: "16px 20px",
    borderTop: `1px solid ${THEME.border}`,
  },
  historyHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  historyAllLink: {
    fontFamily: MONO,
    fontSize: 9,
    color: THEME.accent,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    padding: 0,
  },
  historyEmpty: {
    fontFamily: MONO,
    fontSize: 10,
    color: THEME.textMuted,
    textAlign: "center",
    padding: "8px 0",
  },
  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  historyRow: {
    fontFamily: MONO,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "8px 10px",
    background: THEME.panelElevated,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    color: THEME.text,
  },
  historyRowTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 6,
  },
  historyRowPair: {
    fontSize: 11,
    fontWeight: 600,
    color: THEME.text,
  },
  historyRowDate: {
    fontSize: 9,
    color: THEME.textMuted,
  },
  historyRowValue: {
    fontSize: 11,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
};

export default WalletPanel;
