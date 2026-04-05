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
import "./styles/design-system.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error(
    "#root elementi bulunamadı. index.html içinde <div id=\"root\"></div> olmalı.",
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
