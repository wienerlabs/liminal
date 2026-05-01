/**
 * LIMINAL — Service Worker
 *
 * Conservative offline shell:
 *   - Pre-caches the app shell on install (HTML + main bundle hash
 *     URLs are cache-busted so we let the browser HTTP cache + the
 *     client-side bundle splitter handle long-term caching).
 *   - For navigations: try network first (fresh deploys propagate
 *     immediately) → fall back to cached shell on offline.
 *   - For static assets: stale-while-revalidate (instant load from
 *     cache, background refresh).
 *   - Skip caching for cross-origin requests (RPCs, Pyth, jsDelivr
 *     unicorn runtime, Jupiter tokens) — those are inherently online.
 *
 * Why no third-party PWA library: workbox is overkill for what we
 * actually need (offline shell + light cache). 80 lines of vanilla
 * service-worker code keep the audit surface small.
 *
 * Versioning: bump CACHE_VERSION on any change to this file. Old
 * caches are wiped on activate().
 */

const CACHE_VERSION = "liminal-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const SHELL_URLS = [
  "/",
  "/index.html",
  "/logo.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Delete every cache whose key doesn't start with the current
      // version prefix. Keeps both shell + static for the new version.
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests — POST/PATCH go straight to the network
  // (no point caching mutations).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip cross-origin requests entirely. Solana RPC, Pyth, Jupiter
  // search, jsDelivr (unicorn / fonts) all need to round-trip.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fall back to cached shell.
  // This lets fresh deploys propagate immediately (HTML always pulled
  // online when possible) while staying functional offline.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Static assets (anything from /assets/* or /fonts/*): stale-while-
  // revalidate. Cached response served instantly; cache updated in
  // the background.
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg")
  ) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    // Stash the latest HTML so offline still works.
    const cache = await caches.open(SHELL_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/index.html");
    if (cached) return cached;
    // Last resort — opaque offline response.
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      // Only cache 200 OK responses.
      if (res && res.status === 200) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);
  return cached || networkPromise || fetch(req);
}
