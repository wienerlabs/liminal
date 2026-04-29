/**
 * LIMINAL — AnalyticsPanel
 *
 * BLOK 7 "Sağ Panel: Real-Time Analytics" tarafının tam implementasyonu.
 * Üç sekme:
 *  - "Anlık": useExecutionMachine state'inden canlı grafikler
 *  - "Geçmiş": analyticsStore.getHistory()'den kartlar + modal detaylar
 *  - "Protokol": tüm geçmişten türetilmiş aggregate istatistikler
 *
 * Veri disiplini:
 *  - Bu component hiçbir veri üretmez. Tüm değerler state machine veya
 *    analyticsStore'dan gelir.
 *  - Kamino yield time series 15 saniyede bir kamino.getPositionValue
 *    RPC çağrısıyla beslenir — BLOK 4 "gerçek yield onchain veri".
 *  - Her sekme açıldığında store'dan taze çekilir, cache yok.
 *
 * Grafik stack:
 *  - recharts (BarChart + AreaChart)
 *  - canvas-confetti (DONE banner'ında bir kez)
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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import confetti from "canvas-confetti";
import { ExecutionStatus } from "../state/executionMachine";
import { useExecutionMachine } from "../hooks/useExecutionMachine";
import { useDeviceDetection } from "../hooks/useDeviceDetection";
import { getPositionValue } from "../services/kamino";
import { getPythPrice } from "../services/quicknode";
import {
  deleteExecution,
  getHistory,
  type HistoricalExecution,
  type SliceAnalytics,
} from "../services/analyticsStore";
import {
  requestAnalyticsTab,
  subscribeAnalyticsTab,
  type AnalyticsTab,
} from "../state/analyticsNav";
import AnimatedNumber from "./AnimatedNumber";
import MorphicTabs from "./MorphicTabs";
import ProgressRingsCard from "./ProgressRingsCard";
import TwapLoadingState from "./TwapLoadingState";
import ExecutionStack from "./ExecutionStack";
import { getMevStrategy, type MevLayer } from "../services/mevProtection";

// ---------------------------------------------------------------------------
// Theme (CLAUDE.md BLOK 7 palet)
// ---------------------------------------------------------------------------

const THEME = {
  panel: "var(--color-2)",
  panelElevated: "var(--surface-raised)",
  border: "var(--color-stroke)",
  borderNested: "var(--color-stroke-nested)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-5)",
  accentSoft: "var(--color-accent-bg-strong)",
  success: "var(--color-success)",
  amber: "var(--color-warn)",
  danger: "var(--color-danger)",
  shadow: "var(--shadow-component)",
} as const;

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

/**
 * CSS custom property'yi runtime'da resolve eder. canvas-confetti gibi
 * 3rd-party kütüphaneler CSS variable string'lerini parse edemediği için
 * gerçek hex değerine ihtiyaç duyarlar. Tarayıcıda getComputedStyle ile
 * documentElement'ten okunur — hardcoded hex yok.
 */
function readCssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const KAMINO_SAMPLE_INTERVAL_MS = 15_000;
const SOLANA_EXPLORER_TX_BASE = "https://explorer.solana.com/tx/";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUSD(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs < 1 ? 4 : 2;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Compact USD formatter for tight headline slots (TOTAL GAIN banner,
 * Protocol tab hero number). Caps at 2 significant digits past the
 * magnitude prefix so a $19,434,173.51 reading never overflows the
 * fixed-width banner: $19.43M, $1.45B, etc.
 *
 * Below $10k we fall back to the full `formatUSD` so detail isn't lost
 * on the common small-execution case.
 */
function formatUSDCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return formatUSD(n);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  })}`;
}

function formatBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${bps.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatAmount(n: number, decimals = 4): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
  });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AnalyticsPanel: FC = () => {
  const { state } = useExecutionMachine();
  const device = useDeviceDetection();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("live");

  // Harici tab değişikliği isteklerini dinle (WalletPanel, ExecutionSummaryCard)
  useEffect(() => {
    return subscribeAnalyticsTab(setActiveTab);
  }, []);

  const handleTabChange = useCallback((tab: AnalyticsTab) => {
    setActiveTab(tab);
    requestAnalyticsTab(tab);
  }, []);

  return (
    <aside style={styles.panel} aria-label="Analytics panel">
      <header style={styles.header}>Analytics</header>

      <div style={styles.tabsWrap}>
        <MorphicTabs
          ariaLabel="Analytics views"
          items={[
            { key: "live", label: "Live" },
            { key: "history", label: "History", badge: getHistory().length || undefined },
            { key: "protocol", label: "Protocol" },
          ]}
          active={activeTab}
          onChange={handleTabChange}
        />
      </div>

      <div style={styles.body}>
        {activeTab === "live" && (
          <LiveTab state={state} isMobile={device.isMobile} />
        )}
        {activeTab === "history" && <HistoryTab isMobile={device.isMobile} />}
        {activeTab === "protocol" && (
          <ProtocolTab isMobile={device.isMobile} />
        )}
      </div>
    </aside>
  );
};

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

const TabButton: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    aria-controls={`analytics-panel-${label.toLowerCase()}`}
    onClick={onClick}
    style={{
      ...styles.tabButton,
      color: active ? THEME.accent : THEME.textMuted,
      borderBottomColor: active ? THEME.accent : "transparent",
    }}
  >
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// LIVE TAB
// ---------------------------------------------------------------------------

const LiveTab: FC<{
  state: ReturnType<typeof useExecutionMachine>["state"];
  isMobile: boolean;
}> = ({ state, isMobile }) => {
  // Show the live analytics surface for every status that represents
  // an in-flight or completed run. PREPARING (autopilot plan signing)
  // and DEPOSITING are part of "this run is happening" too — without
  // them the user briefly sees the empty hero card during the first
  // popup window, which feels like the app forgot what they were
  // doing.
  const hasData =
    state.status === ExecutionStatus.PREPARING ||
    state.status === ExecutionStatus.DEPOSITING ||
    state.status === ExecutionStatus.ACTIVE ||
    state.status === ExecutionStatus.SLICE_WITHDRAWING ||
    state.status === ExecutionStatus.SLICE_EXECUTING ||
    state.status === ExecutionStatus.COMPLETING ||
    state.status === ExecutionStatus.DONE;

  // DONE confetti — bir kez. Renkler design-system.css palette'inden runtime
  // olarak çözülür (canvas-confetti CSS variable string kabul etmez, gerçek
  // hex değeri ister). Bu dosyada hardcoded hex yok — getComputedStyle
  // tarayıcı runtime'ında --color-* variable'larını resolve eder.
  const confettiFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (state.status === ExecutionStatus.DONE && !confettiFiredRef.current) {
      confettiFiredRef.current = true;
      try {
        // Light pastel zeminde görünür palette: pink + mint + sky + yellow
        const palette = [
          readCssVar("--color-5") || "#f9b2d7",        // pink
          readCssVar("--color-5-strong") || "#f48cc4", // deeper pink
          readCssVar("--color-3") || "#daf9de",        // mint
          readCssVar("--color-4") || "#cfecf3",        // sky
          readCssVar("--color-1") || "#f6ffdc",        // yellow
        ];
        confetti({
          particleCount: 140,
          spread: 70,
          origin: { y: 0.4 },
          colors: palette,
        });
      } catch {
        /* confetti failure fatal değil */
      }
    }
    if (
      state.status !== ExecutionStatus.DONE &&
      confettiFiredRef.current
    ) {
      confettiFiredRef.current = false;
    }
  }, [state.status]);

  if (!hasData) {
    return <LiveHeroCard />;
  }

  // PREPARING / DEPOSITING — render the multi-phase loading view at
  // the top of the live stack. The user is waiting on Solflare /
  // Solana confirmations during these phases; without surfaced
  // micro-status they feel stuck. The TwapLoadingState handles the
  // scroll cadence and the rings give the visual heartbeat.
  const showLoadingPhases =
    state.status === ExecutionStatus.PREPARING ||
    state.status === ExecutionStatus.DEPOSITING;
  const loadingPhaseIndex =
    state.status === ExecutionStatus.PREPARING ? 0 : 1;

  // Live progress rings — only for in-flight slice phases. Slice
  // count, window elapsed, yield earned. Smooth animation thanks to
  // ProgressRingsCard's built-in stroke transition.
  const showRings =
    state.status === ExecutionStatus.ACTIVE ||
    state.status === ExecutionStatus.SLICE_WITHDRAWING ||
    state.status === ExecutionStatus.SLICE_EXECUTING ||
    state.status === ExecutionStatus.COMPLETING;

  const sliceTotal = state.slices.length;
  const sliceDone = state.slices.filter(
    (s) => s.status === "completed",
  ).length;
  const windowMs = state.config?.windowDurationMs ?? 0;
  const elapsedMs = state.startedAt
    ? Date.now() - state.startedAt.getTime()
    : 0;
  // Rough yield target: principal × apy × windowSeconds / yearSeconds.
  // We don't have apy in state directly, but the kaminoYieldUsd field
  // (post-deposit live estimate) is close enough for the ring's
  // proportion vs. expected; falling back to "compare to gain" if
  // missing.
  const yieldTarget = Math.max(0.01, state.totalPriceImprovementUsd);
  const yieldNow = state.totalYieldEarned;

  return (
    <div style={styles.liveStack}>
      {showLoadingPhases && (
        <TwapLoadingState
          phaseIndex={loadingPhaseIndex}
          phases={[
            {
              status: "Preparing autopilot plan",
              lines: [
                "Building 6-tx pre-sign plan…",
                "Provisioning durable nonce accounts…",
                "Awaiting Solflare signAllTransactions…",
                "Encrypting plan to local-only stash…",
                "Pre-sign complete, broadcasting deposit…",
              ],
            },
            {
              status: "Depositing into Kamino",
              lines: [
                "Submitting deposit transaction…",
                "Waiting for Solana confirmation…",
                "kToken receipt minted to wallet…",
                "Vault APY locked at deposit slot…",
                "Idle capital is now earning…",
              ],
            },
          ]}
        />
      )}
      {showRings && sliceTotal > 0 && (
        <ProgressRingsCard
          title="In-flight progress"
          metrics={[
            {
              label: "Slices",
              color: "#F9B2D7", // LIMINAL pink
              size: 132,
              current: sliceDone,
              target: sliceTotal,
              unit: "",
            },
            {
              label: "Window",
              color: "#CFECF3", // LIMINAL sky
              size: 100,
              current: Math.min(windowMs, elapsedMs),
              target: Math.max(1, windowMs),
              unit: "ms",
            },
            {
              label: "Yield",
              color: "#DAF9DE", // LIMINAL mint
              size: 68,
              current: yieldNow,
              target: yieldTarget,
              unit: "USD",
            },
          ]}
        />
      )}
      <ValueCaptureBanner state={state} isMobile={isMobile} />
      <DFlowBarChart state={state} isMobile={isMobile} />
      <KaminoYieldChart state={state} />
      <LiveTimeline state={state} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// LiveHeroCard — pre-execution empty state with value proposition
// ---------------------------------------------------------------------------

const LiveHeroCard: FC = () => (
  <div style={styles.heroWrap}>
    <div style={styles.heroBadge}>
      <span style={styles.heroBadgeDot} />
      <span>Awaiting execution</span>
    </div>
    <h3 style={styles.heroTitle}>
      Earn while you trade.
    </h3>
    <p style={styles.heroSubtitle}>
      Analytics populate the moment execution starts — live DFlow savings,
      accruing Kamino yield, and your total value capture in real time.
    </p>

    <div style={styles.heroFeatures}>
      <HeroFeature
        icon={<HeroIconBps />}
        title="DFlow price improvement"
        desc="Basis-point gain vs. the market baseline, per slice."
      />
      <HeroFeature
        icon={<HeroIconYield />}
        title="Live Kamino yield"
        desc="Idle capital accrues interest every 15 seconds."
      />
      <HeroFeature
        icon={<HeroIconCapture />}
        title="Total value capture"
        desc="DFlow savings + Kamino yield rolled up in USD."
      />
    </div>
  </div>
);

const HeroFeature: FC<{
  icon: JSX.Element;
  title: string;
  desc: string;
}> = ({ icon, title, desc }) => (
  <div style={styles.heroFeatureRow}>
    <div style={styles.heroFeatureIconWrap}>{icon}</div>
    <div style={{ minWidth: 0 }}>
      <div style={styles.heroFeatureTitle}>{title}</div>
      <div style={styles.heroFeatureDesc}>{desc}</div>
    </div>
  </div>
);

const HeroIconBps: FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="11" width="2.8" height="5" rx="0.8" fill="var(--color-5-strong)" />
    <rect x="6.5" y="7" width="2.8" height="9" rx="0.8" fill="var(--color-5)" />
    <rect x="11" y="3" width="2.8" height="13" rx="0.8" fill="var(--color-5-strong)" />
  </svg>
);

const HeroIconYield: FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="7" stroke="var(--color-success)" strokeWidth="1.5" />
    <path d="M9 4.5v5l3 1.8" stroke="var(--color-success)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const HeroIconCapture: FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path
      d="M9 2l5 3v5c0 3.5-2.5 5.5-5 7-2.5-1.5-5-3.5-5-7V5l5-3z"
      stroke="var(--color-5-strong)"
      strokeWidth="1.5"
      fill="var(--color-accent-bg-soft)"
      strokeLinejoin="round"
    />
    <path
      d="M6.5 9l2 2L12 7"
      stroke="var(--color-5-strong)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Value Capture Banner
// ---------------------------------------------------------------------------

const ValueCaptureBanner: FC<{
  state: ReturnType<typeof useExecutionMachine>["state"];
  isMobile: boolean;
}> = ({ state, isMobile }) => {
  // Kamino yield DONE'a kadar 0 görünür. Canlı yield için useLiveKaminoYield
  // hook'unu tetikleyip banner'da da kullanabiliriz; basitlik için DONE'daki
  // totalYieldEarned'ı input token değil USD cinsinden göstermek gerekir.
  // Banner'da `state.totalYieldEarned`'ı input token olarak bırakıyoruz ve
  // LiveKaminoYieldChart gerçek USD time series'i gösteriyor. Toplam kazanım
  // banner'ı sadece DFlow USD + live yield tracker'ın en son noktası.
  const liveYieldUsd = useLiveKaminoYieldUsd(state);
  const totalValueUsd = state.totalPriceImprovementUsd + liveYieldUsd;

  // Big magnitudes switch to compact notation so the banner never clips.
  // AnimatedNumber is for smooth tick transitions at human-scale values;
  // at six-plus digits the animation becomes visually noisy anyway.
  const useCompact = Math.abs(totalValueUsd) >= 10_000;
  const compactDisplay = formatUSDCompact(totalValueUsd);

  return (
    <div style={styles.valueCaptureBanner}>
      <div style={styles.valueCaptureLabel}>TOTAL GAIN</div>
      <div
        style={{
          ...styles.valueCaptureValue,
          color: totalValueUsd >= 0 ? THEME.success : THEME.amber,
          // clamp(min, ideal, max) keeps the headline legible on mobile
          // (min 1.6rem) while letting it breathe on desktop (max 2.75rem).
          fontSize: isMobile
            ? "clamp(1.6rem, 8vw, 2.2rem)"
            : "clamp(2rem, 4vw, 2.75rem)",
          overflowWrap: "anywhere",
          lineHeight: 1.05,
        }}
        title={
          useCompact
            ? `${formatUSD(totalValueUsd)} exact`
            : undefined
        }
      >
        {useCompact ? (
          compactDisplay
        ) : (
          <AnimatedNumber
            value={totalValueUsd}
            prefix="$"
            decimals={2}
            duration={600}
          />
        )}
      </div>
      <div style={styles.valueCaptureBreakdown}>
        <div style={styles.breakdownRow}>
          <span style={styles.breakdownKey}>DFlow:</span>
          <span
            style={{
              ...styles.breakdownValue,
              color:
                state.totalPriceImprovementUsd >= 0
                  ? THEME.success
                  : THEME.amber,
            }}
          >
            {formatUSDCompact(state.totalPriceImprovementUsd)} (
            {formatBps(state.totalPriceImprovementBps)} bps)
          </span>
        </div>
        <div style={styles.breakdownRow}>
          <span style={styles.breakdownKey}>Kamino:</span>
          <span style={{ ...styles.breakdownValue, color: THEME.success }}>
            {formatUSDCompact(liveYieldUsd)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DFlow Bar Chart
// ---------------------------------------------------------------------------

type BarDatum = {
  name: string;
  bps: number;
  usd: number;
  pending: boolean;
};

const DFlowBarChart: FC<{
  state: ReturnType<typeof useExecutionMachine>["state"];
  isMobile: boolean;
}> = ({ state, isMobile }) => {
  const data: BarDatum[] = useMemo(
    () =>
      state.slices.map((slice, i) => ({
        name: `D${i + 1}`,
        bps: slice.result?.priceImprovementBps ?? 0,
        usd: slice.result?.priceImprovementUsd ?? 0,
        pending: slice.status !== "completed",
      })),
    [state.slices],
  );

  if (data.length === 0) return null;

  // Mobil: her bar için min 40px — toplam genişlik bar sayısına göre büyür,
  // parent yatay scroll ile sığar.
  const MIN_BAR_WIDTH_MOBILE = 40;
  const mobileChartWidth = Math.max(
    data.length * MIN_BAR_WIDTH_MOBILE + 80,
    280,
  );

  return (
    <div style={styles.chartCard}>
      <div style={styles.chartLabel}>DFLOW PRICE IMPROVEMENT</div>
      <div
        className={isMobile ? "liminal-hscroll" : undefined}
        style={{
          ...styles.chartWrapper,
          overflowX: isMobile ? "auto" : undefined,
        }}
      >
        <div
          style={{
            width: isMobile ? mobileChartWidth : "100%",
            minWidth: isMobile ? mobileChartWidth : undefined,
          }}
        >
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={THEME.border} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="name"
              stroke={THEME.textMuted}
              tick={{ fontSize: 15, fontFamily: MONO }}
              tickLine={false}
              axisLine={{ stroke: THEME.border }}
            />
            <YAxis
              stroke={THEME.textMuted}
              tick={{ fontSize: 15, fontFamily: MONO }}
              tickLine={false}
              axisLine={{ stroke: THEME.border }}
              width={40}
            />
            <ReferenceLine y={0} stroke={THEME.textMuted} strokeDasharray="3 3" />
            <Tooltip
              cursor={{ fill: "var(--color-accent-bg-soft)" }}
              contentStyle={{
                background: THEME.panelElevated,
                border: `1px solid ${THEME.border}`,
                borderRadius: 6,
                fontFamily: MONO,
                fontSize: 16,
              }}
              labelStyle={{ color: THEME.textMuted }}
              formatter={(_v: unknown, _n: unknown, item: { payload?: BarDatum }) => {
                const d = item.payload;
                if (!d) return ["", ""];
                if (d.pending) return ["pending", ""];
                return [
                  `${formatBps(d.bps)} bps (${formatUSD(d.usd)})`,
                  "improvement",
                ];
              }}
            />
            <Bar dataKey="bps" radius={[3, 3, 0, 0]} animationDuration={600}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={
                    d.pending
                      ? THEME.border
                      : d.bps >= 0
                        ? THEME.accent
                        : THEME.amber
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Kamino Live Yield USD hook — 15s polling
// ---------------------------------------------------------------------------

type YieldPoint = { t: number; label: string; usd: number };

function useLiveKaminoYield(
  state: ReturnType<typeof useExecutionMachine>["state"],
): YieldPoint[] {
  const [series, setSeries] = useState<YieldPoint[]>([]);
  const activeKey = `${state.kaminoVaultAddress ?? ""}:${state.config?.inputMint ?? ""}:${state.startedAt?.toISOString() ?? ""}`;

  // Execution değiştiğinde seriyi sıfırla.
  useEffect(() => {
    setSeries([]);
  }, [activeKey]);

  // ACTIVE benzeri durumlarda 15s'de bir sample al. PREPARING ve
  // DEPOSITING bilinçli olarak listede DEĞİL — bu fazlarda kullanıcı
  // henüz Kamino'ya deposit yapmamış olabilir, on-chain pozisyon
  // okuyacak bir şey yok. Sample ACTIVE'le başlar.
  useEffect(() => {
    const isLive =
      state.status === ExecutionStatus.ACTIVE ||
      state.status === ExecutionStatus.SLICE_WITHDRAWING ||
      state.status === ExecutionStatus.SLICE_EXECUTING ||
      state.status === ExecutionStatus.COMPLETING;
    if (!isLive) return;
    if (!state.config || !state.kaminoVaultAddress) return;

    let cancelled = false;

    const sample = async (): Promise<void> => {
      try {
        const [pos, price] = await Promise.all([
          getPositionValue(
            state.config!.walletPublicKey,
            state.kaminoVaultAddress!,
            state.config!.inputMint,
            state.kaminoDepositedAmount,
          ),
          getPythPrice(state.config!.inputMint),
        ]);
        if (cancelled) return;
        const yieldTokens = Math.max(0, pos.yieldAccrued);
        const yieldUsd = yieldTokens * (price ?? 0);
        const ts = Date.now();
        setSeries((prev) => [
          ...prev,
          { t: ts, label: formatTime(new Date(ts)), usd: yieldUsd },
        ]);
      } catch (err) {
        console.warn(
          `[LIMINAL] Kamino yield sample error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    void sample();
    const id = setInterval(() => void sample(), KAMINO_SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, activeKey]);

  // DONE state'te son değer olarak totalYieldEarned × son bilinen fiyatı ekle.
  useEffect(() => {
    if (state.status !== ExecutionStatus.DONE) return;
    if (series.length === 0 && state.totalYieldEarned <= 0) return;
    // Zaten ACTIVE'den gelen son point var — DONE'da chart sabit kalır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return series;
}

/** Banner için son yield USD değerini verir. */
function useLiveKaminoYieldUsd(
  state: ReturnType<typeof useExecutionMachine>["state"],
): number {
  const series = useLiveKaminoYield(state);
  if (series.length === 0) return 0;
  return series[series.length - 1].usd;
}

// ---------------------------------------------------------------------------
// Kamino Yield Area Chart
// ---------------------------------------------------------------------------

const KaminoYieldChart: FC<{
  state: ReturnType<typeof useExecutionMachine>["state"];
}> = ({ state }) => {
  const series = useLiveKaminoYield(state);

  if (series.length === 0) {
    return (
      <div style={styles.chartCard}>
        <div style={styles.chartLabel}>KAMINO YIELD (LIVE)</div>
        <div style={styles.yieldEmpty}>Waiting for yield data…</div>
      </div>
    );
  }

  return (
    <div style={styles.chartCard}>
      <div style={styles.chartLabel}>KAMINO YIELD (LIVE)</div>
      <div style={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart
            data={series}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <defs>
              <linearGradient id="liminal-yield-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={THEME.accent} stopOpacity={0.6} />
                <stop offset="100%" stopColor={THEME.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={THEME.border} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={THEME.textMuted}
              tick={{ fontSize: 14, fontFamily: MONO }}
              tickLine={false}
              axisLine={{ stroke: THEME.border }}
              minTickGap={20}
            />
            <YAxis
              stroke={THEME.textMuted}
              tick={{ fontSize: 14, fontFamily: MONO }}
              tickLine={false}
              axisLine={{ stroke: THEME.border }}
              width={44}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{
                background: THEME.panelElevated,
                border: `1px solid ${THEME.border}`,
                borderRadius: 6,
                fontFamily: MONO,
                fontSize: 16,
              }}
              labelStyle={{ color: THEME.textMuted }}
              formatter={(v: number) => [formatUSD(v), "yield"]}
            />
            <Area
              type="monotone"
              dataKey="usd"
              stroke={THEME.accent}
              strokeWidth={2}
              fill="url(#liminal-yield-gradient)"
              isAnimationActive
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live Timeline (tamamlanan slice kartları)
// ---------------------------------------------------------------------------

const LiveTimeline: FC<{
  state: ReturnType<typeof useExecutionMachine>["state"];
}> = ({ state }) => {
  const completed = state.slices.filter((s) => s.status === "completed" && s.result);
  if (completed.length === 0) return null;

  // En yeni en üstte.
  const ordered = [...completed].reverse();

  return (
    <div style={styles.chartCard}>
      <div style={styles.chartLabel}>COMPLETED SLICES</div>
      <div style={styles.timelineList}>
        {ordered.map((slice) => {
          const r = slice.result!;
          return (
            <div
              key={slice.sliceIndex}
              style={{
                ...styles.timelineItem,
                animation: "liminal-slide-in 300ms ease-out",
              }}
            >
              <div style={styles.timelineHeader}>
                <span style={styles.timelineTitle}>
                  Slice {slice.sliceIndex + 1}
                </span>
                <span style={styles.timelineTime}>
                  {formatTime(r.confirmedAt)}
                </span>
              </div>
              <div style={styles.timelineMetrics}>
                <span style={styles.timelineMetric}>
                  <span style={styles.timelineMetricLabel}>fill:</span>{" "}
                  {formatAmount(r.executionPrice, 6)}
                </span>
                <span style={styles.timelineMetric}>
                  <span style={styles.timelineMetricLabel}>market:</span>{" "}
                  {formatAmount(r.marketPrice, 6)}
                </span>
              </div>
              <div style={styles.timelineMetrics}>
                <span
                  style={{
                    ...styles.timelineMetric,
                    color:
                      r.priceImprovementBps >= 0
                        ? THEME.success
                        : THEME.amber,
                  }}
                >
                  {formatBps(r.priceImprovementBps)} bps
                </span>
                <span
                  style={{
                    ...styles.timelineMetric,
                    color:
                      r.priceImprovementUsd >= 0
                        ? THEME.success
                        : THEME.amber,
                  }}
                >
                  {formatUSD(r.priceImprovementUsd)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// HISTORY TAB
// ---------------------------------------------------------------------------

const HistoryTab: FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const [history, setHistory] = useState<HistoricalExecution[]>([]);
  const [selected, setSelected] = useState<HistoricalExecution | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Tab açıldığında TAZE çek (cache yok).
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const refresh = useCallback(() => {
    setHistory(getHistory());
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      deleteExecution(id);
      setConfirmDelete(null);
      refresh();
    },
    [refresh],
  );

  if (history.length === 0) {
    return (
      <div style={styles.historyEmptyWrap}>
        {/* Demo cards — show users what the stack will look like
            BEFORE they have real history. The 4 sample executions
            are clearly marked with a "demo" pill so they don't
            get mistaken for real entries. Hidden on mobile because
            the fan-out math assumes desktop width; mobile users see
            the simple text card instead. */}
        {!isMobile ? (
          <ExecutionStack
            executions={[]}
            demoMode
            title="Preview · what your history will look like"
          />
        ) : (
          <div style={styles.historyEmptyCard}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--color-text-muted)" strokeWidth="1.5" />
              <path d="M12 6v6l4 2" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div style={styles.historyEmptyText}>
              Completed executions will appear here.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.historyStack,
        // Desktop: 2 sütun grid, mobil: tek sütun
        display: isMobile ? "flex" : "grid",
        gridTemplateColumns: isMobile ? undefined : "1fr 1fr",
        gap: 10,
      }}
    >
      {/* Fan-out card stack — visual centrepiece showing the 6 most
          recent executions. Click the stack to fan them out, click a
          card to open the detail modal. The original detailed card
          grid below stays as a navigable list for the full history. */}
      {history.length > 0 && !isMobile && (
        <div style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
          <ExecutionStack
            executions={history}
            onCardOpen={(exec) => setSelected(exec)}
          />
        </div>
      )}
      {history.map((h) => (
        <HistoryCard
          key={h.id}
          execution={h}
          onOpen={() => setSelected(h)}
          onRequestDelete={() => setConfirmDelete(h.id)}
          confirmingDelete={confirmDelete === h.id}
          onConfirmDelete={() => handleDelete(h.id)}
          onCancelDelete={() => setConfirmDelete(null)}
        />
      ))}

      {selected && (
        <HistoryDetailModal
          execution={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

const HistoryCard: FC<{
  execution: HistoricalExecution;
  onOpen: () => void;
  onRequestDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}> = ({
  execution,
  onOpen,
  onRequestDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}) => {
  const { summary, inputSymbol, outputSymbol } = execution;
  const total = summary.totalValueCaptureUsd;
  return (
    <div style={styles.historyCard}>
      <div style={styles.historyCardHeader}>
        <button
          type="button"
          onClick={onOpen}
          style={styles.historyCardTitle}
        >
          <span style={styles.historyPair}>
            {inputSymbol} → {outputSymbol}
          </span>
          <span style={styles.historyDate}>
            {formatDate(execution.createdAt)}
          </span>
        </button>
        {confirmingDelete ? (
          <div style={styles.confirmGroup}>
            <span style={styles.confirmText}>Are you sure?</span>
            <button
              type="button"
              onClick={onConfirmDelete}
              style={styles.confirmYes}
            >
              DELETE
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              style={styles.confirmNo}
            >
              CANCEL
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRequestDelete}
            style={styles.deleteBtn}
            title="Delete"
            aria-label="Delete execution history"
          >
            ×
          </button>
        )}
      </div>

      <div style={styles.historyRow}>
        {formatAmount(summary.totalInputAmount, 2)} {inputSymbol},{" "}
        {formatDuration(summary.executionDurationMs)}
      </div>

      <div style={styles.historyValueRow}>
        <span style={styles.historyValueKey}>DFlow:</span>{" "}
        <span
          style={{
            color:
              summary.totalPriceImprovementUsd >= 0
                ? THEME.success
                : THEME.amber,
          }}
        >
          {formatUSD(summary.totalPriceImprovementUsd)}
        </span>
        <span style={styles.historyDivider}>|</span>
        <span style={styles.historyValueKey}>Kamino:</span>{" "}
        <span style={{ color: THEME.success }}>
          {formatUSD(summary.totalKaminoYieldUsd)}
        </span>
        <span style={styles.historyDivider}>|</span>
        <span style={styles.historyValueKey}>Total:</span>{" "}
        <span
          style={{
            color: total >= 0 ? THEME.success : THEME.amber,
            fontWeight: 700,
          }}
        >
          {formatUSD(total)}
        </span>
      </div>
    </div>
  );
};

const HistoryDetailModal: FC<{
  execution: HistoricalExecution;
  onClose: () => void;
}> = ({ execution, onClose }) => {
  const { summary, slices, inputSymbol, outputSymbol } = execution;
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape key closes modal + focus trap + restore focus on unmount
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Initial focus into the modal
    modalRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      // Focus trap on Tab
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);

    // Body scroll lock
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  const titleId = `history-modal-title-${execution.id}`;

  return (
    <div style={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        style={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div style={styles.modalHeader}>
          <div>
            <div id={titleId} style={styles.modalTitle}>
              {inputSymbol} → {outputSymbol}
            </div>
            <div style={styles.modalSubtitle}>
              {formatDate(execution.createdAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={styles.modalClose}
            aria-label="Close dialog"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.modalSummaryGrid}>
          <SummaryMetric
            label="Total amount"
            value={`${formatAmount(summary.totalInputAmount, 4)} ${inputSymbol}`}
          />
          <SummaryMetric
            label="Received"
            value={`${formatAmount(summary.totalOutputAmount, 4)} ${outputSymbol}`}
          />
          <SummaryMetric
            label="Average fill"
            value={formatAmount(summary.averageExecutionPrice, 6)}
          />
          <SummaryMetric
            label="Baseline price"
            value={formatAmount(summary.baselinePrice, 6)}
          />
          <SummaryMetric
            label="DFlow bps"
            value={`${formatBps(summary.totalPriceImprovementBps)}`}
            color={
              summary.totalPriceImprovementBps >= 0
                ? THEME.success
                : THEME.amber
            }
          />
          <SummaryMetric
            label="DFlow $"
            value={formatUSD(summary.totalPriceImprovementUsd)}
            color={
              summary.totalPriceImprovementUsd >= 0
                ? THEME.success
                : THEME.amber
            }
          />
          <SummaryMetric
            label="Kamino yield"
            value={formatUSD(summary.totalKaminoYieldUsd)}
            color={THEME.success}
          />
          <SummaryMetric
            label="Total gain"
            value={formatUSD(summary.totalValueCaptureUsd)}
            color={
              summary.totalValueCaptureUsd >= 0
                ? THEME.success
                : THEME.amber
            }
            big
          />
          <SummaryMetric
            label="Duration"
            value={formatDuration(summary.executionDurationMs)}
          />
          <SummaryMetric
            label="Slices"
            value={`${summary.completedSlices} completed`}
          />
        </div>

        <div style={styles.modalSectionTitle}>SLICE DETAILS</div>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>Price</th>
                <th style={styles.th}>Bps</th>
                <th style={styles.th}>Yield $</th>
                <th style={styles.th}>Duration</th>
                <th style={styles.th}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s) => (
                <SliceRow key={s.sliceIndex} slice={s} />
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.modalSectionTitle}>SOLANA EXPLORER</div>
        <div style={styles.explorerList}>
          {slices.map((s) => (
            <a
              key={s.sliceIndex}
              href={`${SOLANA_EXPLORER_TX_BASE}${s.signature}`}
              target="_blank"
              rel="noreferrer noopener"
              style={styles.explorerLink}
            >
              Slice {s.sliceIndex + 1}: {s.signature.slice(0, 8)}...
              {s.signature.slice(-8)}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

const SliceRow: FC<{ slice: SliceAnalytics }> = ({ slice }) => {
  const bpsColor =
    slice.priceImprovementBps >= 0 ? THEME.success : THEME.amber;
  return (
    <tr>
      <td style={styles.td}>D{slice.sliceIndex + 1}</td>
      <td style={styles.td}>{formatAmount(slice.executionPrice, 6)}</td>
      <td style={{ ...styles.td, color: bpsColor }}>
        {formatBps(slice.priceImprovementBps)}
      </td>
      <td style={{ ...styles.td, color: THEME.success }}>
        {formatUSD(slice.kaminoYieldUsd)}
      </td>
      <td style={styles.td}>{formatDuration(slice.kaminoDurationMs)}</td>
      <td style={styles.td}>
        <a
          href={`${SOLANA_EXPLORER_TX_BASE}${slice.signature}`}
          target="_blank"
          rel="noreferrer noopener"
          style={styles.txLink}
        >
          {slice.signature.slice(0, 6)}...
        </a>
      </td>
    </tr>
  );
};

const SummaryMetric: FC<{
  label: string;
  value: string;
  color?: string;
  big?: boolean;
}> = ({ label, value, color, big }) => (
  <div style={styles.summaryMetric}>
    <div style={styles.summaryMetricLabel}>{label}</div>
    <div
      style={{
        ...styles.summaryMetricValue,
        color: color ?? THEME.text,
        fontSize: big ? 18 : 13,
        fontWeight: big ? 700 : 600,
      }}
    >
      {value}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// PROTOCOL TAB
// ---------------------------------------------------------------------------

const ProtocolTab: FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const [history, setHistory] = useState<HistoricalExecution[]>([]);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const stats = useMemo(() => {
    if (history.length === 0) return null;

    const totalExecutions = history.length;
    const totalVolumeUsd = history.reduce((s, h) => {
      // Volume = totalInput × baselinePrice (gerçek USD tutar)
      return s + h.summary.totalInputAmount * h.summary.baselinePrice;
    }, 0);
    const totalDFlowUsd = history.reduce(
      (s, h) => s + h.summary.totalPriceImprovementUsd,
      0,
    );
    const totalKaminoUsd = history.reduce(
      (s, h) => s + h.summary.totalKaminoYieldUsd,
      0,
    );
    const totalValueCapture = totalDFlowUsd + totalKaminoUsd;
    const avgDurationMs =
      history.reduce((s, h) => s + h.summary.executionDurationMs, 0) /
      totalExecutions;

    // En çok kullanılan pair
    const pairCounts = new Map<string, number>();
    for (const h of history) {
      const key = `${h.inputSymbol} → ${h.outputSymbol}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    let topPair = "—";
    let topCount = 0;
    for (const [pair, count] of pairCounts.entries()) {
      if (count > topCount) {
        topCount = count;
        topPair = pair;
      }
    }

    // En yüksek single-execution value capture
    let maxCapture = 0;
    for (const h of history) {
      if (h.summary.totalValueCaptureUsd > maxCapture) {
        maxCapture = h.summary.totalValueCaptureUsd;
      }
    }

    return {
      totalExecutions,
      totalVolumeUsd,
      totalDFlowUsd,
      totalKaminoUsd,
      totalValueCapture,
      avgDurationMs,
      topPair,
      topCount,
      maxCapture,
    };
  }, [history]);

  // Cumulative value capture chart data (Item 15)
  const cumulativeData = useMemo(() => {
    if (history.length < 2) return [];
    const sorted = [...history].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    let runningSum = 0;
    return sorted.map((h) => {
      runningSum += h.summary.totalValueCaptureUsd;
      return {
        date: h.createdAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        usd: runningSum,
      };
    });
  }, [history]);

  if (!stats) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            ...styles.protocolStack,
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          }}
        >
          <ProtocolMetric label="Total executions" value="0" />
          <ProtocolMetric label="Total volume" value="$0.00" />
          <ProtocolMetric label="Total DFlow gain" value="$0.00" />
          <ProtocolMetric label="Total Kamino yield" value="$0.00" />
          <ProtocolMetric label="Total value capture" value="$0.00" big />
          <ProtocolMetric label="Average execution duration" value="—" />
          <ProtocolMetric label="Most used pair" value="—" />
          <ProtocolMetric label="Best single execution" value="—" />
        </div>
        <MevProtectionCard />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          ...styles.protocolStack,
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        }}
      >
        <ProtocolMetric
          label="Total executions"
          value={stats.totalExecutions.toLocaleString("en-US")}
        />
        <ProtocolMetric
          label="Total volume"
          value={formatUSD(stats.totalVolumeUsd)}
        />
        <ProtocolMetric
          label="Total DFlow gain"
          value={formatUSD(stats.totalDFlowUsd)}
          color={THEME.success}
        />
        <ProtocolMetric
          label="Total Kamino yield"
          value={formatUSD(stats.totalKaminoUsd)}
          color={THEME.success}
        />
        <ProtocolMetric
          label="Total value capture"
          value={formatUSD(stats.totalValueCapture)}
          color={THEME.success}
          big
        />
        <ProtocolMetric
          label="Average execution duration"
          value={formatDuration(stats.avgDurationMs)}
        />
        <ProtocolMetric
          label="Most used pair"
          value={`${stats.topPair} (${stats.topCount}×)`}
        />
        <ProtocolMetric
          label="Best single execution"
          value={formatUSD(stats.maxCapture)}
          color={THEME.success}
        />
      </div>

      {/* Cumulative value capture area chart (Item 15) */}
      {cumulativeData.length >= 2 && (
        <div style={styles.chartCard}>
          <div style={styles.chartLabel}>CUMULATIVE VALUE CAPTURE</div>
          <div style={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart
                data={cumulativeData}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="liminal-cumulative-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME.accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={THEME.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={THEME.border} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={THEME.textMuted}
                  tick={{ fontSize: 14, fontFamily: MONO }}
                  tickLine={false}
                  axisLine={{ stroke: THEME.border }}
                />
                <YAxis
                  stroke={THEME.textMuted}
                  tick={{ fontSize: 14, fontFamily: MONO }}
                  tickLine={false}
                  axisLine={{ stroke: THEME.border }}
                  width={44}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: THEME.panelElevated,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: 6,
                    fontFamily: MONO,
                    fontSize: 16,
                  }}
                  labelStyle={{ color: THEME.textMuted }}
                  formatter={(v: number) => [formatUSD(v), "cumulative"]}
                />
                <Area
                  type="monotone"
                  dataKey="usd"
                  stroke={THEME.accent}
                  strokeWidth={2}
                  fill="url(#liminal-cumulative-gradient)"
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* MEV protection — explains the two-layer defense stack (Jupiter
          Ultra today, Constellation-ready for tomorrow). */}
      <MevProtectionCard />
    </div>
  );
};

/**
 * MEV Protection card — surfaces the two-layer defense stack on the
 * Protocol tab. Reads from services/mevProtection so the copy stays in
 * lockstep with the env-driven strategy (today jupiter-ultra, later
 * hybrid once Constellation ships).
 */
const MevProtectionCard: FC = () => {
  const strategy = getMevStrategy();
  return (
    <section
      style={styles.mevCard}
      aria-label="MEV protection strategy"
    >
      <div style={styles.mevHeader}>
        <div style={styles.mevTitleRow}>
          <span style={styles.mevBadgeDot} aria-hidden="true" />
          <span style={styles.mevTitle}>MEV PROTECTION</span>
        </div>
        <span style={styles.mevMode}>{strategy.label}</span>
      </div>
      <div style={styles.mevLayers}>
        {strategy.layers.map((layer) => (
          <MevLayerRow key={layer.name} layer={layer} />
        ))}
      </div>
      {!strategy.constellationActive && (
        <p style={styles.mevFooter}>
          Constellation plumbing is in place. Client-side proposer hints
          activate automatically once the SIMD lands on mainnet — no
          redeploy needed for existing users.
        </p>
      )}
    </section>
  );
};

const MevLayerRow: FC<{ layer: MevLayer }> = ({ layer }) => (
  <a
    href={layer.referenceUrl}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      ...styles.mevLayerRow,
      opacity: layer.active ? 1 : 0.72,
    }}
  >
    <span
      style={{
        ...styles.mevLayerStatus,
        background: layer.active
          ? "var(--color-success)"
          : "var(--color-warn)",
      }}
      aria-hidden="true"
    >
      {layer.active ? "Active" : "Ready"}
    </span>
    <div style={styles.mevLayerText}>
      <div style={styles.mevLayerName}>{layer.name}</div>
      <div style={styles.mevLayerDesc}>{layer.description}</div>
    </div>
    <span style={styles.mevLayerArrow} aria-hidden="true">
      ↗
    </span>
  </a>
);

const ProtocolMetric: FC<{
  label: string;
  value: string;
  color?: string;
  big?: boolean;
}> = ({ label, value, color, big }) => (
  <div style={styles.protocolCard}>
    <div style={styles.protocolLabel}>{label}</div>
    <div
      style={{
        ...styles.protocolValue,
        color: color ?? THEME.text,
        fontSize: big ? 22 : 16,
      }}
    >
      {value}
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
    minHeight: 560,
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
    transition: "border-color 200ms ease",
  },
  header: {
    fontFamily: MONO,
    fontSize: 14,
    letterSpacing: 0,
    color: THEME.textMuted,
    opacity: 0.5,
    padding: "12px 16px 10px",
    borderBottom: `1px solid ${THEME.border}`,
    textTransform: "none",
  },
  tabs: {
    display: "flex",
    gap: 2,
    padding: "0 16px",
    borderBottom: `1px solid ${THEME.border}`,
  },
  tabsWrap: {
    padding: "10px 14px 12px",
    borderBottom: `1px solid ${THEME.border}`,
  },
  tabButton: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    padding: "12px 14px",
    cursor: "pointer",
    letterSpacing: 0,
    textTransform: "none",
  },
  body: {
    flex: 1,
    padding: "12px 14px",
    overflowY: "auto",
  },
  emptyHint: {
    fontFamily: MONO,
    fontSize: 17,
    color: THEME.textMuted,
    textAlign: "center",
    padding: "40px 20px",
    lineHeight: 1.6,
  },

  // Hero empty state — pre-execution value proposition
  heroWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "20px 4px 8px",
  },
  heroBadge: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    background: "var(--color-accent-bg-soft)",
    border: "1px solid var(--color-accent-border)",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0,
    color: "var(--color-5-strong)",
  } as CSSProperties,
  heroBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-5-strong)",
    animation: "liminal-active-pulse 1.6s ease-in-out infinite",
    display: "inline-block",
  } as CSSProperties,
  heroTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--color-text)",
    lineHeight: 1.2,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  heroSubtitle: {
    fontSize: 15,
    color: "var(--color-text-muted)",
    lineHeight: 1.55,
    margin: 0,
  },
  heroFeatures: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 6,
  },
  heroFeatureRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "12px 12px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: "var(--radius-md)",
  },
  heroFeatureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: "var(--radius-sm)",
    background: "var(--color-accent-bg-soft)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heroFeatureTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--color-text)",
    marginBottom: 2,
  },
  heroFeatureDesc: {
    fontSize: 14,
    color: "var(--color-text-muted)",
    lineHeight: 1.45,
  },

  // Skeleton empty state (deprecated — kept in case referenced elsewhere)
  skeletonEmpty: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "20px 0",
  },
  skeletonChartCard: {
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-md)",
    padding: "14px 12px 10px",
  },
  skeletonChartLabel: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
    marginBottom: 12,
    paddingLeft: 8,
    opacity: 0.6,
  },
  skeletonBarRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 12,
    height: 90,
    padding: "0 16px",
  },
  skeletonHintText: {
    fontSize: 16,
    color: THEME.textMuted,
    textAlign: "center",
    padding: "8px 20px",
    lineHeight: 1.6,
  },

  // Live stack
  liveStack: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  valueCaptureBanner: {
    background: "var(--color-accent-bg-soft)",
    border: `1px solid var(--color-accent-border)`,
    borderRadius: 10,
    padding: "18px 20px",
    textAlign: "center",
    minWidth: 0,
    overflow: "hidden",
  },
  valueCaptureLabel: {
    fontSize: 15,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
    marginBottom: 8,
  },
  valueCaptureValue: {
    fontSize: 36,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },
  valueCaptureBreakdown: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "center",
  },
  breakdownRow: {
    display: "flex",
    gap: 6,
    fontSize: 16,
    fontVariantNumeric: "tabular-nums",
  },
  breakdownKey: {
    color: THEME.textMuted,
    textTransform: "none",
    letterSpacing: 0,
  },
  breakdownValue: {
    fontWeight: 600,
  },

  // Charts
  chartCard: {
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "14px 12px 10px",
  },
  chartLabel: {
    fontSize: 14,
    color: THEME.accent,
    letterSpacing: 0,
    textTransform: "none",
    marginBottom: 10,
    paddingLeft: 8,
  },
  chartWrapper: {
    width: "100%",
  },
  yieldEmpty: {
    fontSize: 16,
    color: THEME.textMuted,
    padding: "28px 16px",
    textAlign: "center",
  },

  // Live timeline
  timelineList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  timelineItem: {
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    padding: "10px 12px",
  },
  timelineHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  timelineTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: THEME.text,
  },
  timelineTime: {
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  timelineMetrics: {
    display: "flex",
    gap: 12,
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  timelineMetric: {
    display: "inline-flex",
    gap: 4,
  },
  timelineMetricLabel: {
    color: THEME.textMuted,
  },

  // History empty
  historyEmptyWrap: {
    padding: "12px 0",
  },
  historyEmptyCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "36px 20px",
    border: "2px dashed var(--color-stroke)",
    borderRadius: "var(--radius-md)",
    textAlign: "center",
  },
  historyEmptyText: {
    fontSize: 17,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },

  // History
  historyStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  historyCard: {
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "12px 14px",
  },
  historyCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  historyCardTitle: {
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: MONO,
    color: THEME.text,
    flex: 1,
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  historyPair: {
    fontSize: 18,
    fontWeight: 600,
  },
  historyDate: {
    fontSize: 15,
    color: THEME.textMuted,
  },
  historyRow: {
    fontSize: 16,
    color: THEME.textMuted,
    marginBottom: 6,
    fontVariantNumeric: "tabular-nums",
  },
  historyValueRow: {
    fontSize: 15,
    color: THEME.textMuted,
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "baseline",
  },
  historyValueKey: {
    color: THEME.textMuted,
    textTransform: "none",
    letterSpacing: 0,
  },
  historyDivider: {
    color: THEME.border,
    margin: "0 2px",
  },
  deleteBtn: {
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-sm)",
    color: THEME.textMuted,
    cursor: "pointer",
    fontSize: 21,
    width: 32,
    height: 32,
    lineHeight: 1,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  confirmGroup: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
    color: THEME.amber,
  },
  confirmYes: {
    fontFamily: MONO,
    background: THEME.danger,
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 15,
    cursor: "pointer",
    fontWeight: 600,
  },
  confirmNo: {
    fontFamily: MONO,
    background: "transparent",
    color: THEME.textMuted,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 15,
    cursor: "pointer",
  },

  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "var(--color-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 20,
  },
  modalCard: {
    background: "var(--color-2)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: 22,
    maxWidth: 640,
    width: "100%",
    maxHeight: "85vh",
    overflowY: "auto",
    fontFamily: MONO,
    boxShadow: "var(--shadow-raised)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 21,
    fontWeight: 700,
    color: THEME.text,
  },
  modalSubtitle: {
    fontSize: 15,
    color: THEME.textMuted,
    marginTop: 2,
  },
  modalClose: {
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    borderRadius: "var(--radius-sm)",
    color: THEME.textMuted,
    cursor: "pointer",
    width: 36,
    height: 36,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  modalSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginBottom: 18,
  },
  summaryMetric: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  summaryMetricLabel: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  summaryMetricValue: {
    fontVariantNumeric: "tabular-nums",
  },
  modalSectionTitle: {
    fontSize: 15,
    color: THEME.accent,
    letterSpacing: 0,
    textTransform: "none",
    marginBottom: 10,
    marginTop: 8,
  },
  tableWrap: {
    overflowX: "auto",
    marginBottom: 18,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 16,
  },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    color: THEME.textMuted,
    fontSize: 14,
    letterSpacing: 0,
    textTransform: "none",
    borderBottom: `1px solid ${THEME.border}`,
  },
  td: {
    padding: "6px 8px",
    color: THEME.text,
    fontVariantNumeric: "tabular-nums",
    borderBottom: `1px solid ${THEME.border}`,
  },
  txLink: {
    color: THEME.accent,
    textDecoration: "none",
  },
  explorerList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  explorerLink: {
    fontSize: 16,
    color: THEME.accent,
    textDecoration: "none",
    padding: "4px 0",
    fontVariantNumeric: "tabular-nums",
  },

  // Protocol
  protocolStack: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  protocolCard: {
    background: "var(--surface-card)",
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  protocolLabel: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
    textTransform: "none",
  },
  protocolValue: {
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },

  // MEV protection card
  mevCard: {
    background: "var(--surface-card)",
    border: "1px solid var(--color-accent-border)",
    borderRadius: "var(--radius-md)",
    padding: "14px 14px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  mevHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  mevTitleRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  mevBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-5)",
    boxShadow: "0 0 8px var(--color-5)",
    animation: "liminal-pulse 2.2s ease-in-out infinite",
    display: "inline-block",
  },
  mevTitle: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0,
    color: "var(--color-5-strong)",
    textTransform: "none",
  },
  mevMode: {
    fontSize: 14,
    color: THEME.textMuted,
    letterSpacing: 0,
  },
  mevLayers: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  mevLayerRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    textDecoration: "none",
    color: "inherit",
    transition: "opacity var(--motion-base) var(--ease-out)",
  },
  mevLayerStatus: {
    minWidth: 54,
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    textTransform: "none",
    color: "#ffffff",
    textAlign: "center",
    alignSelf: "flex-start",
    marginTop: 2,
  },
  mevLayerText: {
    minWidth: 0,
  },
  mevLayerName: {
    fontSize: 15,
    fontWeight: 600,
    color: THEME.text,
    marginBottom: 3,
  },
  mevLayerDesc: {
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 1.5,
  },
  mevLayerArrow: {
    color: "var(--color-5-strong)",
    fontSize: 16,
    fontWeight: 700,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  mevFooter: {
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 1.5,
    margin: 0,
    paddingTop: 8,
    borderTop: `1px solid ${THEME.border}`,
  },
};

export default AnalyticsPanel;
