/**
 * LIMINAL — kliquidity-sdk shim
 *
 * `@kamino-finance/klend-sdk` pulls `@kamino-finance/kliquidity-sdk` in as
 * a transitive dependency, but the only symbols it actually uses from the
 * public surface are three trivial helpers:
 *
 *   - batchFetch  → fetch items in batches with a worker fn
 *   - chunks      → split an array into fixed-size chunks
 *   - aprToApy    → APR → APY conversion
 *
 * The rest of kliquidity-sdk ships a CLMM rebalancer that transitively
 * imports `@orca-so/whirlpools-core`, a WASM-backed ESM module with a
 * top-level await. Vite's esbuild pre-bundler cannot wrap that CJS-requires-
 * ESM-with-TLA combination, which blows up as either:
 *
 *   - "This require call is not allowed because the transitive dependency
 *      contains a top-level await"  (when included in optimizeDeps)
 *   - "exports is not defined"  (when excluded)
 *
 * This shim exposes the small subset klend-sdk uses and is aliased via
 * Vite's `resolve.alias` so `require("@kamino-finance/kliquidity-sdk")`
 * resolves here instead of the real package. LIMINAL never invokes CLMM /
 * vault rebalancing itself, so this is safe.
 *
 * NOT a general replacement — only the symbols klend-sdk touches on the
 * read paths we use (`KaminoMarket.load`, `getReserves`, APY lookups,
 * `getUserVanillaObligation`).
 */

// ---------------------------------------------------------------------------
// chunks — split an array into fixed-size subarrays.
// ---------------------------------------------------------------------------

export function chunks<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// batchFetch — call a worker fn in chunks of `batchSize`, concatenating the
// results. klend-sdk uses this to fan out getMultipleAccounts queries.
// ---------------------------------------------------------------------------

export async function batchFetch<In, Out>(
  items: readonly In[],
  worker: (batch: In[]) => Promise<Out[]> | Out[],
  batchSize = 100,
): Promise<Out[]> {
  const out: Out[] = [];
  for (const batch of chunks(items, batchSize)) {
    const res = await worker(batch);
    if (Array.isArray(res)) out.push(...res);
  }
  return out;
}

// ---------------------------------------------------------------------------
// aprToApy — standard APR → APY compounding formula.
// `apr` is expressed as a fraction (0.05 = 5%); `periods` is how many
// compounding periods per year (daily = 365, hourly = 8760). Returns a
// fraction.
// ---------------------------------------------------------------------------

export function aprToApy(apr: number, periods: number): number {
  if (!Number.isFinite(apr) || !Number.isFinite(periods) || periods <= 0) {
    return 0;
  }
  return Math.pow(1 + apr / periods, periods) - 1;
}

// ---------------------------------------------------------------------------
// Catch-all — any other symbol klend-sdk may reach for gets an explicit
// unsupported error so we notice quickly instead of debugging mystery
// `undefined` calls at runtime. `Proxy` lets us trap every access.
// ---------------------------------------------------------------------------

function unsupported(name: string): () => never {
  return () => {
    throw new Error(
      `[LIMINAL/kliquidity-shim] "${name}" is not implemented in the shim. ` +
        `If Kamino's SDK now needs it on a read path we use, extend ` +
        `src/stubs/kliquidity-shim.ts.`,
    );
  };
}

// Named exports are the primary surface; Proxy'd default export covers any
// stray dotted access like `kliquidity.Foo.bar`.
const shim = new Proxy(
  { chunks, batchFetch, aprToApy },
  {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return unsupported(prop);
    },
  },
);

export default shim;
