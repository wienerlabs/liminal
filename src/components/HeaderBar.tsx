/**
 * LIMINAL — HeaderBar
 *
 * 48px sticky height, full width.
 *
 * Layout (left → right):
 *   - Brand (LiminalMark + LIMINAL wordmark)
 *   - Connected-state summary bar (PR #5b):
 *       · In-flight slice progress chip (only while an execution is mid-flight)
 *       · SOL portfolio chip (only when wallet connected)
 *     Both hidden on mobile to keep the 48px header readable; mobile gets
 *     a dedicated sticky "active execution" bar below the header instead
 *     (handled in App.tsx).
 *   - Right cluster: ThemeSwitcher · MEV badge · network pill · wallet badge
 *
 * Filter normalizasyonu tek yerden — ikon path'leri zaten beyaz, gereksiz
 * filter uygulanmaz.
 */

import { useCallback, useEffect, useState, type CSSProperties, type FC } from "react";
import {
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import { LiminalMark } from "./BrandLogos";
import { getMevStrategy } from "../services/mevProtection";
import { useDeviceDetection } from "../hooks/useDeviceDetection";
import { useWalletSummary } from "../hooks/useWalletSummary";
import ThemeSwitcher from "./ThemeSwitcher";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeaderBarProps = {
  networkStatus?: { status: "connected" | "slow" | "offline"; slot: number | null };
  /**
   * In-flight execution snapshot — when present, the header renders a
   * compact slice-progress chip (e.g. "▶ 2/4 · +$3.21"). Undefined means
   * no execution is active.
   */
  inFlight?: {
    sliceN: number;
    sliceM: number;
    gainUsd: number;
  };
};

// ---------------------------------------------------------------------------
// Formatting helpers (local — header-only, kept off the global formatters
// path because they're tuned for tight chip rendering)
// ---------------------------------------------------------------------------

function formatUsdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(2)}`;
}

function formatGainShort(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  return `${sign}${formatUsdShort(abs)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HeaderBar: FC<HeaderBarProps> = ({ networkStatus, inFlight }) => {
  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);
  const device = useDeviceDetection();
  const summary = useWalletSummary();

  const shortAddr = wallet.address
    ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
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

  // Summary bar visibility rules:
  //   - Mobile: nothing (App.tsx renders a sticky exec bar below the header)
  //   - Tablet: in-flight chip only (balance chip would crowd the bar)
  //   - Desktop: both chips
  const showInFlight = !!inFlight && !device.isMobile;
  const showBalance =
    summary.connected && !device.isMobile && !device.isTablet;

  return (
    <header style={styles.header}>
      <a href="/" style={styles.brand} aria-label="LIMINAL home">
        <LiminalMark size={40} />
        <span style={styles.wordmark}>LIMINAL</span>
      </a>

      {/* Connected-state summary bar — sits between the brand and the
          right-side controls. Stays empty (just a flex spacer) when
          wallet disconnected and no execution is mid-flight, which is
          the IDLE landing experience. */}
      <div style={styles.summary} aria-live="polite" aria-atomic="false">
        {showInFlight && inFlight && (
          <InFlightChip
            sliceN={inFlight.sliceN}
            sliceM={inFlight.sliceM}
            gainUsd={inFlight.gainUsd}
          />
        )}
        {showBalance && <BalanceChip summary={summary} />}
      </div>

      <div style={styles.right}>
        <ThemeSwitcher />
        {/* MEV badge: hidden on mobile (saves ~50px on a 375px viewport). */}
        {!device.isMobile && <MevBadge />}
        {networkStatus && (
          <div
            style={styles.networkPill}
            aria-label={`Solana network: ${netLabel}`}
            title={
              device.isMobile && networkStatus.slot !== null
                ? `${netLabel} · slot #${networkStatus.slot}`
                : undefined
            }
          >
            <span
              style={{
                ...styles.netDot,
                background: netDotColor,
                boxShadow: `0 0 6px ${netDotColor}`,
              }}
              aria-hidden="true"
            />
            {/* Mobile: just the dot. Tablet/desktop: full label + slot. */}
            {!device.isMobile && (
              <>
                <span style={styles.netLabel}>{netLabel}</span>
                {networkStatus.slot !== null && (
                  <span style={styles.netSlot}>#{networkStatus.slot}</span>
                )}
              </>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={wallet.connected ? handleCopyAddr : undefined}
          style={{
            ...styles.walletBadge,
            cursor: wallet.connected ? "pointer" : "default",
            color: wallet.connected ? "var(--color-text)" : "var(--color-text-muted)",
            borderColor: wallet.connected ? "var(--color-accent-border)" : "var(--color-stroke)",
            // Mobile compact: just dot (when connected) or "—" placeholder.
            paddingLeft: device.isMobile ? 8 : undefined,
            paddingRight: device.isMobile ? 8 : undefined,
          }}
          title={wallet.connected ? "Click to copy address" : "Wallet not connected"}
          aria-label={
            wallet.connected
              ? `Wallet connected: ${shortAddr}. Click to copy.`
              : "Wallet not connected"
          }
        >
          {wallet.connected && (
            <span style={{ ...styles.netDot, background: "var(--color-5)" }} aria-hidden="true" />
          )}
          <span>
            {copiedAddr
              ? "Copied"
              : wallet.connected && shortAddr
                ? shortAddr
                : device.isMobile
                  ? "—"
                  : "Not connected"}
          </span>
        </button>
      </div>
    </header>
  );
};

// ---------------------------------------------------------------------------
// In-flight slice progress chip
//
// Renders only while an execution is mid-flight. Shows:
//   - pulsing accent dot (caught the user's attention back when we lived in
//     the body; here it pulls focus to the header instead)
//   - slice progress as N/M
//   - mini progress bar (12px tall) underneath the text
//   - signed cumulative gain in USD (green if positive, muted otherwise)
//
// Tooltip mirrors the long form for screen reader coverage.
// ---------------------------------------------------------------------------

const InFlightChip: FC<{ sliceN: number; sliceM: number; gainUsd: number }> = ({
  sliceN,
  sliceM,
  gainUsd,
}) => {
  const pct = sliceM > 0 ? Math.min(100, (sliceN / sliceM) * 100) : 0;
  const gainColor =
    gainUsd > 0
      ? "var(--color-success)"
      : gainUsd < 0
        ? "var(--color-danger)"
        : "var(--color-text-muted)";
  return (
    <span
      style={styles.inFlightChip}
      title={`Slice ${sliceN} of ${sliceM} · gain ${formatGainShort(gainUsd)}`}
      aria-label={`Execution in flight: slice ${sliceN} of ${sliceM}, gain ${formatGainShort(gainUsd)}`}
    >
      <span style={styles.inFlightDot} aria-hidden="true" />
      <span style={styles.inFlightSlices}>
        Slice {sliceN}/{sliceM}
      </span>
      <span style={styles.inFlightTrack} aria-hidden="true">
        <span
          style={{
            ...styles.inFlightFill,
            width: `${pct}%`,
          }}
        />
      </span>
      <span style={{ ...styles.inFlightGain, color: gainColor }}>
        {formatGainShort(gainUsd)}
      </span>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Balance chip — connected-state SOL portfolio anchor
//
// Reads from useWalletSummary. Three render branches:
//   - solUsdValue available → "◎ {balance} SOL · ${usd}"
//   - solBalance only       → "◎ {balance} SOL"
//   - loading / no price    → "◎ —"
//
// SOL is intentional: it's the gas token, the most reliable Pyth feed and
// a universally meaningful anchor. Total-portfolio (SPL incl.) is left to
// the WalletPanel where we can afford the multi-feed cost.
// ---------------------------------------------------------------------------

const BalanceChip: FC<{ summary: ReturnType<typeof useWalletSummary> }> = ({
  summary,
}) => {
  const { solBalance, solUsdValue, loading } = summary;

  let text: string;
  if (loading && solBalance == null) {
    text = "◎ …";
  } else if (solBalance == null) {
    text = "◎ —";
  } else {
    const balStr =
      solBalance < 0.001
        ? "<0.001"
        : solBalance.toLocaleString("en-US", {
            maximumFractionDigits: solBalance < 1 ? 4 : 2,
          });
    text =
      solUsdValue != null
        ? `◎ ${balStr} · ${formatUsdShort(solUsdValue)}`
        : `◎ ${balStr} SOL`;
  }

  return (
    <span
      style={styles.balanceChip}
      title={
        solBalance != null && solUsdValue != null
          ? `${solBalance} SOL ≈ ${formatUsdShort(solUsdValue)}`
          : "SOL balance"
      }
      aria-label={`SOL balance: ${text.replace("◎", "")}`}
    >
      {text}
    </span>
  );
};

// ---------------------------------------------------------------------------
// MEV protection badge — subtle chip next to the network pill that signals
// the active MEV-protection stack. Links to the Analytics Protocol tab
// where the full explanation lives.
// ---------------------------------------------------------------------------

function MevBadge() {
  const strategy = getMevStrategy();
  const [hovered, setHovered] = useState(false);
  const activeCount = strategy.layers.filter((l) => l.active).length;
  const short =
    activeCount === 2 ? "MEV: Hybrid" : `MEV: ${activeCount}/2`;
  return (
    <span
      style={{
        ...styles.mevBadge,
        background: hovered
          ? "var(--color-accent-bg-strong)"
          : "var(--color-accent-bg-soft)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${strategy.label}${
        strategy.constellationReady && !strategy.constellationActive
          ? " · Constellation-ready"
          : ""
      }`}
      aria-label={`MEV protection: ${strategy.label}`}
    >
      <span style={styles.mevBadgeDot} aria-hidden="true" />
      <span>{short}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  header: {
    height: "var(--header-height)",
    minHeight: "var(--header-height)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 var(--space-5)",
    background: "var(--surface-glass)",
    borderBottom: "1px solid var(--color-stroke)",
    fontFamily: SANS,
    fontSize: "var(--text-xs)",
    gap: "var(--space-3)",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 50,
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexShrink: 0,
    textDecoration: "none",
    color: "inherit",
    padding: "4px 6px",
    marginLeft: "-6px",
    borderRadius: "var(--radius-sm)",
    transition: "background var(--motion-base) var(--ease-out)",
  },
  wordmark: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: "var(--text-base)",
    letterSpacing: "0.04em",
    color: "var(--color-text)",
    lineHeight: 1,
  },
  // Center summary region — flex:1 absorbs free space, contents are
  // pushed to the left edge so the right cluster always anchors right.
  summary: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    paddingLeft: "var(--space-4)",
    overflow: "hidden",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexShrink: 0,
  },
  // ----- Connected-state chips -------------------------------------------
  inFlightChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    background: "var(--color-accent-bg-soft)",
    color: "var(--color-text)",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    height: 28,
    whiteSpace: "nowrap",
  },
  inFlightDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-5)",
    boxShadow: "0 0 8px var(--color-5)",
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
    flexShrink: 0,
  },
  inFlightSlices: {
    fontVariantNumeric: "tabular-nums",
  },
  inFlightTrack: {
    position: "relative",
    width: 60,
    height: 4,
    borderRadius: 2,
    background: "var(--color-accent-bg-strong)",
    overflow: "hidden",
    flexShrink: 0,
  },
  inFlightFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    background:
      "linear-gradient(90deg, var(--color-5-strong) 0%, var(--color-5) 100%)",
    transition: "width var(--motion-slow) var(--ease-out)",
  },
  inFlightGain: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 700,
  },
  balanceChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    color: "var(--color-text)",
    fontFamily: MONO,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    height: 28,
    whiteSpace: "nowrap",
  },
  // ----- Right cluster (unchanged) ---------------------------------------
  walletBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "5px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    fontSize: "var(--text-xs)",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
    height: 28,
    whiteSpace: "nowrap",
    transition:
      "border-color var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out)",
  },
  mevBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0,
    color: "var(--color-5-strong)",
    textTransform: "none",
    whiteSpace: "nowrap",
    height: 28,
    cursor: "help",
    transition: "background var(--motion-base) var(--ease-out)",
  },
  mevBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--color-5)",
    boxShadow: "0 0 6px var(--color-5)",
    animation: "liminal-pulse 2.2s ease-in-out infinite",
    flexShrink: 0,
  },
  networkPill: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "5px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    fontSize: 13,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap",
    height: 28,
  },
  netDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  netLabel: {
    fontSize: 13,
  },
  netSlot: {
    fontSize: 12,
    color: "var(--color-text-subtle)",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  },
};

export default HeaderBar;
