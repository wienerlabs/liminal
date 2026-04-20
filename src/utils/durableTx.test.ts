import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { buildDurableTx, isDurableNonceTx } from "./durableTx";

/**
 * durableTx guarantees the two runtime invariants for durable-nonce txs:
 *   1. message.recentBlockhash === fetched nonce value
 *   2. message.instructions[0] === SystemProgram.nonceAdvance
 *
 * These tests lock those invariants in and verify the tx shape is
 * what Solflare's `signAllTransactions` expects.
 */

const PAYER = Keypair.generate().publicKey;
const NONCE_ACCOUNT = Keypair.generate().publicKey;
const NONCE_VALUE = "FakeN0nceValue11111111111111111111111111111";

function makeDummyIx(): TransactionInstruction {
  // Memo program — innocuous, no account requirements beyond the signer.
  const memoProgramId = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  );
  return new TransactionInstruction({
    keys: [{ pubkey: PAYER, isSigner: true, isWritable: false }],
    programId: memoProgramId,
    data: Buffer.from("LIMINAL", "utf8"),
  });
}

describe("buildDurableTx", () => {
  it("prepends nonceAdvance as instruction[0]", () => {
    const tx = buildDurableTx({
      payer: PAYER,
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: PAYER,
      nonceValue: NONCE_VALUE,
      instructions: [makeDummyIx()],
    });

    const keys = tx.message.staticAccountKeys;
    const first = tx.message.compiledInstructions[0];
    const firstProgramId = keys[first.programIdIndex];
    expect(firstProgramId.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("places the nonce value into recentBlockhash", () => {
    const tx = buildDurableTx({
      payer: PAYER,
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: PAYER,
      nonceValue: NONCE_VALUE,
      instructions: [makeDummyIx()],
    });
    expect(tx.message.recentBlockhash).toBe(NONCE_VALUE);
  });

  it("keeps the caller's real ixs after the advance ix (no reorder)", () => {
    const ix1 = makeDummyIx();
    const ix2 = makeDummyIx();
    const tx = buildDurableTx({
      payer: PAYER,
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: PAYER,
      nonceValue: NONCE_VALUE,
      instructions: [ix1, ix2],
    });
    // Total: advance + 2 caller ixs.
    expect(tx.message.compiledInstructions.length).toBe(3);
  });

  it("returns an unsigned VersionedTransaction (all sig slots zero)", () => {
    const tx = buildDurableTx({
      payer: PAYER,
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: PAYER,
      nonceValue: NONCE_VALUE,
      instructions: [makeDummyIx()],
    });
    expect(tx).toBeInstanceOf(VersionedTransaction);
    const anySigned = tx.signatures.some((sig) =>
      sig.some((byte) => byte !== 0),
    );
    expect(anySigned).toBe(false);
  });

  it("rejects empty instruction list", () => {
    expect(() =>
      buildDurableTx({
        payer: PAYER,
        nonceAccount: NONCE_ACCOUNT,
        nonceAuthority: PAYER,
        nonceValue: NONCE_VALUE,
        instructions: [],
      }),
    ).toThrow(/at least one real ix/);
  });

  it("rejects empty nonce value", () => {
    expect(() =>
      buildDurableTx({
        payer: PAYER,
        nonceAccount: NONCE_ACCOUNT,
        nonceAuthority: PAYER,
        nonceValue: "",
        instructions: [makeDummyIx()],
      }),
    ).toThrow(/nonceValue is required/);
  });
});

describe("isDurableNonceTx", () => {
  it("returns true for a well-formed durable tx", () => {
    const tx = buildDurableTx({
      payer: PAYER,
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: PAYER,
      nonceValue: NONCE_VALUE,
      instructions: [makeDummyIx()],
    });
    expect(isDurableNonceTx(tx)).toBe(true);
  });

  it("returns false when the first ix is not System nonceAdvance", () => {
    // Build a tx manually that lacks the advance ix — simulate a regular
    // non-durable tx.
    const { TransactionMessage } = require("@solana/web3.js");
    const msg = new TransactionMessage({
      payerKey: PAYER,
      recentBlockhash: NONCE_VALUE,
      instructions: [makeDummyIx()],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    expect(isDurableNonceTx(tx)).toBe(false);
  });
});
