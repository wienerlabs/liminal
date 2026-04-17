/// <reference types="vite/client" />

/**
 * LIMINAL — typed environment variables.
 *
 * Vite exposes any variable prefixed with `VITE_` to client code via
 * `import.meta.env`. Declaring the shape here gives autocomplete and
 * compile-time safety in `import.meta.env.VITE_QUICKNODE_RPC_URL`.
 *
 * To add a new env var:
 *   1. Add `VITE_FOO` to `.env.example` (template, tracked) and
 *      `.env.local` (your local value, gitignored).
 *   2. Add `readonly VITE_FOO: string;` below.
 *   3. Read it via `import.meta.env.VITE_FOO`.
 */

interface ImportMetaEnv {
  /** QuickNode Solana RPC HTTP Provider URL (REQUIRED). */
  readonly VITE_QUICKNODE_RPC_URL: string;
  /**
   * Solana cluster the app connects to. Defaults to "mainnet-beta".
   * Use "devnet" for safe flow testing without burning real SOL —
   * token mints, Kamino program ID, and Pyth feeds all switch to their
   * devnet counterparts when this is set.
   */
  readonly VITE_SOLANA_NETWORK?: "mainnet-beta" | "devnet";
  /**
   * Opt-in Sentry DSN for production error telemetry. When unset the
   * app runs with no telemetry — zero data leaves the browser.
   */
  readonly VITE_SENTRY_DSN?: string;
  /** Aggregator base URL (defaults to Jupiter Ultra). */
  readonly VITE_DFLOW_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
