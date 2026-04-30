/**
 * LIMINAL — ExecutionPanel
 *
 * BLOK 7 "Orta Panel" — LIMINAL'in aksiyon merkezi. Bu revizyonda:
 *  1. Token pair seçimi (wallet token listesi — öncekinden korundu)
 *  2. Canlı fiyat göstergesi (Pyth — öncekinden korundu)
 *  3. Miktar / execution window / dilim sayısı / slippage input'ları (AKTİF)
 *  4. selectOptimalVault ile otomatik Kamino vault seçimi + VaultPreview
 *  5. QuoteComparison (state machine'in currentQuote'una bağlı)
 *  6. useExecutionMachine orchestration'ı (configure → start → timeline)
 *  7. Recovery prompt
 *
 * Input'lar sadece IDLE/CONFIGURED state'lerinde editable. In-flight
 * state'lerde locked + tooltip.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  connectWallet,
  getSOLBalance,
  getSPLTokenBalances,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import { selectOptimalVault, type KaminoVault } from "../services/kamino";
import { usePriceMonitor } from "../hooks/usePriceMonitor";
import { useExecutionMachine } from "../hooks/useExecutionMachine";
import { useDeviceDetection } from "../hooks/useDeviceDetection";
import { useTokenRegistry } from "../hooks/useTokenRegistry";
import type { TokenInfo } from "../services/tokenRegistry";
import {
  DFlowLogo,
  KaminoIcon,
  LiminalMark,
} from "./BrandLogos";
import { ExecutionStatus, IN_FLIGHT_STATUSES } from "../state/executionMachine";
import { estimatePopups, MAX_AUTOPILOT_SLICES } from "../state/preSignPlan";
import VaultPreview from "./VaultPreview";
import QuoteComparison from "./QuoteComparison";
import ExecutionTimeline from "./ExecutionTimeline";
import NotificationBanner from "./NotificationBanner";
import ExecutionSummaryCard from "./ExecutionSummaryCard";
import StepIndicator from "./StepIndicator";
import AnimatedNumber from "./AnimatedNumber";
import Sparkline from "./Sparkline";
import ExecutionStack from "./ExecutionStack";
import RiskAdvisor from "./RiskAdvisor";
import Button from "./Button";
import Tooltip from "./Tooltip";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME = {
  panel: "var(--color-1)",
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  borderHover: "var(--color-stroke-hover)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  accentGlow: "var(--shadow-accent-glow)",
  danger: "var(--color-warn)",
  amber: "var(--color-warn)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Token brand colors (canonical, not palette colors)
const KNOWN_TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF",
  USDC: "#2775CA",
  USDT: "#26A17B",
  BONK: "#F7931A",
};

function getTokenColor(symbol: string): string {
  return KNOWN_TOKEN_COLORS[symbol] ?? "var(--color-5)";
}

// Execution window preset'leri (BLOK 7 Adım 3)
const WINDOW_PRESETS: Array<{
  label: string;
  ms: number;
  suggestedSlices: number;
}> = [
  { label: "30m", ms: 30 * 60 * 1000, suggestedSlices: 3 },
  { label: "1h", ms: 60 * 60 * 1000, suggestedSlices: 4 },
  { label: "2h", ms: 2 * 60 * 60 * 1000, suggestedSlices: 6 },
  { label: "4h", ms: 4 * 60 * 60 * 1000, suggestedSlices: 8 },
];

const DEFAULT_SLIPPAGE_BPS = 50;
const MIN_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 300;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUSD(n: number): string {
  const decimals = n < 1 ? 6 : 2;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function secondsSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

function bpsToPercent(bps: number): string {
  return `%${(bps / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Available tokens hook (wallet'tan beslenir)
// ---------------------------------------------------------------------------

type AvailableToken = {
  mint: string;
  symbol: string;
  balance: number;
};

function useAvailableTokens(wallet: WalletState): {
  tokens: AvailableToken[];
  loading: boolean;
  error: string | null;
} {
  const [tokens, setTokens] = useState<AvailableToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setTokens([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const address = wallet.address;
    void (async () => {
      try {
        const [solBalance, splTokens] = await Promise.all([
          getSOLBalance(address),
          getSPLTokenBalances(address),
        ]);
        if (cancelled) return;

        const combined: AvailableToken[] = [];
        if (solBalance > 0) {
          combined.push({ mint: SOL_MINT, symbol: "SOL", balance: solBalance });
        }
        for (const t of splTokens) {
          if (t.mint === SOL_MINT) continue;
          combined.push({
            mint: t.mint,
            symbol: t.symbol,
            balance: t.balance,
          });
        }
        setTokens(combined);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "An error occurred while loading tokens.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet.connected, wallet.address]);

  return { tokens, loading, error };
}

// ---------------------------------------------------------------------------
// Optimal vault selection hook
// ---------------------------------------------------------------------------

function useOptimalVault(inputMint: string): {
  vault: KaminoVault | null;
  loading: boolean;
} {
  const [vault, setVault] = useState<KaminoVault | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!inputMint) {
      setVault(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const selected = await selectOptimalVault(inputMint);
        if (!cancelled) setVault(selected);
      } catch (err) {
        if (!cancelled) {
          console.warn(
            `[LIMINAL] selectOptimalVault error: ${err instanceof Error ? err.message : String(err)}`,
          );
          setVault(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inputMint]);

  return { vault, loading };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ExecutionPanel: FC = () => {
  // --- Wallet & tokens ----------------------------------------------------
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    connecting: false,
    address: null,
  });
  useEffect(() => {
    const unsub = subscribeWallet(setWallet);
    return unsub;
  }, []);

  // BUG FIX (RR): surface connectWallet() rejections to the user.
  // Previously the call site was `() => void connectWallet()` which
  // silently discarded the promise — if Solflare wasn't installed, or
  // the user rejected the connection popup, they'd see no feedback at
  // all. Capture the error and render it next to the Connect button.
  const [connectError, setConnectError] = useState<string | null>(null);
  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try {
      await connectWallet();
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : "Could not connect to Solflare.",
      );
    }
  }, []);
  const { tokens: rawTokens, loading: tokensLoading, error: tokensError } =
    useAvailableTokens(wallet);

  // --- Token registry (Jupiter) — warm up metadata for all wallet tokens.
  const rawMints = useMemo(() => rawTokens.map((t) => t.mint), [rawTokens]);
  const tokenRegistry = useTokenRegistry(rawMints);
  const tokens = useMemo(
    () =>
      rawTokens.map((t) => {
        const info = tokenRegistry.lookup(t.mint);
        return info ? { ...t, symbol: info.symbol } : t;
      }),
    [rawTokens, tokenRegistry],
  );

  // --- Device detection for mobile responsive adjustments ----------------
  const device = useDeviceDetection();
  const isMobile = device.isMobile;

  // --- Execution machine --------------------------------------------------
  const machine = useExecutionMachine();
  const { state, configure, start, retry, reset } = machine;
  const { pendingRecovery, resumeRecovery, discardRecovery } = machine;
  const { otherTabsInFlight } = machine;

  const isIdleOrConfigured =
    state.status === ExecutionStatus.IDLE ||
    state.status === ExecutionStatus.CONFIGURED;
  // Single source of truth lives in executionMachine — derive from
  // it instead of maintaining a parallel inline list. Earlier audits
  // caught two drift bugs (PR #20 added PREPARING but ExecutionPanel
  // missed it for a release; same risk every time a status is added).
  const isInFlight = IN_FLIGHT_STATUSES.has(state.status);

  const lockedTooltip = "Cannot be changed during active execution.";

  // --- Form state ---------------------------------------------------------
  const [fromMint, setFromMint] = useState<string>("");
  const [toMint, setToMint] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const [windowMs, setWindowMs] = useState<number>(WINDOW_PRESETS[1].ms);
  const [sliceCount, setSliceCount] = useState<number>(
    WINDOW_PRESETS[1].suggestedSlices,
  );
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  /**
   * Otopilot modu (Level 1 durable-nonce pre-sign). True iken plan
   * Solflare'in `signAllTransactions` popup'ıyla tek seferde imzalanır —
   * slice popup'ları Kamino için yok, sadece swap için JIT kalır. Default
   * true, kullanıcı klasik moda her zaman geri dönebilir.
   */
  const [preSignEnabled, setPreSignEnabled] = useState<boolean>(true);

  // Autopilot toggle reactive clamp: if the user had a sliceCount > the
  // autopilot ceiling (e.g. picked 8 in JIT mode then turned autopilot
  // ON), bring the count down to the ceiling so the START button isn't
  // silently disabled. Also re-applies on initial mount.
  useEffect(() => {
    if (isInFlight) return;
    if (preSignEnabled && sliceCount > MAX_AUTOPILOT_SLICES) {
      setSliceCount(MAX_AUTOPILOT_SLICES);
    }
  }, [preSignEnabled, sliceCount, isInFlight]);

  // Wallet değiştiğinde form'u temizle (sadece in-flight değilse).
  useEffect(() => {
    if (isInFlight) return;
    if (!wallet.connected) {
      setFromMint("");
      setToMint("");
      setAmountStr("");
    }
  }, [wallet.connected, isInFlight]);

  useEffect(() => {
    if (isInFlight) return;
    if (fromMint && !tokens.find((t) => t.mint === fromMint)) setFromMint("");
    if (toMint && !tokens.find((t) => t.mint === toMint)) setToMint("");
  }, [tokens, fromMint, toMint, isInFlight]);

  // --- Pyth price monitor -------------------------------------------------
  // Dedup fromMint / toMint — the swap-button flow can momentarily set both
  // to the same mint, which would produce duplicate React keys in the
  // price list and trigger a `Two children with the same key` warning.
  const activeMints = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of [fromMint, toMint]) {
      if (m && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  }, [fromMint, toMint]);
  const priceMonitor = usePriceMonitor(activeMints, 5000);
  const { prices, lastUpdated: priceLastUpdated } = priceMonitor;

  // --- 1s tick (timestamp ve countdown gösterimleri için) ------------------
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- Optimal vault -------------------------------------------------------
  const { vault: optimalVault, loading: vaultLoading } =
    useOptimalVault(fromMint);

  // --- Derived values -----------------------------------------------------
  const amountNum = useMemo(() => {
    const n = parseFloat(amountStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountStr]);

  const fromToken = tokens.find((t) => t.mint === fromMint);
  const fromBalance = fromToken?.balance ?? 0;
  const amountExceedsBalance = amountNum > fromBalance;

  const fromUsdPrice = fromMint ? (prices[fromMint] ?? 0) : 0;
  const amountUsd = amountNum * fromUsdPrice;

  const canConfigure =
    wallet.connected &&
    !!fromMint &&
    !!toMint &&
    amountNum > 0 &&
    !amountExceedsBalance &&
    sliceCount >= 1 &&
    slippageBps >= MIN_SLIPPAGE_BPS &&
    slippageBps <= MAX_SLIPPAGE_BPS &&
    !!optimalVault &&
    !otherTabsInFlight &&
    isIdleOrConfigured;

  // --- Keyboard shortcut: Cmd/Ctrl + Enter to start ----------------------
  // Guard: ignore when a modal/dialog is open or focus is inside an editable
  // element other than this panel (prevents unintended triggers).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
      // Don't fire if a dialog (modal) is mounted anywhere.
      if (document.querySelector('[role="dialog"]')) return;
      if (canConfigure) {
        e.preventDefault();
        handleConfigureAndStartRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfigure]);

  const handleConfigureAndStartRef = useRef<(() => void) | null>(null);

  // --- Actions ------------------------------------------------------------
  const handleConfigureAndStart = useCallback(() => {
    if (!canConfigure || !optimalVault) return;
    try {
      configure({
        inputMint: fromMint,
        outputMint: toMint,
        totalAmount: amountNum,
        sliceCount,
        windowDurationMs: windowMs,
        slippageBps,
        kaminoVaultAddress: optimalVault.marketAddress,
        preSignEnabled,
      });
      // configure senkron — bir sonraki tick'te state CONFIGURED olacak.
      // useEffect ile start'ı tetikleyemeyeceğimiz için burada kısa bir
      // microtask bekleyip start çağırıyoruz.
      queueMicrotask(() => start());
    } catch (err) {
      console.error(
        `[LIMINAL] Execution start error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [
    canConfigure,
    optimalVault,
    configure,
    start,
    fromMint,
    toMint,
    amountNum,
    sliceCount,
    windowMs,
    slippageBps,
    preSignEnabled,
  ]);

  handleConfigureAndStartRef.current = handleConfigureAndStart;

  const handleWindowPreset = useCallback((ms: number, suggested: number) => {
    if (isInFlight) return;
    setWindowMs(ms);
    setSliceCount(suggested);
  }, [isInFlight]);

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  return (
    <section style={styles.panel} aria-label="Execution panel">
      <header style={styles.header}>Execute</header>

      {/* Multi-tab warning — surfaces only when ANOTHER tab in the
          same browser profile is mid-execution. Suppress while we
          have our own in-flight state (we'd be the source) so the
          banner doesn't echo our own activity. */}
      {otherTabsInFlight && !pendingRecovery && (
        <div style={styles.multiTabBanner} role="alert">
          <span aria-hidden="true" style={styles.multiTabIcon}>
            ⚠️
          </span>
          <span>
            <strong>Another LIMINAL tab is mid-execution.</strong> Starting a
            new run here would create overlapping Solflare popups and
            conflicting on-chain transactions. Switch tabs to manage that
            execution first.
          </span>
        </div>
      )}

      {/* Recovery prompt */}
      {pendingRecovery && (
        <div style={styles.recoveryBanner} role="alert">
          <div style={styles.recoveryTitle}>INCOMPLETE EXECUTION</div>
          <div style={styles.recoveryText}>
            An execution from your previous session was not completed. Would
            you like to resume from where it left off?
          </div>
          {!pendingRecovery.canResume && (
            <div style={styles.recoveryWarning}>
              To resume you must reconnect the original wallet (
              {pendingRecovery.walletAddress.slice(0, 4)}...
              {pendingRecovery.walletAddress.slice(-4)}).
            </div>
          )}
          {/* BUG FIX (VV): if another tab is currently broadcasting
              in-flight status via BroadcastChannel, the persisted state
              we just read is THAT tab's live state — not stale. Resuming
              here would create the exact duplicate-execution race that
              the multi-tab service warns about. Block resume + redirect
              the user to the active tab. */}
          {otherTabsInFlight && (
            <div style={styles.recoveryWarning}>
              ⚠️ Another LIMINAL tab is currently running this execution
              live. Switch to that tab to manage it — resuming here would
              double-broadcast.
            </div>
          )}
          <div style={styles.recoveryActions}>
            <button
              type="button"
              onClick={resumeRecovery}
              disabled={!pendingRecovery.canResume || otherTabsInFlight}
              style={{
                ...styles.recoveryPrimary,
                opacity:
                  pendingRecovery.canResume && !otherTabsInFlight ? 1 : 0.4,
                cursor:
                  pendingRecovery.canResume && !otherTabsInFlight
                    ? "pointer"
                    : "not-allowed",
              }}
            >
              RESUME
            </button>
            <button
              type="button"
              onClick={discardRecovery}
              style={styles.recoverySecondary}
            >
              DISCARD
            </button>
          </div>
        </div>
      )}

      {!wallet.connected ? (
        <div style={styles.emptyBody} className="liminal-aurora">
          <div style={styles.welcomeSection}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              <LiminalMark size={88} />
            </div>
            <div style={styles.welcomeTagline}>Intelligent Execution Terminal</div>
            <div style={styles.welcomeFeatures}>
              <WelcomeFeature
                icon={<TwapIcon />}
                title="TWAP Execution"
                desc="Split large swaps into optimal slices"
              />
              <WelcomeFeature
                icon={
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      color: "var(--color-5-strong)",
                    }}
                  >
                    <KaminoIcon size={20} />
                  </span>
                }
                title="Kamino Yield"
                desc="Earn yield on idle capital while you wait"
              />
              <WelcomeFeature
                icon={<DFlowLogo size={20} />}
                title="DFlow MEV Protection"
                desc="Every slice routed through MEV-protected paths"
              />
              <WelcomeFeature
                icon={<ChartIcon />}
                title="Live Analytics"
                desc="Real-time price improvement and yield tracking"
              />
            </div>
            <Button
              variant="primary"
              onClick={() => void handleConnect()}
              disabled={wallet.connecting}
              style={{ width: "100%", marginTop: 8, padding: "14px 28px" }}
            >
              {wallet.connecting ? "Connecting…" : "Connect Solflare"}
            </Button>
            {connectError && (
              <div
                role="alert"
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${THEME.danger}`,
                  background: "var(--color-warn-bg, rgba(255, 100, 80, 0.12))",
                  color: THEME.text,
                  fontFamily: MONO,
                  fontSize: 14,
                  lineHeight: 1.5,
                  textAlign: "left",
                }}
              >
                {connectError}
              </div>
            )}

            {/* Hero stats strip — three terse metrics that anchor what
                LIMINAL actually is, beneath the connect CTA. Numbers are
                static "kind-of-truths" sourced from the architecture
                doc (4 partners, mainnet target, non-custodial). They
                don't pretend to be live aggregate metrics — that lives
                in the Analytics > Protocol tab once the user is in.
                The strip helps a first-time visitor decide "OK, I'll
                connect" before scrolling away.
                Partner logos themselves moved to the global <Footer />
                so they stay visible across all execution states. */}
            <ul style={styles.heroStats} aria-label="LIMINAL stats">
              <li style={styles.heroStatCell}>
                <div style={styles.heroStatValue}>4</div>
                <div style={styles.heroStatLabel}>Partners</div>
                <div style={styles.heroStatHint}>DFlow · Kamino · QuickNode · Solflare</div>
              </li>
              <li style={styles.heroStatCell}>
                <div style={styles.heroStatValue}>0</div>
                <div style={styles.heroStatLabel}>Custody</div>
                <div style={styles.heroStatHint}>Funds stay in your wallet</div>
              </li>
              <li style={styles.heroStatCell}>
                <div style={styles.heroStatValue}>Mainnet</div>
                <div style={styles.heroStatLabel}>Network</div>
                <div style={styles.heroStatHint}>Live execution, no testnet sim</div>
              </li>
            </ul>

            {/* Welcome teaser — fan-out card stack with sample
                executions so first-time visitors see immediately
                what their history will look like. Desktop only;
                mobile welcome state is already content-heavy. */}
            {!isMobile && (
              <div style={styles.welcomeStackWrap}>
                <ExecutionStack
                  executions={[]}
                  demoMode
                  title="Preview · sample executions"
                />
              </div>
            )}
          </div>
        </div>
      ) : state.status === ExecutionStatus.DONE ? (
        <ExecutionSummaryCard state={state} onReset={reset} />
      ) : (
        <>
          {/* Risk Advisor — proactive tips derived from the user's
              local execution history. Sits above the FormCards so the
              user sees relevant nudges before they configure their
              next run, not after. Hidden when no actionable tips
              apply (component returns null on empty input). */}
          {(state.status === ExecutionStatus.IDLE ||
            state.status === ExecutionStatus.CONFIGURED) && (
            <RiskAdvisor
              currentSlippageBps={slippageBps}
              onApply={(key) => {
                if (key.startsWith("slippage:")) {
                  const next = parseInt(key.slice("slippage:".length), 10);
                  if (Number.isFinite(next)) setSlippageBps(next);
                }
              }}
            />
          )}

          {/* ============================================================
              CARD 1 — TRADE
              Token pair + amount + inline live price + vault note. PR #5b
              groups what was previously 5 disjoint sections (token pair,
              live price, vault preview, divider, amount) into a single
              visually-cohesive card with a numbered header. Internally it
              still flows top-to-bottom — the user picks From → To, then
              types the amount — but the visual grouping makes the
              "what am I trading" step feel like one mental task instead
              of three. The Pyth price line + Kamino vault hint sit at
              the bottom as muted supporting info, not as separate cards.
              ============================================================ */}
          <FormCard step={1} title="Trade" subtitle="Pair, size, and price">
            {tokensLoading ? (
              <div style={styles.row} aria-busy="true" aria-label="Loading tokens">
                <SkeletonBox width="48%" height={44} />
                <SkeletonBox width="48%" height={44} />
              </div>
            ) : tokensError ? (
              <div style={styles.errorBlock}>
                <div style={styles.errorText}>Failed to load tokens.</div>
                <div style={styles.errorDetail}>{tokensError}</div>
              </div>
            ) : tokens.length === 0 ? (
              <div style={styles.hintText}>
                No swappable tokens found in your wallet.
              </div>
            ) : (
              <>
                {/* Token pair row */}
                <div
                  style={{
                    ...styles.row,
                    flexDirection: isMobile ? "column" : "row",
                    alignItems: "flex-end",
                  }}
                >
                  <TokenSelect
                    label="From"
                    value={fromMint}
                    tokens={tokens}
                    onChange={(mint) => !isInFlight && setFromMint(mint)}
                    disabled={isInFlight}
                    lockedTooltip={lockedTooltip}
                    prices={prices}
                    lookup={tokenRegistry.lookup}
                  />
                  <button
                    type="button"
                    disabled={isInFlight || !fromMint || !toMint}
                    onClick={() => {
                      if (isInFlight) return;
                      const tmp = fromMint;
                      setFromMint(toMint);
                      setToMint(tmp);
                    }}
                    style={{
                      ...styles.swapButton,
                      opacity: isInFlight || !fromMint || !toMint ? 0.3 : 1,
                      cursor: isInFlight || !fromMint || !toMint ? "not-allowed" : "pointer",
                    }}
                    title="Swap tokens"
                    aria-label="Swap from and to tokens"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 6h10M10 3l3 3-3 3" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M13 10H3M6 13l-3-3 3-3" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <TokenSelect
                    label="To"
                    value={toMint}
                    tokens={tokens.filter((t) => t.mint !== fromMint)}
                    onChange={(mint) => !isInFlight && setToMint(mint)}
                    disabled={isInFlight || !fromMint}
                    lockedTooltip={lockedTooltip}
                    prices={prices}
                    lookup={tokenRegistry.lookup}
                  />
                </div>

                {/* Smart "to" chips — once From is picked but To is
                    still empty, surface up to 3 popular targets as
                    one-tap chips. Saves the user from opening the
                    full dropdown when they just want USDC. */}
                {fromMint && !toMint && !isInFlight && (
                  <SmartToChips
                    fromMint={fromMint}
                    tokens={tokens}
                    onPick={setToMint}
                    lookup={tokenRegistry.lookup}
                  />
                )}

                {/* Amount row — same card, immediately under the pair so
                    the user sees "I'm swapping X of A → B" as one
                    continuous thought. */}
                <div style={styles.formCardSubLabel}>Amount</div>
                <div style={styles.amountInputWrap}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountStr}
                    onChange={(e) => {
                      if (isInFlight) return;
                      const v = e.target.value;
                      if (v === "" || /^\d*\.?\d{0,8}$/.test(v)) {
                        setAmountStr(v);
                      }
                    }}
                    disabled={isInFlight}
                    title={isInFlight ? lockedTooltip : undefined}
                    aria-invalid={amountExceedsBalance}
                    style={{
                      ...styles.numericInput,
                      borderColor: amountExceedsBalance
                        ? "var(--color-danger)"
                        : THEME.border,
                      opacity: isInFlight ? 0.5 : 1,
                      cursor: isInFlight ? "not-allowed" : "text",
                      paddingRight: fromToken && !isInFlight ? 56 : 12,
                    }}
                  />
                  {fromToken && !isInFlight && (
                    <button
                      type="button"
                      // BUG FIX (UU): for SOL, leave a buffer for transaction
                      // fees (and nonce rent in autopilot mode). 0.05 SOL
                      // covers ~250 typical transactions + up to 8 nonce
                      // account rents — well over the worst-case autopilot
                      // pool (6 slices = N+2 = 8 accounts at ~0.00148 SOL
                      // each = 0.012 SOL).
                      onClick={() => {
                        const buffer = fromMint === SOL_MINT ? 0.05 : 0;
                        const max = Math.max(0, fromBalance - buffer);
                        setAmountStr(max.toString());
                      }}
                      style={styles.maxButton}
                      title={
                        fromMint === SOL_MINT
                          ? "Leaves 0.05 SOL for transaction fees + autopilot nonce rent."
                          : undefined
                      }
                    >
                      MAX
                    </button>
                  )}
                </div>
                {fromToken && (
                  <div style={styles.amountHint}>
                    Balance: {fromBalance.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {fromToken.symbol}
                    {amountNum > 0 && fromUsdPrice > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        ≈{" "}
                        <AnimatedNumber
                          value={amountUsd}
                          prefix="$"
                          decimals={amountUsd < 1 ? 4 : 2}
                          duration={350}
                        />
                      </span>
                    )}
                  </div>
                )}
                {amountExceedsBalance && (
                  <div style={styles.amountError}>Amount exceeds balance.</div>
                )}

                {/* Inline live price (Pyth) — used to be its own section,
                    now sits as a quiet footnote inside the Trade card. */}
                <div style={styles.formCardFootnote}>
                  <PriceDisplay
                    mints={activeMints}
                    tokens={tokens}
                    prices={prices}
                    isLoading={priceMonitor.isLoading}
                    error={priceMonitor.error}
                    lastUpdated={priceLastUpdated}
                    now={now}
                  />
                </div>
              </>
            )}
          </FormCard>

          {/* Vault preview — sits between cards 1 and 2, framed as an
              "info card" rather than a step the user configures. The
              auto-vault selection is silent intelligence; surfacing it
              here lets the user verify the choice without giving it the
              weight of a numbered step. */}
          {fromMint && (
            <div style={styles.infoCard}>
              <VaultPreview
                vault={optimalVault}
                isLoading={vaultLoading}
                amountUsd={amountUsd}
                windowDurationSeconds={windowMs / 1000}
              />
            </div>
          )}

          {/* ============================================================
              CARD 2 — SCHEDULE
              Window + slice count. The TWAP "schedule" is the second
              mental task: now that you know what you're trading, decide
              how the engine should pace it.
              ============================================================ */}
          <FormCard step={2} title="Schedule" subtitle="When and how many slices">
            <div style={styles.formCardSubLabel}>Execution window</div>
            <div
              style={{
                ...styles.windowRow,
                flexDirection: isMobile ? "column" : "row",
              }}
            >
              {WINDOW_PRESETS.map((preset) => {
                const active = preset.ms === windowMs;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={isInFlight}
                    onClick={() =>
                      handleWindowPreset(preset.ms, preset.suggestedSlices)
                    }
                    title={isInFlight ? lockedTooltip : undefined}
                    style={{
                      ...styles.chip,
                      background: active ? THEME.accent : "var(--surface-card)",
                      color: active ? "var(--color-text-inverse)" : THEME.textMuted,
                      borderColor: active ? THEME.accent : THEME.border,
                      boxShadow: active ? "0 0 16px rgba(34,209,238,0.25)" : undefined,
                      opacity: isInFlight ? 0.5 : 1,
                      cursor: isInFlight ? "not-allowed" : "pointer",
                      width: isMobile ? "100%" : undefined,
                      minHeight: isMobile ? 44 : undefined,
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div style={styles.formCardSubLabel}>
              Slice count
              {preSignEnabled && (
                <span style={styles.sectionHint}>
                  {" "}(max {MAX_AUTOPILOT_SLICES} in autopilot)
                </span>
              )}
            </div>
            <input
              type="number"
              min={1}
              max={preSignEnabled ? MAX_AUTOPILOT_SLICES : 20}
              value={sliceCount}
              onChange={(e) => {
                if (isInFlight) return;
                const n = parseInt(e.target.value, 10);
                const cap = preSignEnabled ? MAX_AUTOPILOT_SLICES : 20;
                if (Number.isFinite(n) && n >= 1 && n <= cap) setSliceCount(n);
              }}
              disabled={isInFlight}
              title={isInFlight ? lockedTooltip : undefined}
              style={{
                ...styles.numericInput,
                opacity: isInFlight ? 0.5 : 1,
                cursor: isInFlight ? "not-allowed" : "text",
              }}
            />
            {windowMs > 0 && sliceCount > 0 && (
              <div style={styles.formCardFootnote}>
                One slice every{" "}
                <strong>
                  {Math.round(windowMs / sliceCount / 1000 / 60)} min
                </strong>{" "}
                · {sliceCount} slices over{" "}
                {WINDOW_PRESETS.find((p) => p.ms === windowMs)?.label ??
                  `${Math.round(windowMs / 60000)}m`}
              </div>
            )}
          </FormCard>

          {/* ============================================================
              CARD 3 — GUARDRAILS
              Slippage threshold. Renamed from "SLIPPAGE THRESHOLD" to
              the friendlier "Guardrails" because that's what it is in
              user terms — the safety belt that aborts a slice when
              market conditions go too far.
              ============================================================ */}
          <FormCard
            step={3}
            title="Guardrails"
            subtitle={`Max ${bpsToPercent(slippageBps)} per slice`}
          >
            <div
              style={{
                ...styles.slippageRow,
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "stretch" : "center",
              }}
            >
              <input
                type="range"
                min={MIN_SLIPPAGE_BPS}
                max={MAX_SLIPPAGE_BPS}
                step={5}
                value={slippageBps}
                onChange={(e) => {
                  if (isInFlight) return;
                  setSlippageBps(parseInt(e.target.value, 10));
                }}
                disabled={isInFlight}
                style={{
                  ...styles.slider,
                  opacity: isInFlight ? 0.5 : 1,
                  width: isMobile ? "100%" : undefined,
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: isMobile ? "space-between" : undefined,
                }}
              >
                <input
                  type="number"
                  min={MIN_SLIPPAGE_BPS}
                  max={MAX_SLIPPAGE_BPS}
                  step={5}
                  value={slippageBps}
                  onChange={(e) => {
                    if (isInFlight) return;
                    const n = parseInt(e.target.value, 10);
                    if (
                      Number.isFinite(n) &&
                      n >= MIN_SLIPPAGE_BPS &&
                      n <= MAX_SLIPPAGE_BPS
                    ) {
                      setSlippageBps(n);
                    }
                  }}
                  disabled={isInFlight}
                  title={isInFlight ? lockedTooltip : undefined}
                  style={{
                    ...styles.numericInput,
                    width: isMobile ? "100%" : 80,
                    opacity: isInFlight ? 0.5 : 1,
                    cursor: isInFlight ? "not-allowed" : "text",
                  }}
                />
                <span style={styles.sliderLabel}>bps</span>
              </div>
            </div>
            <div style={styles.formCardFootnote}>
              Slices breaching this threshold will be deferred and
              retried — never silently filled at a worse price.
            </div>
          </FormCard>

          {/* Quote comparison (state machine currentQuote'undan) */}
          {(state.currentQuote || state.status === ExecutionStatus.SLICE_WITHDRAWING ||
            state.status === ExecutionStatus.SLICE_EXECUTING) && (
            <div style={styles.section}>
              <QuoteComparison
                quote={state.currentQuote}
                isLoading={
                  !state.currentQuote &&
                  (state.status === ExecutionStatus.SLICE_WITHDRAWING ||
                    state.status === ExecutionStatus.SLICE_EXECUTING)
                }
                error={null}
              />
            </div>
          )}

          {/* Step Indicator (Item 7) */}
          <div style={styles.section}>
            <StepIndicator currentStep={deriveStep(state.status)} />
          </div>

          {/* Live Kamino yield ticker — only renders while an execution
              is actually mid-flight, has a vault, and we know the
              principal in USD. Estimates live accrual via APY × time
              since start. Pure read-side — does not affect the state
              machine; the canonical totalYieldEarned still lands at
              completion via the depositor effect. */}
          {isInFlight && optimalVault && state.startedAt && amountUsd > 0 && (
            <div style={styles.section}>
              <LiveYieldTicker
                principalUsd={amountUsd}
                apyPct={optimalVault.supplyAPY}
                startedAt={state.startedAt}
                vaultName={optimalVault.symbol}
              />
            </div>
          )}

          {/* Timeline (her durumda ama bos slices ile idle gosterir) */}
          {state.slices.length > 0 && (
            <div style={styles.section}>
              <ExecutionTimeline
                state={state}
                onRetry={retry}
                onReset={reset}
              />
            </div>
          )}

          <div style={styles.flexSpacer} />

          {/* Autopilot (durable-nonce pre-sign) toggle — headline UX
              feature. Sits right above the tx preview so the user sees
              the popup-count impact in real time. */}
          {canConfigure && (
            <label style={styles.autopilotRow}>
              <input
                type="checkbox"
                checked={preSignEnabled}
                onChange={(e) => setPreSignEnabled(e.target.checked)}
                style={styles.autopilotCheckbox}
                aria-label="Toggle autopilot mode"
              />
              <span style={styles.autopilotCopy}>
                <span style={styles.autopilotTitle}>
                  🤖 Autopilot mode
                </span>
                <span style={styles.autopilotSub}>
                  Sign the whole Kamino plan upfront in one Solflare popup.
                  Only swap popups open at slice time — no more screen
                  babysitting.
                </span>
              </span>
            </label>
          )}

          {/* Level 2: notification permission prompt, shown only when
              Autopilot is on so the user understands why they'd want
              the permission. */}
          <NotificationBanner visible={canConfigure && preSignEnabled} />

          {/* Transaction count preview — CLAUDE.md BLOK 6 Pre-approval UX.
              Popup count diverges between autopilot vs. JIT modes. */}
          {canConfigure && sliceCount > 0 && (() => {
            const est = estimatePopups(sliceCount, preSignEnabled);
            return (
              <div style={styles.txPreview}>
                {preSignEnabled ? (
                  <>
                    You&apos;ll sign{" "}
                    <span style={styles.txPreviewValue}>
                      {est.upfrontPopups} popups upfront
                    </span>{" "}
                    (nonce setup + full plan), then{" "}
                    <span style={styles.txPreviewValue}>
                      {est.jitSwapPopups} JIT swap popups
                    </span>{" "}
                    as slices fire, and{" "}
                    <span style={styles.txPreviewValue}>1 cleanup popup</span>{" "}
                    at the end — <strong>{est.total} total</strong>. Kamino
                    deposit + withdraws run hands-off in between.
                  </>
                ) : (
                  <>
                    You&apos;ll sign{" "}
                    <span style={styles.txPreviewValue}>
                      {est.total} transactions
                    </span>{" "}
                    total (1 deposit + {sliceCount} batched slices + 1 final
                    withdraw) — each one requires you to be at the screen
                    when its time comes.
                  </>
                )}
              </div>
            );
          })()}

          {/* Start button */}
          <div style={styles.footer}>
            <Button
              variant="primary"
              onClick={handleConfigureAndStart}
              disabled={!canConfigure}
              style={{
                width: "100%",
                padding: "14px 28px",
                minHeight: isMobile ? 56 : undefined,
              }}
            >
              START EXECUTION
            </Button>
            {(() => {
              const reason = disabledReason({
                walletConnected: wallet.connected,
                fromMint,
                toMint,
                amountNum,
                amountExceedsBalance,
                sliceCount,
                slippageBps,
                optimalVault,
                isIdleOrConfigured,
                otherTabsInFlight,
              });
              if (reason) {
                return (
                  <div style={styles.disabledHint} role="status">
                    <span style={styles.disabledHintIcon} aria-hidden="true">!</span>
                    <span>{reason}</span>
                  </div>
                );
              }
              if (!isMobile) {
                return (
                  <div style={styles.shortcutHint}>
                    {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to start
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LiveYieldTicker — live Kamino accrual estimate during an execution.
//
// Why it exists: the state machine only writes `totalYieldEarned` at
// completion. During the long minutes/hours a TWAP execution runs, the
// user sees a flat "$0.00" until the very end, which under-sells the
// "earn while you trade" pitch.
//
// We compute a client-side estimate: principal × (apy/100) × (elapsedSec /
// SECONDS_PER_YEAR). Updates every 1s via setInterval, AnimatedNumber
// smooths the visual transition. This is read-only; the canonical
// totalYieldEarned (post-Kamino-withdraw) wins at completion. We label
// the chip "live estimate" so the user understands it's not bank-truth.
// ---------------------------------------------------------------------------

const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

const LiveYieldTicker: FC<{
  principalUsd: number;
  apyPct: number;
  startedAt: Date;
  vaultName: string;
}> = ({ principalUsd, apyPct, startedAt, vaultName }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, (now - startedAt.getTime()) / 1000);
  const estimated = principalUsd * (apyPct / 100) * (elapsedSec / SECONDS_PER_YEAR);

  return (
    <div style={styles.yieldTicker} role="status" aria-live="polite">
      <span style={styles.yieldTickerDot} aria-hidden="true" />
      <span style={styles.yieldTickerLabel}>
        Kamino accruing in {vaultName} vault
      </span>
      <span style={styles.yieldTickerValue}>
        +
        <AnimatedNumber
          value={estimated}
          prefix="$"
          decimals={estimated < 1 ? 6 : 4}
          duration={900}
        />
      </span>
      <span style={styles.yieldTickerHint}>
        @ {apyPct.toFixed(2)}% · live estimate
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SmartToChips — quick-pick targets for the "To" leg of the pair.
//
// Heuristic ranking:
//   1. Stables (USDC, USDT) bubble up if From is volatile (SOL/BONK)
//   2. SOL bubbles up if From is a stable
//   3. Otherwise: just whatever the user holds, sorted by USD balance
// We render the top 3, dedup'd against fromMint.
//
// One-tap UX: clicking a chip sets toMint and the user moves directly
// to the amount input. They can still open the full dropdown for niche
// targets — these are shortcuts, not a replacement.
// ---------------------------------------------------------------------------

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDS", "PYUSD"]);

const SmartToChips: FC<{
  fromMint: string;
  tokens: AvailableToken[];
  onPick: (mint: string) => void;
  lookup: (mint: string) => TokenInfo | null;
}> = ({ fromMint, tokens, onPick, lookup }) => {
  const fromToken = tokens.find((t) => t.mint === fromMint);
  const fromIsStable = fromToken
    ? STABLE_SYMBOLS.has(fromToken.symbol.toUpperCase())
    : false;

  const candidates = tokens.filter((t) => t.mint !== fromMint);
  const sorted = [...candidates].sort((a, b) => {
    const aStable = STABLE_SYMBOLS.has(a.symbol.toUpperCase()) ? 1 : 0;
    const bStable = STABLE_SYMBOLS.has(b.symbol.toUpperCase()) ? 1 : 0;
    // If From is volatile, stables bubble up. If From is stable, SOL
    // (and other non-stables) bubble up.
    if (fromIsStable) {
      if (aStable !== bStable) return aStable - bStable; // non-stable first
    } else {
      if (aStable !== bStable) return bStable - aStable; // stable first
    }
    // Tie-breaker: larger balance first.
    return b.balance - a.balance;
  });
  const top = sorted.slice(0, 3);

  if (top.length === 0) return null;

  return (
    <div style={styles.smartChipsRow} aria-label="Quick pick targets">
      <span style={styles.smartChipsLabel}>Quick pick →</span>
      {top.map((t) => {
        const info = lookup(t.mint);
        const url = info?.logoURI ?? null;
        return (
          <button
            key={t.mint}
            type="button"
            onClick={() => onPick(t.mint)}
            style={styles.smartChip}
            title={`Set To = ${t.symbol}`}
          >
            {url ? (
              <img
                src={url}
                alt=""
                width={16}
                height={16}
                style={{ borderRadius: "50%" }}
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--color-5)",
                  display: "inline-block",
                }}
              />
            )}
            <span>{t.symbol}</span>
          </button>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// FormCard — grouped step card used by the new fluid form flow.
//
// Replaces the flat sequence of <div style={styles.section}> blocks with
// three numbered cards (Trade · Schedule · Guardrails). Each card carries
// its own header (step number, title, subtitle) so the user gets clear
// "I'm on step 1 of 3" feedback without us having to add a dedicated
// stepper bar.
//
// The numbered prefix is rendered as a small monospace pill so it reads
// as a chapter mark, not a body number — it sits next to the title at
// the same baseline.
// ---------------------------------------------------------------------------

const FormCard: FC<{
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ step, title, subtitle, children }) => (
  // `liminal-lift` adds the desktop-only hover lift + soft shadow.
  // `liminal-form-card-glass` applies the dark-theme background
  // override (inline styles can't see the [data-theme="dark"] selector,
  // so we delegate via a class).
  <section
    style={styles.formCard}
    className="liminal-lift liminal-form-card-glass"
  >
    <header style={styles.formCardHeader}>
      <span style={styles.formCardStep}>{String(step).padStart(2, "0")}</span>
      <span style={styles.formCardTitle}>{title}</span>
      {subtitle && <span style={styles.formCardSubtitle}>{subtitle}</span>}
    </header>
    <div style={styles.formCardBody}>{children}</div>
  </section>
);

// ---------------------------------------------------------------------------
// TokenSelect — custom dropdown picker
//
// Replaced the native <select> in PR #5a. The native control could only
// render plain symbol text per option; the new picker shows for each row
//   - the official token logo (from tokenRegistry's logoURI), with a
//     coloured-circle fallback for tokens without metadata
//   - symbol + name (muted)
//   - live USD price (from Pyth via usePriceMonitor)
//   - balance × price = USD value of the user's holdings
//
// Behaviour:
//   - Click trigger to open, click outside or press Escape to close
//   - Click a row to select; the trigger collapses to logo + symbol +
//     a short balance hint
//   - When `disabled`, trigger is non-interactive and renders the lock
//     tooltip on hover
//   - Empty `value` shows a neutral "Select token" placeholder
// ---------------------------------------------------------------------------

// VerifiedMark — small ✓ pill for tokens flagged verified by the
// Jupiter v2 search (or our hardcoded canonical allowlist), or ⚠ for
// unverified. Helps the user spot honeypot / scam tokens before
// committing to a swap. Tooltip explains the source so the user knows
// "verified" isn't an absolute audit guarantee.
const VerifiedMark: FC<{ verified: boolean }> = ({ verified }) => (
  <span
    title={
      verified
        ? "Verified — recognized by Jupiter's strict list or LIMINAL canonical allowlist"
        : "Unverified — exercise caution; this mint isn't in any well-known verified list"
    }
    aria-label={verified ? "Verified token" : "Unverified token"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      marginLeft: 6,
      padding: "1px 5px",
      borderRadius: 4,
      fontFamily: "var(--font-mono)",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: verified ? "var(--color-success)" : "var(--color-warn)",
      background: verified
        ? "rgba(34, 197, 94, 0.12)"
        : "rgba(245, 158, 11, 0.12)",
      border: `1px solid ${verified ? "rgba(34, 197, 94, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
      verticalAlign: "middle",
    }}
  >
    {verified ? "✓" : "⚠"}
  </span>
);

const TokenLogo: FC<{
  mint: string;
  symbol: string;
  info: TokenInfo | null;
  size?: number;
}> = ({ mint, symbol, info, size = 22 }) => {
  const [errored, setErrored] = useState(false);
  const url = info?.logoURI ?? null;
  if (url && !errored) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          background: "var(--color-2)",
        }}
        aria-hidden="true"
      />
    );
  }
  // Fallback: solid coloured circle with first letter of symbol.
  const bg = getTokenColor(symbol);
  const letter = (symbol || mint).slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: MONO,
        fontSize: Math.max(10, Math.floor(size * 0.5)),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
};

function formatBalance(n: number): string {
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (n < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const TokenSelect: FC<{
  label: string;
  value: string;
  tokens: AvailableToken[];
  onChange: (mint: string) => void;
  disabled?: boolean;
  lockedTooltip?: string;
  prices: Record<string, number>;
  lookup: (mint: string) => TokenInfo | null;
}> = ({
  label,
  value,
  tokens,
  onChange,
  disabled,
  lockedTooltip,
  prices,
  lookup,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedToken = tokens.find((t) => t.mint === value);
  const selectedInfo = selectedToken ? lookup(selectedToken.mint) : null;
  const selectedPrice = selectedToken ? prices[selectedToken.mint] : undefined;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={styles.selectWrap} ref={rootRef}>
      <span style={styles.selectLabel}>{label}</span>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label} token: ${selectedToken?.symbol ?? "none selected"}`}
          title={disabled ? lockedTooltip : undefined}
          onClick={() => !disabled && setOpen((v) => !v)}
          style={{
            ...styles.tokenTrigger,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
            borderColor: open ? "var(--color-accent-border)" : THEME.border,
          }}
        >
          {selectedToken ? (
            <>
              <TokenLogo
                mint={selectedToken.mint}
                symbol={selectedToken.symbol}
                info={selectedInfo}
                size={22}
              />
              <span style={styles.tokenTriggerSymbol}>
                {selectedToken.symbol}
                {selectedInfo && <VerifiedMark verified={selectedInfo.verified} />}
              </span>
              {selectedPrice != null && (
                <span style={styles.tokenTriggerPrice}>
                  {formatUSD(selectedPrice)}
                </span>
              )}
            </>
          ) : (
            <span style={styles.tokenTriggerPlaceholder}>Select token</span>
          )}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            style={{
              marginLeft: "auto",
              transition: "transform var(--motion-base) var(--ease-out)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          >
            <path
              d="M3 5l3 3 3-3"
              fill="none"
              stroke="var(--color-text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open && (
          <ul
            role="listbox"
            aria-label={`${label} token list`}
            style={styles.tokenMenu}
          >
            {tokens.length === 0 ? (
              <li style={styles.tokenMenuEmpty}>No tokens available</li>
            ) : (
              tokens.map((t) => {
                const info = lookup(t.mint);
                const price = prices[t.mint];
                const total = price != null ? price * t.balance : null;
                const selected = t.mint === value;
                return (
                  <li
                    key={t.mint}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(t.mint);
                      setOpen(false);
                    }}
                    style={{
                      ...styles.tokenMenuRow,
                      background: selected
                        ? "var(--color-accent-bg-soft)"
                        : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLLIElement).style.background =
                          "var(--surface-raised)";
                    }}
                    onMouseLeave={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLLIElement).style.background =
                          "transparent";
                    }}
                  >
                    <TokenLogo
                      mint={t.mint}
                      symbol={t.symbol}
                      info={info}
                      size={28}
                    />
                    <div style={styles.tokenMenuMain}>
                      <div style={styles.tokenMenuSymbol}>
                        {t.symbol}
                        {info && <VerifiedMark verified={info.verified} />}
                      </div>
                      <div style={styles.tokenMenuName}>
                        {info?.name ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`}
                      </div>
                    </div>
                    <div style={styles.tokenMenuRight}>
                      <div style={styles.tokenMenuPrice}>
                        {price != null ? formatUSD(price) : "—"}
                      </div>
                      <div style={styles.tokenMenuBalance}>
                        {formatBalance(t.balance)}
                        {total != null && total > 0 && (
                          <span style={styles.tokenMenuTotal}>
                            {" "}
                            · {formatUSD(total)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

const PriceDisplay: FC<{
  mints: string[];
  tokens: AvailableToken[];
  prices: { [mint: string]: number };
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  now: Date;
}> = ({ mints, tokens, prices, isLoading, error, lastUpdated, now }) => {
  // Track last 30 price points per mint for sparkline (Item 14)
  const historyRef = useRef<Record<string, number[]>>({});
  useEffect(() => {
    for (const mint of mints) {
      const price = prices[mint];
      if (price == null) continue;
      if (!historyRef.current[mint]) historyRef.current[mint] = [];
      const arr = historyRef.current[mint];
      if (arr.length === 0 || arr[arr.length - 1] !== price) {
        arr.push(price);
        if (arr.length > 30) arr.shift();
      }
    }
  }, [mints, prices]);

  if (mints.length === 0) {
    return (
      <div style={styles.hintText}>
        Select a token above to track its price.
      </div>
    );
  }
  if (error) {
    return (
      <div style={styles.warningBlock}>
        <div style={styles.warningText}>
          Price data unavailable, checking Pyth connection...
        </div>
      </div>
    );
  }
  if (isLoading && lastUpdated === null) {
    return (
      <div style={styles.priceList} aria-busy="true" aria-label="Loading prices">
        {mints.map((m) => (
          <SkeletonBox key={m} width="100%" height={28} />
        ))}
      </div>
    );
  }
  return (
    <div style={styles.priceList} aria-live="polite" aria-atomic="false">
      {mints.map((mint) => {
        const token = tokens.find((t) => t.mint === mint);
        const symbol = token?.symbol ?? mint.slice(0, 4);
        const price = prices[mint];
        const sparkData = historyRef.current[mint] ?? [];
        const noFeed = price == null && lastUpdated !== null;
        return (
          <div key={mint} style={styles.priceRow}>
            <span style={styles.priceText}>
              1 {symbol} ={" "}
              {noFeed ? (
                <span
                  style={{
                    color: THEME.textMuted,
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                  title="No Pyth price feed available for this token"
                >
                  no feed
                </span>
              ) : (
                <span style={styles.priceValue}>
                  {price != null ? formatUSD(price) : "…"}
                </span>
              )}
            </span>
            {sparkData.length >= 2 && (
              <Sparkline data={sparkData} width={60} height={20} />
            )}
          </div>
        );
      })}
      {lastUpdated && (
        <div style={styles.timestamp}>
          Last updated: {secondsSince(lastUpdated, now)}s ago
        </div>
      )}
    </div>
  );
};

const SkeletonBox: FC<{ width: string | number; height: number }> = ({
  width,
  height,
}) => (
  <div
    aria-hidden="true"
    style={{
      width,
      height,
      borderRadius: 4,
      background: `linear-gradient(90deg, ${THEME.panelElevated} 0%, var(--color-3) 50%, ${THEME.panelElevated} 100%)`,
      backgroundSize: "200% 100%",
      animation: "liminal-shimmer 1.4s ease-in-out infinite",
    }}
  />
);

// ---------------------------------------------------------------------------
// Step derivation helper (Item 7)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// disabledReason — surface the single most actionable blocker to the user
// instead of silently greying out START EXECUTION. Ordered from user-fixable
// (wallet, token, amount) to system-level (vault, state).
// ---------------------------------------------------------------------------

type DisabledInput = {
  walletConnected: boolean;
  fromMint: string;
  toMint: string;
  amountNum: number;
  amountExceedsBalance: boolean;
  sliceCount: number;
  slippageBps: number;
  optimalVault: KaminoVault | null;
  isIdleOrConfigured: boolean;
  otherTabsInFlight: boolean;
};

function disabledReason(i: DisabledInput): string | null {
  if (!i.walletConnected) return "Connect your Solflare wallet to start.";
  if (!i.fromMint) return "Select a token to swap from.";
  if (!i.toMint) return "Select a token to swap to.";
  if (i.amountNum <= 0) return "Enter an amount greater than 0.";
  if (i.amountExceedsBalance) return "Amount exceeds your balance.";
  if (i.sliceCount < 1) return "Slice count must be at least 1.";
  if (i.slippageBps < MIN_SLIPPAGE_BPS)
    return `Slippage must be at least ${MIN_SLIPPAGE_BPS / 100}%.`;
  if (i.slippageBps > MAX_SLIPPAGE_BPS)
    return `Slippage can't exceed ${MAX_SLIPPAGE_BPS / 100}%.`;
  if (!i.optimalVault)
    return "No active Kamino vault found for this token — idle capital can't be parked.";
  if (i.otherTabsInFlight)
    return "Another LIMINAL tab is mid-execution. Switch tabs to manage that one first.";
  if (!i.isIdleOrConfigured) return "An execution is already in progress.";
  return null;
}

// Map state → currentStep index. IDLE/CONFIGURED return -1 so no step is
// highlighted (all circles appear pending grey). Execution starts at step 0
// once DEPOSITING fires.
function deriveStep(status: ExecutionStatus): number {
  switch (status) {
    case ExecutionStatus.IDLE:
    case ExecutionStatus.CONFIGURED:
      return -1; // no step active pre-start
    // BUG FIX (TT): PREPARING was missing → fell through to default
    // (-1) so the StepIndicator showed nothing during autopilot plan
    // signing. From the user's perspective, PREPARING is the front
    // half of the deposit phase (we're setting up nonce accounts and
    // signing all txs that include the deposit), so it maps to the
    // same first step as DEPOSITING. The visual now lights up the
    // moment they hit START.
    case ExecutionStatus.PREPARING:
    case ExecutionStatus.DEPOSITING:
      return 0;
    case ExecutionStatus.ACTIVE:
      return 1;
    case ExecutionStatus.SLICE_WITHDRAWING:
    case ExecutionStatus.SLICE_EXECUTING:
      return 2;
    case ExecutionStatus.COMPLETING:
      return 4;
    case ExecutionStatus.DONE:
      return 5; // all complete
    case ExecutionStatus.ERROR:
      return 2;
    default:
      return -1;
  }
}

// ---------------------------------------------------------------------------
// Welcome feature icons and component (Item 4)
// ---------------------------------------------------------------------------

const TwapIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="12" width="3" height="6" rx="1" fill="var(--color-5)" />
    <rect x="7" y="8" width="3" height="10" rx="1" fill="var(--color-4)" />
    <rect x="12" y="4" width="3" height="14" rx="1" fill="var(--color-3)" />
    <rect x="17" y="2" width="1" height="16" rx="0.5" fill="var(--color-stroke)" />
  </svg>
);

const YieldIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" stroke="var(--color-5)" strokeWidth="1.5" />
    <path d="M10 5v5l3 3" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ShieldIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2L3 6v5c0 4 3.5 6.5 7 8 3.5-1.5 7-4 7-8V6L10 2z" stroke="var(--color-5)" strokeWidth="1.5" fill="none" />
    <path d="M7.5 10L9.5 12L13 8" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChartIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <polyline points="2,16 6,10 10,13 14,6 18,4" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="18" cy="4" r="1.5" fill="var(--color-5)" />
  </svg>
);

const WelcomeFeature: FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
}> = ({ icon, title, desc }) => (
  <div style={styles.welcomeFeature}>
    <div style={styles.welcomeFeatureIcon}>{icon}</div>
    <div style={styles.welcomeFeatureText}>
      <div style={styles.welcomeFeatureTitle}>{title}</div>
      <div style={styles.welcomeFeatureDesc}>{desc}</div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: 600,
    // Frosted glass — see WalletPanel for rationale.
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
    fontSize: 15,
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
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 24px",
  },
  emptyHint: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.textMuted,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 1.6,
  },
  section: {
    padding: "12px 16px",
  },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    letterSpacing: 0,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "none",
  },
  sectionHint: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: 0,
    fontWeight: 400,
    textTransform: "none",
    opacity: 0.75,
  },
  // ----- Grouped form cards (PR #5b form-flow refactor) -----------------
  formCard: {
    margin: "10px 16px",
    padding: "16px 18px",
    // Fully transparent surface — only the border + chapter pill +
    // content sits between the user and the panel's frosted glass +
    // the Unicorn Studio scene behind it. We keep a tiny backdrop
    // blur so any text directly under the card body still stays
    // legible, but no coloured wash. Border carries the visual
    // structure of the card on its own.
    background: "transparent",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    border: `1px solid var(--color-stroke)`,
    borderRadius: 12,
    boxShadow: "var(--shadow-component-soft, none)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  formCardHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
    paddingBottom: 4,
  },
  formCardStep: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-5-strong, var(--color-5))",
    letterSpacing: 0,
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    padding: "2px 7px",
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  formCardTitle: {
    fontFamily: SANS,
    fontSize: 18,
    fontWeight: 700,
    color: THEME.text,
    letterSpacing: 0,
  },
  formCardSubtitle: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
    marginLeft: "auto",
  },
  formCardBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  formCardSubLabel: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    color: THEME.textMuted,
    letterSpacing: 0,
    marginTop: 2,
  },
  formCardFootnote: {
    marginTop: 4,
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  // Live Kamino yield ticker — gentle "money is moving" chip rendered
  // above the timeline during in-flight execution. Pulsing dot anchors
  // attention; AnimatedNumber inside ticks smoothly.
  yieldTicker: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    padding: "10px 14px",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: 999,
    fontFamily: MONO,
    fontSize: 15,
  },
  yieldTickerDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--color-success)",
    boxShadow: "0 0 0 4px rgba(34, 197, 94, 0.18), 0 0 10px var(--color-success)",
    animation: "liminal-active-pulse 1.6s var(--ease-out) infinite",
    flexShrink: 0,
  },
  yieldTickerLabel: {
    color: THEME.text,
    fontWeight: 600,
    flexShrink: 0,
  },
  yieldTickerValue: {
    color: "var(--color-success)",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  yieldTickerHint: {
    color: THEME.textMuted,
    fontSize: 13,
    marginLeft: "auto",
  },
  // Smart-pick chip row — appears under the token pair when From is
  // set but To is empty. Tight spacing so it reads as a hint, not a
  // separate config step.
  smartChipsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: -4,
  },
  smartChipsLabel: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: 0,
  },
  smartChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-accent-border)",
    background: "var(--color-accent-bg-soft)",
    color: THEME.text,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition:
      "background var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out)",
  },
  // Info card — silent intelligence the user verifies but doesn't
  // configure (auto-selected Kamino vault, route stats, etc.). Visually
  // softer than a numbered FormCard so it reads as supporting info.
  infoCard: {
    margin: "0 16px",
    padding: "12px 14px",
    background: "var(--color-accent-bg-soft)",
    border: "1px dashed var(--color-accent-border)",
    borderRadius: 10,
  },
  multiTabBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    margin: "0 16px 10px",
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--color-warn-bg, rgba(255, 200, 80, 0.18))",
    border: `1px solid ${THEME.amber}`,
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.text,
    lineHeight: 1.5,
  },
  multiTabIcon: {
    fontSize: 20,
    flexShrink: 0,
    lineHeight: 1,
  },
  divider: {
    height: 1,
    background: THEME.border,
    margin: "4px 16px",
  },
  row: {
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
  },
  selectWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  selectLabel: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  select: {
    fontFamily: MONO,
    fontSize: 18,
    color: THEME.text,
    background: "var(--surface-input)",
    boxShadow: "inset 0 1px 2px rgba(26, 26, 26, 0.06)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-sm)",
    padding: "10px 32px 10px 12px",
    width: "100%",
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
  },
  // ---- Custom token picker (replaces native <select> for token rows) ----
  tokenTrigger: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    minHeight: 44,
    padding: "8px 12px",
    background: "var(--surface-input)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-sm)",
    boxShadow: "inset 0 1px 2px rgba(26, 26, 26, 0.06)",
    fontFamily: MONO,
    fontSize: 18,
    color: THEME.text,
    textAlign: "left",
    transition: "border-color var(--motion-base) var(--ease-out)",
  },
  tokenTriggerSymbol: {
    fontWeight: 700,
    letterSpacing: 0,
  },
  tokenTriggerPrice: {
    color: THEME.textMuted,
    fontSize: 15,
    fontVariantNumeric: "tabular-nums",
  },
  tokenTriggerPlaceholder: {
    color: THEME.textMuted,
    fontFamily: SANS,
  },
  tokenMenu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    margin: 0,
    padding: 4,
    listStyle: "none",
    background: "var(--surface-raised)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-sm)",
    boxShadow: "var(--shadow-component)",
    maxHeight: 320,
    overflowY: "auto",
    zIndex: 60,
  },
  tokenMenuRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background var(--motion-base) var(--ease-out)",
  },
  tokenMenuMain: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  tokenMenuSymbol: {
    fontFamily: MONO,
    fontWeight: 700,
    fontSize: 16,
    color: THEME.text,
    letterSpacing: 0,
  },
  tokenMenuName: {
    fontFamily: SANS,
    fontSize: 14,
    color: THEME.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tokenMenuRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    flexShrink: 0,
  },
  tokenMenuPrice: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  tokenMenuBalance: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  tokenMenuTotal: {
    color: "var(--color-success)",
  },
  tokenMenuEmpty: {
    padding: "12px",
    color: THEME.textMuted,
    fontFamily: SANS,
    fontSize: 15,
    textAlign: "center",
  },
  swapButton: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid var(--color-stroke)",
    background: "var(--surface-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginBottom: 2,
    transition: "background 150ms ease",
  },
  numericInput: {
    fontFamily: MONO,
    fontSize: 19,
    color: THEME.text,
    background: "var(--surface-input)",
    boxShadow: "inset 0 1px 2px rgba(26, 26, 26, 0.06)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    width: "100%",
    outline: "none",
    fontVariantNumeric: "tabular-nums",
  },
  amountInputWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  maxButton: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 0,
    textTransform: "none",
    color: "var(--color-5)",
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: "var(--radius-sm)",
    padding: "4px 8px",
    cursor: "pointer",
    lineHeight: 1,
    transition: "background var(--motion-base) var(--ease-out)",
  },
  amountHint: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    marginTop: 6,
    fontVariantNumeric: "tabular-nums",
  },
  amountError: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.danger,
    marginTop: 6,
  },
  priceList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  priceRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
    gap: 8,
  },
  priceText: {
    fontFamily: MONO,
    fontSize: 19,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  priceValue: {
    color: THEME.accent,
    fontWeight: 600,
  },
  timestamp: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
    marginTop: 4,
  },
  hintText: {
    fontFamily: MONO,
    fontSize: 16,
    color: THEME.textMuted,
    lineHeight: 1.6,
  },
  warningBlock: {
    padding: "12px 14px",
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 6,
  },
  warningText: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.amber,
    lineHeight: 1.5,
  },
  errorBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    background: "var(--color-warn-bg)",
    border: `1px solid var(--color-warn-border)`,
    borderRadius: 6,
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.danger,
    lineHeight: 1.5,
  },
  errorDetail: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  windowRow: {
    display: "flex",
    gap: 8,
  },
  chip: {
    fontFamily: MONO,
    fontSize: 16,
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    letterSpacing: 0,
    transition: "all 150ms ease",
  },
  slippageRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  slider: {
    flex: 1,
  },
  sliderLabel: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    letterSpacing: 0,
  },
  flexSpacer: {
    flex: 1,
  },
  txPreview: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.textMuted,
    textAlign: "center",
    padding: "10px 16px 0",
    lineHeight: 1.6,
  },
  txPreviewValue: {
    color: THEME.accent,
    fontWeight: 700,
  },
  autopilotRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "10px 16px 0",
    cursor: "pointer",
    userSelect: "none",
  },
  autopilotCheckbox: {
    width: 18,
    height: 18,
    accentColor: THEME.accent,
    marginTop: 2,
    flexShrink: 0,
    cursor: "pointer",
  },
  autopilotCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  autopilotTitle: {
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 700,
    color: THEME.text,
    letterSpacing: 0,
  },
  autopilotSub: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  footer: {
    padding: "12px 16px",
    borderTop: `1px solid ${THEME.border}`,
  },
  shortcutHint: {
    fontFamily: MONO,
    fontSize: 14,
    color: "var(--color-text-muted)",
    textAlign: "center",
    marginTop: 6,
    letterSpacing: 0,
  },
  disabledHint: {
    marginTop: 10,
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-warn-bg)",
    border: "1px solid var(--color-warn-border)",
    color: "var(--color-warn)",
    fontSize: 14,
    lineHeight: 1.45,
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  disabledHintIcon: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "var(--color-warn)",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
  },
  primaryButton: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 8,
    padding: "14px 28px",
    width: "100%",
    letterSpacing: 0,
  },
  recoveryBanner: {
    margin: "12px 16px 0",
    padding: "12px 14px",
    background: "var(--color-accent-bg-soft)",
    border: `1px solid var(--color-accent-border)`,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  recoveryTitle: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.accent,
    letterSpacing: 0,
    textTransform: "none",
    fontWeight: 700,
  },
  recoveryText: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.text,
    lineHeight: 1.5,
  },
  recoveryWarning: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.amber,
    lineHeight: 1.5,
  },
  recoveryActions: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  recoveryPrimary: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    letterSpacing: 0,
  },
  recoverySecondary: {
    fontFamily: MONO,
    fontSize: 16,
    color: THEME.textMuted,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    letterSpacing: 0,
  },

  // Welcome/Onboarding (Item 4)
  welcomeSection: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 340,
    width: "100%",
    padding: "24px 0",
  },
  welcomeTagline: {
    fontFamily: SANS,
    fontSize: 23,
    fontWeight: 700,
    color: "var(--color-text)",
    textAlign: "center",
    letterSpacing: 0,
  },
  welcomeFeatures: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  // Welcome teaser stack — sits below the hero stats on desktop so
  // first-time visitors see a fan-out preview of what their history
  // will look like. Padding-top creates breathing room; min-height
  // covers the absolute-positioned cards.
  welcomeStackWrap: {
    marginTop: 24,
    paddingTop: 16,
    borderTop: "1px dashed var(--color-stroke)",
  },
  // Hero stats strip — 3-cell grid of terse "vital signs" beneath the
  // connect CTA. Each cell has a big number, a 1-word label, and a
  // tooltip-style hint underneath.
  heroStats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    margin: "20px 0 0",
    padding: "14px 12px",
    listStyle: "none",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
  },
  heroStatCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    textAlign: "center",
    minWidth: 0,
  },
  heroStatValue: {
    fontFamily: SANS,
    fontSize: 24,
    fontWeight: 800,
    color: "var(--color-5-strong)",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  heroStatLabel: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    color: THEME.textMuted,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    marginTop: 4,
  },
  heroStatHint: {
    fontFamily: SANS,
    fontSize: 12,
    color: "var(--color-text-subtle)",
    lineHeight: 1.4,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  welcomeFeature: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "8px 12px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: "var(--radius-md)",
  },
  welcomeFeatureIcon: {
    flexShrink: 0,
    width: 20,
    height: 20,
    marginTop: 2,
  },
  welcomeFeatureText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  welcomeFeatureTitle: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 700,
    color: "var(--color-text)",
    letterSpacing: 0,
  },
  welcomeFeatureDesc: {
    fontFamily: MONO,
    fontSize: 15,
    color: "var(--color-text-muted)",
    lineHeight: 1.4,
  },
};

export default ExecutionPanel;
