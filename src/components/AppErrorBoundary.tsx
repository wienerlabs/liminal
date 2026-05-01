/**
 * LIMINAL — App-Level Error Boundary
 *
 * BUG SS: a render-time exception anywhere in the tree (UI bug,
 * unexpected null, RPC response shape change, third-party SDK
 * regression) would otherwise crash the whole app to a blank white
 * screen. For an on-chain trading terminal that's worse than a normal
 * SPA: the user can't reset their state, can't reach the disclaimer,
 * can't see whether their funds are still in Kamino — and refreshing
 * may rehydrate the same broken state.
 *
 * This boundary:
 *   1. Catches render + lifecycle errors below it.
 *   2. Forwards them to the telemetry layer (no-op when no DSN).
 *   3. Renders a recoverable fallback with two options:
 *        - "Reload" — full page reload (recovers in-flight from
 *          localStorage if not the cause of the crash).
 *        - "Reset State + Reload" — clears LIMINAL's localStorage
 *          keys then reloads, for cases where the crash IS state-
 *          driven (corrupted persist, bad recovery).
 *
 * Class component because React's render-error catching API still
 * requires getDerivedStateFromError / componentDidCatch on a class.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureError } from "../services/telemetry";

const LIMINAL_LOCALSTORAGE_KEYS: ReadonlyArray<string> = [
  "liminal:execution:state",
  "liminal:analytics:history",
  "liminal:token-registry:v2",
  "liminal:solflare:connected",
];

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Telemetry is opt-in (VITE_SENTRY_DSN). Silent if DSN missing.
    try {
      captureError(error, "AppErrorBoundary");
    } catch {
      /* never let telemetry crash the boundary */
    }
    // Always log to console for local debugging.
    console.error(
      "[LIMINAL] AppErrorBoundary caught:",
      error,
      info.componentStack,
    );
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private handleResetAndReload = (): void => {
    if (typeof window === "undefined") return;
    try {
      for (const key of LIMINAL_LOCALSTORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      /* localStorage may be disabled — reload anyway */
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "var(--color-bg, #fefefe)",
          color: "var(--color-text, #1a1a1a)",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: "100%",
            padding: "32px 28px",
            borderRadius: 12,
            border: "1px solid var(--color-stroke, #ddd)",
            background: "var(--color-surface, #fff)",
          }}
        >
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              margin: "0 0 12px",
            }}
          >
            LIMINAL hit an unexpected error.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-text-muted, #666)" }}>
            The app caught a render-time exception below. Your funds are not at
            risk — on-chain state is independent of this UI. Try reloading
            first; if that doesn&apos;t recover, use Reset State to clear local
            recovery data and start fresh.
          </p>
          <pre
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 8,
              background: "var(--color-2, #f5f5f5)",
              fontSize: 13,
              lineHeight: 1.4,
              maxHeight: 160,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid var(--color-accent-border, #aaa)",
                background: "var(--color-5, #f9b2d7)",
                color: "var(--color-text-on-accent, #1a1a1a)",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid var(--color-stroke, #ddd)",
                background: "transparent",
                color: "var(--color-text, #1a1a1a)",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reset State + Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
