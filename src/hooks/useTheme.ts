/**
 * LIMINAL — Theme management
 *
 * Two themes: "light" (default pastel) + "dark" (trader-grade).
 * Persisted to localStorage. Applied via `document.documentElement`'s
 * `data-theme` attribute, which the design-system.css uses to swap
 * the entire token set at the :root selector.
 *
 * Subscriber pattern at module level so every consumer of useTheme
 * sees the same theme value (avoids state drift between header
 * switcher and any future per-panel theme readers).
 */

import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "liminal:theme:v1";
const DEFAULT_THEME: Theme = "light";

let moduleTheme: Theme = DEFAULT_THEME;
const listeners = new Set<() => void>();
let initialized = false;

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function applyToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

function init(): void {
  if (initialized) return;
  initialized = true;
  const storage = safeStorage();
  const stored = storage?.getItem(STORAGE_KEY);
  const next: Theme = stored === "dark" ? "dark" : "light";
  moduleTheme = next;
  applyToDom(next);
}

function setThemeInternal(next: Theme): void {
  if (next === moduleTheme) return;
  moduleTheme = next;
  applyToDom(next);
  const storage = safeStorage();
  try {
    storage?.setItem(STORAGE_KEY, next);
  } catch {
    /* quota / private mode — non-fatal */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getSnapshot = (): Theme => moduleTheme;

export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} {
  // Run init exactly once on first render anywhere — earlier than
  // any subscriber would otherwise read stale moduleTheme.
  useEffect(() => {
    init();
  }, []);

  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setTheme = setThemeInternal;
  const toggle = (): void =>
    setThemeInternal(moduleTheme === "dark" ? "light" : "dark");
  return { theme, setTheme, toggle };
}

/** Module-level read for non-React contexts (e.g. canvas drawing). */
export function getTheme(): Theme {
  init();
  return moduleTheme;
}

/** Initialize theme synchronously before React mounts. Called from main.tsx
 *  to avoid the brief light-flash on dark-preferring sessions. */
export function bootstrapTheme(): void {
  init();
}
