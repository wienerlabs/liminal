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
  /** QuickNode Solana mainnet HTTP Provider URL (REQUIRED). */
  readonly VITE_QUICKNODE_RPC_URL: string;
  /** DFlow endorsement server (optional, defaults to https://pond.dflow.net). */
  readonly VITE_DFLOW_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
