/**
 * LIMINAL — WalletPage
 *
 * `#/wallet` route'unda render olur. Mevcut WalletPanel'i daha geniş bir
 * full-page çerçeveye yerleştirir, başına özet hero + quick actions ekler.
 *
 * Header'daki nav pill'lerinden geçilir; mobile'da bottom tab'taki
 * "Wallet" tabıyla aynı state'i paylaşır (useRoute → mobileTab mapping).
 *
 * Detay seksiyonları:
 *   - Hero: connection state, kısa adres, ağ rozeti, SOL+USD özet
 *   - Quick actions: copy address, explorer'da görüntüle, disconnect
 *   - Embedded WalletPanel: tüm mevcut bakiye / Kamino / history içeriği
 */

import { useMemo, useState, type CSSProperties, type FC } from "react";
import {
  disconnectWallet,
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import WalletPickerModal from "../components/WalletPickerModal";
import { useEffect } from "react";
import { useWalletSummary } from "../hooks/useWalletSummary";
import { useProfile } from "../hooks/useProfile";
import { getActiveNetworkConfig } from "../services/network";
import ProfileAvatar from "../components/ProfileAvatar";
import WalletPanel from "../components/WalletPanel";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

const WalletPage: FC = () => {
  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);
  const summary = useWalletSummary();
  const { profile } = useProfile(wallet.address);

  const network = useMemo(() => getActiveNetworkConfig(), []);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleCopy = (): void => {
    if (!wallet.address) return;
    void navigator.clipboard.writeText(wallet.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const explorerUrl = wallet.address
    ? `${network.explorerBaseUrl}/address/${wallet.address}${network.network !== "mainnet-beta" ? `?cluster=${network.network}` : ""}`
    : null;

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div style={styles.heroTop}>
          <div style={styles.heroLeft}>
            {wallet.connected && profile ? (
              <ProfileAvatar avatarId={profile.avatarId} size={56} ring />
            ) : (
              <div style={styles.heroIconFallback} aria-hidden="true">◎</div>
            )}
            <div>
              <div style={styles.heroEyebrow}>
                {wallet.connected ? "Connected · Solflare" : "Disconnected"}
              </div>
              <h1 style={styles.heroTitle}>
                {profile?.username ?? (wallet.connected ? "Anonymous trader" : "Wallet")}
              </h1>
              <div style={styles.heroAddr}>{shortAddr(wallet.address)}</div>
            </div>
          </div>
          <div style={styles.heroStats}>
            <Stat
              label="SOL balance"
              value={
                summary.solBalance != null
                  ? `${summary.solBalance.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })}`
                  : "—"
              }
              hint={
                summary.solUsdValue != null
                  ? `≈ $${summary.solUsdValue.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : undefined
              }
            />
            <Stat
              label="Network"
              value={network.label}
              hint={network.network}
            />
          </div>
        </div>
        {wallet.connected ? (
          <div style={styles.actions}>
            <ActionButton onClick={handleCopy} disabled={!wallet.address}>
              {copied ? "Copied ✓" : "Copy address"}
            </ActionButton>
            {explorerUrl && (
              <ActionButton href={explorerUrl}>
                View on Solscan ↗
              </ActionButton>
            )}
            <ActionButton onClick={() => void disconnectWallet()} variant="danger">
              Disconnect
            </ActionButton>
          </div>
        ) : (
          <div style={styles.connectBlock}>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={wallet.connecting}
              style={styles.connectButton}
              className="liminal-press"
              aria-label="Connect a Solana wallet"
            >
              <span style={styles.connectButtonDot} aria-hidden="true" />
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p style={styles.connectHint}>
              LIMINAL works with Solflare, Phantom, and Backpack. Every
              transaction is signed with simulation guards.
            </p>
          </div>
        )}
      </header>

      {/* Existing rich wallet panel — keeps every section (balances,
          Kamino positions, recent history). Wrapped so the panel's
          internal max-width doesn't fight the new full-page container. */}
      <section style={styles.panelSlot}>
        <WalletPanel />
      </section>

      <WalletPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
};

const Stat: FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div style={styles.stat}>
    <div style={styles.statLabel}>{label}</div>
    <div style={styles.statValue}>{value}</div>
    {hint && <div style={styles.statHint}>{hint}</div>}
  </div>
);

const ActionButton: FC<{
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  variant?: "default" | "danger";
}> = ({ children, onClick, href, disabled, variant }) => {
  const baseStyle: CSSProperties = {
    ...styles.action,
    color:
      variant === "danger" ? "var(--color-danger)" : "var(--color-text)",
    borderColor:
      variant === "danger"
        ? "var(--color-danger)"
        : "var(--color-stroke)",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...baseStyle, textDecoration: "none" }}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={baseStyle}>
      {children}
    </button>
  );
};

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    width: "100%",
    minWidth: 0,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    padding: "var(--space-5) var(--space-5)",
    borderRadius: "var(--radius-xl, 18px)",
    border: "1px solid var(--color-stroke)",
    background:
      "linear-gradient(135deg, rgba(249, 178, 215, 0.10) 0%, rgba(207, 236, 243, 0.10) 50%, rgba(218, 249, 222, 0.10) 100%), var(--surface-card)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
  },
  heroTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--space-4)",
    flexWrap: "wrap",
  },
  heroLeft: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    minWidth: 0,
  },
  heroIconFallback: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-accent-bg-soft)",
    color: "var(--color-5-strong)",
    fontFamily: MONO,
    fontSize: 26,
    border: "1px solid var(--color-accent-border)",
  },
  heroEyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "var(--color-text-muted)",
    marginBottom: 4,
  },
  heroTitle: {
    margin: 0,
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: "clamp(1.4rem, 2.4vw, 2rem)",
    color: "var(--color-text)",
    letterSpacing: "-0.01em",
    lineHeight: 1.15,
  },
  heroAddr: {
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text-muted)",
    marginTop: 2,
    fontVariantNumeric: "tabular-nums",
  },
  heroStats: {
    display: "flex",
    gap: "var(--space-3)",
    flexWrap: "wrap",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 16px",
    borderRadius: "var(--radius-md, 12px)",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-stroke)",
    minWidth: 130,
  },
  statLabel: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--color-text-muted)",
  },
  statValue: {
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: 700,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },
  statHint: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  },
  connectBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    alignItems: "flex-start",
  },
  connectButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 20px",
    minHeight: 44,
    borderRadius: 12,
    border: "1px solid var(--color-accent-border)",
    background: "var(--color-5)",
    color: "#ffffff",
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(249, 178, 215, 0.38)",
    transition:
      "filter var(--motion-base) var(--ease-out), transform 80ms var(--ease-out), box-shadow var(--motion-base) var(--ease-out)",
  },
  connectButtonDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#ffffff",
    boxShadow: "0 0 10px rgba(255,255,255,0.7)",
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
  },
  connectHint: {
    margin: 0,
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
    maxWidth: 520,
  },
  connectLink: {
    color: "var(--color-5-strong)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 14px",
    minHeight: 36,
    borderRadius: 10,
    border: "1px solid var(--color-stroke)",
    background: "var(--surface-card)",
    fontFamily: SANS,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition:
      "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  panelSlot: {
    width: "100%",
    minWidth: 0,
  },
};

export default WalletPage;
