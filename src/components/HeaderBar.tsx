/**
 * LIMINAL — HeaderBar
 *
 * 44px height, full width. Left: logo + wordmark. Right: network pill + wallet badge.
 * Partner logos as subtle "Powered by" text strip.
 */

import { useCallback, useEffect, useState, type CSSProperties, type FC } from "react";
import {
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type HeaderBarProps = {
  networkStatus?: { status: "connected" | "slow" | "offline"; slot: number | null };
};

export const HeaderBar: FC<HeaderBarProps> = ({ networkStatus }) => {
  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);

  const shortAddr = wallet.address
    ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`
    : null;

  const [copiedAddr, setCopiedAddr] = useState(false);
  const handleCopyAddr = useCallback(() => {
    if (!wallet.address) return;
    void navigator.clipboard.writeText(wallet.address).then(() => {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1500);
    });
  }, [wallet.address]);

  const netDotColor =
    networkStatus?.status === "connected"
      ? "var(--color-success)"
      : networkStatus?.status === "slow"
        ? "var(--color-warn)"
        : "var(--color-danger)";

  const netLabel =
    networkStatus?.status === "connected"
      ? "Connected"
      : networkStatus?.status === "slow"
        ? "Slow"
        : "Offline";

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        {/* Inline SVG logo mark */}
        <svg width="20" height="20" viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
          <rect width="32" height="32" rx="6" fill="var(--color-5)" />
          <path d="M8 24V8h4v12h8v4H8z" fill="var(--color-text-inverse)" />
        </svg>
        <span style={styles.wordmark}>LIMINAL</span>
      </div>

      {/* Partner logos */}
      <div style={styles.partners}>
        <span style={styles.poweredBy}>Powered by</span>
        {["DFlow", "Kamino", "Quicknode", "Solflare"].map((name, i) => (
          <span key={name} style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {i > 0 && <span style={styles.partnerDot}>·</span>}
            <span style={styles.partnerName}>{name}</span>
          </span>
        ))}
      </div>

      <div style={styles.right}>
        {/* Network status pill (Item 16) */}
        {networkStatus && (
          <div style={styles.networkPill}>
            <span
              style={{
                ...styles.netDot,
                background: netDotColor,
                boxShadow: `0 0 6px ${netDotColor}`,
              }}
            />
            <span style={styles.netLabel}>{netLabel}</span>
            {networkStatus.slot !== null && (
              <span style={styles.netSlot}>#{networkStatus.slot}</span>
            )}
          </div>
        )}

        {/* Solana mainnet pill */}
        <div style={styles.mainnetPill}>
          <span style={styles.greenDot} />
          <span>Solana Mainnet</span>
        </div>

        {/* Wallet badge */}
        <button
          type="button"
          onClick={wallet.connected ? handleCopyAddr : undefined}
          style={{
            ...styles.walletBadge,
            cursor: wallet.connected ? "pointer" : "default",
          }}
          title={wallet.connected ? "Click to copy address" : undefined}
        >
          {copiedAddr
            ? "Copied!"
            : wallet.connected && shortAddr
              ? shortAddr
              : "Not connected"}
        </button>
      </div>
    </header>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  header: {
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    background: "var(--surface-panel)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderBottom: "1px solid var(--color-stroke)",
    fontFamily: SANS,
    fontSize: 11,
    gap: 12,
    flexShrink: 0,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  wordmark: {
    fontFamily: SANS,
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: 2,
    color: "var(--color-text)",
  },
  partners: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  poweredBy: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 0.5,
    color: "var(--color-stroke-hover)",
    whiteSpace: "nowrap" as const,
    textTransform: "uppercase" as const,
  },
  partnerName: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap" as const,
    transition: "color 150ms ease",
  },
  partnerDot: {
    fontFamily: MONO,
    fontSize: 10,
    color: "var(--color-stroke-hover)",
    margin: "0 6px",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  mainnetPill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    fontSize: 10,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap" as const,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--color-success)",
    animation: "liminal-pulse 2s ease-in-out infinite",
  },
  walletBadge: {
    padding: "3px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    fontSize: 10,
    fontFamily: MONO,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap" as const,
  },
  networkPill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    fontSize: 9,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap" as const,
  },
  netDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  netLabel: {
    fontSize: 9,
  },
  netSlot: {
    fontSize: 8,
    color: "var(--color-text-muted)",
    opacity: 0.7,
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  },
};

export default HeaderBar;
