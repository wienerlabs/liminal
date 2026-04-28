/**
 * LIMINAL — Browser Notification Service (Level 2)
 *
 * Autopilot modunda tek kullanıcı etkileşim noktası: her slice'ın JIT
 * swap popup'ı. Bu modül o popup'ın önüne geçip **browser notification**
 * + **document title flash** + **favicon badge** ile kullanıcıyı
 * arka plandan geri çağırır. Böylece user tabı kapalı değilken başka
 * sekmede / başka uygulamada çalışabilir, sadece slice hazır olunca
 * tetiklenir.
 *
 * Tasarım kuralları:
 *   - Tüm API'ler **tab açık + JS çalışıyor** varsayımına dayanır.
 *     CLAUDE.md BLOK 5'teki "tab kapatılırsa execution duraklar" kararı
 *     hâlâ geçerli — bu modül sekmeyi tutuyor değil, uyarı katmanıdır.
 *   - Sessiz başarısızlık: Notification permission reddedilmişse
 *     veya API yoksa sadece title flash + favicon badge çalışır.
 *     Asla throw atmaz, execution akışını durdurmaz.
 *   - SSR güvenli: `typeof window !== "undefined"` her kritik yerde
 *     kontrol edilir.
 *
 * Tetiklenme noktaları (executionMachine.executePreSignedSlice):
 *   - Slice zamanı gelip JIT swap popup'ı açılmadan hemen önce.
 *   - Execution DONE olduğunda (cleanup popup öncesi).
 *   - ERROR state'ine geçildiğinde (user müdahalesi gerekli).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPermission = "default" | "granted" | "denied";

export type NotifyOptions = {
  /** Notification body — kısa ve actionable. */
  body: string;
  /** Notification click handler (typically focuses the tab). */
  onClick?: () => void;
  /** Icon URL — default: /logo.png */
  icon?: string;
  /**
   * Same-tag notifications replace each other. Slice notifications use
   * "liminal-slice" tag so N slices don't spam N popup stacks.
   */
  tag?: string;
  /**
   * If true, the browser keeps the notification visible until user
   * action. Slice-ready notifications use this — users shouldn't miss
   * the prompt because they were AFK for 20 seconds.
   */
  requireInteraction?: boolean;
};

// ---------------------------------------------------------------------------
// Permission lifecycle
// ---------------------------------------------------------------------------

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return "denied";
  return window.Notification.permission as NotificationPermission;
}

/**
 * Prompt the user for notification permission. Returns the resulting
 * state. Safe to call multiple times — if already granted/denied the
 * browser just returns the cached result without a second prompt.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  try {
    const result = await window.Notification.requestPermission();
    return result as NotificationPermission;
  } catch {
    // Older browsers used the callback form; fall back.
    return getNotificationPermission();
  }
}

// ---------------------------------------------------------------------------
// Title flasher — falls back to this if notifications are denied
// ---------------------------------------------------------------------------

let originalTitle: string | null = null;
let flashInterval: ReturnType<typeof setInterval> | null = null;
// BUG FIX: keep references to the active listeners so subsequent
// startTitleFlash() calls (e.g. multi-slice TWAP) reuse / replace
// instead of accumulating. Without this, every slice ready signal
// adds another (focus, visibilitychange) pair that all fire when the
// user finally returns to the tab — momentary listener pile-up that
// runs stopTitleFlash N times.
let activeFocusHandler: (() => void) | null = null;
let activeVisibilityHandler: (() => void) | null = null;

function detachFocusHandlers(): void {
  if (typeof window !== "undefined" && activeFocusHandler) {
    window.removeEventListener("focus", activeFocusHandler);
  }
  if (typeof document !== "undefined" && activeVisibilityHandler) {
    document.removeEventListener("visibilitychange", activeVisibilityHandler);
  }
  activeFocusHandler = null;
  activeVisibilityHandler = null;
}

/**
 * Flashes the document title between original and `alert` until the
 * user focuses the tab. Visual reinforcement for the notification —
 * also the ONLY signal if Notification permission is denied.
 */
export function startTitleFlash(alertLabel: string): void {
  if (typeof document === "undefined") return;
  if (originalTitle === null) originalTitle = document.title;
  // Clears interval AND any prior listeners so we never accumulate.
  stopTitleFlash();

  let showAlert = true;
  flashInterval = setInterval(() => {
    document.title = showAlert ? `🔔 ${alertLabel}` : (originalTitle ?? "LIMINAL");
    showAlert = !showAlert;
  }, 1000);

  // Auto-stop when the user focuses the tab — primary signal they saw
  // the alert.
  activeFocusHandler = () => {
    stopTitleFlash();
  };
  activeVisibilityHandler = () => {
    if (document.visibilityState === "visible") {
      stopTitleFlash();
    }
  };
  window.addEventListener("focus", activeFocusHandler);
  document.addEventListener("visibilitychange", activeVisibilityHandler);
}

export function stopTitleFlash(): void {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  detachFocusHandlers();
  if (typeof document !== "undefined" && originalTitle !== null) {
    document.title = originalTitle;
  }
}

// ---------------------------------------------------------------------------
// Main notify entry point — used by executionMachine
// ---------------------------------------------------------------------------

/**
 * Fire a notification + title flash + favicon badge. Silent if permission
 * is denied or API unavailable — title flash still fires as a fallback.
 *
 * Only attempts the native Notification when the document is NOT
 * currently focused. If the user is actively looking at LIMINAL, a
 * popup toast would be annoying redundancy; the Solflare signing popup
 * will follow immediately anyway.
 */
export function notify(title: string, options: NotifyOptions): void {
  if (typeof document === "undefined") return;

  // If the tab is already focused, skip native notification — signing
  // popup is about to pop anyway, no need to double-alert. Keep the
  // title flash as a no-op path.
  const tabFocused =
    typeof document !== "undefined" && document.visibilityState === "visible";

  if (!tabFocused) {
    startTitleFlash(title);
  }

  if (
    !tabFocused &&
    isNotificationSupported() &&
    getNotificationPermission() === "granted"
  ) {
    try {
      const n = new window.Notification(title, {
        body: options.body,
        icon: options.icon ?? "/logo.png",
        tag: options.tag ?? "liminal-slice",
        requireInteraction: options.requireInteraction ?? false,
        // Renotify forces the browser to buzz even if a tagged
        // notification is already visible — we want every slice to
        // interrupt since each requires a separate signature.
        renotify: true,
      } as NotificationOptions & { renotify?: boolean });

      n.onclick = () => {
        if (typeof window !== "undefined") window.focus();
        stopTitleFlash();
        options.onClick?.();
        n.close();
      };
    } catch (err) {
      // Some browsers throw if the page isn't served over HTTPS / the
      // notification option shape changed. Never let this propagate.
      console.warn(
        `[LIMINAL] Notification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers for the three execution-flow moments
// ---------------------------------------------------------------------------

export function notifySliceReady(sliceIndex: number, total: number): void {
  notify(`Slice ${sliceIndex + 1}/${total} ready`, {
    body: "Tap to sign the swap — quote is fresh and waiting.",
    tag: "liminal-slice",
    requireInteraction: true,
  });
}

/**
 * Notify execution complete. The trailing "One more popup..." hint is
 * only relevant for autopilot mode (which has a cleanup popup); JIT
 * mode finishes cleanly with no further popups, so the hint is
 * suppressed for that case.
 *
 * BUG FIX (L-2, audit): previous version always appended "One more
 * popup to reclaim nonce rent" even for JIT executions, which had
 * no such popup. Misleading copy for the majority path.
 */
export function notifyExecutionDone(
  totalUsd: number,
  options?: { autopilot?: boolean },
): void {
  const usdLabel =
    totalUsd > 0
      ? `+$${totalUsd.toFixed(2)}`
      : totalUsd < 0
        ? `-$${Math.abs(totalUsd).toFixed(2)}`
        : "$0.00";
  const cleanupHint = options?.autopilot
    ? " One more popup to reclaim nonce rent."
    : "";
  notify("Execution complete", {
    body: `All slices filled. Total value capture: ${usdLabel}.${cleanupHint}`,
    tag: "liminal-done",
    requireInteraction: false,
  });
}

export function notifyExecutionError(message: string): void {
  notify("Execution needs attention", {
    body: message.length > 140 ? `${message.slice(0, 137)}…` : message,
    tag: "liminal-error",
    requireInteraction: true,
  });
}
