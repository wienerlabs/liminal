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
