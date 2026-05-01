/**
 * LIMINAL — Service Worker registration
 *
 * Wraps the navigator.serviceWorker.register() call with the guards
 * we need:
 *   - Skipped in dev (import.meta.env.DEV) so HMR isn't intercepted
 *   - Skipped when the browser doesn't support service workers (older
 *     Safari, file:// origin, etc.)
 *   - Logs the result via console.warn on failure but never throws —
 *     a missing offline shell is not a fatal error
 *   - Listens for `controllerchange` (new SW activated) and reloads
 *     once so users always run the freshest deploy
 *
 * The actual SW lives in `public/sw.js` so Vite copies it verbatim
 * to the build output. We don't bundle it through the JS pipeline
 * because workers are loaded by URL, not module-graph.
 */

const SW_PATH = "/sw.js";

let reloaded = false;

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  // Vite injects DEV at build time; on production builds it's false.
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
    });
    // When a new SW activates, the browser is ready to use it but the
    // current page still runs the old one. Reload exactly once so the
    // user immediately sees the new deploy.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    if (reg.waiting) {
      // A SW is already waiting on first load — likely an update from
      // a previous session. Tell it to take over now.
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  } catch (err) {
    // Don't toast / Sentry — service worker absence is benign. Just
    // a console warn so devs can see if registration fails.
    console.warn(
      `[LIMINAL/sw] register failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
