/**
 * LIMINAL — Global Footer
 *
 * Subtle "Built with" partner row that lives at the very bottom of every
 * layout (mobile, tablet, desktop). Pulled out of ExecutionPanel's welcome
 * state so the partner attribution shows up regardless of execution state
 * — first-time visitors, mid-execution users and post-completion screens
 * all see it. Renders a thin horizontal strip with the four partner logos
 * (DFlow, Kamino, QuickNode, Solflare) at uniform 14px cap-height.
 *
 * Visual rules:
 *   - Border-top single hairline, no gradient
 *   - Muted color, ~55% opacity so it never competes with active content
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
            style={{ ...styles.logoInner, borderRadius: 6, padding: "2px 4px" }}
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
    color: "var(--color-text-muted)",
    fontFamily: MONO,
    fontSize: 12,
    opacity: 0.6,
  },
  label: {
    letterSpacing: 0,
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
