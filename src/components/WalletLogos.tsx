/**
 * LIMINAL — Wallet brand logos
 *
 * Inline SVG marks for the wallets we support in the picker. We embed
 * them as React components instead of remote <img> so:
 *   - No extra network requests during a connect flow.
 *   - The marks render even if the browser is offline.
 *   - Sizes scale crisply at any DPR.
 *
 * The artwork is a simplified-but-recognizable take on each brand —
 * faithful to the dominant shape + color so users see "the wallet I
 * know" at a glance. Full official PNGs are available on each
 * brand's marketing site if a higher fidelity is ever needed.
 */

import type { FC } from "react";

export type WalletLogoProps = {
  size?: number;
};

// -----------------------------------------------------------------------------
// Solflare — orange/yellow sun-burst inside a rounded square.
// -----------------------------------------------------------------------------
export const SolflareLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect width="64" height="64" rx="14" fill="url(#solflareGrad)" />
    <defs>
      <linearGradient
        id="solflareGrad"
        x1="0"
        y1="0"
        x2="64"
        y2="64"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#FFC83C" />
        <stop offset="1" stopColor="#FC822B" />
      </linearGradient>
    </defs>
    {/* Sun core */}
    <circle cx="32" cy="32" r="9" fill="#FFF6D8" />
    {/* 8 rays */}
    <g stroke="#FFF6D8" strokeWidth="3" strokeLinecap="round">
      <line x1="32" y1="10" x2="32" y2="17" />
      <line x1="32" y1="47" x2="32" y2="54" />
      <line x1="10" y1="32" x2="17" y2="32" />
      <line x1="47" y1="32" x2="54" y2="32" />
      <line x1="16" y1="16" x2="21" y2="21" />
      <line x1="43" y1="43" x2="48" y2="48" />
      <line x1="48" y1="16" x2="43" y2="21" />
      <line x1="21" y1="43" x2="16" y2="48" />
    </g>
  </svg>
);

// -----------------------------------------------------------------------------
// Phantom — purple ghost mark.
// -----------------------------------------------------------------------------
export const PhantomLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect width="64" height="64" rx="14" fill="#AB9FF2" />
    {/* Ghost body — dome with a wavy bottom edge */}
    <path
      d="M16 32a16 16 0 0 1 32 0v17.5c0 1.5-1.7 2.3-2.9 1.4l-3.4-2.5a2 2 0 0 0-2.4 0l-3.4 2.5a2 2 0 0 1-2.4 0l-3.4-2.5a2 2 0 0 0-2.4 0l-3.4 2.5a2 2 0 0 1-2.4 0l-3.4-2.5C17.7 51.8 16 51 16 49.5V32z"
      fill="#fff"
    />
    {/* Eyes */}
    <circle cx="27" cy="30" r="3" fill="#AB9FF2" />
    <circle cx="40" cy="30" r="3" fill="#AB9FF2" />
  </svg>
);

// -----------------------------------------------------------------------------
// Backpack — red/orange "B" mark.
// -----------------------------------------------------------------------------
export const BackpackLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect width="64" height="64" rx="14" fill="#E33E3F" />
    {/* Stylized "B" — two stacked tabs */}
    <path
      d="M20 18h16c5.5 0 10 4 10 9 0 2.7-1.3 5-3.3 6.5 2.8 1.4 4.7 4.3 4.7 7.5 0 5-4.5 9-10 9H20V18zm6 5v8h10c2.5 0 4.5-1.8 4.5-4s-2-4-4.5-4H26zm0 13v9h11c2.7 0 5-2 5-4.5S39.7 36 37 36H26z"
      fill="#fff"
    />
  </svg>
);

import type { WalletId } from "../services/solflare";

export const WalletLogo: FC<{ id: WalletId; size?: number }> = ({
  id,
  size,
}) => {
  if (id === "solflare") return <SolflareLogo size={size} />;
  if (id === "phantom") return <PhantomLogo size={size} />;
  if (id === "backpack") return <BackpackLogo size={size} />;
  return null;
};
