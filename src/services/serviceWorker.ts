/**
 * LIMINAL — Service Worker registration
 *
 * Disabled for hackathon submission. Previous SW versions kept caching
 * stale bundles on the production domain, masking new deploys until
 * users manually cleared storage. To prevent that footgun during demo
 * + judging, we:
 *
 *   1. No longer register a service worker.
 *   2. Actively unregister any SW that a previous visit installed.
 *   3. Clear every cache the previous SW seeded (CacheStorage entries).
 *
 * Effect: every page load fetches the freshest bundle from Vercel.
 * Slightly higher network use, much better deploy-to-user latency.
 * Re-enable after submission once the cadence settles and we want
 * offline support back.
 */

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  } catch (err) {
    console.warn(
      `[LIMINAL/sw] cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
