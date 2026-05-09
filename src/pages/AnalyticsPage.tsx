/**
 * LIMINAL — AnalyticsPage
 *
 * `#/analytics` route'unda render olur. Üstte lifetime stat hero'su
 * (toplam execution, toplam volume, toplam savings, toplam yield),
 * altında mevcut AnalyticsPanel (Live/History/Protocol tabları zaten
 * var) full-width şekilde.
 *
 * Hero hesaplaması localStorage'daki HistoricalExecution kayıtlarından
 * türetilir. Boş history için "Çalıştırılan execution yok" boş-state'i
 * gösterilir, panel değişmeden tab'lardan canlı / protocol view'larına
 * gidilebilir.
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import { getHistory, type HistoricalExecution } from "../services/analyticsStore";
import AnalyticsPanel from "../components/AnalyticsPanel";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

type Aggregate = {
  count: number;
  totalVolumeUsd: number;
  totalPriceImprovementUsd: number;
  totalKaminoYieldUsd: number;
  avgBps: number;
};

function aggregate(history: HistoricalExecution[]): Aggregate {
  if (history.length === 0) {
    return {
      count: 0,
      totalVolumeUsd: 0,
      totalPriceImprovementUsd: 0,
      totalKaminoYieldUsd: 0,
      avgBps: 0,
    };
  }
  let totalVolumeUsd = 0;
  let totalImp = 0;
  let totalYield = 0;
  let totalBps = 0;
  for (const h of history) {
    // Volume = input × baseline. Falls back to executionPrice if no baseline.
    const px = h.summary.baselinePrice || h.summary.averageExecutionPrice;
    totalVolumeUsd += h.summary.totalInputAmount * px;
    totalImp += h.summary.totalPriceImprovementUsd;
    totalYield += h.summary.totalKaminoYieldUsd;
    totalBps += h.summary.totalPriceImprovementBps;
  }
  return {
    count: history.length,
    totalVolumeUsd,
    totalPriceImprovementUsd: totalImp,
    totalKaminoYieldUsd: totalYield,
    avgBps: totalBps / history.length,
  };
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const AnalyticsPage: FC = () => {
  const [history, setHistory] = useState<HistoricalExecution[]>(() => getHistory());

  // Refresh on mount + every 5s so newly completed executions surface
  // here without a manual reload. Cheap because it's pure localStorage.
  useEffect(() => {
    setHistory(getHistory());
    const id = setInterval(() => setHistory(getHistory()), 5000);
    return () => clearInterval(id);
  }, []);

  const agg = aggregate(history);

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div style={styles.heroHead}>
          <div style={styles.heroEyebrow}>Analytics</div>
          <h1 style={styles.heroTitle}>Lifetime performance</h1>
          <p style={styles.heroSubtitle}>
            {agg.count > 0
              ? `${agg.count} execution across ${formatUsd(agg.totalVolumeUsd)} of routed volume.`
              : "Henüz tamamlanmış execution yok. İlk swap'tan sonra metrikler buraya yansır."}
          </p>
        </div>
        <div style={styles.statGrid}>
          <Stat label="Executions" value={`${agg.count}`} accent />
          <Stat
            label="Routed volume"
            value={formatUsd(agg.totalVolumeUsd)}
            hint="Input × baseline"
          />
          <Stat
            label="DFlow savings"
            value={formatUsd(agg.totalPriceImprovementUsd)}
            hint={agg.count > 0 ? `Ø ${agg.avgBps.toFixed(1)} bps / execution` : undefined}
            positive
          />
          <Stat
            label="Kamino yield"
            value={formatUsd(agg.totalKaminoYieldUsd)}
            hint={agg.count > 0 ? "Idle capital" : undefined}
            positive
          />
          <Stat
            label="Composite alpha"
            value={formatUsd(
              agg.totalPriceImprovementUsd + agg.totalKaminoYieldUsd,
            )}
            hint="Spread + yield"
            positive
          />
        </div>
      </header>

      {/* Mevcut tab'lı panel — Live / History / Protocol tabları
          AnalyticsPanel içinde duruyor. Full-width container'da
          serbestçe nefes alır. */}
      <section style={styles.panelSlot}>
        <AnalyticsPanel />
      </section>
    </div>
  );
};

const Stat: FC<{
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  positive?: boolean;
}> = ({ label, value, hint, accent, positive }) => (
  <div
    style={{
      ...styles.stat,
      background: accent
        ? "var(--color-accent-bg-strong)"
        : "var(--color-accent-bg-soft)",
      borderColor: accent
        ? "var(--color-accent-border)"
        : "var(--color-stroke)",
    }}
  >
    <div style={styles.statLabel}>{label}</div>
    <div
      style={{
        ...styles.statValue,
        color: positive ? "var(--color-success)" : "var(--color-text)",
      }}
    >
      {value}
    </div>
    {hint && <div style={styles.statHint}>{hint}</div>}
  </div>
);

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
      "linear-gradient(135deg, rgba(207, 236, 243, 0.10) 0%, rgba(218, 249, 222, 0.10) 50%, rgba(246, 255, 220, 0.10) 100%), var(--surface-card)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
  },
  heroHead: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  heroEyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
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
  heroSubtitle: {
    margin: 0,
    fontFamily: SANS,
    fontSize: 14,
    color: "var(--color-text-muted)",
    maxWidth: 640,
    lineHeight: 1.5,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "var(--space-3)",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "12px 16px",
    borderRadius: "var(--radius-md, 12px)",
    border: "1px solid var(--color-stroke)",
  },
  statLabel: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
  },
  statValue: {
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },
  statHint: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  panelSlot: {
    width: "100%",
    minWidth: 0,
  },
};

export default AnalyticsPage;
