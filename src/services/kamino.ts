/**
 * LIMINAL — Kamino Lending Service (lazy facade)
 *
 * The real implementation lives in `./kamino-impl.ts`. That file pulls
 * `@kamino-finance/klend-sdk`, `@solana/kit`, `decimal.js`, `bn.js` and
 * via transitive deps a 4.4 MB / 764 kB-gzip chunk. We route every
 * call through a dynamic `import()` here so the chunk only lands in
 * the browser when the user actually reaches Kamino surfaces —
 * WalletPanel "positions" polling, VaultPreview on token-pair select,
 * or an execution start.
 *
 * Type-only re-exports stay synchronous — types erase at build time
 * and don't trigger the dep.
 *
 * NOT changed: public API signatures and semantics. Every consumer
 * (`useKaminoPosition`, `useActiveKaminoPositions`, `executionMachine`,
 * `VaultPreview`) is unaware this is now async-loaded.
 */

import type {
  PublicKey,
  AddressLookupTableAccount,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

export type {
  KaminoVault,
  KaminoPositionData,
  ActiveKaminoPosition,
  SignTransactionFn,
} from "./kamino-impl";

type ImplModule = typeof import("./kamino-impl");

let implPromise: Promise<ImplModule> | null = null;

/**
 * Idempotent loader. First caller triggers the `import()`; every other
 * caller shares the same promise. Failure is not cached — the next call
 * retries (useful when a transient bundle-fetch fails due to network).
 */
function loadImpl(): Promise<ImplModule> {
  if (!implPromise) {
    implPromise = import("./kamino-impl").catch((err) => {
      implPromise = null;
      throw err;
    });
  }
  return implPromise;
}

/**
 * Optional: warm the chunk before any user interaction. Call from a
 * component `useEffect` to start the SDK download during idle time so
 * the first real call (e.g. clicking START EXECUTION) doesn't stall
 * waiting on the chunk network request.
 */
export function preloadKamino(): void {
  void loadImpl();
}

// ---------------------------------------------------------------------------
// Public API — mirrored 1:1 from ./kamino-impl, each fn await-delegates.
// ---------------------------------------------------------------------------

export async function getAvailableVaults(
  ...args: Parameters<ImplModule["getAvailableVaults"]>
): ReturnType<ImplModule["getAvailableVaults"]> {
  const m = await loadImpl();
  return m.getAvailableVaults(...args);
}

export async function selectOptimalVault(
  ...args: Parameters<ImplModule["selectOptimalVault"]>
): ReturnType<ImplModule["selectOptimalVault"]> {
  const m = await loadImpl();
  return m.selectOptimalVault(...args);
}

export async function getPositionValue(
  ...args: Parameters<ImplModule["getPositionValue"]>
): ReturnType<ImplModule["getPositionValue"]> {
  const m = await loadImpl();
  return m.getPositionValue(...args);
}

export async function getActivePositions(
  ...args: Parameters<ImplModule["getActivePositions"]>
): ReturnType<ImplModule["getActivePositions"]> {
  const m = await loadImpl();
  return m.getActivePositions(...args);
}

export async function invalidateKaminoMarketCache(): Promise<void> {
  const m = await loadImpl();
  m.invalidateKaminoMarketCache();
}

export async function deposit(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  amount: number,
  signTransaction: ImplModule["deposit"] extends (
    ...args: infer P
  ) => unknown
    ? P[4]
    : never,
): ReturnType<ImplModule["deposit"]> {
  const m = await loadImpl();
  return m.deposit(
    walletPublicKey,
    vaultMarketAddress,
    tokenMint,
    amount,
    signTransaction,
  );
}

export async function partialWithdraw(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
  signTransaction: ImplModule["partialWithdraw"] extends (
    ...args: infer P
  ) => unknown
    ? P[4]
    : never,
): ReturnType<ImplModule["partialWithdraw"]> {
  const m = await loadImpl();
  return m.partialWithdraw(
    walletPublicKey,
    vaultMarketAddress,
    tokenMint,
    tokenAmount,
    signTransaction,
  );
}

export async function finalWithdraw(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  signTransaction: ImplModule["finalWithdraw"] extends (
    ...args: infer P
  ) => unknown
    ? P[2]
    : never,
  options?: { tokenMint?: string; trackedDepositedAmount?: number },
): ReturnType<ImplModule["finalWithdraw"]> {
  const m = await loadImpl();
  return m.finalWithdraw(
    walletPublicKey,
    vaultMarketAddress,
    signTransaction,
    options,
  );
}

export async function buildPartialWithdrawInstructions(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  const m = await loadImpl();
  return m.buildPartialWithdrawInstructions(
    walletPublicKey,
    vaultMarketAddress,
    tokenMint,
    tokenAmount,
  );
}

/**
 * Unsigned deposit ixs for the durable-nonce pre-signing path. Mirrors
 * `deposit()` but returns ixs instead of broadcasting. Consumers wrap
 * the output with `buildDurableTx` and request a single
 * `signAllTransactions` popup alongside every other plan tx.
 */
export async function buildDepositInstructions(
  walletPublicKey: PublicKey,
  tokenMint: string,
  amount: number,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  const m = await loadImpl();
  return m.buildDepositInstructions(walletPublicKey, tokenMint, amount);
}

/**
 * Unsigned final-withdraw ixs (U64_MAX drain) for the durable-nonce
 * pre-signing path. Caller wraps in `buildDurableTx`.
 */
export async function buildFinalWithdrawInstructions(
  walletPublicKey: PublicKey,
  tokenMint: string,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  const m = await loadImpl();
  return m.buildFinalWithdrawInstructions(walletPublicKey, tokenMint);
}

// Re-export the program ID for Solana Explorer link building. Accessing
// it eagerly would defeat the lazy-load point, so callers that need the
// raw string await this promise once and cache it.
let cachedProgramId: string | null = null;
export async function getKaminoLendingProgramId(): Promise<string> {
  if (cachedProgramId) return cachedProgramId;
  const m = await loadImpl();
  cachedProgramId = m.KAMINO_LENDING_PROGRAM_ID_STR;
  return cachedProgramId;
}

// Suppress unused-import warning from the TypeScript side — the types
// are imported solely so the signatures above compile.
export type _UnusedKaminoFacadeTypes = VersionedTransaction;
