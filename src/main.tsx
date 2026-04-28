/**
 * LIMINAL — Entry point
 *
 * Vite dev server ve production build bu dosyadan başlar. App.tsx tüm
 * layout + state machine binding'ini içerir; burada yalnızca ReactDOM
 * root mount'u yapılır.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./styles/design-system.css";
import { initTelemetry } from "./services/telemetry";
import { bootstrapTheme } from "./hooks/useTheme";

// Apply persisted theme synchronously before React mounts. Without
// this the user briefly sees light theme even when their stored
// preference is dark — no flash of incorrect theme (FOIT).
bootstrapTheme();

// Fire-and-forget. initTelemetry is a no-op when VITE_SENTRY_DSN is
// unset, so this is zero cost for developers running locally without a
// DSN and completely opt-in in production.
void initTelemetry();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error(
    "#root elementi bulunamadı. index.html içinde <div id=\"root\"></div> olmalı.",
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
