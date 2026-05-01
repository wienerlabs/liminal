/**
 * LIMINAL — ProfileAvatar
 *
 * Static registry of 4 avatar SVGs in LIMINAL's pastel palette,
 * recolored from the kokonutui Avatar Picker (hot pink / orange /
 * black / neon green) to our pink / sky / mint / yellow tones. Each
 * avatar has the same eye/mouth structure as the source — a friendly
 * inset face — but rendered against the brand's palette.
 *
 * Component renders one avatar at the given size. The SVG itself
 * uses a 36×36 viewBox; we set width/height to the requested size
 * and let CSS scale it cleanly. A circular mask clips the inner
 * rectangles so the avatar reads as a round portrait at any size.
 *
 * Color anchors per avatar (used by ProfileSetup for the ring glow):
 *   1 — pink + yellow      → 249, 178, 215  (LIMINAL pink #F9B2D7)
 *   2 — deeper pink + mint → 244, 140, 196  (deeper pink #F48CC4)
 *   3 — sky + pink         → 207, 236, 243  (sky #CFECF3)
 *   4 — mint + sky         → 218, 249, 222  (mint #DAF9DE)
 */

import type { CSSProperties, FC, ReactNode } from "react";

export type AvatarDef = {
  id: number;
  alt: string;
  /** RGB triplet (no rgb() wrapper) for the per-avatar color ring. */
  rgb: string;
  /** Renders the SVG at any size — receives `size` so it can set
   * width/height. The viewBox is 36×36 internally. */
  render: (size: number) => ReactNode;
};

// LIMINAL palette hexes — matches design-system.css tokens.
const PINK = "#f9b2d7";
const PINK_DEEP = "#f48cc4";
const SKY = "#cfecf3";
const MINT = "#daf9de";
const YELLOW = "#f6ffdc";
const INK = "#1a1a1a";
const PAPER = "#ffffff";

function buildAvatar(
  id: number,
  bg: string,
  shape: { fill: string; rx: number; tx: number; ty: number; rot: number },
  face: { stroke: string; tx: number; ty: number; rot: number },
): (size: number) => ReactNode {
  return (size: number) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      role="img"
      aria-label={`LIMINAL avatar ${id}`}
      style={{ display: "block" }}
    >
      <title>{`LIMINAL avatar ${id}`}</title>
      <mask
        id={`liminal-avatar-mask-${id}`}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="36"
        height="36"
      >
        <rect width="36" height="36" rx="72" fill="#fff" />
      </mask>
      <g mask={`url(#liminal-avatar-mask-${id})`}>
        <rect width="36" height="36" fill={bg} />
        <rect
          x="0"
          y="0"
          width="36"
          height="36"
          rx={shape.rx}
          fill={shape.fill}
          transform={`translate(${shape.tx} ${shape.ty}) rotate(${shape.rot} 18 18)`}
        />
        <g transform={`translate(${face.tx} ${face.ty}) rotate(${face.rot} 18 18)`}>
          {/* Smile */}
          <path
            d="M15 19c2 1 4 1 6 0"
            fill="none"
            stroke={face.stroke}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* Eyes */}
          <rect x="10" y="14" width="1.5" height="2" rx="1" fill={face.stroke} />
          <rect x="24" y="14" width="1.5" height="2" rx="1" fill={face.stroke} />
        </g>
      </g>
    </svg>
  );
}

// Avatar 1 — pink base + yellow rounded square overlay, ink face.
const AVATAR_1: AvatarDef = {
  id: 1,
  alt: "Pink Yellow",
  rgb: "249, 178, 215",
  render: buildAvatar(
    1,
    PINK,
    { fill: YELLOW, rx: 6, tx: 9, ty: -5, rot: 219 },
    { stroke: INK, tx: 4.5, ty: -4, rot: 9 },
  ),
};

// Avatar 2 — deeper pink base + mint overlay, paper face (high
// contrast over the deep pink).
const AVATAR_2: AvatarDef = {
  id: 2,
  alt: "Deep Pink Mint",
  rgb: "244, 140, 196",
  render: buildAvatar(
    2,
    PINK_DEEP,
    { fill: MINT, rx: 6, tx: 5, ty: -1, rot: 55 },
    { stroke: INK, tx: 7, ty: -6, rot: -5 },
  ),
};

// Avatar 3 — sky base + pink circle overlay, ink face.
const AVATAR_3: AvatarDef = {
  id: 3,
  alt: "Sky Pink",
  rgb: "207, 236, 243",
  render: buildAvatar(
    3,
    SKY,
    { fill: PINK, rx: 36, tx: -3, ty: 7, rot: 227 },
    { stroke: INK, tx: -3, ty: 3.5, rot: 7 },
  ),
};

// Avatar 4 — mint base + sky rounded square overlay, ink face.
const AVATAR_4: AvatarDef = {
  id: 4,
  alt: "Mint Sky",
  rgb: "218, 249, 222",
  render: buildAvatar(
    4,
    MINT,
    { fill: SKY, rx: 6, tx: 9, ty: -5, rot: 219 },
    { stroke: INK, tx: 4.5, ty: -4, rot: 9 },
  ),
};

export const AVATARS: AvatarDef[] = [AVATAR_1, AVATAR_2, AVATAR_3, AVATAR_4];

export function getAvatarById(id: number): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

// ---------------------------------------------------------------------------
// Render component — used wherever we want a quick "show this avatar"
// without writing the inline SVG every time.
// ---------------------------------------------------------------------------

export type ProfileAvatarProps = {
  avatarId: number;
  size?: number;
  /** Adds a 1px translucent ring in the avatar's accent color. Used
   * by ProfileChip + the stage in ProfileSetup. */
  ring?: boolean;
  /** Passes through for layout. */
  style?: CSSProperties;
  className?: string;
};

export const ProfileAvatar: FC<ProfileAvatarProps> = ({
  avatarId,
  size = 32,
  ring = false,
  style,
  className,
}) => {
  const avatar = getAvatarById(avatarId);
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        background: PAPER,
        boxShadow: ring
          ? `0 0 0 1px rgba(${avatar.rgb}, 0.6), 0 4px 12px rgba(${avatar.rgb}, 0.18)`
          : undefined,
        ...style,
      }}
    >
      {avatar.render(size)}
    </span>
  );
};

export default ProfileAvatar;
