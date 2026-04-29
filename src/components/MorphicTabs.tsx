/**
 * LIMINAL — MorphicTabs
 *
 * Segmented pill bar where the active tab gets full rounded corners +
 * separation gap, while neighbouring inactive tabs share a continuous
 * "joined" rectangle. The visual effect: as the user clicks across the
 * bar, the active selector "morphs" between positions — the rounded
 * corners follow the click rather than a sliding indicator. Adapted
 * from the kokonutui MorphicNavbar pattern, retuned for LIMINAL's
 * pastel palette and inline-style stack (no Tailwind / Next.js / Framer
 * Motion).
 *
 * Why this fits LIMINAL: the AnalyticsPanel already has three top-level
 * tabs (Live / History / Protocol) that previously used a flat
 * underline indicator. The morphic pill reads more "trader terminal"
 * and gives the panel a stronger visual anchor.
 */

import type { CSSProperties, FC } from "react";

export type MorphicTabItem<K extends string> = {
  key: K;
  label: string;
  /** Optional small badge (e.g. "12" for history count). */
  badge?: string | number;
};

export type MorphicTabsProps<K extends string> = {
  items: MorphicTabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
};

export function MorphicTabs<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
}: MorphicTabsProps<K>): ReturnType<FC> {
  const activeIndex = items.findIndex((it) => it.key === active);

  return (
    <nav style={styles.outer} aria-label={ariaLabel ?? "Tabs"}>
      <div style={styles.bar} role="tablist">
        {items.map((item, index) => {
          const isActive = item.key === active;
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const prevActive = activeIndex === index - 1;
          const nextActive = activeIndex === index + 1;

          // Rounding rules — only the active tab gets *all four* corners
          // rounded; its neighbours drop the corners that face the
          // active pill so the joined-rectangle illusion holds.
          let radius: CSSProperties = {
            borderRadius: 0,
          };
          if (isActive) {
            radius = { borderRadius: 10 };
          } else {
            const leftOuter = isFirst || prevActive;
            const rightOuter = isLast || nextActive;
            radius = {
              borderTopLeftRadius: leftOuter ? 10 : 0,
              borderBottomLeftRadius: leftOuter ? 10 : 0,
              borderTopRightRadius: rightOuter ? 10 : 0,
              borderBottomRightRadius: rightOuter ? 10 : 0,
            };
          }

          // The active pill has tiny side margins — that's the gap
          // that makes neighbouring inactive tabs "rejoin" while the
          // active tab visually pops out.
          const margin: CSSProperties = isActive
            ? { margin: "0 4px" }
            : { margin: 0 };

          return (
            <button
              key={item.key}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onChange(item.key)}
              style={{
                ...styles.tab,
                ...radius,
                ...margin,
                background: isActive
                  ? "var(--color-5)"
                  : "var(--surface-card)",
                color: isActive
                  ? "var(--color-text-inverse)"
                  : "var(--color-text-muted)",
                fontWeight: isActive ? 700 : 500,
                boxShadow: isActive
                  ? "0 0 0 1px var(--color-accent-border), 0 4px 16px rgba(249, 178, 215, 0.32)"
                  : "none",
              }}
            >
              <span>{item.label}</span>
              {item.badge != null && (
                <span
                  style={{
                    ...styles.badge,
                    background: isActive
                      ? "rgba(255, 255, 255, 0.25)"
                      : "var(--color-accent-bg-soft)",
                    color: isActive
                      ? "var(--color-text-inverse)"
                      : "var(--color-5-strong)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const MONO = "var(--font-mono)";

const styles: Record<string, CSSProperties> = {
  outer: {
    display: "flex",
    justifyContent: "center",
    width: "100%",
  },
  bar: {
    display: "inline-flex",
    alignItems: "center",
    padding: 4,
    borderRadius: 14,
    background: "var(--surface-glass, rgba(255, 255, 255, 0.5))",
    border: "1px solid var(--color-stroke)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    width: "100%",
  },
  tab: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "8px 14px",
    border: "none",
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: 0,
    transition:
      "background var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out), border-radius 380ms cubic-bezier(0.4, 0, 0.2, 1), margin 380ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow var(--motion-base) var(--ease-out)",
  },
  badge: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 6px",
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
    minWidth: 18,
    textAlign: "center",
  },
};

export default MorphicTabs;
