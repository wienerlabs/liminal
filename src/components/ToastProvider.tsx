/**
 * LIMINAL — Toast Notification System
 *
 * Module-level toast store (like execution machine pattern).
 * showToast(message, type) can be called from anywhere.
 * ToastContainer renders at root level in App.tsx.
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FC,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "success" | "info" | "warning";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

let _nextId = 1;
let _toasts: Toast[] = [];
const _listeners: Set<(toasts: Toast[]) => void> = new Set();

function notify(): void {
  for (const fn of _listeners) {
    fn([..._toasts]);
  }
}

function removeToast(id: number): void {
  _toasts = _toasts.filter((t) => t.id !== id);
  notify();
}

export function showToast(message: string, type: ToastType = "info"): void {
  const toast: Toast = {
    id: _nextId++,
    message,
    type,
    createdAt: Date.now(),
  };
  _toasts = [..._toasts, toast].slice(-3); // max 3
  notify();

  // Auto-dismiss after 4s
  setTimeout(() => {
    removeToast(toast.id);
  }, 4000);
}

function subscribe(fn: (toasts: Toast[]) => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToastContainer: FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set());

  useEffect(() => subscribe(setToasts), []);

  const handleDismiss = useCallback((id: number) => {
    setExitingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      removeToast(id);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={styles.container} role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const isExiting = exitingIds.has(t.id);
        const accent =
          t.type === "success"
            ? "var(--color-success)"
            : t.type === "warning"
              ? "var(--color-warn)"
              : "var(--color-5)";
        const icon =
          t.type === "success" ? "✓" : t.type === "warning" ? "!" : "i";
        return (
          <div
            key={t.id}
            role={t.type === "warning" ? "alert" : "status"}
            aria-live={t.type === "warning" ? "assertive" : "polite"}
            style={{
              ...styles.toast,
              borderColor: accent,
              animation: isExiting
                ? "liminal-slide-out 200ms var(--ease-out) forwards"
                : "liminal-slide-in 300ms var(--ease-out)",
            }}
          >
            <span
              style={{ ...styles.iconBadge, color: accent, borderColor: accent }}
              aria-hidden="true"
            >
              {icon}
            </span>
            <span style={styles.message}>{t.message}</span>
            <button
              type="button"
              onClick={() => handleDismiss(t.id)}
              style={styles.dismissBtn}
              aria-label="Dismiss notification"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container: {
    position: "fixed",
    top: "calc(var(--header-height) + 12px)",
    right: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    zIndex: 9999,
    pointerEvents: "none",
    maxWidth: 360,
  },
  toast: {
    pointerEvents: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--color-text)",
    background: "var(--surface-raised-strong)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid",
    borderRadius: "var(--radius-md)",
    padding: "10px 14px",
    boxShadow: "var(--shadow-raised)",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  iconBadge: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "1px solid",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
    lineHeight: 1,
  },
  message: {
    lineHeight: 1.5,
    flex: 1,
  },
  dismissBtn: {
    background: "transparent",
    border: "none",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    width: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

export default ToastContainer;
