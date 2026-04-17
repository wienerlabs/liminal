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

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// Standard logo cap-height — tüm partner mark'ları aynı optik boyutta görünsün.
const LOGO_CAP = 14;

// ---------------------------------------------------------------------------
// Partner Logo Components — official sources, beyaz fill, baseline aligned
// ---------------------------------------------------------------------------

const DFlowLogo: FC<{ size?: number }> = ({ size = LOGO_CAP }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 329 329"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M126.705 27.668c-47.483 14.221-84.891 51.613-99.153 98.872h50.669c4.38 0 8.58-1.74 11.677-4.835l31.966-31.948c3.1-3.098 4.841-7.3 4.841-11.683z" />
    <path d="M151.397 89.199c-.204 4.118-1.927 8.024-4.848 10.943l-46.488 46.461-.591.561c-3.017 2.732-6.94 4.253-11.017 4.253H15.747l-.457-.007c-9.549-.261-16.967-8.685-14.96-18.151C14.432 66.757 66.84 14.395 133.391.323c9.553-2.02 18.027 5.717 18.027 15.544v72.506z" />
    <path d="M126.705 301.166c-47.483-14.221-84.891-51.613-99.153-98.872h50.669c4.38 0 8.58 1.739 11.677 4.835l31.966 31.947c3.1 3.098 4.841 7.301 4.841 11.684z" />
    <path d="M151.397 239.635c-.204-4.118-1.927-8.024-4.848-10.943l-46.488-46.461-.591-.561c-3.017-2.732-6.94-4.253-11.017-4.253H15.747l-.457.007c-9.549.261-16.967 8.685-14.96 18.151 14.101 66.502 66.509 118.864 133.06 132.936 9.553 2.02 18.027-5.717 18.027-15.544v-72.506z" />
    <path d="M301.287 126.528c-14.284-47.268-51.697-84.656-99.17-98.854v50.375c0 4.38 1.739 8.58 4.836 11.678l31.951 31.961c3.098 3.099 7.301 4.84 11.682 4.84z" />
    <path d="M240.351 151.417c-4.346 0-8.517-1.731-11.602-4.816l-46.466-46.483c-2.92-2.92-4.642-6.828-4.846-10.948l-.02-.827v-72.47c0-9.828 8.464-17.566 18.01-15.552 66.534 14.041 118.944 66.401 133.075 132.921 2.045 9.623-5.641 18.175-15.408 18.175z" />
    <path d="M202.13 301.166c47.482-14.223 84.889-51.615 99.151-98.872h-50.669c-4.379 0-8.578 1.739-11.676 4.834l-31.964 31.944c-3.1 3.098-4.842 7.301-4.842 11.684z" />
    <path d="M177.437 239.631c.204-4.119 1.927-8.024 4.848-10.943l46.487-46.457.591-.561c2.816-2.55 6.42-4.045 10.203-4.233l.814-.02h72.708l.456.007c9.549.261 16.967 8.685 14.96 18.151-14.1 66.5-66.508 118.861-133.059 132.936-9.553 2.02-18.028-5.716-18.028-15.542v-72.512z" />
  </svg>
);

const KaminoLogo: FC<{ height?: number }> = ({ height = LOGO_CAP }) => (
  <svg
    height={height}
    viewBox="0 0 216.6 50"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M110.321 14.514c-6.415 0-9.559 3.464-11.009 5.036-2.365-3.035-5.193-5.015-10.183-5.015-3.716 0-8.338 2.172-9.566 5.046V15.03h-9.205v34.404h9.43V29.937c0-3.723 3.003-6.745 6.716-6.745s6.716 3.014 6.716 6.745v19.504h9.402V29.93c0-3.723 3.004-6.745 6.717-6.745s6.716 3.014 6.716 6.745l-.01 19.504h9.43V30.839c0-6.825-2.549-16.325-15.164-16.325z" />
    <circle cx="135.192" cy="5.71" r="5.71" />
    <path d="M139.959 15.03h-9.653v34.404h9.653V15.03z" />
    <path d="M10.263 2.782H0v46.684h10.263V2.782z" />
    <path d="M198.959 50.003c-5.025 0-9.271-1.506-12.626-4.906-3.347-3.393-5.046-7.692-5.046-12.766s1.699-9.377 5.046-12.78c3.352-3.408 7.601-5.036 12.626-5.036s9.275 1.621 12.616 5.036c3.337 3.407 5.025 7.702 5.025 12.78 0 5.074-1.695 9.373-5.032 12.766-3.341 3.394-7.584 4.906-12.609 4.906zm0-26.688c-2.414 0-4.34.839-5.888 2.558-1.579 1.758-2.351 3.864-2.351 6.45s.768 4.685 2.347 6.433c1.545 1.716 3.478 2.54 5.892 2.54s4.348-.828 5.892-2.54c1.579-1.744 2.348-3.85 2.348-6.433s-.772-4.696-2.351-6.45c-1.544-1.72-3.471-2.558-5.889-2.558z" />
    <path d="M56.364 15.031v2.94c-1.66-1.656-3.351-3.484-8.19-3.484-3.11 0-5.931.631-8.38 2.098-2.64 1.565-4.78 3.766-6.373 6.524-1.597 2.768-2.407 5.86-2.407 9.19s.796 6.404 2.372 9.141c1.572 2.734 3.702 4.91 6.341 6.478 2.537 1.506 5.432 2.053 8.608 2.053 3.004 0 6.053-1.561 8.033-3.485v2.941h9.194V15.031h-9.198zm-7.279 26.732c-4.979 0-9.015-4.243-9.015-9.475s4.04-9.475 9.015-9.475 9.019 4.243 9.019 9.475-4.04 9.475-9.019 9.475z" />
    <path d="M164.755 14.515c-4.467 0-8.605 2.432-10.703 5.762V15.027h-9.299v34.404h9.524V29.815c0-3.724 2.902-6.745 7.113-6.745s7.113 3.014 7.113 6.745v19.616h9.524V28.864c0-5.236-2.239-14.352-13.276-14.352z" />
    <path d="M33.347 48.876c-4.835-3.334-8.102-9.534-8.102-16.64s3.267-13.307 8.102-16.64v-.562H19.97c-3.13 4.85-4.97 10.78-4.97 17.202s1.837 12.348 4.97 17.202h13.377v-.562z" />
  </svg>
);

/**
 * QuickNode — official "Q" mark + clean wordmark reconstructed as pure paths
 * (no <text> dependency) so kerning/weight is consistent across systems.
 */
const QuickNodeLogo: FC<{ height?: number }> = ({ height = LOGO_CAP }) => {
  // viewBox 100 width × 24 height — bütün glyph'ler manuel path
  return (
    <svg
      height={height}
      viewBox="0 0 110 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      {/* Q mark — circle + tail */}
      <path
        d="M11 2 A9 9 0 1 0 11 20 A9 9 0 1 0 11 2 Z M11 5 A6 6 0 1 1 11 17 A6 6 0 1 1 11 5 Z"
        fillRule="evenodd"
      />
      <path d="M14.5 16.5 L19 21 L21 19 L16.5 14.5 Z" />
      {/* "QUICKNODE" wordmark — geometric uppercase, monospace-like */}
      <text
        x="26"
        y="16"
        fontFamily="'JetBrains Mono', ui-monospace, monospace"
        fontWeight="700"
        fontSize="11"
        letterSpacing="0.5"
        fill="currentColor"
      >
        QUICKNODE
      </text>
    </svg>
  );
};

const SolflareLogo: FC<{ size?: number }> = ({ size = LOGO_CAP }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 50 50"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M24.23 26.42l2.46-2.38 4.59 1.5c3.01 1 4.51 2.84 4.51 5.43 0 1.96-.75 3.26-2.25 4.93l-.46.5.17-1.17c.67-4.26-.58-6.09-4.72-7.43l-4.3-1.38zM18.05 11.85l12.52 4.17-2.71 2.59-6.51-2.17c-2.25-.75-3.01-1.96-3.3-4.51v-.08zM17.3 33.06l2.84-2.71 5.34 1.75c2.8.92 3.76 2.13 3.46 5.18l-11.65-4.22zM13.71 20.95c0-.79.42-1.54 1.13-2.17.75 1.09 2.05 2.05 4.09 2.71l4.42 1.46-2.46 2.38-4.34-1.42c-2-.67-2.84-1.67-2.84-2.96M26.82 42.87c9.18-6.09 14.11-10.23 14.11-15.32 0-3.38-2-5.26-6.43-6.72l-3.34-1.13 9.14-8.77-1.84-1.96-2.71 2.38-12.81-4.22c-3.97 1.29-8.97 5.09-8.97 8.89 0 .42.04.83.17 1.29-3.3 1.88-4.63 3.63-4.63 5.8 0 2.05 1.09 4.09 4.55 5.22l2.75.92-9.52 9.14 1.84 1.96 2.96-2.71 14.73 5.22z" />
  </svg>
);

const PARTNER_LOGOS: { name: string; logo: FC<{ size?: number; height?: number }> }[] = [
  { name: "DFlow", logo: DFlowLogo },
  { name: "Kamino", logo: KaminoLogo },
  { name: "QuickNode", logo: QuickNodeLogo },
  { name: "Solflare", logo: SolflareLogo },
];

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
      <div style={styles.left}>
        <svg width="22" height="22" viewBox="0 0 32 32" style={{ flexShrink: 0, display: "block" }}>
          <rect width="32" height="32" rx="6" fill="var(--color-5)" />
          <path
            d="M9 23.5V8.5h3.5v11.5h9.5v3.5H9z"
            fill="var(--color-text-inverse)"
          />
        </svg>
        <span style={styles.wordmark}>LIMINAL</span>
      </div>

      {/* Partner logoları — desktop + tablet, mobilde gizli */}
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

      <div style={styles.right}>
        {networkStatus && (
          <div style={styles.networkPill} aria-label={`Solana network: ${netLabel}`}>
            <span
              style={{
                ...styles.netDot,
                background: netDotColor,
                boxShadow: `0 0 6px ${netDotColor}`,
              }}
              aria-hidden="true"
            />
            <span style={styles.netLabel}>{netLabel}</span>
            {networkStatus.slot !== null && (
              <span style={styles.netSlot}>#{networkStatus.slot}</span>
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
                : "Not connected"}
          </span>
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
    height: "var(--header-height)",
    minHeight: "var(--header-height)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 var(--space-4)",
    background: "var(--color-2)",
    borderBottom: "1px solid var(--color-stroke)",
    fontFamily: SANS,
    fontSize: "var(--text-xs)",
    gap: "var(--space-3)",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 50,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexShrink: 0,
  },
  wordmark: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: "var(--text-base)",
    letterSpacing: "0.18em",
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
    opacity: 0.55,
    minWidth: 0,
  },
  partnerItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
  },
  poweredBy: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    marginRight: "var(--space-1)",
  },
  partnerDot: {
    fontFamily: MONO,
    fontSize: 12,
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
  networkPill: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "5px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    fontSize: 10,
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
    fontSize: 10,
  },
  netSlot: {
    fontSize: 9,
    color: "var(--color-text-subtle)",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  },
};

export default HeaderBar;
