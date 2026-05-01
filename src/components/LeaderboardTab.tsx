/**
 * LIMINAL — LeaderboardTab
 *
 * Local-first leaderboard. Two sections:
 *
 *   1. "Your stats" — rolls up all entries in the user's local
 *      analyticsStore: total runs, total value capture, best single
 *      run, average bps. Updates as new runs complete.
 *
 *   2. "Community" — a seeded list of fake-but-plausible top users
 *      with profile-style avatars + usernames + value capture totals.
 *      Marked clearly as "demo" because we don't have a backend.
 *      The shape matches what a real /leaderboard endpoint would
 *      return so swapping in real data later is one fetch call away.
 *
 * Why local + seeded demo: Solflare track judges + first-time visitors
 * both want to see "who's doing well on this thing." Without a backend
 * we fake that signal; the user's own row is real and updates live,
 * so the experience still rewards using the app.
 *
 * Future: replace SEED_COMMUNITY with a fetch to a Supabase
 * leaderboard table. Schema mirrored 1:1.
 */

import { useEffect, useState, type CSSProperties, type FC } from "react";
import {
  getHistory,
  type HistoricalExecution,
} from "../services/analyticsStore";
import {
  getProfile,
  subscribeProfiles,
} from "../services/profileStore";
import { ProfileAvatar } from "./ProfileAvatar";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

type LeaderboardRow = {
  rank: number;
  username: string;
  avatarId: number;
  /** "you" / "demo" — controls badge styling. */
  badge: "you" | "demo";
  totalCaptureUsd: number;
  totalRuns: number;
  bestSingleUsd: number;
  avgBps: number;
};

// Seeded community rows. Numbers picked to feel realistic for the
// hackathon timeframe — early adopters with a handful of runs each.
// They sit AROUND the user, not above by orders of magnitude, so the
// user feels reachable progress.
const SEED_COMMUNITY: Omit<LeaderboardRow, "rank" | "badge">[] = [
  {
    username: "trader_okto",
    avatarId: 3,
    totalCaptureUsd: 412.18,
    totalRuns: 23,
    bestSingleUsd: 78.4,
    avgBps: 17.2,
  },
  {
    username: "dca.daily",
    avatarId: 1,
    totalCaptureUsd: 287.5,
    totalRuns: 41,
    bestSingleUsd: 22.1,
    avgBps: 9.6,
  },
  {
    username: "stable_eddie",
    avatarId: 4,
    totalCaptureUsd: 198.32,
    totalRuns: 18,
    bestSingleUsd: 41.7,
    avgBps: 13.8,
  },
  {
    username: "limit_lad",
    avatarId: 2,
    totalCaptureUsd: 152.05,
    totalRuns: 12,
    bestSingleUsd: 28.9,
    avgBps: 16.4,
  },
  {
    username: "ape_efficient",
    avatarId: 1,
    totalCaptureUsd: 124.83,
    totalRuns: 9,
    bestSingleUsd: 35.2,
    avgBps: 21.3,
  },
  {
    username: "patient_solana",
    avatarId: 4,
    totalCaptureUsd: 89.41,
    totalRuns: 11,
    bestSingleUsd: 14.7,
    avgBps: 8.2,
  },
];

function rollupOwnHistory(
  history: HistoricalExecution[],
  username: string,
  avatarId: number,
): Omit<LeaderboardRow, "rank" | "badge"> {
  const totalCaptureUsd = history.reduce(
    (s, h) => s + h.summary.totalValueCaptureUsd,
    0,
  );
  const totalRuns = history.length;
  const bestSingleUsd = history.reduce(
    (best, h) => Math.max(best, h.summary.totalValueCaptureUsd),
    0,
  );
  const avgBps =
    history.length > 0
      ? history.reduce((s, h) => s + h.summary.totalPriceImprovementBps, 0) /
        history.length
      : 0;
  return { username, avatarId, totalCaptureUsd, totalRuns, bestSingleUsd, avgBps };
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type LeaderboardTabProps = {
  walletAddress: string | null;
};

export const LeaderboardTab: FC<LeaderboardTabProps> = ({ walletAddress }) => {
  const [history, setHistory] = useState<HistoricalExecution[]>([]);
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    setHistory(getHistory());
    const id = setInterval(() => setHistory(getHistory()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return subscribeProfiles(() => setProfileVersion((v) => v + 1));
  }, []);

  // Build the user's own row if they have any history. If not, we
  // still show the leaderboard with just the seeded community.
  const profile = walletAddress ? getProfile(walletAddress) : null;
  const ownData =
    history.length > 0
      ? rollupOwnHistory(
          history,
          profile?.username ?? "you",
          profile?.avatarId ?? 1,
        )
      : null;

  // Merge + rank by total capture descending. The user's row wins
  // ties so they see themselves prominently.
  const merged: Omit<LeaderboardRow, "rank" | "badge">[] = [
    ...(ownData ? [ownData] : []),
    ...SEED_COMMUNITY,
  ];
  merged.sort((a, b) => b.totalCaptureUsd - a.totalCaptureUsd);

  const rows: LeaderboardRow[] = merged.map((m, i) => ({
    ...m,
    rank: i + 1,
    badge:
      ownData && m.username === ownData.username && m.totalCaptureUsd === ownData.totalCaptureUsd
        ? "you"
        : "demo",
  }));

  const youRow = rows.find((r) => r.badge === "you");

  return (
    <section style={styles.root}>
      {/* Your stats summary — always renders even when history is
          empty, with zeros + a "no runs yet" hint. */}
      <div style={styles.yourCard}>
        <div style={styles.yourCardHeader}>
          <span style={styles.yourCardLabel}>Your stats</span>
          {youRow && (
            <span style={styles.yourCardRank}>#{youRow.rank}</span>
          )}
        </div>
        {ownData ? (
          <div style={styles.statsGrid}>
            <Stat label="Total capture" value={formatUsd(ownData.totalCaptureUsd)} />
            <Stat label="Runs" value={String(ownData.totalRuns)} />
            <Stat label="Best run" value={formatUsd(ownData.bestSingleUsd)} />
            <Stat label="Avg bps" value={`${ownData.avgBps.toFixed(1)} bps`} />
          </div>
        ) : (
          <div style={styles.emptyState}>
            Complete your first execution to appear on the board.
          </div>
        )}
      </div>

      {/* Community leaderboard */}
      <div style={styles.boardHeader}>
        <span style={styles.boardLabel}>Top capturers</span>
        <span style={styles.boardHint}>by total value captured</span>
      </div>
      <ol style={styles.list}>
        {rows.map((r) => (
          <li
            key={`${r.rank}-${r.username}`}
            style={{
              ...styles.row,
              background:
                r.badge === "you"
                  ? "var(--color-accent-bg-soft)"
                  : "var(--surface-card)",
              borderColor:
                r.badge === "you"
                  ? "var(--color-accent-border)"
                  : "var(--color-stroke)",
            }}
          >
            <span style={styles.rank}>#{r.rank}</span>
            <ProfileAvatar avatarId={r.avatarId} size={26} />
            <span style={styles.username}>
              {r.username}
              <span
                style={{
                  ...styles.badge,
                  color:
                    r.badge === "you"
                      ? "var(--color-success)"
                      : "var(--color-text-muted)",
                  borderColor:
                    r.badge === "you"
                      ? "rgba(34, 197, 94, 0.4)"
                      : "var(--color-stroke)",
                }}
                aria-label={r.badge === "you" ? "Your row" : "Demo data"}
              >
                {r.badge === "you" ? "you" : "demo"}
              </span>
            </span>
            <div style={styles.rowStats}>
              <span style={styles.rowCapture}>
                {formatUsd(r.totalCaptureUsd)}
              </span>
              <span style={styles.rowMeta}>
                {r.totalRuns} runs · {r.avgBps.toFixed(1)} bps avg
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div style={styles.footnote}>
        Community rows are seeded demo data — a public Supabase-backed
        leaderboard is the planned upgrade. Your row is real and updates
        as you complete runs.
      </div>
    </section>
  );
};

const Stat: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={styles.stat}>
    <span style={styles.statValue}>{value}</span>
    <span style={styles.statLabel}>{label}</span>
  </div>
);

const styles: Record<string, CSSProperties> = {
  root: {
    padding: "12px 14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  yourCard: {
    padding: "14px 16px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  yourCardHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
  },
  yourCardLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  yourCardRank: {
    marginLeft: "auto",
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--color-5-strong)",
    fontVariantNumeric: "tabular-nums",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statValue: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 18,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  emptyState: {
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    fontStyle: "italic",
  },
  boardHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "0 4px",
  },
  boardLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  boardHint: {
    fontFamily: SANS,
    fontSize: 12,
    color: "var(--color-text-muted)",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid",
    fontFamily: MONO,
  },
  rank: {
    width: 28,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  username: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    padding: "1px 6px",
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    border: "1px solid",
    borderRadius: 4,
  },
  rowStats: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 1,
    flexShrink: 0,
  },
  rowCapture: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
  },
  rowMeta: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  footnote: {
    fontFamily: SANS,
    fontSize: 12,
    color: "var(--color-text-muted)",
    fontStyle: "italic",
    lineHeight: 1.4,
    padding: "0 4px",
  },
};

export default LeaderboardTab;
