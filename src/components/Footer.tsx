/**
 * LIMINAL — Global Footer
 *
 * "Built with" partner row that lives at the very bottom of every
 * layout (mobile, tablet, desktop). Pulled out of ExecutionPanel's welcome
 * state so the partner attribution shows up regardless of execution state
 * — first-time visitors, mid-execution users and post-completion screens
 * all see it. Renders a thin horizontal strip with the four partner logos
 * (DFlow, Kamino, QuickNode, Solflare) at uniform 14px cap-height.
 *
 * Visual rules:
 *   - Border-top single hairline, no gradient
 *   - Logos render in full --color-text strength (post-PR #5n; was 60%
 *     opacity which felt washed out against the busy unicorn backdrop).
 *     The "Built with" label stays muted so the four partners are the
 *     ones that pop.
 *   - Center-aligned on tablet/desktop; tighter wrap on mobile
 *   - Hidden under the mobile tab bar via parent padding (App.tsx already
 *     offsets mobileBody for that). Mobile renders the footer above the
 *     tab bar, inside the scroll body.
 */

import type { CSSProperties, FC } from "react";
import { LOGO_CAP, PARTNER_LOGOS } from "./BrandLogos";

const MONO = "var(--font-mono)";

export type FooterProps = {
  /** When true, applies tighter spacing for mobile layout. */
  compact?: boolean;
};

export const Footer: FC<FooterProps> = ({ compact = false }) => (
  <footer
    style={{
      ...styles.root,
      padding: compact ? "14px 12px" : "18px 16px",
      gap: compact ? 10 : 14,
    }}
    aria-label="Built with"
  >
    <span style={styles.label}>Built with</span>
    <div style={{ ...styles.logos, gap: compact ? 10 : 14 }}>
      {PARTNER_LOGOS.map(({ name, logo: Logo }, i) => (
        <span key={name} style={styles.logoWrap}>
          {i > 0 && (
            <span aria-hidden="true" style={styles.dot}>
              ·
            </span>
          )}
          <span
            title={name}
            aria-label={`${name} logo`}
            role="img"
            className="liminal-halo"
            // Full-strength text color overrides the parent footer's
            // muted color → SVGs (which use fill="currentColor") read
            // dark/dense in light theme, near-white-and-bold in dark
            // theme. PR #5n bumped this per user feedback that the
            // sponsor strip looked too washed out against the
            // animated unicorn backdrop.
            style={{
              ...styles.logoInner,
              borderRadius: 6,
              padding: "2px 4px",
              color: "var(--color-text)",
            }}
          >
            <Logo height={LOGO_CAP} size={LOGO_CAP} />
          </span>
        </span>
      ))}
    </div>
  </footer>
);

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    borderTop: "1px solid var(--color-stroke)",
    background: "transparent",
    // Default colour for the "Built with" label only — the logos
    // override to full --color-text below for higher contrast.
    color: "var(--color-text-muted)",
    fontFamily: MONO,
    fontSize: 14,
    // No global opacity any more — the original 0.6 wash made the
    // sponsor logos disappear into the unicorn backdrop.
  },
  label: {
    letterSpacing: 0,
    // Slightly stronger than fully-muted so the label doesn't look
    // grey-on-grey next to the now-bold logos.
    color: "var(--color-text-muted)",
    opacity: 0.85,
  },
  logos: {
    display: "inline-flex",
    alignItems: "center",
  },
  logoWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    opacity: 0.5,
  },
  logoInner: {
    display: "inline-flex",
    alignItems: "center",
    height: LOGO_CAP,
  },
};

export default Footer;
