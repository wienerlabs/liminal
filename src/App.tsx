/**
 * LIMINAL — Root Layout
 *
 * CLAUDE.md BLOK 7 "Ekran Yapisi: Uc Panel" + BLOK 6 "In-App Browser
 * Uyumlulugu" + mobil tab navigation. Uc breakpoint:
 *   - Desktop (>=1024): sol (280) + orta (flex) + sag (320)
 *   - Tablet (768-1023): sol gizli, orta + sag 50/50
 *   - Mobile (<768): tek sutun + alt tab bar + ust active execution bar
 *
 * Solflare in-app browser: mount'ta otomatik baglanti, ustte "Solflare
 * uzerinden acildi" yesil banner.
 *
 * Includes: HeaderBar, ToastContainer, panel entrance animations,
 * network status, mobile tab badge.
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import "./styles/design-system.css";
import { useDeviceDetection } from "./hooks/useDeviceDetection";
import { useExecutionMachine } from "./hooks/useExecutionMachine";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import {
  IN_FLIGHT_STATUSES,
} from "./state/executionMachine";
import {
  connectWallet,
  initSolflare,
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "./services/solflare";
import WalletPanel from "./components/WalletPanel";
import ExecutionPanel from "./components/ExecutionPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import HeaderBar from "./components/HeaderBar";
import { ToastContainer } from "./components/ToastProvider";

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
  activeBarBg: "var(--color-2)",
  warn: "var(--color-warn)",
  shadow: "var(--shadow-component)",
} as const;

const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Google Fonts preconnect
// ---------------------------------------------------------------------------

const FONT_LINKS_ID = "liminal-google-fonts";
if (typeof document !== "undefined" && !document.getElementById(FONT_LINKS_ID)) {
  const preconnect1 = document.createElement("link");
  preconnect1.id = `${FONT_LINKS_ID}-pc1`;
  preconnect1.rel = "preconnect";
  preconnect1.href = "https://fonts.googleapis.com";

  const preconnect2 = document.createElement("link");
  preconnect2.id = `${FONT_LINKS_ID}-pc2`;
  preconnect2.rel = "preconnect";
  preconnect2.href = "https://fonts.gstatic.com";
  preconnect2.setAttribute("crossorigin", "anonymous");

  const stylesheet = document.createElement("link");
  stylesheet.id = FONT_LINKS_ID;
  stylesheet.rel = "stylesheet";
  stylesheet.href =
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap";

  document.head.appendChild(preconnect1);
  document.head.appendChild(preconnect2);
  document.head.appendChild(stylesheet);
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

type MobileTab = "wallet" | "execute" | "analytics";

export const App: FC = () => {
  const device = useDeviceDetection();
  const { state } = useExecutionMachine();
  const networkStatus = useNetworkStatus();

  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);

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

  const inFlight = IN_FLIGHT_STATUSES.has(state.status);
  const sliceN = state.currentSliceIndex + 1;
  const sliceM = state.slices.length;

  // Mobile tab badge: show slice count on Execute tab during active execution
  const executeBadge = inFlight && sliceM > 0 ? `${sliceN}/${sliceM}` : undefined;

  // ------------------------------------------------------------------
  // Mobile layout
  // ------------------------------------------------------------------
  if (device.isMobile) {
    return (
      <div className="liminal-root" style={styles.mobileRoot}>
        <HeaderBar networkStatus={networkStatus} />
        {device.isSolflareInAppBrowser && <SolflareBanner />}
        <ToastContainer />

        {inFlight && (
          <button
            type="button"
            onClick={() => setMobileTab("execute")}
            style={styles.activeExecBar}
          >
            <span style={styles.pulseDot} />
            <span style={styles.activeExecText}>
              Execution active: Slice {sliceN}/{sliceM}
            </span>
            <span style={styles.activeExecUsd}>
              $
              {state.totalPriceImprovementUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </button>
        )}

        <main style={styles.mobileBody}>
          {mobileTab === "wallet" && <WalletPanel />}
          {mobileTab === "execute" && <ExecutionPanel />}
          {mobileTab === "analytics" && <AnalyticsPanel />}
        </main>

        <nav style={styles.mobileTabBar}>
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
  // Tablet layout
  // ------------------------------------------------------------------
  if (device.isTablet) {
    return (
      <div className="liminal-root" style={styles.appRoot}>
        <HeaderBar networkStatus={networkStatus} />
        {device.isSolflareInAppBrowser && <SolflareBanner />}
        <ToastContainer />
        <div style={styles.tabletLayout}>
          <div style={{ ...styles.tabletPane, ...panelEntranceStyle(0) }}>
            <ExecutionPanel />
          </div>
          <div style={{ ...styles.tabletPane, ...panelEntranceStyle(1) }}>
            <AnalyticsPanel />
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Desktop layout
  // ------------------------------------------------------------------
  return (
    <div className="liminal-root" style={styles.appRoot}>
      <HeaderBar networkStatus={networkStatus} />
      {device.isSolflareInAppBrowser && <SolflareBanner />}
      <ToastContainer />
      <div style={styles.desktopLayout}>
        <aside style={{ ...styles.leftCol, ...panelEntranceStyle(0) }}>
          <WalletPanel />
        </aside>
        <main style={{ ...styles.middleCol, ...panelEntranceStyle(1) }}>
          <ExecutionPanel />
        </main>
        <aside style={{ ...styles.rightCol, ...panelEntranceStyle(2) }}>
          <AnalyticsPanel />
        </aside>
      </div>
      {!wallet.connected && !device.isSolflareInAppBrowser && (
        <div style={styles.desktopFooterHint}>
          Connect your Solflare wallet from the left panel to get started.
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel entrance animation helper (Item 10)
// ---------------------------------------------------------------------------

function panelEntranceStyle(index: number): CSSProperties {
  return {
    animation: `liminal-panel-enter 500ms ease-out ${index * 120}ms both`,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SolflareBanner: FC = () => (
  <div style={styles.solflareBanner}>
    <span style={styles.solflareDot} />
    <span>Opened via Solflare</span>
  </div>
);

const MobileTabButton: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}> = ({ label, active, onClick, badge }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      ...styles.mobileTabButton,
      color: active ? THEME.accent : THEME.textMuted,
      borderTopColor: active ? THEME.accent : "transparent",
      position: "relative",
    }}
  >
    {label}
    {badge && (
      <span style={styles.tabBadge}>{badge}</span>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  appRoot: {
    background: THEME.bg,
    color: THEME.text,
    fontFamily: SANS,
    display: "flex",
    flexDirection: "column",
  },
  solflareBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "8px 16px",
    background: "var(--color-accent-bg-soft)",
    borderBottom: "1px solid var(--color-stroke)",
    fontFamily: SANS,
    fontSize: 11,
    color: THEME.accent,
    letterSpacing: 0.5,
  },
  solflareDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: THEME.accent,
    boxShadow: "0 0 8px var(--color-5)",
  },

  // Desktop
  desktopLayout: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "280px 1fr 320px",
    gap: 16,
    padding: 16,
    minHeight: 0,
  },
  leftCol: {
    minWidth: 0,
  },
  middleCol: {
    minWidth: 0,
  },
  rightCol: {
    minWidth: 0,
  },
  desktopFooterHint: {
    padding: "10px 16px",
    textAlign: "center",
    fontSize: 11,
    color: THEME.textMuted,
    borderTop: `1px solid ${THEME.border}`,
  },

  // Tablet
  tabletLayout: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    padding: 12,
    minHeight: 0,
  },
  tabletPane: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  // Mobile
  mobileRoot: {
    background: THEME.bg,
    color: THEME.text,
    fontFamily: SANS,
    display: "flex",
    flexDirection: "column",
  },
  mobileBody: {
    flex: 1,
    padding: "10px 10px 76px",
    overflowY: "auto",
    minHeight: 0,
  },
  mobileTabBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    background: THEME.panelBg,
    borderTop: `1px solid ${THEME.border}`,
    zIndex: 100,
    paddingBottom: "env(safe-area-inset-bottom, 0)",
  },
  mobileTabButton: {
    background: "transparent",
    border: "none",
    borderTop: "2px solid transparent",
    cursor: "pointer",
    fontFamily: SANS,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    padding: "10px 4px",
  },
  tabBadge: {
    position: "absolute",
    top: 4,
    right: "calc(50% - 24px)",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    background: "var(--color-5)",
    color: "var(--color-text-inverse)",
    fontSize: 9,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
    lineHeight: 1,
    fontFamily: "var(--font-mono)",
  },

  // Active execution bar (mobile)
  activeExecBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 40,
    padding: "0 14px",
    background: THEME.activeBarBg,
    border: "none",
    borderBottom: `1px solid ${THEME.border}`,
    color: THEME.text,
    fontFamily: SANS,
    fontSize: 11,
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
    animation: "liminal-active-pulse 1.4s ease-in-out infinite",
    flexShrink: 0,
  },
  activeExecText: {
    flex: 1,
    color: THEME.text,
    fontWeight: 600,
  },
  activeExecUsd: {
    color: THEME.accent,
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  },
};

export default App;
