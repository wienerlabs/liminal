/**
 * LIMINAL — Brand + Partner Logos (shared)
 *
 * Single source of truth for every brand mark used across the UI:
 *   - LiminalMark     → the canonical LIMINAL logo PNG (public/logo.png)
 *   - DFlowLogo       → inline SVG, official pinwheel mark
 *   - KaminoLogo      → inline SVG, official wordmark
 *   - QuickNodeLogo   → inline SVG, Q + wordmark
 *   - SolflareLogo    → inline SVG, S mark
 *
 * Why one file: every partner logo was previously inlined inside
 * HeaderBar only, so QuoteComparison / VaultPreview / ExecutionPanel
 * couldn't show the right brand next to its own section without
 * duplicating SVGs. Centralising here means a partner logo update
 * touches one file.
 */

import type { FC } from "react";

/** Uniform cap-height so mixed logos line up in the partner strip. */
export const LOGO_CAP = 14;

// ---------------------------------------------------------------------------
// LIMINAL mark — raster brand asset
// ---------------------------------------------------------------------------

export type LiminalMarkProps = {
  size?: number;
  style?: React.CSSProperties;
};

export const LiminalMark: FC<LiminalMarkProps> = ({ size = 28, style }) => (
  <img
    src="/logo.png"
    alt=""
    width={size}
    height={size}
    decoding="async"
    loading="eager"
    aria-hidden="true"
    style={{
      display: "block",
      flexShrink: 0,
      width: size,
      height: size,
      objectFit: "contain",
      ...style,
    }}
  />
);

// ---------------------------------------------------------------------------
// Partner logos
// ---------------------------------------------------------------------------

export const DFlowLogo: FC<{ size?: number }> = ({ size = LOGO_CAP }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 329 329"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M126.705 27.668c-47.483 14.221-84.891 51.613-99.153 98.872h50.669c4.38 0 8.58-1.74 11.677-4.835l31.966-31.948c3.1-3.098 4.841-7.3 4.841-11.683z" />
    <path d="M151.397 89.199c-.204 4.118-1.927 8.024-4.848 10.943l-46.488 46.461-.591.561c-3.017 2.732-6.94 4.253-11.017 4.253H15.747l-.457-.007c-9.549-.261-16.967-8.685-14.96-18.151C14.432 66.757 66.84 14.395 133.391.323c9.553-2.02 18.027 5.717 18.027 15.544v72.506z" />
    <path d="M126.705 301.166c-47.483-14.221-84.891-51.613-99.153-98.872h50.669c4.38 0 8.58 1.739 11.677 4.835l31.966 31.947c3.1 3.098 4.841 7.301 4.841 11.684z" />
    <path d="M151.397 239.635c-.204-4.118-1.927-8.024-4.848-10.943l-46.488-46.461-.591-.561c-3.017-2.732-6.94-4.253-11.017-4.253H15.747l-.457.007c-9.549.261-16.967 8.685-14.96 18.151 14.101 66.502 66.509 118.864 133.06 132.936 9.553 2.02 18.027-5.717 18.027-15.544v-72.506z" />
    <path d="M301.287 126.528c-14.284-47.268-51.697-84.656-99.17-98.854v50.375c0 4.38 1.739 8.58 4.836 11.678l31.951 31.961c3.098 3.099 7.301 4.84 11.682 4.84z" />
    <path d="M240.351 151.417c-4.346 0-8.517-1.731-11.602-4.816l-46.466-46.483c-2.92-2.92-4.642-6.828-4.846-10.948l-.02-.827v-72.47c0-9.828 8.464-17.566 18.01-15.552 66.534 14.041 118.944 66.401 133.075 132.921 2.045 9.623-5.641 18.175-15.408 18.175z" />
    <path d="M202.13 301.166c47.482-14.223 84.889-51.615 99.151-98.872h-50.669c-4.379 0-8.578 1.739-11.676 4.834l-31.964 31.944c-3.1 3.098-4.842 7.301-4.842 11.684z" />
    <path d="M177.437 239.631c.204-4.119 1.927-8.024 4.848-10.943l46.487-46.457.591-.561c2.816-2.55 6.42-4.045 10.203-4.233l.814-.02h72.708l.456.007c9.549.261 16.967 8.685 14.96 18.151-14.1 66.5-66.508 118.861-133.059 132.936-9.553 2.02-18.028-5.716-18.028-15.542v-72.512z" />
  </svg>
);

export const KaminoLogo: FC<{ height?: number }> = ({ height = LOGO_CAP }) => (
  <svg
    height={height}
    viewBox="0 0 216.6 50"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M110.321 14.514c-6.415 0-9.559 3.464-11.009 5.036-2.365-3.035-5.193-5.015-10.183-5.015-3.716 0-8.338 2.172-9.566 5.046V15.03h-9.205v34.404h9.43V29.937c0-3.723 3.003-6.745 6.716-6.745s6.716 3.014 6.716 6.745v19.504h9.402V29.93c0-3.723 3.004-6.745 6.717-6.745s6.716 3.014 6.716 6.745l-.01 19.504h9.43V30.839c0-6.825-2.549-16.325-15.164-16.325z" />
    <circle cx="135.192" cy="5.71" r="5.71" />
    <path d="M139.959 15.03h-9.653v34.404h9.653V15.03z" />
    <path d="M10.263 2.782H0v46.684h10.263V2.782z" />
    <path d="M198.959 50.003c-5.025 0-9.271-1.506-12.626-4.906-3.347-3.393-5.046-7.692-5.046-12.766s1.699-9.377 5.046-12.78c3.352-3.408 7.601-5.036 12.626-5.036s9.275 1.621 12.616 5.036c3.337 3.407 5.025 7.702 5.025 12.78 0 5.074-1.695 9.373-5.032 12.766-3.341 3.394-7.584 4.906-12.609 4.906zm0-26.688c-2.414 0-4.34.839-5.888 2.558-1.579 1.758-2.351 3.864-2.351 6.45s.768 4.685 2.347 6.433c1.545 1.716 3.478 2.54 5.892 2.54s4.348-.828 5.892-2.54c1.579-1.744 2.348-3.85 2.348-6.433s-.772-4.696-2.351-6.45c-1.544-1.72-3.471-2.558-5.889-2.558z" />
    <path d="M56.364 15.031v2.94c-1.66-1.656-3.351-3.484-8.19-3.484-3.11 0-5.931.631-8.38 2.098-2.64 1.565-4.78 3.766-6.373 6.524-1.597 2.768-2.407 5.86-2.407 9.19s.796 6.404 2.372 9.141c1.572 2.734 3.702 4.91 6.341 6.478 2.537 1.506 5.432 2.053 8.608 2.053 3.004 0 6.053-1.561 8.033-3.485v2.941h9.194V15.031h-9.198zm-7.279 26.732c-4.979 0-9.015-4.243-9.015-9.475s4.04-9.475 9.015-9.475 9.019 4.243 9.019 9.475-4.04 9.475-9.019 9.475z" />
    <path d="M164.755 14.515c-4.467 0-8.605 2.432-10.703 5.762V15.027h-9.299v34.404h9.524V29.815c0-3.724 2.902-6.745 7.113-6.745s7.113 3.014 7.113 6.745v19.616h9.524V28.864c0-5.236-2.239-14.352-13.276-14.352z" />
    <path d="M33.347 48.876c-4.835-3.334-8.102-9.534-8.102-16.64s3.267-13.307 8.102-16.64v-.562H19.97c-3.13 4.85-4.97 10.78-4.97 17.202s1.837 12.348 4.97 17.202h13.377v-.562z" />
  </svg>
);

export const QuickNodeLogo: FC<{ height?: number }> = ({
  height = LOGO_CAP,
}) => (
  <svg
    height={height}
    viewBox="0 0 110 24"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path
      d="M11 2 A9 9 0 1 0 11 20 A9 9 0 1 0 11 2 Z M11 5 A6 6 0 1 1 11 17 A6 6 0 1 1 11 5 Z"
      fillRule="evenodd"
    />
    <path d="M14.5 16.5 L19 21 L21 19 L16.5 14.5 Z" />
    <text
      x="26"
      y="17"
      fontFamily="'Space Grotesk', system-ui, sans-serif"
      fontWeight="700"
      fontSize="13"
      letterSpacing="0.3"
      fill="currentColor"
    >
      QUICKNODE
    </text>
  </svg>
);

export const SolflareLogo: FC<{ size?: number }> = ({ size = LOGO_CAP }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 50 50"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <path d="M24.23 26.42l2.46-2.38 4.59 1.5c3.01 1 4.51 2.84 4.51 5.43 0 1.96-.75 3.26-2.25 4.93l-.46.5.17-1.17c.67-4.26-.58-6.09-4.72-7.43l-4.3-1.38zM18.05 11.85l12.52 4.17-2.71 2.59-6.51-2.17c-2.25-.75-3.01-1.96-3.3-4.51v-.08zM17.3 33.06l2.84-2.71 5.34 1.75c2.8.92 3.76 2.13 3.46 5.18l-11.65-4.22zM13.71 20.95c0-.79.42-1.54 1.13-2.17.75 1.09 2.05 2.05 4.09 2.71l4.42 1.46-2.46 2.38-4.34-1.42c-2-.67-2.84-1.67-2.84-2.96M26.82 42.87c9.18-6.09 14.11-10.23 14.11-15.32 0-3.38-2-5.26-6.43-6.72l-3.34-1.13 9.14-8.77-1.84-1.96-2.71 2.38-12.81-4.22c-3.97 1.29-8.97 5.09-8.97 8.89 0 .42.04.83.17 1.29-3.3 1.88-4.63 3.63-4.63 5.8 0 2.05 1.09 4.09 4.55 5.22l2.75.92-9.52 9.14 1.84 1.96 2.96-2.71 14.73 5.22z" />
  </svg>
);

export const PARTNER_LOGOS: {
  name: string;
  logo: FC<{ size?: number; height?: number }>;
}[] = [
  { name: "DFlow", logo: DFlowLogo },
  { name: "Kamino", logo: KaminoLogo },
  { name: "QuickNode", logo: QuickNodeLogo },
  { name: "Solflare", logo: SolflareLogo },
];
