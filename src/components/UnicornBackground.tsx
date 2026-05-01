/**
 * LIMINAL — UnicornBackground
 *
 * Full-viewport animated background powered by Unicorn Studio. Mounts a
 * single `<div data-us-project="…">` and dynamically loads the Unicorn
 * Studio runtime from jsDelivr the first time any instance mounts.
 * Subsequent mounts reuse the loaded runtime (`window.UnicornStudio`)
 * and just call `init()` again — Unicorn Studio handles re-binding to
 * any new `data-us-project` divs in the DOM.
 *
 * Render rules:
 *   - Fixed-position, full-viewport, z-index 0 — sits behind every
 *     other LIMINAL surface. Cards/panels with semi-transparent
 *     surfaces (var(--surface-card) is 65% white in light theme,
 *     3% white on dark) automatically show this through.
 *   - `pointer-events: none` so the visual never intercepts clicks
 *     on the foreground UI.
 *   - Skipped under `prefers-reduced-motion: reduce`. Body keeps its
 *     palette colour (`var(--color-1)`) as the fallback so the page
 *     has a calm pastel base while/instead of the Unicorn render.
 *   - Skipped during the 3-second completion flourish? No — the
 *     CompletionFlourish overlay sits at z-index 300 and its own
 *     blurred backdrop hides whatever's underneath, so the two
 *     layers cooperate without us needing to coordinate them.
 *
 * Script loading is idempotent: a guard against double-injecting the
 * runtime (HMR, multiple instances, etc.) checks for an existing
 * `<script>` tag and reuses it. Failure to load is non-fatal — the
 * div stays empty and the body palette colour shows through.
 */

import { useEffect, useRef, type CSSProperties, type FC } from "react";

const UNICORN_SCRIPT_SRC =
  "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.11/dist/unicornStudio.umd.js";
const SCRIPT_TAG_ID = "liminal-unicorn-studio-runtime";

type UnicornStudioGlobal = {
  isInitialized?: boolean;
  init?: () => void;
};

declare global {
  interface Window {
    UnicornStudio?: UnicornStudioGlobal;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadUnicornRuntime(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();

    // Already loaded → resolve immediately. The caller will still call
    // init() so Unicorn binds to the freshly-mounted div.
    if (window.UnicornStudio?.init) return resolve();

    // Initialize the global namespace the upstream snippet expects.
    if (!window.UnicornStudio) {
      window.UnicornStudio = { isInitialized: false };
    }

    // Reuse an in-flight script tag if present (HMR, double-mount).
    const existing = document.getElementById(SCRIPT_TAG_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.UnicornStudio?.init) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("script error")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_TAG_ID;
    script.src = UNICORN_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Unicorn Studio runtime"));
    document.head.appendChild(script);
  });
}

export type UnicornBackgroundProps = {
  /** The `data-us-project` ID provided by Unicorn Studio. */
  projectId: string;
  /** Visual opacity of the background. Default 1. Useful when the
   * scene is too saturated for the surrounding UI palette. */
  opacity?: number;
  /** When true, the runtime is loaded but the visual is rendered with
   * `display: none`. Lets the parent toggle visibility without
   * dropping/recreating the canvas. */
  hidden?: boolean;
};

export const UnicornBackground: FC<UnicornBackgroundProps> = ({
  projectId,
  opacity = 1,
  hidden = false,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let cancelled = false;
    void loadUnicornRuntime()
      .then(() => {
        if (cancelled) return;
        // Defer one tick so the projectId div is definitely in the DOM
        // before init() walks the document looking for `data-us-project`
        // attributes.
        window.setTimeout(() => {
          if (!cancelled) window.UnicornStudio?.init?.();
        }, 0);
      })
      .catch(() => {
        // Silent failure — body palette colour stays visible. We don't
        // toast this because the user didn't opt into seeing the
        // animation directly; if it doesn't load, they get the calm
        // pastel base, which is also fine.
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Reduced-motion users still get the static palette base. The div is
  // returned as null so the runtime never even registers it.
  if (prefersReducedMotion()) return null;

  const style: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 0,
    pointerEvents: "none",
    overflow: "hidden",
    opacity,
    display: hidden ? "none" : undefined,
    // Smooth fade-in on first paint so the page doesn't snap from
    // body-color to full-saturation animation.
    animation: "liminal-fade-in 600ms var(--ease-out, ease)",
  };

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={style}
      // The Unicorn runtime walks the DOM for divs with this attribute
      // and replaces their content with its rendered canvas. We let it
      // own the inner DOM — no children rendered from React.
      data-us-project={projectId}
    />
  );
};

// ---------------------------------------------------------------------------
// Document-level CSS — the Unicorn runtime auto-injects a "Made with
// Unicorn Studio" anchor inside the host div. Because the runtime
// owns the host div's innerHTML, a React-side <style> child wouldn't
// survive its first re-render. We inject once at the document level
// instead. The selector is data-attribute-scoped so it can't bleed
// into anything else.
// ---------------------------------------------------------------------------

const UNICORN_HIDE_ATTRIBUTION_STYLE_ID =
  "liminal-unicorn-hide-attribution";
if (
  typeof document !== "undefined" &&
  !document.getElementById(UNICORN_HIDE_ATTRIBUTION_STYLE_ID)
) {
  const tag = document.createElement("style");
  tag.id = UNICORN_HIDE_ATTRIBUTION_STYLE_ID;
  tag.textContent = `
    [data-us-project] > a[href*="unicorn.studio"] {
      display: none !important;
    }
  `;
  document.head.appendChild(tag);
}

export default UnicornBackground;
