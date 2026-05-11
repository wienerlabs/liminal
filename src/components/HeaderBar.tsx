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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import WalletPickerModal from "./WalletPickerModal";
import { LiminalMark } from "./BrandLogos";
import { getMevStrategy } from "../services/mevProtection";
import { useDeviceDetection } from "../hooks/useDeviceDetection";
import { useRoute } from "../hooks/useRoute";
import { useWalletSummary } from "../hooks/useWalletSummary";
import { useProfile } from "../hooks/useProfile";
import { openPalette } from "./CommandPalette";
import ThemeSwitcher from "./ThemeSwitcher";
import AnimatedNumber from "./AnimatedNumber";
import ProfileAvatar from "./ProfileAvatar";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeaderBarProps = {
  networkStatus?: {
    status: "connected" | "slow" | "offline";
    slot: number | null;
    latencyMs?: number | null;
  };
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
  /** Called when the user clicks their profile chip — App.tsx opens the
   * profile editor in dismissable mode. */
  onEditProfile?: () => void;
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

export const HeaderBar: FC<HeaderBarProps> = ({
  networkStatus,
  inFlight,
  onEditProfile,
}) => {
  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);
  const device = useDeviceDetection();
  const { route, navigate } = useRoute();
  const summary = useWalletSummary();
  const { profile } = useProfile(wallet.address);

  const shortAddr = wallet.address
    ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
    : null;

  const [copiedAddr, setCopiedAddr] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          navigate("home");
        }}
        style={styles.brand}
        aria-label="LIMINAL home"
      >
        <LiminalMark size={40} />
        <span style={styles.wordmark}>LIMINAL</span>
      </button>

      {/* Primary nav — Execute / Wallet / Analytics. Hidden on mobile
          because the bottom tab bar covers the same routes there. */}
      {!device.isMobile && (
        <nav style={styles.navPills} aria-label="Primary">
          <NavPill
            label="Execute"
            active={route === "home"}
            onClick={() => navigate("home")}
          />
          <NavPill
            label="Wallet"
            active={route === "wallet"}
            onClick={() => navigate("wallet")}
          />
          <NavPill
            label="Analytics"
            active={route === "analytics"}
            onClick={() => navigate("analytics")}
          />
        </nav>
      )}

      {/* Connected-state summary bar — sits between nav and the
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
        {/* Command palette launcher — visible affordance for the
            ⌘K hotkey. Hidden on mobile because the on-screen keyboard
            covers most of the palette and the bottom-tab nav already
            covers the same routing actions. */}
        {!device.isMobile && (
          <button
            type="button"
            onClick={() => openPalette()}
            style={styles.kbdLauncher}
            aria-label="Open command palette"
            title="Command palette · ⌘K"
          >
            <span aria-hidden="true">⌘</span>
            <span aria-hidden="true">K</span>
          </button>
        )}
        <ThemeSwitcher />
        {/* MEV badge: hidden on mobile (saves ~50px on a 375px viewport). */}
        {!device.isMobile && <MevBadge />}
        {networkStatus && (
          <div
            style={styles.networkPill}
            aria-label={`Solana network: ${netLabel}${networkStatus.latencyMs != null ? `, ${Math.round(networkStatus.latencyMs)}ms` : ""}`}
            title={`${netLabel}${networkStatus.latencyMs != null ? ` · ${Math.round(networkStatus.latencyMs)}ms` : ""}${networkStatus.slot != null ? ` · slot #${networkStatus.slot}` : ""}`}
          >
            <NetworkMeter
              latencyMs={networkStatus.latencyMs ?? null}
              status={networkStatus.status}
            />
            {/* Mobile: just the meter. Tablet/desktop: full label + slot. */}
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

        {/* Three states for the wallet slot:
            1. Disconnected → prominent pink Connect Solflare CTA so
               first-time visitors don't have to scroll the splash to
               find the auth action.
            2. Connected + profile saved → ProfileChip (avatar + name)
               that opens the profile editor on click.
            3. Connected but no profile yet → fallback wallet badge
               with the short address. */}
        {!wallet.connected ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={wallet.connecting}
            style={styles.connectCta}
            className="liminal-press"
            aria-label="Connect a Solana wallet"
          >
            <span style={styles.connectDot} aria-hidden="true" />
            <span>{wallet.connecting ? "Connecting…" : device.isMobile ? "Connect" : "Connect wallet"}</span>
          </button>
        ) : wallet.connected && profile && onEditProfile ? (
          <button
            type="button"
            onClick={onEditProfile}
            style={styles.profileChip}
            className="liminal-press"
            title="Edit profile"
            aria-label={`Profile: ${profile.username}. Click to edit.`}
          >
            <ProfileAvatar avatarId={profile.avatarId} size={20} ring />
            {!device.isMobile && (
              <span style={styles.profileChipName}>{profile.username}</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={wallet.connected ? handleCopyAddr : undefined}
            style={{
              ...styles.walletBadge,
              cursor: wallet.connected ? "pointer" : "default",
              color: wallet.connected ? "var(--color-text)" : "var(--color-text-muted)",
              borderColor: wallet.connected ? "var(--color-accent-border)" : "var(--color-stroke)",
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
        )}
      </div>
      <WalletPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </header>
  );
};

// ---------------------------------------------------------------------------
// NavPill — primary navigation segmented pill (Execute/Wallet/Analytics).
// Active route uses the LIMINAL accent palette; inactive pills are subtle
// outlines that highlight on hover. Hidden on mobile (bottom tab bar).
// ---------------------------------------------------------------------------

const NavPill: FC<{ label: string; active: boolean; onClick: () => void }> = ({
  label,
  active,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        ...styles.navPill,
        background: active
          ? "var(--color-5)"
          : hovered
            ? "var(--color-accent-bg-soft)"
            : "transparent",
        borderColor: active
          ? "var(--color-accent-border)"
          : "transparent",
        color: active
          ? "var(--color-text-inverse, #fff)"
          : hovered
            ? "var(--color-text)"
            : "var(--color-text-muted)",
        fontWeight: active ? 600 : 500,
        boxShadow: active
          ? "0 2px 8px -2px rgba(244, 140, 196, 0.45)"
          : "none",
      }}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
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
      {/* Animated gain — count up on each slice settlement so the win
          feels earned, not popped. AnimatedNumber's prefix wraps the
          formatted absolute value, so we render the sign separately and
          pass abs(gainUsd). */}
      <span style={{ ...styles.inFlightGain, color: gainColor }}>
        <AnimatedNumber
          value={Math.abs(gainUsd)}
          prefix={gainUsd >= 0 ? "+$" : "−$"}
          decimals={2}
          duration={500}
        />
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

  // Loading + empty placeholders are static text; rich rendering only
  // when we actually have a number to animate.
  if (loading && solBalance == null) {
    return (
      <span style={styles.balanceChip} aria-label="Loading balance">
        ◎ …
      </span>
    );
  }
  if (solBalance == null) {
    return (
      <span style={styles.balanceChip} aria-label="Balance unavailable">
        ◎ —
      </span>
    );
  }

  const balDecimals = solBalance < 1 ? 4 : 2;
  return (
    <span
      style={styles.balanceChip}
      title={
        solUsdValue != null
          ? `${solBalance} SOL ≈ ${formatUsdShort(solUsdValue)}`
          : `${solBalance} SOL`
      }
      aria-label={`SOL balance ${solBalance}${solUsdValue != null ? `, USD ${solUsdValue.toFixed(2)}` : ""}`}
    >
      <span aria-hidden="true">◎</span>
      {/* Balance ticks softly when SPL transfers / receives land. The
          dot separator is decorative — animation hides between two
          synced spans. */}
      <AnimatedNumber
        value={solBalance}
        decimals={balDecimals}
        duration={500}
      />
      {solUsdValue != null && (
        <>
          <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
          <AnimatedNumber
            value={solUsdValue}
            prefix="$"
            decimals={solUsdValue < 1 ? 4 : 2}
            duration={500}
          />
        </>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// NetworkMeter — 3-bar wifi-style gauge driven by RPC latency.
//   - 3 bars lit if latency < 250ms (green, "fresh")
//   - 2 bars lit if 250-700ms (warm green, "good")
//   - 1 bar  lit if 700-2000ms (amber, "slow")
//   - 0 bars + red dot if status === "offline"
//
// Tooltip on the parent pill shows the actual latency + slot.
// ---------------------------------------------------------------------------

const NetworkMeter: FC<{
  latencyMs: number | null;
  status: "connected" | "slow" | "offline";
}> = ({ latencyMs, status }) => {
  const lit =
    status === "offline"
      ? 0
      : latencyMs == null
        ? 2
        : latencyMs < 250
          ? 3
          : latencyMs < 700
            ? 2
            : 1;
  const colour =
    lit === 0
      ? "var(--color-danger)"
      : lit === 1
        ? "var(--color-warn)"
        : "var(--color-success)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 2,
        height: 12,
      }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 4 + i * 3,
            background: i < lit ? colour : "var(--color-stroke)",
            borderRadius: 1,
            transition: "background var(--motion-base) var(--ease-out)",
          }}
        />
      ))}
    </span>
  );
};

// ---------------------------------------------------------------------------
// MEV protection badge — subtle chip next to the network pill that signals
// the active MEV-protection stack. Hovering / focusing surfaces a rich
// popover that visualises both layers (Jupiter Ultra + Constellation),
// their active status, and a one-sentence description per layer. Click
// also pins the popover so users on touch devices can read it.
// ---------------------------------------------------------------------------

function MevBadge() {
  const strategy = getMevStrategy();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const activeCount = strategy.layers.filter((l) => l.active).length;
  const short =
    activeCount === 2 ? "MEV: Hybrid" : `MEV: ${activeCount}/2`;

  // Click-outside dismissal for the pinned state.
  useEffect(() => {
    if (!pinned) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setPinned(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinned]);

  const open = hovered || pinned;

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        style={{
          ...styles.mevBadge,
          background: open
            ? "var(--color-accent-bg-strong)"
            : "var(--color-accent-bg-soft)",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((v) => !v)}
        aria-label={`MEV protection: ${strategy.label}`}
        aria-expanded={open}
      >
        <span style={styles.mevBadgeDot} aria-hidden="true" />
        <span>{short}</span>
      </button>
      {open && <MevPopover strategy={strategy} />}
    </span>
  );
}

const MevPopover: FC<{ strategy: ReturnType<typeof getMevStrategy> }> = ({
  strategy,
}) => (
  <div role="tooltip" style={styles.mevPopover}>
    <div style={styles.mevPopoverHeader}>
      <span style={styles.mevPopoverTitle}>{strategy.label}</span>
      {strategy.constellationReady && !strategy.constellationActive && (
        <span style={styles.mevPopoverPill}>Constellation-ready</span>
      )}
    </div>
    <ul style={styles.mevPopoverLayers}>
      {strategy.layers.map((layer) => (
        <li key={layer.name} style={styles.mevPopoverLayer}>
          <span
            aria-hidden="true"
            style={{
              ...styles.mevPopoverLayerDot,
              background: layer.active
                ? "var(--color-success)"
                : "var(--color-text-subtle)",
              boxShadow: layer.active
                ? "0 0 8px var(--color-success)"
                : "none",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={styles.mevPopoverLayerName}>
              {layer.name}{" "}
              <span
                style={{
                  color: layer.active
                    ? "var(--color-success)"
                    : "var(--color-text-subtle)",
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                · {layer.active ? "Active" : "Ready"}
              </span>
            </div>
            <div style={styles.mevPopoverLayerDesc}>{layer.description}</div>
          </div>
        </li>
      ))}
    </ul>
  </div>
);

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
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  wordmark: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: "var(--text-base)",
    letterSpacing: "0.04em",
    color: "var(--color-text)",
    lineHeight: 1,
  },
  // Primary nav pills — sit immediately right of the brand. flex:0 so
  // they don't grow; summary region picks up the slack.
  navPills: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 3,
    borderRadius: 10,
    background: "var(--surface-glass, rgba(255, 255, 255, 0.4))",
    border: "1px solid var(--color-stroke)",
    flexShrink: 0,
  },
  navPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid transparent",
    cursor: "pointer",
    fontFamily: SANS,
    fontSize: 13,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    transition:
      "background var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
    minHeight: 30,
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
    fontSize: 14,
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
    gap: 5,
    padding: "5px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    color: "var(--color-text)",
    fontFamily: MONO,
    fontSize: 14,
    fontVariantNumeric: "tabular-nums",
    height: 28,
    whiteSpace: "nowrap",
    transition:
      "border-color var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out)",
  },
  // ----- Connect CTA (disconnected state) -------------------------------
  // Prominent pink button so first-time visitors see the auth path
  // immediately. Replaces the old subtle "Not connected" outline chip.
  connectCta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    minHeight: 36,
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    background: "var(--color-5)",
    color: "#ffffff",
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 4px 14px rgba(249, 178, 215, 0.36)",
    transition:
      "filter var(--motion-base) var(--ease-out), transform 80ms var(--ease-out), box-shadow var(--motion-base) var(--ease-out)",
  },
  connectDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#ffffff",
    boxShadow: "0 0 8px rgba(255,255,255,0.7)",
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
    flexShrink: 0,
  },
  // ----- Right cluster ---------------------------------------------------
  kbdLauncher: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "0 8px",
    height: 28,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition:
      "color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out)",
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
    transition:
      "border-color var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out)",
  },
  // ProfileChip — replaces the wallet badge when a profile exists.
  // Avatar + username + soft accent border. Clicking it opens the
  // profile editor in dismissable mode.
  profileChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "3px 10px 3px 4px",
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    background: "var(--color-accent-bg-soft)",
    color: "var(--color-text)",
    fontFamily: MONO,
    fontSize: "var(--text-xs)",
    fontWeight: 600,
    height: 28,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition:
      "border-color var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out)",
  },
  profileChipName: {
    fontFamily: MONO,
    letterSpacing: 0,
  },
  mevBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0,
    color: "var(--color-5-strong)",
    textTransform: "none",
    whiteSpace: "nowrap",
    height: 28,
    cursor: "help",
    background: "var(--color-accent-bg-soft)",
    transition: "background var(--motion-base) var(--ease-out)",
  },
  // Popover anchored under the MEV badge — wide enough to fit the
  // long "DFlow-endorsed routing (Jupiter Ultra)" header on one line.
  mevPopover: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 340,
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
    boxShadow: "var(--shadow-component, 0 8px 24px rgba(0,0,0,0.12))",
    padding: 14,
    zIndex: 60,
    animation: "liminal-scale-in 180ms var(--ease-out, ease)",
    transformOrigin: "top right",
  },
  mevPopoverHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    paddingBottom: 8,
    borderBottom: "1px solid var(--color-stroke)",
    marginBottom: 10,
  },
  mevPopoverTitle: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 15,
    color: "var(--color-text)",
  },
  mevPopoverPill: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    color: "var(--color-5-strong)",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    padding: "2px 6px",
    borderRadius: 999,
    marginLeft: "auto",
  },
  mevPopoverLayers: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  mevPopoverLayer: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  mevPopoverLayerDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 6,
  },
  mevPopoverLayerName: {
    fontFamily: SANS,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    lineHeight: 1.3,
  },
  mevPopoverLayerDesc: {
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
    marginTop: 4,
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
    fontSize: 15,
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
    fontSize: 15,
  },
  netSlot: {
    fontSize: 14,
    color: "var(--color-text-subtle)",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  },
};

export default HeaderBar;
