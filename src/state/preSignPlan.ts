/**
 * LIMINAL — Pre-Sign Plan Orchestrator
 *
 * Level 1 durable-nonce execution plan. Builds every Kamino tx the TWAP
 * will need, wraps each into a durable-nonced V0 tx, and asks Solflare
 * for a single `signAllTransactions` approval. Resulting plan is held
 * in memory (never persisted — nonce authority is the user's wallet,
 * pre-signed payloads contain transient state we can't safely rehydrate
 * across refreshes).
 *
 * Responsibilities:
 *   1. Allocate the nonce pool + broadcast the setup tx (popup #1).
 *   2. Build + sign the operational plan (popup #2).
 *   3. Provide broadcast helpers for each phase (deposit, per-slice
 *      withdraw, final withdraw, cleanup).
 *   4. Expose cleanup helper to reclaim rent at DONE.
 *
 * What we deliberately DON'T do here:
 *   - Quote-dependent swap tx building — swaps stay JIT because Jupiter
 *     Ultra quotes expire in ~10-30s, can't be pre-signed.
 *   - Persistence across refresh — if the tab is closed after plan
 *     signing, the remaining pre-signed payloads are lost. Caller should
 *     fall back to JIT if the plan is absent on resume.
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildCreateNonceAccountsTx,
  buildCloseNonceAccountsTx,
  estimateNoncePoolRent,
  fetchNonceValues,
  generateNoncePool,
  type NoncePoolEntry,
  type NonceValue,
} from "../services/durableNonce";
import { buildDurableTx } from "../utils/durableTx";
import {
  buildDepositInstructions,
  buildFinalWithdrawInstructions,
  buildPartialWithdrawInstructions,
} from "../services/kamino";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignAllFn = <T extends VersionedTransaction>(
  txs: T[],
) => Promise<T[]>;
export type SignOneFn = <T extends VersionedTransaction>(tx: T) => Promise<T>;

/**
 * One durable-nonced, pre-signed transaction bound to a specific slot in
 * the execution plan. `broadcasted = true` after successful confirm;
 * prevents double-broadcast on accidental resume.
 */
export type PreSignedEntry = {
  tx: VersionedTransaction;
  noncePubkey: PublicKey;
  broadcasted: boolean;
};

export type PreSignedPlan = {
  /** Ephemeral keypairs for the nonce accounts — only used by
   *  buildCloseNonceAccountsTx; authority is the user wallet. Kept so
   *  cleanup can locate the accounts. */
  pool: NoncePoolEntry[];
  /** On-chain nonce values as they were at signing time — informational
   *  only; consumed values live inside the pre-signed tx payloads. */
  nonceValues: NonceValue[];
  /** Tx that consumes nonceValues[0]. */
  deposit: PreSignedEntry;
  /** Tx per slice: slicePlan[i] consumes nonceValues[i+1]. */
  slices: PreSignedEntry[];
  /** Tx that consumes nonceValues[N+1]. */
  finalWithdraw: PreSignedEntry;
  /** Rent lamports paid upfront — displayed in UI, refunded on cleanup. */
  rentLamports: number;
};

export type BuildPlanArgs = {
  connection: Connection;
  walletPublicKey: PublicKey;
  inputMint: string;
  /** Total deposit amount in UI (human) units. */
  totalAmount: number;
  /** Per-slice amount (UI units). length === slice count. */
  sliceAmounts: number[];
  signOne: SignOneFn;
  signAll: SignAllFn;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function broadcastAndConfirm(
  tx: VersionedTransaction,
  connection: Connection,
): Promise<string> {
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  // getLatestBlockhash is cheap; we prefer its contextual
  // (blockhash + lastValidBlockHeight) pair over relying on the stored
  // nonce value for confirmation bounds.
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

// ---------------------------------------------------------------------------
// Plan lifecycle
// ---------------------------------------------------------------------------

/**
 * Orchestrate the 2-popup plan build:
 *
 *   Popup #1 (Solflare signTransaction): setup tx creates N+2 nonce
 *     accounts. Broadcast → confirm → fetch nonce values.
 *
 *   Popup #2 (Solflare signAllTransactions): deposit + N slice withdraws
 *     + final withdraw, each durable-nonced. Stored in memory.
 *
 * Throws if the user rejects either popup, or if Kamino ix building
 * fails. Caller surfaces the error to the user and stays in the
 * CONFIGURED state so they can retry or disable pre-sign.
 */
export async function buildAndSignPlan(
  args: BuildPlanArgs,
): Promise<PreSignedPlan> {
  const {
    connection,
    walletPublicKey,
    inputMint,
    totalAmount,
    sliceAmounts,
    signOne,
    signAll,
  } = args;

  if (sliceAmounts.length < 1) {
    throw new Error(
      "preSignPlan: sliceAmounts must contain at least 1 slice.",
    );
  }

  const poolSize = sliceAmounts.length + 2; // deposit + N slices + final
  const pool = generateNoncePool(poolSize);

  // --- Popup #1: setup tx ---------------------------------------------------
  const setupTx = await buildCreateNonceAccountsTx(
    walletPublicKey,
    pool,
    connection,
  );
  const rentLamports = await estimateNoncePoolRent(poolSize, connection);
  const signedSetup = await signOne(setupTx);
  await broadcastAndConfirm(signedSetup, connection);

  const nonceValues = await fetchNonceValues(connection, pool);
  if (nonceValues.length !== poolSize) {
    throw new Error(
      `preSignPlan: expected ${poolSize} nonce values, got ${nonceValues.length}.`,
    );
  }

  // --- Build all operational txs --------------------------------------------
  const depositIxs = await buildDepositInstructions(
    walletPublicKey,
    inputMint,
    totalAmount,
  );
  const sliceIxs = await Promise.all(
    sliceAmounts.map((amount) =>
      buildPartialWithdrawInstructions(walletPublicKey, "", inputMint, amount),
    ),
  );
  const finalIxs = await buildFinalWithdrawInstructions(
    walletPublicKey,
    inputMint,
  );

  const depositTx = buildDurableTx({
    payer: walletPublicKey,
    nonceAccount: pool[0].publicKey,
    nonceAuthority: walletPublicKey,
    nonceValue: nonceValues[0].value,
    instructions: depositIxs.instructions,
    lookupTables: depositIxs.lookupTables,
  });

  const sliceTxs = sliceIxs.map((ixSet, i) =>
    buildDurableTx({
      payer: walletPublicKey,
      nonceAccount: pool[i + 1].publicKey,
      nonceAuthority: walletPublicKey,
      nonceValue: nonceValues[i + 1].value,
      instructions: ixSet.instructions,
      lookupTables: ixSet.lookupTables,
    }),
  );

  const finalTx = buildDurableTx({
    payer: walletPublicKey,
    nonceAccount: pool[poolSize - 1].publicKey,
    nonceAuthority: walletPublicKey,
    nonceValue: nonceValues[poolSize - 1].value,
    instructions: finalIxs.instructions,
    lookupTables: finalIxs.lookupTables,
  });

  // --- Popup #2: signAllTransactions ---------------------------------------
  const all: VersionedTransaction[] = [depositTx, ...sliceTxs, finalTx];
  const signed = await signAll(all);
  if (signed.length !== all.length) {
    throw new Error(
      `preSignPlan: signAll returned ${signed.length} txs, expected ${all.length}. ` +
        "Solflare signing API anomaly — abort and retry.",
    );
  }

  return {
    pool,
    nonceValues,
    deposit: { tx: signed[0], noncePubkey: pool[0].publicKey, broadcasted: false },
    slices: signed.slice(1, 1 + sliceAmounts.length).map((tx, i) => ({
      tx,
      noncePubkey: pool[i + 1].publicKey,
      broadcasted: false,
    })),
    finalWithdraw: {
      tx: signed[signed.length - 1],
      noncePubkey: pool[poolSize - 1].publicKey,
      broadcasted: false,
    },
    rentLamports,
  };
}

/**
 * Broadcast a pre-signed entry. No user popup — this runs automatically
 * when the state machine reaches the right phase. Returns the tx
 * signature. Mutates `entry.broadcasted = true` on success.
 */
export async function broadcastPreSigned(
  entry: PreSignedEntry,
  connection: Connection,
): Promise<string> {
  if (entry.broadcasted) {
    throw new Error(
      "preSignPlan.broadcastPreSigned: entry already broadcasted — refusing double-send.",
    );
  }
  const sig = await broadcastAndConfirm(entry.tx, connection);
  entry.broadcasted = true;
  return sig;
}

/**
 * Close every nonce account in the plan and refund rent. Called after
 * DONE — one popup (#N+3 in the UX count). Errors are non-fatal:
 * cleanup failure just means the user holds ~$2 of SOL in dormant nonce
 * accounts they can reclaim later.
 */
export async function closeNoncePool(
  plan: PreSignedPlan,
  connection: Connection,
  signOne: SignOneFn,
  walletPublicKey: PublicKey,
): Promise<string> {
  const closeTx = await buildCloseNonceAccountsTx(
    walletPublicKey,
    plan.pool,
    connection,
  );
  const signed = await signOne(closeTx);
  return broadcastAndConfirm(signed, connection);
}

// ---------------------------------------------------------------------------
// UI preview helper — how many popups will the user see?
// ---------------------------------------------------------------------------

export type PopupEstimate = {
  /** Upfront, approving the plan: setup + signAll = 2. */
  upfrontPopups: number;
  /** Per-slice JIT swap popups — 1 per slice. */
  jitSwapPopups: number;
  /** Cleanup popup at DONE. */
  cleanupPopups: number;
  /** Sum of the above. */
  total: number;
};

/**
 * Predict popup count for both execution modes so the UI can show a
 * side-by-side comparison in the preview.
 */
export function estimatePopups(
  sliceCount: number,
  preSignEnabled: boolean,
): PopupEstimate {
  if (preSignEnabled) {
    return {
      upfrontPopups: 2,
      jitSwapPopups: sliceCount,
      cleanupPopups: 1,
      total: sliceCount + 3,
    };
  }
  // JIT mode: 1 deposit + N batched(withdraw+swap) + 1 final = N+2 popups,
  // all spread across the execution window requiring user presence.
  return {
    upfrontPopups: 0,
    jitSwapPopups: sliceCount + 2,
    cleanupPopups: 0,
    total: sliceCount + 2,
  };
}
