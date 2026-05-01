/**
 * LIMINAL — Root Layout
 *
 * Üç breakpoint:
 *   - Desktop (>=1024): sol (300) + orta (flex) + sağ (300) — simetrik
 *   - Tablet (768-1023): sol gizli, orta + sağ 50/50
 *   - Mobile (<768): tek sutun + alt tab bar + üst active execution bar
 *
 * Solflare in-app browser: mount'ta otomatik bağlantı, üstte yeşil banner.
 * Safe-area inset hem tab bar hem body padding'inde uygulanır.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import "./styles/design-system.css";
import { useDeviceDetection } from "./hooks/useDeviceDetection";
import { useExecutionMachine } from "./hooks/useExecutionMachine";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useTheme } from "./hooks/useTheme";
import {
  IN_FLIGHT_STATUSES,
} from "./state/executionMachine";
import {
  connectWallet,
  disconnectWallet,
  initSolflare,
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "./services/solflare";
import WalletPanel from "./components/WalletPanel";
import ExecutionPanel from "./components/ExecutionPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import HeaderBar from "./components/HeaderBar";
import Footer from "./components/Footer";
import CommandPalette, {
  openPalette,
  useCommandPaletteHotkey,
  type CommandAction,
} from "./components/CommandPalette";
import ProfileSetup from "./components/ProfileSetup";
import CompletionFlourish from "./components/CompletionFlourish";
import UnicornBackground from "./components/UnicornBackground";
import { ExecutionStatus } from "./state/executionMachine";
import { ToastContainer } from "./components/ToastProvider";
import DisclaimerModal, {
  hasAcceptedDisclaimer,
} from "./components/DisclaimerModal";
import { useProfile } from "./hooks/useProfile";
import { useDcaRunner } from "./hooks/useDcaRunner";
import { getActiveNetworkConfig } from "./services/network";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME = {
  bg: "var(--color-1)",
  panelBg: "var(--color-2)",
  border: "var(--color-stroke)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
} as const;

const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

type MobileTab = "wallet" | "execute" | "analytics";

export const App: FC = () => {
  const device = useDeviceDetection();
  const machine = useExecutionMachine();
  const { state } = machine;
  const networkStatus = useNetworkStatus();

  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);

  // Disclaimer gate — first-connect only, persisted in localStorage.
  // Re-rendered whenever the wallet transitions to connected so we can
  // show the modal right at the moment the user is about to act.
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  useEffect(() => {
    if (wallet.connected && !hasAcceptedDisclaimer()) {
      setDisclaimerOpen(true);
    }
  }, [wallet.connected]);

  // Profile gate — once the user has accepted the disclaimer, check
  // whether they've set up a profile (username + avatar) for this
  // wallet address. First-connect = mandatory setup. Subsequent
  // edits via "Edit profile" / palette = dismissable.
  const { profile, save: saveProfile } = useProfile(wallet.address);
  const [profileSetupMode, setProfileSetupMode] = useState<
    "closed" | "first-time" | "edit"
  >("closed");
  useEffect(() => {
    if (
      wallet.connected &&
      !disclaimerOpen &&
      hasAcceptedDisclaimer() &&
      !profile
    ) {
      setProfileSetupMode("first-time");
    } else if (!wallet.connected) {
      setProfileSetupMode("closed");
    }
  }, [wallet.connected, disclaimerOpen, profile]);

  const [mobileTab, setMobileTab] = useState<MobileTab>("execute");

  // Solflare in-app browser: auto-connect on mount.
  useEffect(() => {
    if (!device.isSolflareInAppBrowser) return;
    void (async () => {
      try {
        await initSolflare();
        if (!getWalletState().connected) {
          await connectWallet();
        }
      } catch (err) {
        console.warn(
          `[LIMINAL] Solflare in-app browser auto-connect error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, [device.isSolflareInAppBrowser]);

  // DCA runner — ticks every 30s, fires due schedules through the
  // machine when the wallet is connected and the user isn't mid-run.
  // Mounted once at the App root.
  useDcaRunner({
    walletConnected: wallet.connected,
    walletAddress: wallet.address,
    machine,
    state,
  });

  const inFlight = IN_FLIGHT_STATUSES.has(state.status);
  const sliceN = state.currentSliceIndex + 1;
  const sliceM = state.slices.length;

  // Completion flourish — fires once on each IDLE/in-flight → DONE
  // transition. The ASCII overlay auto-dismisses after 3s, but the
  // edge-trigger here means it doesn't re-pop on later state writes
  // that keep the same DONE status.
  const [flourishVisible, setFlourishVisible] = useState(false);
  const prevStatusRef = useRef<ExecutionStatus>(state.status);
  useEffect(() => {
    if (
      prevStatusRef.current !== ExecutionStatus.DONE &&
      state.status === ExecutionStatus.DONE
    ) {
      setFlourishVisible(true);
    }
    prevStatusRef.current = state.status;
  }, [state.status]);

  const executeBadge = inFlight && sliceM > 0 ? `${sliceN}/${sliceM}` : undefined;

  // Header summary bar — only populated while an execution is in flight.
  // HeaderBar handles its own breakpoint visibility (mobile = hidden,
  // tablet = chip only, desktop = chip + balance).
  const headerInFlight =
    inFlight && sliceM > 0
      ? {
          sliceN,
          sliceM,
          gainUsd: state.totalPriceImprovementUsd,
        }
      : undefined;

  // ---------------------------------------------------------------------
  // Command palette (⌘K) — global launcher with action commands.
  // Token-targeted shortcuts are added by ExecutionPanel via its own
  // wiring; the App-level palette covers global navigation + theme +
  // wallet actions.
  // ---------------------------------------------------------------------
  useCommandPaletteHotkey();
  const { theme, toggle: toggleTheme } = useTheme();
  const paletteActions = useMemo<CommandAction[]>(() => {
    const list: CommandAction[] = [];
    list.push({
      id: "theme.toggle",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      hint: theme === "dark" ? "☀" : "☾",
      category: "Appearance",
      run: toggleTheme,
    });
    if (device.isMobile) {
      list.push(
        {
          id: "tab.wallet",
          label: "Go to Wallet",
          category: "Navigation",
          hint: "Mobile",
          run: () => setMobileTab("wallet"),
        },
        {
          id: "tab.execute",
          label: "Go to Execute",
          category: "Navigation",
          hint: "Mobile",
          run: () => setMobileTab("execute"),
        },
        {
          id: "tab.analytics",
          label: "Go to Analytics",
          category: "Navigation",
          hint: "Mobile",
          run: () => setMobileTab("analytics"),
        },
      );
    }
    if (wallet.connected && wallet.address) {
      list.push({
        id: "wallet.copy",
        label: "Copy wallet address",
        hint: `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`,
        category: "Wallet",
        run: () => {
          if (wallet.address) {
            void navigator.clipboard.writeText(wallet.address);
          }
        },
      });
      list.push({
        id: "profile.edit",
        label: profile ? "Edit profile" : "Set up profile",
        hint: profile?.username,
        category: "Profile",
        run: () => setProfileSetupMode("edit"),
      });
      list.push({
        id: "wallet.disconnect",
        label: "Disconnect Solflare",
        category: "Wallet",
        run: () => {
          void disconnectWallet();
        },
      });
    } else {
      list.push({
        id: "wallet.connect",
        label: "Connect Solflare",
        category: "Wallet",
        run: () => {
          void connectWallet();
        },
      });
    }
    return list;
  }, [theme, toggleTheme, device.isMobile, wallet.connected, wallet.address, profile]);

  // ---------------------------------------------------------------------
  // Completion flourish element — same JSX rendered in all three
  // layouts. Visible only during the 3-second post-DONE celebration.
  // ---------------------------------------------------------------------
  const completionFlourish = (
    <CompletionFlourish
      visible={flourishVisible}
      onDismiss={() => setFlourishVisible(false)}
    />
  );

  // ---------------------------------------------------------------------
  // Unicorn Studio animated background — fixed-position, full-viewport,
  // sits behind every layout's content. Same instance shared across all
  // three layouts so the runtime initialises once.
  //
  // Opacity dialled to 0.55: the upstream scene is more saturated than
  // our pastel palette, so we soften it to a "sense of motion" layer
  // rather than a competing visual element. The body's
  // var(--color-1) stays the dominant base colour through the unicorn.
  // ---------------------------------------------------------------------
  const unicornBackground = (
    <UnicornBackground projectId="1mCMfRJPPI9y8tbAhs5m" opacity={0.55} />
  );

  // ---------------------------------------------------------------------
  // ProfileSetup modal element — same JSX rendered in all three layouts.
  // Lifting the conditional construction up here keeps the layout
  // branches readable and makes sure the same `dismissable` flag is
  // applied no matter which breakpoint we're in.
  // ---------------------------------------------------------------------
  const profileSetupModal =
    wallet.connected && wallet.address && profileSetupMode !== "closed" ? (
      <ProfileSetup
        address={wallet.address}
        existing={profile}
        dismissable={profileSetupMode === "edit"}
        onDismiss={() => setProfileSetupMode("closed")}
        onComplete={({ username, avatarId }) => {
          saveProfile({ username, avatarId });
          setProfileSetupMode("closed");
        }}
      />
    ) : null;

  // Slash commands — terse keyboard-first verbs the power user types
  // instead of arrow-keying through the action list. Routed through the
  // same palette UI; consumer just needs to translate "/<verb> <args>"
  // into one or more CommandAction candidates. Help registry surfaces
  // when the user types just "/".
  const paletteSlashHelp = useMemo(
    () => [
      { verb: "theme", description: "Toggle or set theme", example: "/theme dark" },
      { verb: "connect", description: "Connect Solflare wallet" },
      { verb: "disconnect", description: "Disconnect wallet" },
      { verb: "go", description: "Jump to a panel (mobile only)", example: "/go execute" },
      { verb: "copy", description: "Copy connected wallet address" },
    ],
    [],
  );
  const resolveSlash = useMemo(
    () => (raw: string): CommandAction[] => {
      const body = raw.replace(/^\//, "").trim().toLowerCase();
      if (!body) return [];
      const [verb, ...rest] = body.split(/\s+/);
      const arg = rest.join(" ");
      const out: CommandAction[] = [];

      if (verb === "theme") {
        if (arg === "dark" || arg === "light") {
          const target = arg === "dark";
          if ((theme === "dark") !== target) {
            out.push({
              id: `slash.theme.${arg}`,
              label: `Switch to ${arg} theme`,
              category: "Slash → theme",
              run: toggleTheme,
            });
          } else {
            out.push({
              id: `slash.theme.noop`,
              label: `Theme is already ${arg}`,
              category: "Slash → theme",
              run: () => {},
            });
          }
        } else {
          out.push({
            id: `slash.theme.toggle`,
            label: `Toggle theme (currently ${theme})`,
            category: "Slash → theme",
            run: toggleTheme,
          });
        }
      } else if (verb === "connect") {
        out.push({
          id: "slash.connect",
          label: wallet.connected ? "Already connected" : "Connect Solflare",
          category: "Slash → wallet",
          run: () => {
            if (!wallet.connected) void connectWallet();
          },
        });
      } else if (verb === "disconnect") {
        out.push({
          id: "slash.disconnect",
          label: wallet.connected ? "Disconnect Solflare" : "Not connected",
          category: "Slash → wallet",
          run: () => {
            if (wallet.connected) void disconnectWallet();
          },
        });
      } else if (verb === "copy") {
        if (wallet.connected && wallet.address) {
          out.push({
            id: "slash.copy",
            label: "Copy wallet address",
            hint: `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`,
            category: "Slash → wallet",
            run: () => {
              if (wallet.address) {
                void navigator.clipboard.writeText(wallet.address);
              }
            },
          });
        }
      } else if (verb === "go") {
        if (device.isMobile && (arg === "wallet" || arg === "execute" || arg === "analytics")) {
          out.push({
            id: `slash.go.${arg}`,
            label: `Go to ${arg}`,
            category: "Slash → navigation",
            run: () => setMobileTab(arg as MobileTab),
          });
        } else if (device.isMobile) {
          ["wallet", "execute", "analytics"].forEach((tab) =>
            out.push({
              id: `slash.go.${tab}`,
              label: `Go to ${tab}`,
              category: "Slash → navigation",
              run: () => setMobileTab(tab as MobileTab),
            }),
          );
        }
      }
      return out;
    },
    [theme, toggleTheme, wallet.connected, wallet.address, device.isMobile],
  );

  // ------------------------------------------------------------------
  // Mobile layout
  // ------------------------------------------------------------------
  if (device.isMobile) {
    return (
      <div className="liminal-root" style={styles.mobileRoot}>
        {unicornBackground}
        <HeaderBar networkStatus={networkStatus} inFlight={headerInFlight} onEditProfile={() => setProfileSetupMode("edit")} />
        {device.isSolflareInAppBrowser && <SolflareBanner />}
        <NetworkBanner />
        <ToastContainer />
        <CommandPalette actions={paletteActions} slashHelp={paletteSlashHelp} resolveSlash={resolveSlash} />
        {disclaimerOpen && (
          <DisclaimerModal onAccept={() => setDisclaimerOpen(false)} />
        )}
        {profileSetupModal}
        {completionFlourish}

        {inFlight && (
          <div style={{ position: "sticky", top: "var(--header-height)", zIndex: 40 }}>
            <button
              type="button"
              onClick={() => setMobileTab("execute")}
              style={styles.activeExecBar}
              aria-label={`Execution active — slice ${sliceN} of ${sliceM}. Tap to view.`}
            >
              <span style={styles.pulseDot} aria-hidden="true" />
              <span style={styles.activeExecText}>
                Slice {sliceN}/{sliceM}
              </span>
              <span style={styles.activeExecUsd} aria-label="Total gain">
                +$
                {state.totalPriceImprovementUsd.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </button>
            <div style={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={sliceM} aria-valuenow={sliceN}>
              <div
                style={{
                  ...styles.progressFill,
                  width: sliceM > 0 ? `${(sliceN / sliceM) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
        )}

        <main style={styles.mobileBody}>
          {mobileTab === "wallet" && <WalletPanel />}
          {mobileTab === "execute" && <ExecutionPanel />}
          {mobileTab === "analytics" && <AnalyticsPanel />}
          <Footer compact />
        </main>

        <nav style={styles.mobileTabBar} role="tablist" aria-label="Main navigation">
          <MobileTabButton
            label="Wallet"
            active={mobileTab === "wallet"}
            onClick={() => setMobileTab("wallet")}
          />
          <MobileTabButton
            label="Execute"
            active={mobileTab === "execute"}
            onClick={() => setMobileTab("execute")}
            badge={executeBadge}
          />
          <MobileTabButton
            label="Analytics"
            active={mobileTab === "analytics"}
            onClick={() => setMobileTab("analytics")}
          />
        </nav>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Tablet layout (768-1023)
  // ------------------------------------------------------------------
  // 2-column Execute + Analytics. WalletPanel is hidden — at this
  // viewport width keeping all 3 panels would squeeze the middle col
  // to ~224px which is unusable for the execution form. Connected
  // wallet state (balances, positions) surfaces in the Execute panel
  // header summary bar instead. (TODO: header summary bar for tablet
  // is a P2 follow-up.)
  // ------------------------------------------------------------------
  if (device.isTablet) {
    return (
      <div className="liminal-root" style={styles.appRoot}>
        {unicornBackground}
        <HeaderBar networkStatus={networkStatus} inFlight={headerInFlight} onEditProfile={() => setProfileSetupMode("edit")} />
        {device.isSolflareInAppBrowser && <SolflareBanner />}
        <NetworkBanner />
        <ToastContainer />
        <CommandPalette actions={paletteActions} slashHelp={paletteSlashHelp} resolveSlash={resolveSlash} />
        {disclaimerOpen && (
          <DisclaimerModal onAccept={() => setDisclaimerOpen(false)} />
        )}
        {profileSetupModal}
        {completionFlourish}
        <div style={styles.tabletLayoutOuter}>
          <div style={styles.tabletLayout}>
            <main style={{ ...styles.tabletPane, ...panelEntranceStyle(0) }}>
              <ExecutionPanel />
            </main>
            <aside style={{ ...styles.tabletPane, ...panelEntranceStyle(1) }}>
              <AnalyticsPanel />
            </aside>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Desktop layout — clamp 3-col with max-width container
  // ------------------------------------------------------------------
  return (
    <div className="liminal-root" style={styles.appRoot}>
        {unicornBackground}
      <HeaderBar networkStatus={networkStatus} inFlight={headerInFlight} onEditProfile={() => setProfileSetupMode("edit")} />
      {device.isSolflareInAppBrowser && <SolflareBanner />}
        <NetworkBanner />
      <ToastContainer />
        <CommandPalette actions={paletteActions} slashHelp={paletteSlashHelp} resolveSlash={resolveSlash} />
        {disclaimerOpen && (
          <DisclaimerModal onAccept={() => setDisclaimerOpen(false)} />
        )}
        {profileSetupModal}
        {completionFlourish}
      <div style={styles.desktopLayoutOuter}>
        <div style={styles.desktopLayout}>
          <aside style={{ ...styles.sideCol, ...panelEntranceStyle(0) }}>
            <WalletPanel />
          </aside>
          <main style={{ ...styles.middleCol, ...panelEntranceStyle(1) }}>
            <ExecutionPanel />
          </main>
          <aside style={{ ...styles.sideColRight, ...panelEntranceStyle(2) }}>
            <AnalyticsPanel />
          </aside>
        </div>
      </div>
      {!wallet.connected && !device.isSolflareInAppBrowser && (
        <div style={styles.desktopFooterHint}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
            <path d="M9 3L5 7l4 4" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Connect your Solflare wallet — the Connect button is in the middle panel.
        </div>
      )}
      <Footer />
    </div>
  );
};

function panelEntranceStyle(index: number): CSSProperties {
  return {
    animation: `liminal-panel-enter 500ms var(--ease-out) ${index * 100}ms both`,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SolflareBanner: FC = () => (
  <div style={styles.solflareBanner} role="status">
    <span style={styles.solflareDot} aria-hidden="true" />
    <span>Opened via Solflare</span>
  </div>
);

/**
 * Testnet/devnet banner — renders only when VITE_SOLANA_NETWORK is set
 * to a non-mainnet cluster. Kept above every layout so the user can't
 * miss that they're on a test environment.
 */
const NetworkBanner: FC = () => {
  const config = getActiveNetworkConfig();
  if (!config.testBanner) return null;
  return (
    <div
      role="alert"
      style={{
        background: "var(--color-warn-bg)",
        color: "var(--color-warn)",
        borderBottom: "1px solid var(--color-warn-border)",
        padding: "8px var(--space-4)",
        textAlign: "center",
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: 0,
      }}
    >
      {config.testBanner}
    </div>
  );
};

const tabIcons: Record<string, (color: string) => JSX.Element> = {
  Wallet: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="4" width="14" height="10" rx="2" stroke={color} strokeWidth="1.5" />
      <path d="M1 7h14" stroke={color} strokeWidth="1.5" />
      <circle cx="12" cy="10" r="1" fill={color} />
    </svg>
  ),
  Execute: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polygon points="5,2 13,8 5,14" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  Analytics: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline points="1,12 5,6 9,9 15,3" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const MobileTabButton: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}> = ({ label, active, onClick, badge }) => {
  const color = active ? THEME.accent : THEME.textMuted;
  const renderIcon = tabIcons[label];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...styles.mobileTabButton,
        color,
        borderTopColor: active ? THEME.accent : "transparent",
      }}
    >
      {renderIcon && renderIcon(color)}
      <span style={styles.mobileTabLabel}>{label}</span>
      {badge && (
        <span style={styles.tabBadge} aria-label={`${badge} slices`}>{badge}</span>
      )}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  appRoot: {
    // Transparent so the fixed-position UnicornBackground (z-index 0)
    // shows through. Body still has var(--color-1) as a fallback while
    // the Unicorn runtime loads + on prefers-reduced-motion users.
    background: "transparent",
    color: THEME.text,
    fontFamily: SANS,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    zIndex: 1,
  },
  solflareBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    padding: "8px var(--space-4)",
    background: "var(--color-accent-bg-soft)",
    borderBottom: "1px solid var(--color-stroke)",
    fontFamily: SANS,
    fontSize: "var(--text-xs)",
    color: THEME.accent,
    letterSpacing: 0,
  },
  solflareDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: THEME.accent,
    boxShadow: "0 0 8px var(--color-5)",
  },

  // Outer container: clamps to a max-width on ultra-wide displays so
  // the layout doesn't stretch into infinity. At ≥1920 the body keeps
  // its background but the actual UI stays comfortably readable.
  desktopLayoutOuter: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: 1800,
    margin: "0 auto",
    padding: "0 var(--space-4)",
  },
  // Adaptive 3-col grid using CSS clamp() — works tablet → ultra-wide
  // without a JS isTablet branch:
  //   sideCol left:   clamp(220px, 22vw, 300px)
  //   middleCol:      1fr (executes the meat of the work)
  //   sideCol right:  clamp(260px, 26vw, 380px) — analytics gets
  //                   slightly more room on wide screens for charts
  desktopLayout: {
    flex: 1,
    display: "grid",
    gridTemplateColumns:
      "clamp(220px, 22vw, 300px) 1fr clamp(260px, 26vw, 380px)",
    gap: "var(--space-4)",
    padding: "var(--space-4) 0",
    minHeight: 0,
    alignItems: "start",
  },
  sideCol: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  // Right side col gets a min-height so analytics charts have room
  // even when execution hasn't started yet — prevents collapse to
  // <100px on tablet with empty AWAITING state.
  sideColRight: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 480,
  },
  middleCol: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  desktopFooterHint: {
    padding: "10px var(--space-4)",
    textAlign: "center",
    fontSize: "var(--text-xs)",
    color: THEME.textMuted,
    borderTop: `1px solid ${THEME.border}`,
    animation: "liminal-panel-enter 500ms var(--ease-out)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
  },

  // Tablet — 2-col Execute + Analytics. Wallet hidden at this width;
  // see App component comment for rationale.
  tabletLayoutOuter: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: 1200,
    margin: "0 auto",
    padding: "0 var(--space-3)",
  },
  tabletLayout: {
    flex: 1,
    display: "grid",
    // 1.4fr / 1fr — Execute slightly larger because the form has more
    // input controls. Analytics fits a few cards even at 41% width.
    gridTemplateColumns: "1.4fr 1fr",
    gap: "var(--space-3)",
    padding: "var(--space-3) 0",
    minHeight: 0,
    alignItems: "start",
  },
  tabletPane: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  // Mobile
  mobileRoot: {
    // Same transparency rationale as appRoot — see above.
    background: "transparent",
    color: THEME.text,
    fontFamily: SANS,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    zIndex: 1,
  },
  mobileBody: {
    flex: 1,
    padding: "var(--space-3)",
    paddingBottom: "calc(var(--mobile-tab-height) + var(--space-3) + env(safe-area-inset-bottom, 0px))",
    overflowY: "auto",
    minHeight: 0,
  },
  mobileTabBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: "calc(var(--mobile-tab-height) + env(safe-area-inset-bottom, 0px))",
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    background: THEME.panelBg,
    borderTop: `1px solid ${THEME.border}`,
    zIndex: 100,
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
  },
  mobileTabButton: {
    background: "transparent",
    border: "none",
    borderTop: "2px solid transparent",
    cursor: "pointer",
    fontFamily: SANS,
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: 0,
    textTransform: "none",
    padding: "10px var(--space-1)",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: "var(--touch-min)",
    transition: "color var(--motion-base) var(--ease-out)",
  },
  mobileTabLabel: {
    lineHeight: 1,
  },
  tabBadge: {
    position: "absolute",
    top: 6,
    right: "30%",
    minWidth: 20,
    height: 16,
    borderRadius: 8,
    background: "var(--color-5)",
    color: "var(--color-text-inverse)",
    fontSize: 14,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 5px",
    lineHeight: 1,
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
  },

  // Active execution bar (mobile)
  activeExecBar: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    height: 40,
    padding: "0 var(--space-4)",
    background: "var(--color-2)",
    border: "none",
    borderBottom: `1px solid ${THEME.border}`,
    color: THEME.text,
    fontFamily: SANS,
    fontSize: "var(--text-xs)",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: THEME.accent,
    boxShadow: `0 0 8px ${THEME.accent}`,
    animation: "liminal-active-pulse 1.4s var(--ease-out) infinite",
    flexShrink: 0,
  },
  progressTrack: {
    position: "relative",
    height: 4,
    background: "var(--color-accent-bg-soft)",
    width: "100%",
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    // Gradient from deeper to lighter accent → reads as forward motion
    // even when the bar hasn't moved for a few seconds.
    background:
      "linear-gradient(90deg, var(--color-5-strong) 0%, var(--color-5) 100%)",
    boxShadow: "0 0 10px rgba(249, 178, 215, 0.6)",
    transition: "width var(--motion-slow) var(--ease-out)",
  },
  activeExecText: {
    flex: 1,
    color: THEME.text,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
  },
  activeExecUsd: {
    color: "var(--color-success)",
    fontWeight: 700,
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
  },
};

export default App;
