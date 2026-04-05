/**
 * LIMINAL — Root Layout
 *
 * CLAUDE.md BLOK 7 "Ekran Yapısı: Üç Panel" + BLOK 6 "In-App Browser
 * Uyumluluğu" + mobil tab navigation. Üç breakpoint:
 *   - Desktop (≥1024): sol (280) + orta (flex) + sağ (320)
 *   - Tablet (768-1023): sol gizli, orta + sağ 50/50
 *   - Mobile (<768): tek sütun + alt tab bar + üst active execution bar
 *
 * Solflare in-app browser: mount'ta otomatik bağlantı, üstte "Solflare
 * üzerinden açıldı" yeşil banner. Kullanıcı hiçbir zaman manuel connect
 * butonuna basmaz.
 *
 * Viewport height: 100vh yerine 100dvh (dynamic viewport height) kullanılır,
 * mobil tarayıcıların address bar davranışıyla uyumlu. Fallback zinciri
 * dvh → svh → vh.
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import "./styles/design-system.css";
import { useDeviceDetection } from "./hooks/useDeviceDetection";
import { useExecutionMachine } from "./hooks/useExecutionMachine";
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

// ---------------------------------------------------------------------------
// Theme — tüm değerler design-system.css CSS variable'larından okunur.
// Bu dosya yalnızca referans isimlerini JS-friendly bir objede topluyor;
// hardcoded hex değer yok.
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
// Google Fonts preconnect + stylesheet — head'e inject edilir.
// design-system.css içindeki @import fallback; burada preconnect eklemek
// font load latency'sini düşürür.
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

  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);

  const [mobileTab, setMobileTab] = useState<MobileTab>("execute");

  // Solflare in-app browser: mount'ta otomatik bağlantı.
  // `isSolflareInAppBrowser` true ise kullanıcıya prompt göstermeden
  // doğrudan connect() çağrılır. Zaten trusted session'da olduğu için
  // Solflare reddetmez, silent reconnect.
  useEffect(() => {
    if (!device.isSolflareInAppBrowser) return;
    void (async () => {
      try {
        await initSolflare();
        // Eğer onlyIfTrusted ile bağlanılmadıysa açık connect dene.
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

  // ------------------------------------------------------------------
  // Mobile layout
  // ------------------------------------------------------------------
  if (device.isMobile) {
    return (
      <div className="liminal-root" style={styles.mobileRoot}>
        {device.isSolflareInAppBrowser && <SolflareBanner />}

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
        {device.isSolflareInAppBrowser && <SolflareBanner />}
        <div style={styles.tabletLayout}>
          <div style={styles.tabletPane}>
            <ExecutionPanel />
          </div>
          <div style={styles.tabletPane}>
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
      {device.isSolflareInAppBrowser && <SolflareBanner />}
      <div style={styles.desktopLayout}>
        <aside style={styles.leftCol}>
          <WalletPanel />
        </aside>
        <main style={styles.middleCol}>
          <ExecutionPanel />
        </main>
        <aside style={styles.rightCol}>
          <AnalyticsPanel />
        </aside>
      </div>
      {!wallet.connected && !device.isSolflareInAppBrowser && (
        // Empty-state hint — steers user to the left panel.
        <div style={styles.desktopFooterHint}>
          Connect your Solflare wallet from the left panel to get started.
        </div>
      )}
    </div>
  );
};

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
}> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      ...styles.mobileTabButton,
      color: active ? THEME.accent : THEME.textMuted,
      borderTopColor: active ? THEME.accent : "transparent",
    }}
  >
    {label}
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
    padding: "10px 10px 76px", // bottom padding tab bar için
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
    // Safe area (iOS notch)
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
