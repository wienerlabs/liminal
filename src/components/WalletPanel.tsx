/**
 * LIMINAL — WalletPanel
 *
 * BLOK 7 (Frontend Mimari ve UX Akışı) altında sol panel:
 * Solflare bağlantı durumu + SOL/SPL token bakiyeleri + disconnect.
 *
 * Tasarım kuralları (CLAUDE.md + design-system.css):
 * - Tüm renkler src/styles/design-system.css CSS değişkenlerinden gelir
 * - Space Grotesk (sans), JetBrains Mono (mono — tx/adresler ve sayılar)
 * - Sayısal değerler tabular-nums ile layout kaymasız
 * - Loading: skeleton loader; Error: açıklayıcı mesaj + retry
 *
 * Veri kaynakları (BLOK 5):
 * - SOL ve SPL bakiyeleri: Quicknode RPC (`./services/quicknode`)
 * - SOL USD fiyatı: Pyth feed (usePriceMonitor hook'u ile canlı)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  disconnectWallet,
  getSOLBalance,
  getSPLTokenBalances,
  initSolflare,
  subscribeWallet,
  type TokenBalance,
  type WalletState,
} from "../services/solflare";
import { usePriceMonitor } from "../hooks/usePriceMonitor";
import { useTokenRegistry } from "../hooks/useTokenRegistry";
import { useActiveKaminoPositions } from "../hooks/useActiveKaminoPositions";
import { LiminalMark } from "./BrandLogos";
import type { ActiveKaminoPosition } from "../services/kamino";
import {
  getHistory,
  type HistoricalExecution,
} from "../services/analyticsStore";
import { requestAnalyticsTab } from "../state/analyticsNav";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Token brand colors (canonical, not palette colors)
const KNOWN_TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF",
  USDC: "#2775CA",
  USDT: "#26A17B",
  BONK: "#F7931A",
};

function tokenColor(symbol: string): string {
  return KNOWN_TOKEN_COLORS[symbol] ?? "var(--color-5)";
}

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

// Tüm metinler Space Grotesk sans-serif.
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
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Jupiter token registry — warm up metadata for every mint we'll render.
  // Registry fires per-mint fetches in parallel and re-renders as each lands.
  const allMints = useMemo(() => {
    const list: string[] = [SOL_MINT];
    for (const t of tokens ?? []) if (t.mint) list.push(t.mint);
    return list;
  }, [tokens]);
  const tokenRegistry = useTokenRegistry(allMints);

  // Active Kamino deposits — surfaced independently of any execution so the
  // user can always see (and manage) parked capital, even mid-error.
  const kamino = useActiveKaminoPositions(
    wallet.connected ? wallet.address : null,
  );

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

  // handleConnect removed — CTA delegated to ExecutionPanel (single
  // primary connect action across the app). connectError state kept
  // for surfacing errors that originate from the wallet adapter even
  // when triggered elsewhere — e.g. accountChanged → re-init failure.

  const handleDisconnect = useCallback(async () => {
    await disconnectWallet();
    setConfirmingDisconnect(false);
  }, []);

  const handleRetryBalances = useCallback(() => {
    if (wallet.address) void loadBalances(wallet.address);
  }, [wallet.address, loadBalances]);

  // -----------------------------------------------------------------------
  // Disconnected state: value-prop only (no CTA).
  //
  // Previous design had a "Connect Solflare" button here AND another in
  // ExecutionPanel's welcome state — same action, two buttons. We
  // delegate the CTA to ExecutionPanel (the larger, more visible one)
  // and use this panel purely as a value-prop / education surface.
  // The arrow hint at the bottom of the App's desktopFooterHint already
  // points the user to the Connect button.
  // -----------------------------------------------------------------------
  if (!wallet.connected) {
    return (
      <aside
        style={styles.panel}
        aria-label="Wallet panel"
      >
        <header style={styles.header}>Wallet</header>
        <div style={styles.emptyBody}>
          <LiminalMark size={72} style={{ marginBottom: 4 }} />
          <div style={styles.emptyHint}>
            Once connected, your SOL + SPL balances, active Kamino
            positions, and execution history land here.
          </div>
          <div style={styles.featureBullets}>
            <div style={styles.bulletItem}>
              <span style={styles.bulletDot} />
              SOL + SPL balances
            </div>
            <div style={styles.bulletItem}>
              <span style={styles.bulletDot} />
              Active Kamino positions
            </div>
            <div style={styles.bulletItem}>
              <span style={styles.bulletDot} />
              Execution history + analytics
            </div>
          </div>
          {/* CTA intentionally moved to ExecutionPanel — single primary
              connect action across the whole app. `connectError` from
              that path surfaces in the same place. */}
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
    <aside
      style={styles.panel}
      aria-label="Wallet panel"
    >
      <header style={styles.header}>Wallet</header>

      <section style={styles.section}>
        <div style={styles.sectionLabel}>ADDRESS</div>
        <CopyableAddress address={wallet.address} />
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
              mint={SOL_MINT}
              symbol="SOL"
              amount={sol}
              usd={solUsdPrice != null ? sol * solUsdPrice : null}
              registry={tokenRegistry}
            />
            {tokens.map((t) => (
              <BalanceRow
                key={t.mint}
                mint={t.mint}
                symbol={t.symbol}
                amount={t.balance}
                usd={t.usdValue > 0 ? t.usdValue : null}
                registry={tokenRegistry}
              />
            ))}
          </div>
        )}
      </section>

      <div style={styles.divider} />

      {/* Active Kamino positions — emergency withdraw affordance. Renders
          only when the wallet has at least one non-zero deposit on Kamino. */}
      {kamino.positions.length > 0 && (
        <>
          <section style={styles.section}>
            <div style={styles.sectionLabel}>KAMINO POSITIONS</div>
            <div style={styles.kaminoPositionList}>
              {kamino.positions.map((p) => (
                <KaminoPositionRow key={p.reserveAddress} position={p} />
              ))}
            </div>
            <div style={styles.kaminoFootnote}>
              Capital parked in Kamino lending reserves. Click a row to
              manage or withdraw directly on app.kamino.finance.
            </div>
          </section>
          <div style={styles.divider} />
        </>
      )}

      {/* Kompakt geçmiş — son 3 execution */}
      <section style={styles.section}>
        <div style={styles.historyHeaderRow}>
          <div style={styles.sectionLabel}>History</div>
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
        {confirmingDisconnect ? (
          <div style={styles.disconnectConfirmRow}>
            <button
              type="button"
              onClick={handleDisconnect}
              style={styles.disconnectConfirmYes}
              aria-label="Confirm disconnect"
            >
              DISCONNECT
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(false)}
              style={styles.secondaryButton}
              aria-label="Cancel disconnect"
            >
              CANCEL
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDisconnect(true)}
            style={styles.secondaryButton}
          >
            DISCONNECT
          </button>
        )}
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
  const [hovered, setHovered] = useState(false);
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.historyRow,
        borderColor: hovered ? "var(--color-stroke-hover)" : THEME.border,
        background: hovered ? "var(--surface-raised)" : THEME.panelElevated,
        transition: "border-color 150ms ease, background 150ms ease",
      }}
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

const CopyableAddress: FC<{ address: string | null }> = ({ address }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [address]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      style={styles.addressButton}
      title="Click to copy full address"
    >
      <span style={styles.addressValue}>
        {address ? shortAddress(address) : "—"}
      </span>
      <span style={styles.copiedText}>
        {copied ? "Copied!" : ""}
      </span>
    </button>
  );
};

type BalanceRowProps = {
  mint: string;
  symbol: string;
  amount: number;
  usd: number | null;
  registry: ReturnType<typeof useTokenRegistry>;
};

const BalanceRow: FC<BalanceRowProps> = ({
  mint,
  symbol,
  amount,
  usd,
  registry,
}) => {
  const [hovered, setHovered] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const tokenInfo = registry.lookup(mint);
  const displaySymbol = tokenInfo?.symbol ?? symbol;
  const logoURI = tokenInfo?.logoURI ?? null;

  const usdColor = useMemo(() => {
    if (usd == null) return THEME.textMuted;
    if (usd > 0) return "var(--color-success)";
    return THEME.textMuted;
  }, [usd]);

  return (
    <div
      style={{
        ...styles.balanceRow,
        background: hovered ? "var(--surface-card-hover)" : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <TokenAvatar
          symbol={displaySymbol}
          logoURI={logoURI}
          imgFailed={imgFailed}
          onImgFail={() => setImgFailed(true)}
        />
        <span style={styles.balanceSymbol}>{displaySymbol}</span>
      </div>
      <div style={styles.balanceValues}>
        <span style={styles.balanceAmount}>
          {formatAmount(amount, decimalsFor(displaySymbol))}
        </span>
        <span style={{ ...styles.balanceUsd, color: usdColor }}>
          {usd != null ? formatUSD(usd) : "—"}
        </span>
      </div>
    </div>
  );
};

const BalanceSkeleton: FC = () => (
  <div style={styles.skeleton} aria-hidden="true" />
);

/**
 * Active Kamino deposit row — one per reserve. Click opens Kamino app in
 * a new tab for manual withdrawal. Explicit "↗" affordance signals that
 * the action leaves LIMINAL.
 */
/**
 * Kamino position row — function declaration (not const arrow) so it is
 * fully hoisted and survives Vite HMR partial reloads without "is not
 * defined" TDZ errors.
 */
function KaminoPositionRow({
  position,
}: {
  position: ActiveKaminoPosition;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={position.manageUrl}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.kaminoPositionRow,
        background: hovered ? "var(--surface-card-hover)" : "var(--surface-card)",
        // Use explicit border longhands (no `border:` shorthand in base
        // style) so React doesn't log a mixed-shorthand warning.
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: hovered ? "var(--color-accent-border)" : THEME.border,
      }}
      aria-label={`Manage ${position.amount} ${position.symbol} on Kamino`}
    >
      <div style={styles.kaminoPositionTop}>
        <span style={styles.kaminoPositionSymbol}>{position.symbol}</span>
        <span style={styles.kaminoPositionApy}>
          %{position.supplyAPY.toFixed(2)} APY
        </span>
      </div>
      <div style={styles.kaminoPositionBottom}>
        <span style={styles.kaminoPositionAmount}>
          {position.amount.toLocaleString("en-US", {
            maximumFractionDigits: 6,
          })}{" "}
          {position.symbol}
        </span>
        <span style={styles.kaminoPositionOpenIcon} aria-hidden="true">
          ↗
        </span>
      </div>
    </a>
  );
}

/**
 * Token avatar — shows logo image when available, otherwise renders a
 * gradient pastel circle with the token's initial letter. Failed image
 * loads (404, CORS, etc.) gracefully fall back to the initial avatar.
 */
const TokenAvatar: FC<{
  symbol: string;
  logoURI: string | null;
  imgFailed: boolean;
  onImgFail: () => void;
}> = ({ symbol, logoURI, imgFailed, onImgFail }) => {
  const initial = (symbol || "?").trim().charAt(0).toUpperCase();
  // Stable hue from symbol for fallback avatar color
  let hue = 0;
  for (let i = 0; i < symbol.length; i++) hue = (hue * 31 + symbol.charCodeAt(i)) % 360;

  if (logoURI && !imgFailed) {
    return (
      <img
        src={logoURI}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onError={onImgFail}
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          flexShrink: 0,
          background: "var(--surface-card)",
          objectFit: "cover",
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 82%), hsl(${(hue + 40) % 360}, 70%, 75%))`,
        color: "var(--color-text)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0,
      }}
    >
      {initial}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: 600,
    maxHeight: "calc(100vh - var(--header-height) - var(--space-8))",
    // Frosted glass — let the Unicorn Studio background bleed through
    // the panel surface. backdrop-filter blurs whatever's underneath
    // (the animated scene + body palette) so card content stays
    // legible without a fully opaque white block.
    background: "var(--surface-panel-glass)",
    backdropFilter: "blur(20px) saturate(140%)",
    WebkitBackdropFilter: "blur(20px) saturate(140%)",
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-lg)",
    fontFamily: MONO,
    overflow: "hidden",
    boxShadow: "var(--shadow-component)",
    transition: "border-color var(--motion-base) var(--ease-out)",
  },
  header: {
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: 0,
    fontWeight: 600,
    color: THEME.textMuted,
    padding: "14px 16px 12px",
    borderBottom: `1px solid ${THEME.border}`,
    textTransform: "none",
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
    fontSize: 15,
    color: THEME.textMuted,
    textAlign: "center",
    maxWidth: 240,
    lineHeight: 1.6,
  },
  featureBullets: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignSelf: "stretch",
  },
  bulletItem: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    display: "flex",
    alignItems: "center",
    gap: 8,
    lineHeight: 1.4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "var(--color-5)",
    flexShrink: 0,
  },
  primaryButton: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 8,
    padding: "14px 28px",
    letterSpacing: 0,
    transition: "transform 120ms ease",
  },
  secondaryButton: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "10px 16px",
    width: "100%",
    cursor: "pointer",
    letterSpacing: 0,
    textTransform: "none",
  },
  section: {
    padding: "12px 16px",
  },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: 0,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "none",
  },
  addressButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: MONO,
  },
  addressValue: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.text,
    letterSpacing: 0,
    fontVariantNumeric: "tabular-nums",
  },
  copiedText: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.accent,
    fontWeight: 600,
    minWidth: 44,
  },
  divider: {
    height: 1,
    background: THEME.border,
    margin: "0 16px",
  },
  balanceList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 280,
    overflowY: "auto",
    paddingRight: 4,
    marginRight: -4,
  },
  balanceRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 8px",
    borderRadius: "var(--radius-sm)",
    transition: "background var(--motion-base) var(--ease-out)",
    minWidth: 0,
  },
  balanceSymbol: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: THEME.text,
    letterSpacing: 0,
  },
  balanceValues: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  balanceAmount: {
    fontFamily: MONO,
    fontSize: 16,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  balanceUsd: {
    fontFamily: MONO,
    fontSize: 13,
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
    background: "var(--color-danger-bg)",
    border: `1px solid var(--color-danger-border)`,
    borderRadius: "var(--radius-md)",
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.danger,
    lineHeight: 1.5,
  },
  errorDetail: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  flexSpacer: {
    flex: 1,
  },
  footer: {
    padding: "12px 16px",
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
    fontSize: 12,
    color: THEME.accent,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    letterSpacing: 0,
    textTransform: "none",
    padding: 0,
  },
  historyEmpty: {
    fontFamily: MONO,
    fontSize: 13,
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
    fontSize: 14,
    fontWeight: 600,
    color: THEME.text,
  },
  historyRowDate: {
    fontSize: 12,
    color: THEME.textMuted,
  },
  historyRowValue: {
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  disconnectConfirmRow: {
    display: "flex",
    gap: 8,
    width: "100%",
  },
  kaminoPositionList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  kaminoPositionRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    // Border longhands only — inline style sets borderColor dynamically
    // on hover; mixing with the `border` shorthand would trigger a
    // React styling warning.
    borderRadius: "var(--radius-md)",
    textDecoration: "none",
    color: "inherit",
    transition:
      "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
    cursor: "pointer",
  },
  kaminoPositionTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  kaminoPositionSymbol: {
    fontSize: 16,
    fontWeight: 600,
    color: THEME.text,
    letterSpacing: 0,
  },
  kaminoPositionApy: {
    fontSize: 15,
    color: "var(--color-success)",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
  },
  kaminoPositionBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  kaminoPositionAmount: {
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  kaminoPositionOpenIcon: {
    fontSize: 14,
    color: "var(--color-5-strong)",
    fontWeight: 700,
  },
  kaminoFootnote: {
    marginTop: 8,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  disconnectConfirmYes: {
    fontFamily: MONO,
    fontSize: 14,
    color: "#fff",
    background: "var(--color-danger)",
    border: "1px solid var(--color-danger)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 16px",
    flex: 1,
    cursor: "pointer",
    letterSpacing: 0,
    textTransform: "none",
    fontWeight: 600,
  },
};

export default WalletPanel;
