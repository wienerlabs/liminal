/**
 * LIMINAL — @solana/kit ↔ @solana/web3.js bridge
 *
 * Kamino SDK v7 was rewritten against @solana/kit (the new functional
 * Solana JS stack), but Solflare + @solana/web3.js are the rest of the
 * LIMINAL runtime. Every write-path instruction produced by a
 * `KaminoAction` lives in kit's `Instruction` shape; to sign and
 * broadcast through Solflare we need to translate those into web3.js
 * `TransactionInstruction`s and wrap them in a `VersionedTransaction`.
 *
 * Correspondence (explicit):
 *
 *   kit                             →  web3.js
 *   ────────────────────────────────────────────────
 *   Address  (base58 string branded) →  PublicKey     (via `new PublicKey(str)`)
 *   Instruction.programAddress       →  TransactionInstruction.programId
 *   Instruction.accounts[i].address  →  TransactionInstruction.keys[i].pubkey
 *   Instruction.accounts[i].role     →  { isSigner, isWritable } bit pair
 *   Instruction.data (Uint8Array)    →  Buffer.from(...)
 *
 * Role mapping (kit's AccountRole enum):
 *
 *   READONLY         (0) → isSigner=false isWritable=false
 *   WRITABLE         (1) → isSigner=false isWritable=true
 *   READONLY_SIGNER  (2) → isSigner=true  isWritable=false
 *   WRITABLE_SIGNER  (3) → isSigner=true  isWritable=true
 *
 * We use kit's own `isSignerRole` / `isWritableRole` helpers instead of
 * hardcoded enum ints so future kit versions that renumber roles still
 * translate correctly.
 */

import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  isSignerRole,
  isWritableRole,
  type Instruction,
  type AccountMeta as KitAccountMeta,
} from "@solana/kit";

/**
 * Kit instruction → web3.js instruction. Preserves account order and
 * role semantics exactly. Throws on unsupported shapes (missing program
 * or unknown address type) so caller sees the bug immediately instead
 * of broadcasting a malformed tx.
 */
export function kitInstructionToWeb3(ix: Instruction): TransactionInstruction {
  if (!ix.programAddress) {
    throw new Error(
      "[kitBridge] kit instruction missing programAddress — cannot translate.",
    );
  }

  const keys: AccountMeta[] = (ix.accounts ?? []).map(
    (account: KitAccountMeta, idx: number) => {
      if (!account.address) {
        throw new Error(
          `[kitBridge] account[${idx}] missing address on instruction for program ${String(ix.programAddress)}.`,
        );
      }
      return {
        pubkey: new PublicKey(account.address),
        isSigner: isSignerRole(account.role),
        isWritable: isWritableRole(account.role),
      };
    },
  );

  // kit exposes `data` as a `ReadonlyUint8Array | undefined`; web3.js wants
  // a Buffer. An absent data field is a legal no-op instruction (rare but
  // possible for marker ixs) — give it an empty buffer.
  const data = ix.data
    ? Buffer.from(ix.data as Uint8Array)
    : Buffer.alloc(0);

  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys,
    data,
  });
}

/**
 * Convenience: translate a batch of kit instructions in order. Used to
 * combine a KaminoAction's `computeBudgetIxs + setupIxs + lendingIxs +
 * cleanupIxs` into the final web3.js instruction list.
 */
export function kitInstructionsToWeb3(
  ixs: readonly Instruction[],
): TransactionInstruction[] {
  return ixs.map(kitInstructionToWeb3);
}
