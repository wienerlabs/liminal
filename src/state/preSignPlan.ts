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
import { isDurableNonceTx } from "../utils/durableTx";
import {
  buildCreateNonceAccountsTx,
  buildCloseNonceAccountsTx,
  estimateNoncePoolRent,
  fetchNonceValues,
  generateNoncePool,
  MAX_NONCES_PER_SETUP_TX,
  type NoncePoolEntry,
  type NonceValue,
} from "../services/durableNonce";

/**
 * Maximum slice count compatible with autopilot mode. The setup tx
 * creates `sliceCount + 2` nonce accounts (deposit + slices + final),
 * which must all fit in a single V0 transaction (capped by
 * MAX_NONCES_PER_SETUP_TX). Beyond this the user must either disable
 * autopilot (JIT mode has no such ceiling) or split — splitting is
 * out of scope for now.
 */
export const MAX_AUTOPILOT_SLICES: number = MAX_NONCES_PER_SETUP_TX - 2;
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
  /**
   * Kamino vault (reserve) address for the deposit/withdraw flow. Passed
   * through to `buildPartialWithdrawInstructions` for explicit routing.
   * BUG FIX (H-2, audit): previously sent as `""`, relying on
   * kamino-impl's `loadReserveByMint` to pick the first matching reserve
   * — silent contract violation if Kamino ever adds multiple reserves
   * for the same mint.
   */
  kaminoVaultAddress: string;
  signOne: SignOneFn;
  signAll: SignAllFn;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect Solana RPC errors that indicate the tx's `recentBlockhash` is
 * stale and the tx must be rebuilt. Solana cluster, RPC providers, and
 * Solflare's signing layer each phrase this differently — match
 * loosely on the canonical strings.
 */
function isStaleBlockhashError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  return /BlockhashNotFound|block height exceeded|blockhash.*expired/i.test(
    msg,
  );
}

async function broadcastAndConfirm(
  tx: VersionedTransaction,
  connection: Connection,
): Promise<string> {
  // skipPreflight: true — autopilot pre-signed plans bundle Kamino
  // deposit/withdraw + DFlow swap into versioned-tx slices. Solflare's
  // signing pass can mutate priority-fee instructions which shifts the
  // message hash off the signed bytes; preflight then rejects with
  // "did not pass signature verification, logs:[]". On-chain
  // execution validates signatures regardless, and we already ran
  // simulateTransaction during plan build, so the redundant preflight
  // is a fragility tax with no security benefit.
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  // BUG FIX (M-5, audit): durable-nonce txs don't expire when
  // blockhash rotates — they're tied to the on-chain nonce value.
  // Confirming with a freshly-fetched blockhash + lastValidBlockHeight
  // would incorrectly time out if the tx happens to land after that
  // block height is exceeded, even though the tx is still valid on
  // chain. The signature-only form is the correct strategy for
  // durable-nonced transactions.
  //
  // Setup + cleanup txs use a regular recentBlockhash and DO need
  // the (blockhash, lastValidBlockHeight) strategy for proper
  // expiry handling. Detect via instruction[0] being the
  // SystemProgram nonceAdvance.
  if (isDurableNonceTx(tx)) {
    // Use the deprecated signature-only form. web3.js' newer
    // DurableNonceTransactionConfirmationStrategy requires nonce
    // account + value lookup — the signature-only form polls
    // getSignatureStatus which works regardless of nonce state.
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  // Non-durable (setup, cleanup) — proper blockheight-based strategy.
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
    kaminoVaultAddress,
    signOne,
    signAll,
  } = args;

  if (sliceAmounts.length < 1) {
    throw new Error(
      "preSignPlan: sliceAmounts must contain at least 1 slice.",
    );
  }
  if (sliceAmounts.length > MAX_AUTOPILOT_SLICES) {
    throw new Error(
      `Autopilot mode supports at most ${MAX_AUTOPILOT_SLICES} slices ` +
        `(current: ${sliceAmounts.length}). Either reduce the slice count or ` +
        `turn off autopilot to use the classic JIT path.`,
    );
  }

  const poolSize = sliceAmounts.length + 2; // deposit + N slices + final
  const pool = generateNoncePool(poolSize);

  // --- Popup #1: setup tx ---------------------------------------------------
  // The setup tx uses a regular recentBlockhash (the nonce accounts
  // don't exist yet, so they can't durable-nonce themselves). If the
  // user lingers in the Solflare popup for >60s, the blockhash will
  // be stale and broadcast will fail with `BlockhashNotFound`. We
  // retry once with a freshly built tx (the ephemeral keypairs sign
  // the new message hash via their stored secret keys) before giving
  // up.
  const rentLamports = await estimateNoncePoolRent(poolSize, connection);
  const signedSetup = await signOne(
    await buildCreateNonceAccountsTx(walletPublicKey, pool, connection),
  );
  try {
    await broadcastAndConfirm(signedSetup, connection);
  } catch (err) {
    if (!isStaleBlockhashError(err)) throw err;
    // Rebuild + re-sign once (the original signature is invalid because
    // the message bytes changed with the new blockhash).
    const freshTx = await buildCreateNonceAccountsTx(
      walletPublicKey,
      pool,
      connection,
    );
    const freshSigned = await signOne(freshTx);
    await broadcastAndConfirm(freshSigned, connection);
  }

  // BUG FIX (HH): from this point onward the setup tx has confirmed
  // and N+2 nonce accounts hold our rent on chain. Any failure between
  // here and the successful return would otherwise abandon them — the
  // ephemeral keypairs only existed in this function's scope so we'd
  // lose the ability to authorize a future cleanup. Wrap the rest of
  // the build in a try/catch that runs a best-effort closeNoncePool
  // before re-throwing. User sees one extra Solflare popup but reclaims
  // ~$2 of rent. If they reject the cleanup popup too, log the loss
  // (still recoverable manually with `nonceWithdraw`).
  try {
    const nonceValues = await fetchNonceValues(connection, pool);
    if (nonceValues.length !== poolSize) {
      throw new Error(
        `preSignPlan: expected ${poolSize} nonce values, got ${nonceValues.length}.`,
      );
    }

    // --- Build all operational txs ------------------------------------
    const depositIxs = await buildDepositInstructions(
      walletPublicKey,
      inputMint,
      totalAmount,
    );
    const sliceIxs = await Promise.all(
      sliceAmounts.map((amount) =>
        buildPartialWithdrawInstructions(
          walletPublicKey,
          kaminoVaultAddress,
          inputMint,
          amount,
        ),
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

    // --- Popup #2: signAllTransactions -------------------------------
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
      deposit: {
        tx: signed[0],
        noncePubkey: pool[0].publicKey,
        broadcasted: false,
      },
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
  } catch (err) {
    // Plan build failed AFTER setup confirmed → reclaim the abandoned
    // nonce rent before propagating. Best-effort: every step is
    // wrapped so a cleanup-time failure never masks the original
    // build error (which is what the user actually needs to see).
    console.warn(
      `[LIMINAL] Plan build failed after setup confirmed (${err instanceof Error ? err.message : String(err)}); ` +
        "attempting to reclaim ~$2 of nonce rent...",
    );
    try {
      const closeTx = await buildCloseNonceAccountsTx(
        walletPublicKey,
        pool,
        connection,
      );
      // BUG FIX (H-3, audit): null return = nothing to close (e.g.
      // setup tx confirmed but accounts somehow already drained).
      // Skip cleanly without surfacing as an error.
      if (closeTx) {
        const signedClose = await signOne(closeTx);
        await broadcastAndConfirm(signedClose, connection);
        console.warn(
          "[LIMINAL] Auto-reclaim succeeded — nonce accounts closed, rent refunded.",
        );
      } else {
        console.warn(
          "[LIMINAL] Auto-reclaim no-op: nonce accounts already drained.",
        );
      }
    } catch (cleanupErr) {
      console.warn(
        `[LIMINAL] Auto-reclaim failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}. ` +
          `${pool.length} nonce account(s) hold rent on chain — recoverable manually with nonceWithdraw.`,
      );
    }
    throw err;
  }
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
): Promise<string | null> {
  const closeTx = await buildCloseNonceAccountsTx(
    walletPublicKey,
    plan.pool,
    connection,
  );
  // BUG FIX (H-3, audit): build returns null when there's nothing to
  // clean up. Skip the popup + broadcast in that case — caller treats
  // this as a no-op success.
  if (!closeTx) return null;
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
