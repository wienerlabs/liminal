/**
 * LIMINAL — TwapLoadingState
 *
 * Multi-phase loading view rendered during the heavy "between-state"
 * moments of an execution: PREPARING (autopilot pre-sign building),
 * DEPOSITING (Kamino deposit broadcast → confirmation), and the final
 * Kamino withdraw at completion. Adapted from the kokonutui AILoadingState
 * pattern but retuned for LIMINAL:
 *
 *   - Multi-ring SVG progress indicator using LIMINAL's pastel palette
 *     (pink → sky → mint → yellow rings, no neon green/orange)
 *   - Circles share a central progress mask so they only render along
 *     the arc proportional to the current phase progress
 *   - Scrolling task lines: each phase has a hand-written list of
 *     micro-states; lines advance every 2s, scrolling upward with a
 *     gradient fade so the visual rhythm is "something is happening,
 *     specifically these things"
 *   - Pure CSS animations (no Framer Motion). Counter-rotating rings
 *     via inline @keyframes the component injects once on mount.
 *
 * Phases are consumer-controlled — pass an active `phase` index that
 * matches one of the entries in `phases`. Each phase has a status
 * label (rendered next to the rings) and a list of `lines` that
 * scroll upward inside the code-style box underneath.
 */

import { useEffect, useRef, useState, type CSSProperties, type FC } from "react";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

export type TwapLoadingPhase = {
  /** Header label shown next to the rings ("Preparing autopilot plan…"). */
  status: string;
  /** Internal micro-states the user sees scrolling underneath. */
  lines: string[];
};

export type TwapLoadingStateProps = {
  phases: TwapLoadingPhase[];
  /** Index into `phases`. The component still scrolls lines within the
   * active phase even when `phaseIndex` doesn't change — only when the
   * line cursor wraps does the component request the next phase by
   * calling `onPhaseAdvance`. */
  phaseIndex: number;
  onPhaseAdvance?: () => void;
  className?: string;
  style?: CSSProperties;
};

const LINE_HEIGHT = 28;
const VISIBLE_LINES = 3;
const ADVANCE_MS = 2000;

export const TwapLoadingState: FC<TwapLoadingStateProps> = ({
  phases,
  phaseIndex,
  onPhaseAdvance,
  className,
  style,
}) => {
  const phase = phases[Math.max(0, Math.min(phaseIndex, phases.length - 1))];
  const totalLines = phase.lines.length;

  // Reset visible window on phase change.
  const [visible, setVisible] = useState<{ text: string; n: number }[]>(() =>
    phase.lines
      .slice(0, Math.min(VISIBLE_LINES + 2, totalLines))
      .map((text, i) => ({ text, n: i + 1 })),
  );
  const [scroll, setScroll] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisible(
      phase.lines
        .slice(0, Math.min(VISIBLE_LINES + 2, totalLines))
        .map((text, i) => ({ text, n: i + 1 })),
    );
    setScroll(0);
  }, [phaseIndex, phase.lines, totalLines]);

  useEffect(() => {
    const id = setInterval(() => {
      const firstLineIdx = Math.floor(scroll / LINE_HEIGHT);
      const nextLineIdx = (firstLineIdx + VISIBLE_LINES) % totalLines;

      // Wrap-around → ask consumer to advance to next phase.
      if (nextLineIdx < firstLineIdx && nextLineIdx !== 0) {
        if (onPhaseAdvance) onPhaseAdvance();
        return;
      }

      if (nextLineIdx >= visible.length && nextLineIdx < totalLines) {
        setVisible((prev) => [
          ...prev,
          { text: phase.lines[nextLineIdx], n: nextLineIdx + 1 },
        ]);
      }
      setScroll((p) => p + LINE_HEIGHT);
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [scroll, visible.length, totalLines, phase.lines, onPhaseAdvance]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = scroll;
  }, [scroll]);

  // Progress through phases for the masked rings — 0 at start of first
  // phase, 1 at end of last. Within a phase we interpolate by line idx.
  const linesInPhase = totalLines;
  const lineCursor = Math.floor(scroll / LINE_HEIGHT);
  const phaseProgress = Math.min(1, lineCursor / linesInPhase);
  const overallProgress =
    phases.length > 0
      ? Math.min(1, (phaseIndex + phaseProgress) / phases.length)
      : 0;

  return (
    <div className={className} style={{ ...styles.root, ...style }}>
      <div style={styles.statusRow}>
        <RingsIndicator progress={overallProgress} />
        <span style={styles.statusText}>{phase.status}…</span>
      </div>
      <div style={styles.codePane}>
        <div
          ref={containerRef}
          style={styles.codeScroll}
          aria-hidden="true"
        >
          {visible.map((line) => (
            <div style={styles.codeRow} key={`${line.n}-${line.text}`}>
              <span style={styles.codeLineNo}>{line.n}</span>
              <span style={styles.codeText}>{line.text}</span>
            </div>
          ))}
        </div>
        <div style={styles.codeFade} aria-hidden="true" />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Multi-ring SVG progress indicator
// ---------------------------------------------------------------------------

const RingsIndicator: FC<{ progress: number }> = ({ progress }) => {
  const stroke = 16;
  const ringRadii = [150, 130, 110, 90, 70, 50];
  // Pastel LIMINAL palette — pink hot inside, mint/sky pastel outside.
  // Outer rings are the "background" tones; inner rings are the
  // hot-colored progress accent.
  const ringColors = [
    "var(--color-5)",       // pink
    "var(--color-4)",       // sky
    "var(--color-3)",       // mint
    "var(--color-1)",       // yellow
    "var(--color-5-strong)",// deeper pink
    "var(--color-4)",       // sky again for innermost
  ];

  // Mask: a single circle sweep proportional to `progress` (0..1) so
  // every ring only renders along the same proportion of its arc.
  const sweep = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ position: "relative", width: 28, height: 28 }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 240 240"
        aria-label={`Loading ${Math.round(sweep * 100)}%`}
      >
        <defs>
          <mask id="liminal-twap-progress-mask">
            <rect width="240" height="240" fill="black" />
            <circle
              cx="120"
              cy="120"
              r="120"
              fill="white"
              transform="rotate(-90 120 120)"
              strokeDasharray={`${sweep * 754}, 754`}
            />
          </mask>
        </defs>
        <g
          mask="url(#liminal-twap-progress-mask)"
          strokeDasharray="18% 40%"
          strokeWidth={stroke}
          fill="none"
          style={{ transformOrigin: "120px 120px" }}
        >
          {ringRadii.map((r, i) => (
            <circle
              key={r}
              cx="120"
              cy="120"
              r={r}
              stroke={ringColors[i]}
              opacity={0.95}
              style={{
                animation: `liminal-twap-ring-${i % 2 === 0 ? "cw" : "ccw"} 8s linear infinite`,
                animationDelay: `${(i % 3) * 0.1}s`,
                transformOrigin: "120px 120px",
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 14px",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 12,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontFamily: SANS,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  statusText: {
    fontSize: 14,
    letterSpacing: 0,
  },
  codePane: {
    position: "relative",
    height: LINE_HEIGHT * VISIBLE_LINES,
    overflow: "hidden",
    borderRadius: 8,
    background: "var(--surface-input)",
    border: "1px solid var(--color-stroke)",
  },
  codeScroll: {
    height: "100%",
    overflow: "hidden",
    scrollBehavior: "smooth",
  },
  codeRow: {
    display: "flex",
    alignItems: "center",
    height: LINE_HEIGHT,
    padding: "0 10px",
    fontFamily: MONO,
    fontSize: 12,
  },
  codeLineNo: {
    width: 24,
    textAlign: "right",
    paddingRight: 10,
    color: "var(--color-text-subtle)",
    userSelect: "none",
    fontVariantNumeric: "tabular-nums",
  },
  codeText: {
    color: "var(--color-text)",
    flex: 1,
  },
  codeFade: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
      "linear-gradient(to bottom, var(--surface-input) 0%, transparent 30%, transparent 70%, var(--surface-input) 100%)",
  },
};

export default TwapLoadingState;
