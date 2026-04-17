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
import { DFlowLogo, LiminalMark } from "./BrandLogos";
import { ExecutionStatus } from "../state/executionMachine";
import VaultPreview from "./VaultPreview";
import QuoteComparison from "./QuoteComparison";
import ExecutionTimeline from "./ExecutionTimeline";
import ExecutionSummaryCard from "./ExecutionSummaryCard";
import StepIndicator from "./StepIndicator";
import Sparkline from "./Sparkline";
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

  const isIdleOrConfigured =
    state.status === ExecutionStatus.IDLE ||
    state.status === ExecutionStatus.CONFIGURED;
  const isInFlight =
    state.status === ExecutionStatus.DEPOSITING ||
    state.status === ExecutionStatus.ACTIVE ||
    state.status === ExecutionStatus.SLICE_WITHDRAWING ||
    state.status === ExecutionStatus.SLICE_EXECUTING ||
    state.status === ExecutionStatus.COMPLETING;

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
      <header style={styles.header}>EXECUTE</header>

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
          <div style={styles.recoveryActions}>
            <button
              type="button"
              onClick={resumeRecovery}
              disabled={!pendingRecovery.canResume}
              style={{
                ...styles.recoveryPrimary,
                opacity: pendingRecovery.canResume ? 1 : 0.4,
                cursor: pendingRecovery.canResume ? "pointer" : "not-allowed",
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
        <div style={styles.emptyBody}>
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
                icon={<YieldIcon />}
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
              onClick={() => void connectWallet()}
              style={{ width: "100%", marginTop: 8, padding: "14px 28px" }}
            >
              CONNECT SOLFLARE
            </Button>
          </div>
        </div>
      ) : state.status === ExecutionStatus.DONE ? (
        <ExecutionSummaryCard state={state} onReset={reset} />
      ) : (
        <>
          {/* Token pair */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>TOKEN PAIR</div>
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
                  onChange={(e) => !isInFlight && setFromMint(e.target.value)}
                  disabled={isInFlight}
                  lockedTooltip={lockedTooltip}
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
                    {/* Horizontal swap arrows — left/right exchange */}
                    <path d="M3 6h10M10 3l3 3-3 3" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13 10H3M6 13l-3-3 3-3" stroke="var(--color-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <TokenSelect
                  label="To"
                  value={toMint}
                  tokens={tokens.filter((t) => t.mint !== fromMint)}
                  onChange={(e) => !isInFlight && setToMint(e.target.value)}
                  disabled={isInFlight || !fromMint}
                  lockedTooltip={lockedTooltip}
                />
              </div>
            )}
          </div>

          {/* Canlı fiyat */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>LIVE PRICE (PYTH)</div>
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

          {/* Vault preview (otomatik seçilmiş Kamino vault) */}
          {fromMint && (
            <div style={styles.section}>
              <VaultPreview
                vault={optimalVault}
                isLoading={vaultLoading}
                amountUsd={amountUsd}
                windowDurationSeconds={windowMs / 1000}
              />
            </div>
          )}

          <div style={styles.divider} />

          {/* Miktar */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>AMOUNT</div>
            <div style={styles.amountInputWrap}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => {
                  if (isInFlight) return;
                  const v = e.target.value;
                  // Sadece sayı + tek nokta + max 8 decimal kabul et.
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
                  onClick={() => setAmountStr(fromBalance.toString())}
                  style={styles.maxButton}
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
                  <span style={{ marginLeft: 8 }}>≈ {formatUSD(amountUsd)}</span>
                )}
              </div>
            )}
            {amountExceedsBalance && (
              <div style={styles.amountError}>Amount exceeds balance.</div>
            )}
          </div>

          {/* Execution window */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>EXECUTION WINDOW</div>
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
          </div>

          {/* Slice count */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>SLICE COUNT</div>
            <input
              type="number"
              min={1}
              max={20}
              value={sliceCount}
              onChange={(e) => {
                if (isInFlight) return;
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 20) setSliceCount(n);
              }}
              disabled={isInFlight}
              title={isInFlight ? lockedTooltip : undefined}
              style={{
                ...styles.numericInput,
                opacity: isInFlight ? 0.5 : 1,
                cursor: isInFlight ? "not-allowed" : "text",
              }}
            />
          </div>

          {/* Slippage */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>
              SLIPPAGE THRESHOLD ({bpsToPercent(slippageBps)})
            </div>
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
          </div>

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

          {/* Transaction count preview — CLAUDE.md BLOK 6 Pre-approval UX */}
          {canConfigure && sliceCount > 0 && (
            <div style={styles.txPreview}>
              You will sign{" "}
              <span style={styles.txPreviewValue}>
                {1 + sliceCount + 1} transactions
              </span>{" "}
              total (1 deposit + {sliceCount} batched slices + 1 final
              withdraw).
            </div>
          )}

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

const TokenSelect: FC<{
  label: string;
  value: string;
  tokens: AvailableToken[];
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  lockedTooltip?: string;
}> = ({ label, value, tokens, onChange, disabled, lockedTooltip }) => {
  const selectedToken = tokens.find((t) => t.mint === value);
  return (
    <label style={styles.selectWrap}>
      <span style={styles.selectLabel}>{label}</span>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {selectedToken && (
          <span
            style={{
              position: "absolute",
              left: 12,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: getTokenColor(selectedToken.symbol),
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
        )}
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          title={disabled ? lockedTooltip : undefined}
          style={{
            ...styles.select,
            paddingLeft: selectedToken ? 28 : 12,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <option value="">-- select --</option>
          {tokens.map((t) => (
            <option key={t.mint} value={t.mint}>
              {t.symbol}
            </option>
          ))}
        </select>
      </div>
    </label>
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
                    fontSize: 12,
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
    background: "var(--color-2)",
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
    fontSize: 13,
    letterSpacing: "0.18em",
    fontWeight: 600,
    color: THEME.textMuted,
    padding: "14px 16px 12px",
    borderBottom: `1px solid ${THEME.border}`,
    textTransform: "uppercase",
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
    fontSize: 15,
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
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: "0.16em",
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "uppercase",
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
    fontSize: 12,
    color: THEME.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  select: {
    fontFamily: MONO,
    fontSize: 16,
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
    fontSize: 17,
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
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
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
    fontSize: 13,
    color: THEME.textMuted,
    marginTop: 6,
    fontVariantNumeric: "tabular-nums",
  },
  amountError: {
    fontFamily: MONO,
    fontSize: 13,
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
    fontSize: 17,
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
  },
  priceValue: {
    color: THEME.accent,
    fontWeight: 600,
  },
  timestamp: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
    marginTop: 4,
  },
  hintText: {
    fontFamily: MONO,
    fontSize: 14,
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
    fontSize: 15,
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
    fontSize: 15,
    color: THEME.danger,
    lineHeight: 1.5,
  },
  errorDetail: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  windowRow: {
    display: "flex",
    gap: 8,
  },
  chip: {
    fontFamily: MONO,
    fontSize: 14,
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    letterSpacing: 0.5,
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
    fontSize: 13,
    color: THEME.textMuted,
    letterSpacing: 0.5,
  },
  flexSpacer: {
    flex: 1,
  },
  txPreview: {
    fontFamily: MONO,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
    padding: "10px 16px 0",
    lineHeight: 1.6,
  },
  txPreviewValue: {
    color: THEME.accent,
    fontWeight: 700,
  },
  footer: {
    padding: "12px 16px",
    borderTop: `1px solid ${THEME.border}`,
  },
  shortcutHint: {
    fontFamily: MONO,
    fontSize: 12,
    color: "var(--color-text-muted)",
    textAlign: "center",
    marginTop: 6,
    letterSpacing: 0.5,
  },
  disabledHint: {
    marginTop: 10,
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-warn-bg)",
    border: "1px solid var(--color-warn-border)",
    color: "var(--color-warn)",
    fontSize: 12,
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
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
  },
  primaryButton: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 8,
    padding: "14px 28px",
    width: "100%",
    letterSpacing: 1,
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
    fontSize: 13,
    color: THEME.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
  },
  recoveryText: {
    fontFamily: MONO,
    fontSize: 15,
    color: THEME.text,
    lineHeight: 1.5,
  },
  recoveryWarning: {
    fontFamily: MONO,
    fontSize: 13,
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
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text-inverse)",
    background: THEME.accent,
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    letterSpacing: 1,
  },
  recoverySecondary: {
    fontFamily: MONO,
    fontSize: 14,
    color: THEME.textMuted,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    letterSpacing: 1,
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
    fontSize: 21,
    fontWeight: 700,
    color: "var(--color-text)",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  welcomeFeatures: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
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
    fontSize: 14,
    fontWeight: 700,
    color: "var(--color-text)",
    letterSpacing: 0.5,
  },
  welcomeFeatureDesc: {
    fontFamily: MONO,
    fontSize: 13,
    color: "var(--color-text-muted)",
    lineHeight: 1.4,
  },
};

export default ExecutionPanel;
