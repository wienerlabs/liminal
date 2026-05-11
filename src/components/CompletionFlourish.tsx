/**
 * LIMINAL — CompletionFlourish
 *
 * Compact centered card that pops over the app for 3 seconds when an
 * execution transitions to DONE. The emotional peak — confetti from
 * canvas-confetti bursts on mount, ASCII "CAPTURED" warps inside the
 * card, the rest of the page stays softly visible behind a light
 * scrim. ExecutionSummaryCard renders the metrics elsewhere; this
 * overlay is the celebration frame between fill confirmation and
 * the metrics readout.
 *
 * Behaviour:
 *   - Auto-dismisses after `durationMs` (default 3000 ms)
 *   - Click on the scrim / card dismisses early
 *   - Esc dismisses (keyboard accessibility)
 *   - Renders nothing when `visible === false`; the parent decides
 *     when to mount/unmount based on the execution state machine
 *   - Skips entirely under `prefers-reduced-motion: reduce` —
 *     three.js wave shader + confetti are exactly what RM users
 *     opt out of. Summary metrics still fire from elsewhere.
 *
 * Visual updates (PR #5n):
 *   - Was a full-bleed overlay → now a 540×340 centered card so
 *     the rest of the page stays partly visible
 *   - canvas-confetti bursts on mount (LIMINAL pastel palette,
 *     two staggered cones from card edges)
 *
 * The text is a short brand-vocab word: "CAPTURED" (default — refers
 * to value capture). Single short word reads best on the warped
 * ASCII plane; multi-word strings get squished.
 */

import { useEffect, useRef, type CSSProperties, type FC } from "react";
import ASCIIText from "./ASCIIText";

export type CompletionFlourishProps = {
  visible: boolean;
  text?: string;
  durationMs?: number;
  /** Caller invokes this when the overlay self-dismisses or the user
   * clicks/presses Escape. Parent should set its own visibility flag
   * to false in response. */
  onDismiss: () => void;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Two-burst confetti — first cone from the left card edge, second
// from the right after a short stagger. Pastel palette matches
// LIMINAL design tokens (pink / sky / mint / yellow / deeper pink).
// canvas-confetti is already a dependency (vendor-confetti chunk
// bundled by AnalyticsPanel) so this adds zero KB to the build.
async function fireConfetti(): Promise<void> {
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    const palette = [
      "#f9b2d7", // LIMINAL pink
      "#cfecf3", // sky
      "#daf9de", // mint
      "#f6ffdc", // yellow
      "#f48cc4", // deeper pink
    ];
    // Left cone — angled toward the centre-up.
    confetti({
      particleCount: 90,
      spread: 60,
      angle: 60,
      origin: { x: 0.25, y: 0.7 },
      colors: palette,
      zIndex: 301,
      ticks: 220,
      scalar: 0.9,
    });
    // Right cone — symmetric, fired a tick later for that "pop pop"
    // double-tap rhythm.
    setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 60,
        angle: 120,
        origin: { x: 0.75, y: 0.7 },
        colors: palette,
        zIndex: 301,
        ticks: 220,
        scalar: 0.9,
      });
    }, 180);
    // Centre burst — fills the card area with smaller, more numerous
    // confetti for that "yeah we did it" feel.
    setTimeout(() => {
      confetti({
        particleCount: 60,
        spread: 100,
        startVelocity: 30,
        origin: { x: 0.5, y: 0.5 },
        colors: palette,
        zIndex: 301,
        ticks: 200,
        scalar: 0.7,
      });
    }, 380);
  } catch {
    /* canvas-confetti load failure is silent — flourish still works */
  }
}

export const CompletionFlourish: FC<CompletionFlourishProps> = ({
  visible,
  text = "CAPTURED",
  durationMs = 3000,
  onDismiss,
}) => {
  const dismissedRef = useRef(false);

  // Auto-dismiss timer + confetti fire. Guarded by `dismissedRef` so
  // an early click + the timer don't both fire onDismiss.
  useEffect(() => {
    if (!visible) {
      dismissedRef.current = false;
      return;
    }
    if (prefersReducedMotion()) {
      // Skip the 3D/ASCII/confetti entirely under reduced-motion. The
      // metrics summary still fires elsewhere, so the user doesn't
      // lose the completion signal.
      onDismiss();
      return;
    }
    void fireConfetti();
    const id = setTimeout(() => {
      if (!dismissedRef.current) {
        dismissedRef.current = true;
        onDismiss();
      }
    }, durationMs);
    return () => clearTimeout(id);
  }, [visible, durationMs, onDismiss]);

  // Esc handling.
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !dismissedRef.current) {
        dismissedRef.current = true;
        onDismiss();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Execution complete — ${text}`}
      onClick={() => {
        if (!dismissedRef.current) {
          dismissedRef.current = true;
          onDismiss();
        }
      }}
      style={styles.scrim}
    >
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* ASCII flourish fills the card — uses absolute positioning
            inherited from ASCIIText's container styles. */}
        <div style={styles.asciiWrap}>
          <ASCIIText
            text={text}
            asciiFontSize={6}
            textFontSize={140}
            planeBaseHeight={6}
            enableWaves
          />
        </div>
        {/* Bottom hint — kbd-style label sitting under the ASCII */}
        <div aria-hidden="true" style={styles.hint}>
          Click anywhere to dismiss · auto-closes in 3s
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    zIndex: 300,
    // Lighter scrim than the previous full-bleed overlay — page
    // content stays softly visible behind so the celebration reads
    // as an accent over the existing context, not a takeover.
    background: "rgba(255, 255, 255, 0.4)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    animation: "liminal-fade-in 200ms var(--ease-out, ease)",
    padding: 20,
  },
  card: {
    position: "relative",
    width: "min(540px, calc(100vw - 40px))",
    height: "min(340px, calc(100vh - 40px))",
    borderRadius: 24,
    overflow: "hidden",
    background:
      "linear-gradient(135deg, rgba(249, 178, 215, 0.18) 0%, rgba(207, 236, 243, 0.18) 50%, rgba(218, 249, 222, 0.18) 100%), rgba(255, 255, 255, 0.85)",
    backdropFilter: "blur(20px) saturate(140%)",
    WebkitBackdropFilter: "blur(20px) saturate(140%)",
    border: "1px solid var(--color-stroke)",
    boxShadow:
      "0 24px 60px rgba(26, 26, 26, 0.18), 0 8px 24px rgba(249, 178, 215, 0.22)",
    cursor: "default",
    animation:
      "liminal-flourish-pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
  },
  asciiWrap: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    position: "absolute",
    bottom: 18,
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--color-text-muted)",
    letterSpacing: "0.12em",
    opacity: 0.7,
  },
};

// Document-level CSS — dark-theme variants + the pop-in keyframe for
// the card. We inject once at document level so:
//   1. the dark-theme override survives any future style recalc
//   2. the keyframe is reachable from the inline `animation:` value
//   3. the styles can't bleed into anything else (selectors are
//      data-attribute / aria-label scoped).
const STYLE_INJECTED_KEY = "liminal-completion-flourish-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_INJECTED_KEY)) {
  const tag = document.createElement("style");
  tag.id = STYLE_INJECTED_KEY;
  tag.textContent = `
    @keyframes liminal-flourish-pop {
      0%   { opacity: 0; transform: scale(0.86) translateY(8px); }
      60%  { opacity: 1; transform: scale(1.02) translateY(-2px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      [aria-label^="Execution complete"] > * {
        animation: none !important;
      }
    }
    :root[data-theme="dark"] [aria-label^="Execution complete"] {
      background: rgba(10, 10, 10, 0.4) !important;
    }
    :root[data-theme="dark"] [aria-label^="Execution complete"] > div {
      background:
        linear-gradient(135deg, rgba(244, 140, 196, 0.14) 0%, rgba(207, 236, 243, 0.10) 50%, rgba(218, 249, 222, 0.10) 100%),
        rgba(20, 20, 20, 0.85) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
    }
  `;
  document.head.appendChild(tag);
}

export default CompletionFlourish;
