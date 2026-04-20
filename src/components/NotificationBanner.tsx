/**
 * LIMINAL — Notification Permission Banner
 *
 * Level 2 UX katmanı. Autopilot modunda her slice'ta bir JIT swap popup
 * açılır; kullanıcı tab'den başka yere gitmişse bu popup'ı kaçırabilir.
 * Banner, kullanıcıya browser notification permission ister — granted
 * olursa slice hazır olduğunda native notification + title flash +
 * ses tetiklenir.
 *
 * Görünürlük kuralları:
 *   - Permission `default` ve Autopilot ON → banner görünür
 *   - Permission `granted` → banner gizli (kullanıcı zaten ayarlamış)
 *   - Permission `denied` → banner gizli (browser-level karar — tekrar
 *     sormayı kullanıcı kendi ayarlarından yapabilir)
 *   - Notification API yoksa → banner gizli (iOS Safari < 16.4 etc.)
 */

import { useEffect, useState, type FC } from "react";
import {
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
} from "../services/notifications";

const MONO = "var(--font-mono)";

type Permission = "default" | "granted" | "denied" | "unsupported";

function readPermission(): Permission {
  if (!isNotificationSupported()) return "unsupported";
  return getNotificationPermission();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type NotificationBannerProps = {
  /** Banner sadece autopilot ON'ken göster. */
  visible: boolean;
};

export const NotificationBanner: FC<NotificationBannerProps> = ({ visible }) => {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Refresh the cached permission if the user changed it via browser
  // settings while the tab was open.
  useEffect(() => {
    const id = setInterval(() => {
      setPermission(readPermission());
    }, 5000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;
  if (permission === "granted" || permission === "unsupported") return null;
  if (permission === "denied") return null;
  if (dismissed) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        margin: "0 16px 10px",
        borderRadius: 8,
        background: "var(--color-accent-bg-soft)",
        border: "1px solid var(--color-accent-border)",
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      <span role="img" aria-label="bell" style={{ fontSize: 18 }}>
        🔔
      </span>
      <span style={{ flex: 1, lineHeight: 1.5, color: "var(--color-text)" }}>
        <strong>Get pinged when each slice is ready to sign.</strong>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          Browser notifications let you step away while autopilot runs — we
          only ping for the JIT swap popups.
        </span>
      </span>
      <button
        type="button"
        onClick={handleEnable}
        disabled={busy}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid var(--color-accent-border)",
          background: "var(--color-5)",
          color: "var(--color-text-on-accent)",
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 700,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "…" : "Enable"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss notification banner"
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid var(--color-stroke)",
          background: "transparent",
          color: "var(--color-text-muted)",
          fontFamily: MONO,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
};

export default NotificationBanner;
