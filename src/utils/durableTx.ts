/**
 * LIMINAL — Durable-Nonce Transaction Builder
 *
 * Solana'da "durable nonce" ile imzalanmış bir transaction'ın iki zorunlu
 * özelliği vardır:
 *
 *   1. `recentBlockhash` slot'u **on-chain nonce değeri** ile doldurulur —
 *      gerçek son blockhash değil. (Runtime bu değeri nonce advance ix'i
 *      tarafından consume edildikten sonra tx'in hala valid olmasını bu
 *      sayede garanti eder.)
 *   2. Mesajın **İLK** instruction'ı `SystemProgram.nonceAdvance` olmalı.
 *      Bu zorunluluk runtime tarafından kontrol edilir; bozulan tx
 *      `ProgramError::InvalidAccountData` ile reject edilir.
 *
 * Bu modül yukarıdaki iki invariant'ı tek bir builder arkasında toplar ve
 * `VersionedTransaction` döndürür — çağıranın imzayı sonradan atmasına
 * (Solflare `signAllTransactions`) izin verir.
 *
 * Kullanım:
 *
 * ```ts
 * const tx = buildDurableTx({
 *   payer: walletPublicKey,
 *   nonceAccount: pool[0].publicKey,
 *   nonceAuthority: walletPublicKey,
 *   nonceValue: values[0].value,
 *   instructions: kaminoDepositIxs,
 *   lookupTables: [],
 * });
 * const signed = await wallet.signAllTransactions([tx, ...]);
 * // Broadcast edilmeden önce nonce saatlerce geçerli kalır.
 * ```
 */

import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import { buildAdvanceNonceIx } from "../services/durableNonce";

// ---------------------------------------------------------------------------
// Args & builder
// ---------------------------------------------------------------------------

export type BuildDurableTxArgs = {
  /** Fee payer and signer of the payload. Usually the user's wallet. */
  payer: PublicKey;
  /** The nonce account used to keep this tx durable. */
  nonceAccount: PublicKey;
  /** The authority that can advance the nonce — must equal payer unless
   *  you intentionally set a different authority at init time. Passing
   *  both separately guards against accidental drift. */
  nonceAuthority: PublicKey;
  /** Current on-chain nonce value fetched via `fetchNonceValues`. This
   *  replaces `recentBlockhash` in the compiled message. */
  nonceValue: string;
  /** The real work of the tx — Kamino deposit/withdraw, SPL approve,
   *  whatever. `nonceAdvance` will be prepended automatically; do NOT
   *  include it here. */
  instructions: TransactionInstruction[];
  /** Optional address lookup tables for V0 compilation. Kamino v7
   *  doesn't need these on the read/write path, but the batcher's Ultra
   *  swap path uses them, so we accept them for symmetry. */
  lookupTables?: AddressLookupTableAccount[];
};

/**
 * Compile a V0 durable-nonced VersionedTransaction. Returned tx is
 * UNSIGNED — caller partially-signs or delegates to a wallet adapter.
 */
export function buildDurableTx(
  args: BuildDurableTxArgs,
): VersionedTransaction {
  const {
    payer,
    nonceAccount,
    nonceAuthority,
    nonceValue,
    instructions,
    lookupTables,
  } = args;

  if (!nonceValue) {
    throw new Error(
      "durableTx.buildDurableTx: nonceValue is required and must be a non-empty string.",
    );
  }
  if (instructions.length === 0) {
    throw new Error(
      "durableTx.buildDurableTx: instructions must contain at least one real ix " +
        "(nonceAdvance is prepended automatically).",
    );
  }

  const advance = buildAdvanceNonceIx(nonceAuthority, nonceAccount);

  const message = new TransactionMessage({
    payerKey: payer,
    // Runtime reads this slot as the nonce when ix[0] is nonceAdvance.
    recentBlockhash: nonceValue,
    instructions: [advance, ...instructions],
  }).compileToV0Message(lookupTables ?? []);

  return new VersionedTransaction(message);
}

// ---------------------------------------------------------------------------
// Invariant helper — for tests / debug only. Returns true if `tx` looks
// like a valid durable-nonced transaction (first ix is System
// nonceAdvance). Does NOT validate the nonce value itself.
// ---------------------------------------------------------------------------

const SYSTEM_PROGRAM_ID_STR = "11111111111111111111111111111111";
const NONCE_ADVANCE_DISCRIMINATOR = 4; // SystemInstruction::AdvanceNonceAccount

/**
 * Check whether a compiled VersionedTransaction satisfies the durable
 * nonce runtime requirements. Returns `true` iff the first compiled ix is
 * SystemProgram nonceAdvance.
 *
 * This is intended for defensive checks in the execution pipeline (a
 * regression test in the hot path is cheap insurance). It reads the
 * compiled message, not the pre-compile args, so it works even on txs
 * received from persistence / re-signed elsewhere.
 */
export function isDurableNonceTx(tx: VersionedTransaction): boolean {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  const compiled = msg.compiledInstructions;
  if (compiled.length === 0) return false;

  const first = compiled[0];
  const programId = keys[first.programIdIndex];
  if (!programId) return false;
  if (programId.toBase58() !== SYSTEM_PROGRAM_ID_STR) return false;

  // SystemInstruction layouts are little-endian u32 discriminators.
  const data = first.data;
  if (data.length < 4) return false;
  const disc =
    data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  return disc === NONCE_ADVANCE_DISCRIMINATOR;
}

// ---------------------------------------------------------------------------
// Integration path (executionMachine — follow-up PR)
// ---------------------------------------------------------------------------
//
// Expected flow once wired end-to-end:
//
//   CONFIGURED → click "Başlat"
//     → pool = generateNoncePool(sliceCount + 2)
//     → setupTx = buildCreateNonceAccountsTx(payer, pool, conn)
//     → solflare.signTransaction(setupTx) → broadcast → confirm  [POPUP 1]
//     → values = fetchNonceValues(conn, pool)
//     → plan = [
//         buildDurableTx(deposit ixs, values[0]),
//         buildDurableTx(slice 1 withdraw ixs, values[1]),
//         ...,
//         buildDurableTx(slice N withdraw ixs, values[N]),
//         buildDurableTx(final withdraw ixs, values[N+1]),
//       ]
//     → solflare.signAllTransactions(plan) → stored in state  [POPUP 2]
//   DEPOSITING:
//     → broadcast plan[0] → confirm (no popup)
//   ACTIVE → per slice:
//     → wait for target timestamp
//     → broadcast plan[sliceIndex + 1] (pre-signed withdraw) → confirm
//     → fetch fresh Jupiter Ultra quote → JIT sign + broadcast  [POPUP 3..N+2]
//   COMPLETING:
//     → broadcast plan[N+1] (final withdraw) → confirm (no popup)
//     → buildCloseNonceAccountsTx → solflare.sign → broadcast  [POPUP N+3]
//
// Total user popups for 4-slice TWAP: 2 (setup + signAll) + 4 (JIT swaps)
// + 1 (cleanup) = 7 popups — but popups 2..5 can be answered with push
// notifications (Level 2), so the user is only screen-bound for popups
// 1, 2, and the cleanup.
