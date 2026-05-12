/**
 * LIMINAL — Wallet brand logos
 *
 * Official brand marks sourced from each project's wallet-adapter
 * package (Phantom, Solflare) and Backpack's published adapter PNG.
 * Stored under `/public/wallet-logos/` and served as static assets so
 * the bundle stays small and the artwork is pixel-faithful to the
 * brands' own materials.
 *
 * Provenance:
 *   - phantom.svg   → anza-xyz/wallet-adapter packages/wallets/phantom
 *   - solflare.svg  → anza-xyz/wallet-adapter packages/wallets/solflare
 *   - backpack.png  → @solana/wallet-adapter-backpack@0.1.14 src/adapter.ts
 *
 * If a logo file 404s the <img> falls back to its `alt` text. We do
 * not maintain a homemade SVG fallback anymore — using the brand's
 * own mark is the whole point.
 */

import type { FC } from "react";
import type { WalletId } from "../services/solflare";

export type WalletLogoProps = {
  size?: number;
};

const LOGO_PATH: Record<WalletId, string> = {
  solflare: "/wallet-logos/solflare.svg",
  phantom: "/wallet-logos/phantom.svg",
  backpack: "/wallet-logos/backpack.png",
};

const LOGO_ALT: Record<WalletId, string> = {
  solflare: "Solflare",
  phantom: "Phantom",
  backpack: "Backpack",
};

const imgStyle = (size: number): React.CSSProperties => ({
  width: size,
  height: size,
  // Same rounded-square silhouette across all three so the picker stays
  // visually consistent even though each brand mark has its own corner
  // radius baked into the artwork.
  borderRadius: 14,
  display: "block",
  // Crisp scaling — wallets ship at 100-128px, the picker shows at 36-48px.
  imageRendering: "auto",
});

export const SolflareLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <img
    src={LOGO_PATH.solflare}
    alt={LOGO_ALT.solflare}
    width={size}
    height={size}
    style={imgStyle(size)}
    referrerPolicy="no-referrer"
    draggable={false}
  />
);

export const PhantomLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <img
    src={LOGO_PATH.phantom}
    alt={LOGO_ALT.phantom}
    width={size}
    height={size}
    style={imgStyle(size)}
    referrerPolicy="no-referrer"
    draggable={false}
  />
);

export const BackpackLogo: FC<WalletLogoProps> = ({ size = 36 }) => (
  <img
    src={LOGO_PATH.backpack}
    alt={LOGO_ALT.backpack}
    width={size}
    height={size}
    style={imgStyle(size)}
    referrerPolicy="no-referrer"
    draggable={false}
  />
);

export const WalletLogo: FC<{ id: WalletId; size?: number }> = ({
  id,
  size,
}) => {
  if (id === "solflare") return <SolflareLogo size={size} />;
  if (id === "phantom") return <PhantomLogo size={size} />;
  if (id === "backpack") return <BackpackLogo size={size} />;
  return null;
};
