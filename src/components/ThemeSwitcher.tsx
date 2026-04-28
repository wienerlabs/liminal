/**
 * LIMINAL — ThemeSwitcher
 *
 * Single-icon button (sun ↔ moon). Sits in the header next to the
 * wallet badge. Toggling persists to localStorage via useTheme.
 *
 * Two SVG icons inlined (no extra runtime, ~200 bytes each). The
 * displayed icon is the OPPOSITE of the active theme — clicking the
 * moon while in light mode tells the user "go dark".
 */

import type { CSSProperties, FC } from "react";
import { useTheme } from "../hooks/useTheme";

export const ThemeSwitcher: FC = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={styles.button}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
};

const SunIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const styles: Record<string, CSSProperties> = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    transition:
      "color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out), background var(--motion-base) var(--ease-out)",
  },
};

export default ThemeSwitcher;
