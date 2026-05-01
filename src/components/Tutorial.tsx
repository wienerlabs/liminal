/**
 * LIMINAL — Tutorial / coach-mark tour
 *
 * 4-step guided tour shown to first-time visitors. Each step:
 *   - Highlights a region of the page (via a CSS-only spotlight that
 *     punches a hole in the dimming overlay using a radial-gradient
 *     mask anchored to a `data-tutorial-target` selector)
 *   - Renders a small text card next to that region with title +
 *     body + Next / Skip / Back controls
 *
 * Steps
 *   1. "Welcome to LIMINAL" — points at the hero stats strip (or
 *      the LIMINAL wordmark when stats aren't on screen yet)
 *   2. "TWAP, not market" — points at the Trade card; explains why
 *      slicing the swap matters
 *   3. "Earn while you wait" — points at the Schedule card / vault
 *      preview; explains the Kamino yield while idle
 *   4. "DFlow keeps it MEV-protected" — points at the MEV badge in
 *      the header; one-line on protection layers
 *
 * Persistence: a `liminal:tutorial:seen:v1` flag in localStorage
 * suppresses the tour after first complete. There's a "Replay tour"
 * action in the command palette for users who want to revisit.
 *
 * Skipped under prefers-reduced-motion (the spotlight transition
 * uses a 220ms tween between targets) — instead, those users get a
 * static "Welcome" toast and the tour ends gracefully.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";

const STORAGE_KEY = "liminal:tutorial:seen:v1";

export type TutorialStep = {
  /** CSS selector for the element to spotlight. The component reads
   * the bounding rect at render time — no need to pre-compute. */
  selector: string;
  /** Step title (short noun phrase). */
  title: string;
  /** Body copy (1-2 sentences max). */
  body: string;
  /** Card position relative to the spotlighted region. */
  side?: "top" | "bottom" | "left" | "right";
};

const DEFAULT_STEPS: TutorialStep[] = [
  {
    selector: 'ul[aria-label="LIMINAL stats"]',
    title: "Welcome to LIMINAL",
    body: "An intelligent execution terminal for Solana — built on DFlow + Kamino + QuickNode + Solflare. The stats below show what makes us different.",
    side: "bottom",
  },
  {
    selector: '[aria-label="LIMINAL home"]',
    title: "TWAP, not market",
    body: "LIMINAL splits your trade into time-weighted slices. You get DFlow-routed MEV protection on every fill, plus systematic price improvement vs. a single Jupiter swap.",
    side: "bottom",
  },
  {
    // Best-effort: points at MevBadge if available, otherwise the wallet badge
    selector: '[aria-expanded][title*="MEV"], [aria-label*="MEV"]',
    title: "MEV-protected, every slice",
    body: "Each fill clears against committed market-maker inventory through DFlow's Jupiter Ultra RFQ pool. Sandwich and backrun attacks have no surface at the route level.",
    side: "bottom",
  },
  {
    selector: '[aria-label="Built with"]',
    title: "Built with four partners",
    body: "DFlow routes the swap, Kamino earns yield on the idle portion during the TWAP window, QuickNode powers the live data, Solflare signs every transaction.",
    side: "top",
  },
];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type TutorialProps = {
  /** When true, force-show the tour even if the seen flag is set.
   * Used by the "Replay tour" command palette action. */
  forceOpen?: boolean;
  onClose?: () => void;
  steps?: TutorialStep[];
};

export const Tutorial: FC<TutorialProps> = ({
  forceOpen = false,
  onClose,
  steps = DEFAULT_STEPS,
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const reducedMotion = useRef<boolean>(prefersReducedMotion());

  // Decide whether to mount on first render. Forced open ignores the
  // seen flag; otherwise we only show on a fresh-localStorage user.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStepIndex(0);
      return;
    }
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        // Defer the first show by a tick so the page paints first;
        // looks better than the tour popping in instantly.
        const id = setTimeout(() => setOpen(true), 700);
        return () => clearTimeout(id);
      }
    } catch {
      /* ignore — privacy mode etc. */
    }
  }, [forceOpen]);

  // Resolve the bounding rect for the current step's target, re-running
  // on resize / scroll so the spotlight stays attached.
  useLayoutEffect(() => {
    if (!open) return;
    const step = steps[stepIndex];
    if (!step) return;

    function locate(): void {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        // Scroll into view so the spotlight isn't off-screen.
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        // Defer the rect read so the smooth scroll has a chance to start
        // and we don't capture the pre-scroll rect.
        setTimeout(() => {
          if (el) setRect(el.getBoundingClientRect());
        }, 120);
      } else {
        setRect(null);
      }
    }
    locate();

    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [open, stepIndex, steps]);

  const close = (): void => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    if (onClose) onClose();
  };

  const next = (): void => {
    if (stepIndex >= steps.length - 1) {
      close();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const back = (): void => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  if (!open) return null;
  const step = steps[stepIndex];
  if (!step) return null;

  // Card position — derived from rect when available, fallback centre.
  const cardStyle: CSSProperties = {
    position: "fixed",
    zIndex: 401,
    left: rect ? Math.max(20, Math.min(window.innerWidth - 360, rect.left)) : "50%",
    top: rect
      ? step.side === "top"
        ? Math.max(20, rect.top - 140)
        : rect.bottom + 16
      : "50%",
    transform: rect ? undefined : "translate(-50%, -50%)",
    width: 340,
    maxWidth: "calc(100vw - 40px)",
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 14,
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.08)",
    padding: 18,
    transition: reducedMotion.current
      ? "none"
      : "left 220ms var(--ease-out, ease), top 220ms var(--ease-out, ease)",
  };

  // Spotlight — full-page dim with a transparent ellipse over the
  // target. Pure CSS, no SVG mask needed.
  const dimStyle: CSSProperties = rect
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 400,
        pointerEvents: "auto",
        background: `radial-gradient(ellipse ${rect.width / 2 + 20}px ${rect.height / 2 + 20}px at ${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)`,
        transition: reducedMotion.current
          ? "none"
          : "background 220ms var(--ease-out, ease)",
      }
    : {
        position: "fixed",
        inset: 0,
        zIndex: 400,
        pointerEvents: "auto",
        background: "rgba(0, 0, 0, 0.55)",
      };

  return (
    <>
      <div
        style={dimStyle}
        onClick={close}
        aria-hidden="true"
      />
      <div role="dialog" aria-label="Tutorial" style={cardStyle}>
        <div style={styles.eyebrow}>
          {`Step ${stepIndex + 1} of ${steps.length}`}
        </div>
        <h3 style={styles.title}>{step.title}</h3>
        <p style={styles.body}>{step.body}</p>
        <div style={styles.actions}>
          <button
            type="button"
            onClick={close}
            style={styles.skipButton}
            className="liminal-press"
          >
            Skip tour
          </button>
          <div style={{ flex: 1 }} />
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              style={styles.backButton}
              className="liminal-press"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            style={styles.nextButton}
            className="liminal-press"
          >
            {stepIndex >= steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
};

// Helper: clear the seen flag so the next render re-fires the tour.
export function replayTutorial(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  // Caller is responsible for re-rendering with forceOpen=true; this
  // helper just nukes the persisted flag.
}

const styles: Record<string, CSSProperties> = {
  eyebrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.1em",
    fontWeight: 700,
    textTransform: "uppercase",
    color: "var(--color-5-strong)",
    marginBottom: 6,
  },
  title: {
    fontFamily: "var(--font-sans)",
    fontWeight: 700,
    fontSize: 18,
    color: "var(--color-text)",
    margin: 0,
    marginBottom: 8,
  },
  body: {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    color: "var(--color-text-muted)",
    margin: 0,
    lineHeight: 1.5,
  },
  actions: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  skipButton: {
    padding: "6px 10px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    cursor: "pointer",
  },
  backButton: {
    padding: "6px 10px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
    background: "var(--surface-card)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 6,
    cursor: "pointer",
  },
  nextButton: {
    padding: "6px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 700,
    color: "var(--color-text-inverse)",
    background: "var(--color-text)",
    border: "1px solid var(--color-text)",
    borderRadius: 6,
    cursor: "pointer",
  },
};

export default Tutorial;
