/**
 * LIMINAL — MEV protection strategy
 *
 * LIMINAL stacks two complementary MEV defenses:
 *
 *   1. **Routing-level (active today)** — Jupiter Ultra RFQs include
 *      DFlow-endorsed private paths. Market makers fill against their
 *      inventory with pre-committed prices, so sandwich and backrun
 *      opportunities don't exist at the route level. This is the
 *      mechanism powering every slice LIMINAL sends right now.
 *
 *   2. **Slot-level (tracked for Constellation)** — Anza's Multiple
 *      Concurrent Proposers proposal (SIMD in review) breaks the
 *      single-leader monopoly on block construction. When it lands on
 *      mainnet, LIMINAL's `sendRawTransaction` layer will add a
 *      proposer-selection hint so slices land on the least-censoring
 *      proposer of the epoch. The quote/build/simulate pipeline doesn't
 *      change.
 *
 * This module exposes a single resolved strategy object the UI consumes
 * (Analytics "MEV Protection" card, HeaderBar readiness badge, README
 * roadmap). It's driven by `VITE_MEV_PROTECTION_MODE`, defaulting to
 * `jupiter-ultra` — the current production path. Once Constellation's
 * client libraries are GA, the default flips to `hybrid`.
 */

export type MevProtectionMode =
  | "jupiter-ultra"
  | "jupiter-ultra+constellation"
  | "constellation-only";

export interface MevLayer {
  name: string;
  /** One-line description shown on the Protocol tab MEV card. */
  description: string;
  /** true when the layer is actively intercepting LIMINAL's traffic. */
  active: boolean;
  /** External reference (docs, SIMD, blog) for the curious user. */
  referenceUrl: string;
}

export interface MevProtectionStrategy {
  mode: MevProtectionMode;
  /** Human label for badges / chips. */
  label: string;
  /** Two-layer breakdown — routing + slot. */
  layers: MevLayer[];
  /** true while Constellation is still in SIMD review / not on mainnet. */
  constellationReady: boolean;
  /** true iff Constellation is the current mainnet default. */
  constellationActive: boolean;
}

const SUPPORTED_MODES: MevProtectionMode[] = [
  "jupiter-ultra",
  "jupiter-ultra+constellation",
  "constellation-only",
];

function parseMode(raw: string | undefined): MevProtectionMode {
  if (raw && (SUPPORTED_MODES as string[]).includes(raw)) {
    return raw as MevProtectionMode;
  }
  return "jupiter-ultra";
}

const ACTIVE_MODE: MevProtectionMode = parseMode(
  import.meta.env.VITE_MEV_PROTECTION_MODE,
);

// Layer descriptions — stable copy the UI can render verbatim.
const ULTRA_LAYER: Omit<MevLayer, "active"> = {
  name: "DFlow-endorsed routing (Jupiter Ultra)",
  description:
    "Every slice routes through Jupiter Ultra's RFQ pool, which includes DFlow-endorsed market-maker quotes. Fills clear against committed inventory, so sandwich and backrun attacks have no surface at the route level.",
  referenceUrl: "https://dflow.net",
};

const CONSTELLATION_LAYER: Omit<MevLayer, "active"> = {
  name: "Multiple Concurrent Proposers (Constellation)",
  description:
    "Anza's Constellation SIMD replaces the single-leader block construction model with multiple proposers per slot. LIMINAL will add a proposer-selection hint on broadcast so slices land on the least-censoring proposer of the epoch.",
  referenceUrl:
    "https://www.anza.xyz/blog/introducing-constellation",
};

function buildStrategy(mode: MevProtectionMode): MevProtectionStrategy {
  const ultraActive = mode !== "constellation-only";
  const constellationActive =
    mode === "jupiter-ultra+constellation" || mode === "constellation-only";

  const layers: MevLayer[] = [
    { ...ULTRA_LAYER, active: ultraActive },
    { ...CONSTELLATION_LAYER, active: constellationActive },
  ];

  const label =
    mode === "jupiter-ultra"
      ? "Jupiter Ultra (DFlow-endorsed)"
      : mode === "jupiter-ultra+constellation"
        ? "Hybrid: Jupiter Ultra + Constellation"
        : "Constellation-only";

  return {
    mode,
    label,
    layers,
    // Ready = client plumbing exists. Active = mainnet is actually
    // running it. Kept separate so the UI can say "Constellation-ready"
    // before the flip happens without lying about current state.
    constellationReady: true,
    constellationActive,
  };
}

const ACTIVE_STRATEGY = buildStrategy(ACTIVE_MODE);

export function getMevStrategy(): MevProtectionStrategy {
  return ACTIVE_STRATEGY;
}
