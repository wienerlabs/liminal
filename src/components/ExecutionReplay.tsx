/**
 * LIMINAL — ExecutionReplay
 *
 * Animated playback of a completed execution. Reconstructs the slice
 * timeline AS IF it were happening live: starts with all slices
 * pending, then "fires" them in order at scaled timestamps so the
 * user can see how the run progressed in time.
 *
 * Why this exists: a single execution is the most concrete artefact
 * the app produces, but the user sees it once when it completes and
 * then it's a static row in History. Replay lets them re-experience
 * the run — useful for explanation (sharing how DCA pacing worked),
 * for inspection (when did slice 3 hit the slippage limit?), and
 * for sheer visual delight.
 *
 * Speed control: 1× / 5× / 30× / instant. Playback is interpolation
 * over real timestamps in execution.slices[*].executedAt — no fake
 * timing, the original cadence is preserved up to the speed multiplier.
 *
 * Layout: full-bleed modal overlay (similar to ProfileSetup) with a
 * slice timeline + a running cumulative-gain ticker. Esc / backdrop
 * click dismiss.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import type {
  HistoricalExecution,
  SliceAnalytics,
} from "../services/analyticsStore";
import AnimatedNumber from "./AnimatedNumber";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

type Speed = 1 | 5 | 30 | "instant";
const SPEED_LABELS: Record<Speed, string> = {
  1: "1×",
  5: "5×",
  30: "30×",
  instant: "Instant",
};

// Tick rate for the playback clock. 60ms ≈ 16fps which is plenty for
// "advance the timeline" semantics — we're not animating individual
// glyph frames, just visibility flags.
const TICK_MS = 60;

export type ExecutionReplayProps = {
  execution: HistoricalExecution;
  onClose: () => void;
};

export const ExecutionReplay: FC<ExecutionReplayProps> = ({
  execution,
  onClose,
}) => {
  const slices = execution.slices ?? [];
  const startedAt = execution.summary.startedAt.getTime();
  const completedAt = execution.summary.completedAt.getTime();
  const totalDurationMs = Math.max(1, completedAt - startedAt);

  const [speed, setSpeed] = useState<Speed>(5);
  const [playing, setPlaying] = useState<boolean>(true);
  // playhead in milliseconds since startedAt — 0 → totalDurationMs.
  const [playhead, setPlayhead] = useState<number>(0);
  const playheadRef = useRef<number>(0);
  playheadRef.current = playhead;

  // Tick the playhead forward at TICK_MS, scaled by speed. "instant"
  // skips to the end immediately. Stops at totalDurationMs.
  useEffect(() => {
    if (!playing) return;
    if (speed === "instant") {
      setPlayhead(totalDurationMs);
      setPlaying(false);
      return;
    }
    const id = setInterval(() => {
      const next = Math.min(
        totalDurationMs,
        playheadRef.current + TICK_MS * (speed as number),
      );
      setPlayhead(next);
      if (next >= totalDurationMs) {
        setPlaying(false);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, totalDurationMs]);

  // Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Snapshot — which slices have "executed" by the current playhead?
  // Sliding window over slice executedAt timestamps relative to start.
  const snapshot = useMemo(() => {
    const now = startedAt + playhead;
    const fired: SliceAnalytics[] = [];
    const pending: SliceAnalytics[] = [];
    for (const s of slices) {
      if (s.executedAt.getTime() <= now) fired.push(s);
      else pending.push(s);
    }
    const cumulativeGain = fired.reduce(
      (sum, s) => sum + (s.priceImprovementUsd ?? 0),
      0,
    );
    const cumulativeYield = fired.reduce(
      (sum, s) => sum + (s.kaminoYieldUsd ?? 0),
      0,
    );
    return { fired, pending, cumulativeGain, cumulativeYield };
  }, [slices, startedAt, playhead]);

  const progressPct = (playhead / totalDurationMs) * 100;
  const isComplete = playhead >= totalDurationMs;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Execution replay"
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.eyebrow}>Replay</span>
            <h2 style={styles.title}>
              {execution.inputSymbol} → {execution.outputSymbol}
            </h2>
            <p style={styles.subtitle}>
              {execution.summary.completedSlices} slices ·{" "}
              {formatDuration(totalDurationMs)} ·{" "}
              {execution.createdAt.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close replay"
          >
            ×
          </button>
        </header>

        {/* Cumulative ticker — animated as the playhead advances */}
        <div style={styles.tickers}>
          <div style={styles.ticker}>
            <span style={styles.tickerLabel}>vs. Jupiter</span>
            <AnimatedNumber
              value={snapshot.cumulativeGain}
              prefix="$"
              decimals={2}
              duration={250}
            />
          </div>
          <div style={styles.ticker}>
            <span style={styles.tickerLabel}>+ Kamino yield</span>
            <AnimatedNumber
              value={snapshot.cumulativeYield}
              prefix="$"
              decimals={2}
              duration={250}
            />
          </div>
          <div style={styles.ticker}>
            <span style={styles.tickerLabel}>Slices fired</span>
            <span style={styles.tickerValue}>
              {snapshot.fired.length} / {slices.length}
            </span>
          </div>
        </div>

        {/* Scrubber bar — visual progress + draggable playhead */}
        <div
          style={styles.scrubberWrap}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / rect.width),
            );
            setPlayhead(Math.floor(ratio * totalDurationMs));
            setPlaying(false);
          }}
          aria-label="Timeline scrubber"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.floor(totalDurationMs / 1000)}
          aria-valuenow={Math.floor(playhead / 1000)}
        >
          <div style={styles.scrubberTrack}>
            <div
              style={{
                ...styles.scrubberFill,
                width: `${progressPct}%`,
              }}
            />
            {/* Slice markers on the track */}
            {slices.map((s) => {
              const offsetMs = s.executedAt.getTime() - startedAt;
              const pct = (offsetMs / totalDurationMs) * 100;
              const fired = s.executedAt.getTime() <= startedAt + playhead;
              return (
                <span
                  key={s.sliceIndex}
                  aria-hidden="true"
                  style={{
                    ...styles.sliceMarker,
                    left: `${pct}%`,
                    background: fired
                      ? "var(--color-success)"
                      : "var(--color-stroke)",
                  }}
                />
              );
            })}
          </div>
          <div style={styles.scrubberMeta}>
            <span>{formatDuration(playhead)}</span>
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
        </div>

        {/* Slice list — fired slices show metrics, pending ones grey */}
        <ul style={styles.sliceList}>
          {slices.map((s) => {
            const fired = s.executedAt.getTime() <= startedAt + playhead;
            return (
              <li
                key={s.sliceIndex}
                style={{
                  ...styles.sliceRow,
                  opacity: fired ? 1 : 0.45,
                  background: fired
                    ? "var(--surface-card)"
                    : "transparent",
                }}
              >
                <span style={styles.sliceIndex}>#{s.sliceIndex + 1}</span>
                <span style={styles.sliceTime}>
                  {fired ? formatTimestamp(s.executedAt) : "—"}
                </span>
                <span style={styles.sliceAmount}>
                  {fired
                    ? `${s.inputAmount.toFixed(4)} ${execution.inputSymbol}`
                    : "pending"}
                </span>
                {fired && (
                  <span
                    style={{
                      ...styles.sliceGain,
                      color:
                        s.priceImprovementUsd >= 0
                          ? "var(--color-success)"
                          : "var(--color-warn)",
                    }}
                  >
                    {s.priceImprovementUsd >= 0 ? "+" : ""}
                    {s.priceImprovementUsd.toFixed(2)} USD
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Playback controls */}
        <footer style={styles.controls}>
          <button
            type="button"
            onClick={() => {
              if (isComplete) {
                setPlayhead(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
            style={styles.playButton}
            className="liminal-press"
            aria-label={
              isComplete ? "Replay" : playing ? "Pause" : "Resume"
            }
          >
            {isComplete ? "↻ Replay" : playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <div style={styles.speedGroup} role="radiogroup" aria-label="Playback speed">
            {(Object.keys(SPEED_LABELS) as Array<keyof typeof SPEED_LABELS>).map(
              (k) => {
                const numericKey = (
                  k === "instant" ? "instant" : (Number(k) as Speed)
                ) as Speed;
                const isActive = speed === numericKey;
                return (
                  <button
                    key={String(k)}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => {
                      setSpeed(numericKey);
                      if (numericKey !== "instant") setPlaying(true);
                    }}
                    style={{
                      ...styles.speedButton,
                      background: isActive
                        ? "var(--color-text)"
                        : "transparent",
                      color: isActive
                        ? "var(--color-text-inverse)"
                        : "var(--color-text-muted)",
                      borderColor: isActive
                        ? "var(--color-text)"
                        : "var(--color-stroke)",
                    }}
                  >
                    {SPEED_LABELS[numericKey]}
                  </button>
                );
              },
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatTimestamp(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 250,
    background: "rgba(0, 0, 0, 0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    animation: "liminal-fade-in 200ms var(--ease-out, ease)",
  },
  card: {
    width: "100%",
    maxWidth: 720,
    maxHeight: "calc(100vh - 40px)",
    overflow: "auto",
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 16,
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "0 28px 64px rgba(0, 0, 0, 0.18)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    color: "var(--color-5-strong)",
    letterSpacing: "0.1em",
  },
  title: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 22,
    color: "var(--color-text)",
    margin: "4px 0 2px 0",
  },
  subtitle: {
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    margin: 0,
  },
  closeButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: 8,
    background: "transparent",
    border: "1px solid var(--color-stroke)",
    color: "var(--color-text-muted)",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
  },
  tickers: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },
  ticker: {
    padding: "10px 12px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  tickerLabel: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    letterSpacing: "0.04em",
  },
  tickerValue: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: 700,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
  },
  scrubberWrap: {
    cursor: "pointer",
    padding: "8px 0",
  },
  scrubberTrack: {
    position: "relative",
    height: 6,
    background: "var(--color-stroke)",
    borderRadius: 3,
  },
  scrubberFill: {
    height: 6,
    background: "linear-gradient(90deg, var(--color-5), var(--color-4))",
    borderRadius: 3,
    transition: "width 60ms linear",
  },
  sliceMarker: {
    position: "absolute",
    top: -2,
    width: 10,
    height: 10,
    borderRadius: "50%",
    transform: "translateX(-5px)",
    border: "2px solid var(--surface-raised)",
    transition: "background 200ms var(--ease-out, ease)",
  },
  scrubberMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    marginTop: 6,
    fontVariantNumeric: "tabular-nums",
  },
  sliceList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 240,
    overflowY: "auto",
  },
  sliceRow: {
    display: "grid",
    gridTemplateColumns: "40px 90px 1fr auto",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    fontFamily: MONO,
    fontSize: 12,
    transition:
      "opacity 200ms var(--ease-out, ease), background 200ms var(--ease-out, ease)",
  },
  sliceIndex: {
    fontWeight: 700,
    color: "var(--color-text-muted)",
  },
  sliceTime: {
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  sliceAmount: {
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sliceGain: {
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingTop: 14,
    borderTop: "1px solid var(--color-stroke)",
    marginTop: 4,
  },
  playButton: {
    padding: "10px 18px",
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 700,
    color: "#ffffff",
    background: "var(--color-text)",
    border: "1px solid var(--color-text)",
    borderRadius: 10,
    cursor: "pointer",
  },
  speedGroup: {
    display: "inline-flex",
    gap: 4,
    marginLeft: "auto",
  },
  speedButton: {
    padding: "6px 12px",
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid",
    borderRadius: 6,
    cursor: "pointer",
    transition:
      "background var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out)",
  },
};

export default ExecutionReplay;
