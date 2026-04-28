import { describe, expect, it, vi } from "vitest";
import {
  Connection,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  MAX_NONCES_PER_SETUP_TX,
  buildAdvanceNonceIx,
  buildCloseNonceAccountsTx,
  buildCreateNonceAccountsTx,
  estimateNoncePoolRent,
  fetchNonceValues,
  generateNoncePool,
} from "./durableNonce";

/**
 * durableNonce is the foundation of the pre-sign execution plan. These
 * tests lock in:
 *   - pool lifecycle invariants (size bounds, keypair uniqueness)
 *   - setup tx shape (N accounts → 2N ixs: create + init per account)
 *   - partial-signing contract (ephemeral keys sign, payer does not)
 *   - advance ix correctness (must be System program, well-formed)
 *   - cleanup tx skips already-closed accounts (non-fatal recovery)
 *   - fetch/close error messages surface the misconfiguration clearly
 */

const PAYER = new PublicKey("GZNrd9GJQHEbnLJsUwcgRs4rH4xKucnU6Y5Y5Y5Y5Y5Y");

function mockConnection(
  overrides: Partial<{
    rent: number;
    blockhash: string;
    accountLamports: (pubkey: PublicKey) => number | null;
    nonceValue: (pubkey: PublicKey) => { nonce: string; authority: PublicKey } | null;
  }> = {},
): Connection {
  const {
    rent = 1_500_000,
    blockhash = "11111111111111111111111111111111",
    accountLamports = () => rent,
    nonceValue = (pk) => ({
      // Non-empty base58 string — durableTx contract only requires
      // truthiness here.
      nonce: `NONCE${pk.toBase58().slice(0, 4)}`,
      authority: PAYER,
    }),
  } = overrides;

  return {
    getMinimumBalanceForRentExemption: vi.fn(async (_len: number) => rent),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash,
      lastValidBlockHeight: 1,
    })),
    getAccountInfo: vi.fn(async (pk: PublicKey) => {
      const lamports = accountLamports(pk);
      return lamports === null ? null : { lamports };
    }),
    getNonce: vi.fn(async (pk: PublicKey) => {
      const v = nonceValue(pk);
      if (!v) return null;
      return {
        authorizedPubkey: v.authority,
        nonce: v.nonce,
        feeCalculator: { lamportsPerSignature: 5000 },
      };
    }),
  } as unknown as Connection;
}

describe("generateNoncePool", () => {
  it("returns `count` entries with matching publicKey and keypair", () => {
    const pool = generateNoncePool(4);
    expect(pool).toHaveLength(4);
    for (const entry of pool) {
      expect(entry.publicKey.equals(entry.keypair.publicKey)).toBe(true);
    }
  });

  it("produces unique addresses (Keypair.generate() randomness)", () => {
    const pool = generateNoncePool(6);
    const addrs = new Set(pool.map((e) => e.publicKey.toBase58()));
    expect(addrs.size).toBe(6);
  });

  it("rejects non-positive or non-integer counts", () => {
    expect(() => generateNoncePool(0)).toThrow(/positive integer/);
    expect(() => generateNoncePool(-1)).toThrow(/positive integer/);
    expect(() => generateNoncePool(1.5)).toThrow(/positive integer/);
  });

  it("rejects counts above MAX_NONCES_PER_SETUP_TX", () => {
    expect(() => generateNoncePool(MAX_NONCES_PER_SETUP_TX + 1)).toThrow(
      /MAX_NONCES_PER_SETUP_TX/,
    );
  });
});

describe("buildCreateNonceAccountsTx", () => {
  it("produces 2 ixs per nonce (createAccount + initialize)", async () => {
    const pool = generateNoncePool(3);
    const conn = mockConnection();
    const tx = await buildCreateNonceAccountsTx(PAYER, pool, conn);

    // V0 message — compiledInstructions present.
    expect(tx.message.compiledInstructions.length).toBe(pool.length * 2);
  });

  it("is partially signed by every pool keypair (payer still pending)", async () => {
    const pool = generateNoncePool(2);
    const conn = mockConnection();
    const tx = await buildCreateNonceAccountsTx(PAYER, pool, conn);

    // Signatures slot: index 0 is payer (zero-filled until Solflare
    // signs), subsequent slots belong to the ephemeral pool keypairs and
    // are non-zero (signed by tx.sign()).
    expect(tx.signatures.length).toBeGreaterThanOrEqual(pool.length + 1);
    const nonzero = tx.signatures.filter((sig) =>
      sig.some((byte) => byte !== 0),
    );
    // Exactly pool.length signatures are non-zero (the ephemeral keys);
    // the payer slot is still all-zeros pending Solflare.
    expect(nonzero.length).toBe(pool.length);
  });

  it("requests rent-exempt funding for NONCE_ACCOUNT_LENGTH", async () => {
    const pool = generateNoncePool(1);
    const conn = mockConnection({ rent: 1_234_567 });
    await buildCreateNonceAccountsTx(PAYER, pool, conn);
    expect(conn.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(
      NONCE_ACCOUNT_LENGTH,
      "confirmed",
    );
  });

  it("rejects empty pool and oversize pool", async () => {
    const conn = mockConnection();
    await expect(buildCreateNonceAccountsTx(PAYER, [], conn)).rejects.toThrow(
      /empty pool/,
    );
    // Build a fake oversize pool that bypasses generateNoncePool's guard
    // so we test the build-side check independently.
    const oversize = [
      ...generateNoncePool(MAX_NONCES_PER_SETUP_TX),
      ...generateNoncePool(1),
    ];
    await expect(
      buildCreateNonceAccountsTx(PAYER, oversize, conn),
    ).rejects.toThrow(/MAX_NONCES_PER_SETUP_TX/);
  });
});

describe("fetchNonceValues", () => {
  it("returns a NonceValue for every pool entry", async () => {
    const pool = generateNoncePool(3);
    const conn = mockConnection();
    const values = await fetchNonceValues(conn, pool);
    expect(values).toHaveLength(3);
    for (let i = 0; i < pool.length; i++) {
      expect(values[i].account.equals(pool[i].publicKey)).toBe(true);
      expect(values[i].value).toMatch(/^NONCE/);
      expect(values[i].authority.equals(PAYER)).toBe(true);
    }
  });

  it("throws with account hint when a nonce is missing", async () => {
    const pool = generateNoncePool(2);
    const conn = mockConnection({ nonceValue: () => null });
    await expect(fetchNonceValues(conn, pool)).rejects.toThrow(
      /not found on-chain/,
    );
  });

  it("returns empty array for empty pool without hitting RPC", async () => {
    const conn = mockConnection();
    const values = await fetchNonceValues(conn, []);
    expect(values).toEqual([]);
    expect(conn.getNonce).not.toHaveBeenCalled();
  });
});

describe("buildAdvanceNonceIx", () => {
  it("targets SystemProgram and carries both nonce + authority keys", () => {
    const pool = generateNoncePool(1);
    const ix = buildAdvanceNonceIx(PAYER, pool[0].publicKey);
    expect(ix.programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    const keyStrs = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keyStrs).toContain(pool[0].publicKey.toBase58());
    expect(keyStrs).toContain(PAYER.toBase58());
  });
});

describe("buildCloseNonceAccountsTx", () => {
  it("builds one nonceWithdraw ix per non-empty account", async () => {
    const pool = generateNoncePool(3);
    const conn = mockConnection();
    const tx = await buildCloseNonceAccountsTx(PAYER, pool, conn);
    expect(tx).not.toBeNull();
    expect(tx!.message.compiledInstructions.length).toBe(3);
  });

  it("skips accounts with zero lamports (already closed — non-fatal)", async () => {
    const pool = generateNoncePool(3);
    const conn = mockConnection({
      accountLamports: (pk) =>
        pk.equals(pool[1].publicKey) ? 0 : 1_500_000,
    });
    const tx = await buildCloseNonceAccountsTx(PAYER, pool, conn);
    expect(tx).not.toBeNull();
    expect(tx!.message.compiledInstructions.length).toBe(2);
  });

  // Bug H-3 (audit): returns null instead of throwing when nothing
  // to clean up. Caller paths treat this as a no-op success.
  it("returns null when every account is already closed", async () => {
    const pool = generateNoncePool(2);
    const conn = mockConnection({ accountLamports: () => 0 });
    const tx = await buildCloseNonceAccountsTx(PAYER, pool, conn);
    expect(tx).toBeNull();
  });

  it("returns null on empty pool (no throw)", async () => {
    const conn = mockConnection();
    const tx = await buildCloseNonceAccountsTx(PAYER, [], conn);
    expect(tx).toBeNull();
  });

  it("requires the payer to be the authority (only their signature needed)", async () => {
    const pool = generateNoncePool(2);
    const conn = mockConnection();
    const tx = await buildCloseNonceAccountsTx(PAYER, pool, conn);
    expect(tx).not.toBeNull();
    // No ephemeral signatures — authority is the payer.
    const nonzero = tx!.signatures.filter((sig) =>
      sig.some((byte) => byte !== 0),
    );
    expect(nonzero.length).toBe(0);
    expect(tx).toBeInstanceOf(VersionedTransaction);
  });
});

describe("estimateNoncePoolRent", () => {
  it("multiplies rent-exempt per-account by count", async () => {
    const conn = mockConnection({ rent: 1_000_000 });
    expect(await estimateNoncePoolRent(6, conn)).toBe(6_000_000);
  });

  it("returns 0 for empty pool without RPC call", async () => {
    const conn = mockConnection();
    expect(await estimateNoncePoolRent(0, conn)).toBe(0);
    expect(conn.getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
  });
});
