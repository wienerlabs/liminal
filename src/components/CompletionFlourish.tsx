/**
 * LIMINAL — CompletionFlourish
 *
 * Full-screen ASCII flourish that pops over the app for 3 seconds when
 * an execution transitions to DONE. It's the emotional peak — the
 * confetti already fires from AnalyticsPanel, and the existing
 * ExecutionSummaryCard renders the metrics; this overlay is the
 * "wow, look what happened" frame between them.
 *
 * Behaviour:
 *   - Auto-dismisses after `durationMs` (default 3000 ms)
 *   - Click anywhere to dismiss early
 *   - Esc dismisses (kept reachable for accessibility)
 *   - Renders nothing when `visible === false`; the parent decides when
 *     to mount/unmount based on the execution state machine.
 *   - Skips rendering entirely when `prefers-reduced-motion: reduce`
 *     is set — three.js + a wave shader is exactly what RM users
 *     opt out of. The metrics summary still fires from elsewhere.
 *
 * The text shown is a short word that maps to LIMINAL's brand
 * vocabulary: "CAPTURED" (default — refers to value capture), or any
 * caller-provided string. Single short word reads best on the warped
 * ASCII plane; multi-word text gets squished.
 */

import { useEffect, useRef, type FC } from "react";
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

export const CompletionFlourish: FC<CompletionFlourishProps> = ({
  visible,
  text = "CAPTURED",
  durationMs = 3000,
  onDismiss,
}) => {
  const dismissedRef = useRef(false);

  // Auto-dismiss timer — set when the overlay becomes visible, cleared
  // on unmount/visibility change. Guarded by `dismissedRef` so an
  // early click + the timer don't both fire onDismiss.
  useEffect(() => {
    if (!visible) {
      dismissedRef.current = false;
      return;
    }
    if (prefersReducedMotion()) {
      // Skip the 3D/ASCII flourish entirely under reduced-motion. The
      // confetti + summary card still fire elsewhere, so the user
      // doesn't lose the completion signal.
      onDismiss();
      return;
    }
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
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background:
          "radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.85) 100%)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        cursor: "pointer",
        animation: "liminal-fade-in 200ms var(--ease-out, ease)",
        // Container needs to be position:relative so the absolutely-
        // positioned ASCIIText element fills it.
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ASCIIText
          text={text}
          asciiFontSize={9}
          textFontSize={220}
          planeBaseHeight={9}
          enableWaves
        />
      </div>
      {/* Dismiss hint — small kbd-style label at the bottom so the
          user knows it'll go away on its own. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 32,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--color-text-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          mixBlendMode: "difference",
          opacity: 0.7,
        }}
      >
        Click anywhere to dismiss · auto-closes in 3s
      </div>
    </div>
  );
};

// Dark-theme overlay tweak — use a darker tinted backdrop so the
// ASCII glyphs read against the body instead of fighting a near-white
// scrim. Applied via a sibling <style> tag baked into the design
// system would also work, but inline here keeps the component
// self-contained.
const STYLE_INJECTED_KEY = "liminal-completion-flourish-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_INJECTED_KEY)) {
  const tag = document.createElement("style");
  tag.id = STYLE_INJECTED_KEY;
  tag.textContent = `
    :root[data-theme="dark"] [aria-label^="Execution complete"] {
      background: radial-gradient(circle at 50% 50%, rgba(10, 10, 10, 0.55) 0%, rgba(10, 10, 10, 0.85) 100%) !important;
    }
  `;
  document.head.appendChild(tag);
}

export default CompletionFlourish;
