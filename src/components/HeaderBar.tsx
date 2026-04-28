/**
 * LIMINAL — HeaderBar
 *
 * 48px sticky height, full width. Sol: logo + wordmark. Sağ: network pill +
 * wallet badge. Partner logoları "Powered by" şerit olarak ortada.
 *
 * Tüm logolar 14px capital height, baseline ortak. Filter normalizasyonu
 * tek yerden (ikon path'leri zaten beyaz, filter gereksiz tekrar yapmıyoruz).
 */

import { useCallback, useEffect, useState, type CSSProperties, type FC } from "react";
import {
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import {
  LOGO_CAP,
  LiminalMark,
  PARTNER_LOGOS,
} from "./BrandLogos";
import { getMevStrategy } from "../services/mevProtection";
import { useDeviceDetection } from "../hooks/useDeviceDetection";
import ThemeSwitcher from "./ThemeSwitcher";

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
  const device = useDeviceDetection();

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

  return (
    <header style={styles.header}>
      <a
        href="/"
        style={styles.brand}
        aria-label="LIMINAL home"
      >
        <LiminalMark size={40} />
        <span style={styles.wordmark}>LIMINAL</span>
      </a>

      {/* Partner logoları — desktop + tablet only. Mobile (<=767)
          gizli ki "Connected #N..." + WalletBadge sığsın. */}
      {!device.isMobile && (
        <div style={styles.partners} aria-label="Powered by">
          <span style={styles.poweredBy}>Powered by</span>
          {PARTNER_LOGOS.map(({ name, logo: Logo }, i) => (
            <span key={name} style={styles.partnerItem}>
              {i > 0 && <span style={styles.partnerDot} aria-hidden="true">·</span>}
              <span style={styles.partnerLogo} title={name} aria-label={`${name} logo`} role="img">
                <Logo height={LOGO_CAP} size={LOGO_CAP} />
              </span>
            </span>
          ))}
        </div>
      )}
      {device.isMobile && <div style={{ flex: 1 }} aria-hidden="true" />}

      <div style={styles.right}>
        <ThemeSwitcher />
        {/* MEV badge: desktop + tablet only on mobile (saves ~50px). */}
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
          {/* Mobile: short address only when connected, hide entirely otherwise.
              Desktop/tablet: full text. */}
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
    // Frosted glass — translucent panel color, backdrop blur on top.
    // Matches the pastel theme while staying legible on any scroll bg.
    background: "rgba(255, 255, 255, 0.78)",
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
    letterSpacing: "0.22em",
    color: "var(--color-text)",
    lineHeight: 1,
  },
  partners: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    color: "var(--color-text)",
    opacity: 0.45,
    minWidth: 0,
  },
  partnerItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
  },
  poweredBy: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: "0.12em",
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    marginRight: "var(--space-1)",
  },
  partnerDot: {
    fontFamily: MONO,
    fontSize: 15,
    color: "var(--color-text-subtle)",
    margin: "0 var(--space-2)",
    lineHeight: 1,
    transform: "translateY(-1px)",
  },
  partnerLogo: {
    display: "inline-flex",
    alignItems: "center",
    height: LOGO_CAP,
    transition: "opacity var(--motion-base) var(--ease-out)",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexShrink: 0,
  },
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
    transition: "border-color var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out)",
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
    letterSpacing: "0.06em",
    color: "var(--color-5-strong)",
    textTransform: "uppercase",
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
