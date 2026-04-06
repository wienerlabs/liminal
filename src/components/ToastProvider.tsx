/**
 * LIMINAL — Toast Notification System
 *
 * Module-level toast store (like execution machine pattern).
 * showToast(message, type) can be called from anywhere.
 * ToastContainer renders at root level in App.tsx.
 */

import {
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
    _toasts = _toasts.filter((t) => t.id !== toast.id);
    notify();
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

  useEffect(() => subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div style={styles.container}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            ...styles.toast,
            borderColor:
              t.type === "success"
                ? "var(--color-5)"
                : t.type === "warning"
                  ? "var(--color-warn)"
                  : "var(--color-stroke)",
          }}
        >
          <span style={styles.message}>{t.message}</span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container: {
    position: "fixed",
    top: 56,
    right: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    zIndex: 9999,
    pointerEvents: "none",
    maxWidth: 340,
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
    padding: "10px 16px",
    boxShadow: "var(--shadow-raised)",
    animation: "liminal-slide-in 300ms ease-out",
  },
  message: {
    lineHeight: 1.5,
  },
};

export default ToastContainer;
