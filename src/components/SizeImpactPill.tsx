/**
 * LIMINAL — SizeImpactPill
 *
 * Quick visual hint of how aggressive the user's swap size is for the
 * chosen input token. Heuristic — not a real quote. Calls out the
 * uncertainty in the tooltip ("estimated, see Preview for the exact
 * DFlow quote") so the user doesn't read it as bank-truth.
 *
 * The model is a piecewise function tuned to the typical liquidity
 * profile of major Solana pairs:
 *   - USDC / USDT / other stables — deep on Solana, even $50k is tame
 *   - SOL                          — 50-day median depth ≈ $5M, so
 *                                    $10k starts to nudge slippage
 *   - Anything else                — assume thin; warn earlier
 *
 * Tiers:
 *   comfortable (< 1 bp predicted) — green
 *   moderate    (1-5 bp)           — soft accent
 *   aggressive  (5-15 bp)          — amber
 *   heavy       (15+ bp)           — danger, suggests split
 *
 * Why heuristic instead of live multi-quote: a real curve would call
 * DFlow's quote endpoint 4-5 times every keystroke. That's API spam.
 * The heuristic gives 80% of the value at 0% of the rate-limit cost.
 * Power users can still hit "Preview" (or just start the run, see the
 * first slice's actual quote in QuoteComparison) for the real number.
 */

import type { CSSProperties, FC } from "react";

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USDS",
  "PYUSD",
  "USDH",
  "DAI",
]);
const MAJOR_SYMBOLS = new Set([
  "SOL",
  "WSOL",
  "BSOL",
  "JTO",
  "JUP",
  "MSOL",
  "INF",
  "ETH",
]);

type Tier = "comfortable" | "moderate" | "aggressive" | "heavy";

function classify(symbol: string, amountUsd: number): {
  tier: Tier;
  predictedBps: number;
} {
  const sym = symbol.toUpperCase();
  // Reference USD size at which we expect ~5bp impact. Bigger reference
  // = deeper liquidity assumed = same swap size feels more comfortable.
  const ref = STABLE_SYMBOLS.has(sym)
    ? 50_000
    : MAJOR_SYMBOLS.has(sym)
      ? 12_000
      : 2_500;

  // bps grows roughly with (amount / ref)^1.6 — a smooth curve that
  // stays comfortable below ref and starts to bite past 1.5× ref.
  const ratio = amountUsd / ref;
  const predictedBps = ratio <= 0 ? 0 : 5 * Math.pow(ratio, 1.6);

  if (predictedBps < 1) return { tier: "comfortable", predictedBps };
  if (predictedBps < 5) return { tier: "moderate", predictedBps };
  if (predictedBps < 15) return { tier: "aggressive", predictedBps };
  return { tier: "heavy", predictedBps };
}

export type SizeImpactPillProps = {
  symbol: string;
  amountUsd: number;
};

const TIER_LABEL: Record<Tier, string> = {
  comfortable: "Comfortable size",
  moderate: "Moderate size",
  aggressive: "Aggressive size",
  heavy: "Heavy — consider splitting",
};

const TIER_COLOUR: Record<Tier, { bg: string; fg: string; border: string }> = {
  comfortable: {
    bg: "rgba(34, 197, 94, 0.12)",
    fg: "var(--color-success)",
    border: "rgba(34, 197, 94, 0.4)",
  },
  moderate: {
    bg: "var(--color-accent-bg-soft)",
    fg: "var(--color-5-strong)",
    border: "var(--color-accent-border)",
  },
  aggressive: {
    bg: "rgba(245, 158, 11, 0.12)",
    fg: "var(--color-warn)",
    border: "rgba(245, 158, 11, 0.4)",
  },
  heavy: {
    bg: "rgba(239, 68, 68, 0.12)",
    fg: "var(--color-danger)",
    border: "rgba(239, 68, 68, 0.4)",
  },
};

export const SizeImpactPill: FC<SizeImpactPillProps> = ({
  symbol,
  amountUsd,
}) => {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

  const { tier, predictedBps } = classify(symbol, amountUsd);
  const c = TIER_COLOUR[tier];
  const bpsStr = predictedBps < 1
    ? `<1 bp`
    : `~${predictedBps.toFixed(1)} bp`;

  return (
    <span
      title={`Heuristic size-impact estimate based on ${symbol} typical liquidity. Real DFlow quote may differ. ${bpsStr} predicted at this size.`}
      style={{
        ...styles.pill,
        background: c.bg,
        color: c.fg,
        borderColor: c.border,
      }}
    >
      <span style={styles.dot} aria-hidden="true" />
      <span>{TIER_LABEL[tier]}</span>
      <span style={styles.bps}>· {bpsStr}</span>
    </span>
  );
};

const styles: Record<string, CSSProperties> = {
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0,
    whiteSpace: "nowrap",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "currentColor",
  },
  bps: {
    opacity: 0.75,
    fontVariantNumeric: "tabular-nums",
  },
};

export default SizeImpactPill;
