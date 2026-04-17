/**
 * LIMINAL — Solana network configuration
 *
 * One place that resolves which Solana cluster the app runs against at
 * runtime, plus the per-cluster overrides every downstream service
 * (quicknode, kamino, dflow) needs to stay consistent. Controlled via
 * `VITE_SOLANA_NETWORK`:
 *
 *   mainnet-beta  (default)  real mainnet — real funds at risk.
 *   devnet                    safe flow testing — test SOL, fake tokens.
 *
 * Adding a new cluster: extend SUPPORTED_NETWORKS + NETWORK_CONFIG, then
 * every service that imports `getActiveNetwork` picks it up automatically.
 *
 * NOT configured here: the QuickNode RPC URL itself — that's a separate
 * env var so you can point either network at a different provider (e.g.
 * a mainnet Helius URL while debugging against public devnet).
 */

export type SolanaNetwork = "mainnet-beta" | "devnet";

export type NetworkConfig = {
  network: SolanaNetwork;
  /** Human-readable label for UI chips, logs, explorer links. */
  label: string;
  /** Base URL for Solana Explorer transaction links. */
  explorerBaseUrl: string;
  /** Whether Kamino Main Market is usable on this cluster. */
  kaminoAvailable: boolean;
  /** Whether Jupiter Ultra / aggregator swaps are usable. */
  aggregatorAvailable: boolean;
  /**
   * One-line banner shown at the top of the UI when not on mainnet.
   * null = no banner.
   */
  testBanner: string | null;
};

const SUPPORTED_NETWORKS: SolanaNetwork[] = ["mainnet-beta", "devnet"];

const NETWORK_CONFIG: Record<SolanaNetwork, NetworkConfig> = {
  "mainnet-beta": {
    network: "mainnet-beta",
    label: "Solana Mainnet",
    explorerBaseUrl: "https://explorer.solana.com",
    kaminoAvailable: true,
    aggregatorAvailable: true,
    testBanner: null,
  },
  devnet: {
    network: "devnet",
    label: "Devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    // Kamino Main Market lives on mainnet only. On devnet we gracefully
    // degrade the UI (VaultPreview shows "unavailable on devnet").
    kaminoAvailable: false,
    // Jupiter Ultra is mainnet-only. On devnet the aggregator is disabled
    // and the execution panel surfaces that.
    aggregatorAvailable: false,
    testBanner:
      "DEVNET MODE — simulated execution only. Kamino + DFlow aggregator are disabled on this cluster.",
  },
};

function parseNetwork(raw: string | undefined): SolanaNetwork {
  if (raw && (SUPPORTED_NETWORKS as string[]).includes(raw)) {
    return raw as SolanaNetwork;
  }
  return "mainnet-beta";
}

const ACTIVE_NETWORK: SolanaNetwork = parseNetwork(
  import.meta.env.VITE_SOLANA_NETWORK,
);

const ACTIVE_CONFIG: NetworkConfig = NETWORK_CONFIG[ACTIVE_NETWORK];

export function getActiveNetwork(): SolanaNetwork {
  return ACTIVE_NETWORK;
}

export function getActiveNetworkConfig(): NetworkConfig {
  return ACTIVE_CONFIG;
}

export function isMainnet(): boolean {
  return ACTIVE_NETWORK === "mainnet-beta";
}

export function isDevnet(): boolean {
  return ACTIVE_NETWORK === "devnet";
}

/**
 * Solana Explorer link for a given signature on the current cluster.
 * Safe for UI consumption: includes cluster query string on devnet.
 */
export function explorerTxUrl(signature: string): string {
  if (ACTIVE_NETWORK === "mainnet-beta") {
    return `${ACTIVE_CONFIG.explorerBaseUrl}/tx/${signature}`;
  }
  return `${ACTIVE_CONFIG.explorerBaseUrl.split("?")[0]}/tx/${signature}?cluster=devnet`;
}
