/**
 * LIMINAL — Solflare Deep Link Helper
 *
 * BLOK 6 "Deep Linking" spesifikasyonu: mobile kullanıcılar için
 * `solflare://browse?url=<liminal>` URL'si. Solflare uygulaması in-app
 * browser'ında hedef URL'yi açar, bu sayede Solflare cüzdan zaten
 * bağlıdır ve kullanıcı ikinci kez connect yapmaz.
 *
 * Level 2 kapsamında iki senaryoda kullanılır:
 *   1. Onboarding: desktop'ta QR kod / mobile'da butona dönüşür ("Open
 *      in Solflare app"). Kullanıcı mobile Solflare'de execution'ı
 *      başlatır.
 *   2. Notification → deep link: slice hazır notification'ına
 *      tıklandığında execution ekranına direkt yönlenir.
 */

const SOLFLARE_DEEPLINK_SCHEME = "solflare://";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Solflare deep link that opens `url` inside the Solflare app's
 * in-app browser. Uses `encodeURIComponent` on the destination to
 * preserve query strings and fragment identifiers.
 *
 * Returns the full deep link, e.g. `solflare://browse?url=https%3A%2F%2Fliminaltwap.com`.
 */
export function buildSolflareBrowseLink(url: string): string {
  if (!url) {
    throw new Error("solflareDeepLink: `url` is required.");
  }
  return `${SOLFLARE_DEEPLINK_SCHEME}browse?url=${encodeURIComponent(url)}`;
}

/**
 * Convenience: current-page-as-deep-link. Reads `window.location.href`
 * and wraps it; useful for the "Open in Solflare" button that lets a
 * desktop user continue an execution on mobile.
 */
export function buildDeepLinkToCurrentPage(): string | null {
  if (typeof window === "undefined") return null;
  const href = window.location?.href;
  if (!href) return null;
  return buildSolflareBrowseLink(href);
}

/**
 * Heuristic detection for whether we're running inside Solflare's
 * in-app browser. The app sets `window.solflare` early (before any
 * LIMINAL code runs) and also modifies the User-Agent. Neither is a
 * hard contract so we combine both signals.
 */
export function isInSolflareInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const hasProvider = !!window.solflare?.isSolflare;
  const uaHint =
    typeof navigator !== "undefined" &&
    /Solflare/i.test(navigator.userAgent ?? "");
  return hasProvider && uaHint;
}
