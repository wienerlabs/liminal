/**
 * LIMINAL — Durable Nonce Pool Service
 *
 * BLOK 2 "Kritik Tasarım Kararı: Transaction Sayısını Minimize Et" maddesi
 * batching'i emrediyor; bu modül bir adım ileri gider ve **bekletme süresini
 * de minimize eder**.
 *
 * Problem: TWAP execution 30dk–4sa sürebiliyor. Her slice için kullanıcıyı
 * Solflare popup'ına teslim etmek kullanıcıyı ekran başında tutar —
 * fundamental bir UX sorunu. Durable nonce, tx blockhash'inin yerine
 * on-chain bir nonce değeri koyar; bu tx saatlerce stale olmaz, execution
 * anında broadcast edilir.
 *
 * Mimari:
 *   1. `generateNoncePool(N)` N ephemeral Keypair üretir (lifecycle: tek
 *      execution). Keypair'ler sadece hesapları INIT etmek için imzalar;
 *      sonrasında authority wallet'tır, ephemeral key atılır.
 *   2. `buildCreateNonceAccountsTx(payer, pool)` tek bir V0 tx içinde
 *      tüm hesapları oluşturur ve initialize eder. Bu tx payer + pool'daki
 *      her Keypair tarafından kısmi imzalı döner; geriye Solflare imzası
 *      kalır.
 *   3. `fetchNonceValues(conn, pool)` setup confirm olduktan sonra
 *      on-chain nonce değerlerini çeker — bunlar durable tx'lerin
 *      "recentBlockhash" slot'una oturacaktır.
 *   4. `buildAdvanceNonceIx(authority, noncePubkey)` her durable tx'in
 *      İLK instruction'ı olmalıdır — bu Solana runtime tarafından zorunlu.
 *   5. `buildCloseNonceAccountsTx(payer, pool)` execution sonunda rent'i
 *      geri alır. Her account ~0.00148 SOL rent-exempt, kayıp sıfırdır.
 *
 * Rent: N=6 slice için 6 × 0.00148 = 0.00888 SOL upfront, execution sonunda
 * tamamı geri döner. Net maliyet = sadece cleanup tx'in network fee'si.
 *
 * Authority modeli: nonce'u advance edebilen tek entity payer (kullanıcı
 * cüzdanı). Ephemeral Keypair sadece init aşamasında imza verir —
 * authority'yi kullanıcıya devreder, kendisi sonradan gereksizdir.
 *
 * Kurallar:
 *   - BLOK 6 commitment `confirmed` (kural 6) — finalized beklemez.
 *   - BLOK 6 timeout 60s (kural 7) — nonce fetch'te aynı.
 *   - Simulation BLOK 6 kural 5 uyarınca tx broadcast öncesi ZORUNLU
 *     (simulation bu modülde değil, çağıran executionMachine içinde).
 */

import {
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A durable nonce account allocated for a single execution. `keypair` is the
 * ephemeral signer that initializes the account; after setup confirms, only
 * `authority` can advance the nonce.
 *
 * Lifecycle:
 *   1. created by `generateNoncePool` — on-chain yokluk, sadece keypair.
 *   2. initialized by `buildCreateNonceAccountsTx` broadcast + confirm.
 *   3. value queried by `fetchNonceValues` → on-chain nonce blob.
 *   4. consumed by each durable tx broadcast (nonceAdvance ix).
 *   5. closed by `buildCloseNonceAccountsTx` — rent refund.
 */
export type NoncePoolEntry = {
  /** Ephemeral keypair whose public key IS the nonce account address. */
  keypair: Keypair;
  /** Convenience: `keypair.publicKey`. Immutable after creation. */
  publicKey: PublicKey;
};

/**
 * A materialized nonce value fetched from chain. `value` is the base58
 * string that goes into `TransactionMessage.recentBlockhash`.
 */
export type NonceValue = {
  account: PublicKey;
  value: string;
  authority: PublicKey;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Setup/cleanup tx pack size. A single V0 transaction can comfortably fit
 * ~8 createAccount + nonceInitialize pairs before touching the 1232-byte
 * MTU. For our TWAP (max ~6 slices + deposit + final) we stay well under.
 */
export const MAX_NONCES_PER_SETUP_TX = 8;

// ---------------------------------------------------------------------------
// Pool lifecycle
// ---------------------------------------------------------------------------

/**
 * Allocate `count` ephemeral Keypairs. Nothing on-chain yet — these
 * addresses are just future nonce account pubkeys.
 *
 * `count` expected range: 1..MAX_NONCES_PER_SETUP_TX. Larger pools will be
 * rejected upfront so the caller never builds a setup tx that would
 * overrun MTU.
 */
export function generateNoncePool(count: number): NoncePoolEntry[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `durableNonce.generateNoncePool: count must be a positive integer (got ${count}).`,
    );
  }
  if (count > MAX_NONCES_PER_SETUP_TX) {
    throw new Error(
      `durableNonce.generateNoncePool: pool size ${count} exceeds ` +
        `MAX_NONCES_PER_SETUP_TX=${MAX_NONCES_PER_SETUP_TX}. Split into multiple setup txs.`,
    );
  }
  const pool: NoncePoolEntry[] = [];
  for (let i = 0; i < count; i++) {
    const keypair = Keypair.generate();
    pool.push({ keypair, publicKey: keypair.publicKey });
  }
  return pool;
}

/**
 * Build a single V0 VersionedTransaction that creates and initializes every
 * entry in `pool`. Returns a partially-signed tx — each pool keypair has
 * already signed (each must sign its own createAccount ix); the payer
 * wallet must sign via Solflare before broadcast.
 *
 * Nonce accounts are created rent-exempt for `NONCE_ACCOUNT_LENGTH` bytes.
 * Authority is set to `payer` so only the user's wallet can advance or
 * close them post-setup — the ephemeral keypair has no further power.
 */
export async function buildCreateNonceAccountsTx(
  payer: PublicKey,
  pool: NoncePoolEntry[],
  connection: Connection,
): Promise<VersionedTransaction> {
  if (pool.length === 0) {
    throw new Error(
      "durableNonce.buildCreateNonceAccountsTx: empty pool — nothing to create.",
    );
  }
  if (pool.length > MAX_NONCES_PER_SETUP_TX) {
    throw new Error(
      `durableNonce.buildCreateNonceAccountsTx: pool size ${pool.length} exceeds ` +
        `MAX_NONCES_PER_SETUP_TX=${MAX_NONCES_PER_SETUP_TX}.`,
    );
  }

  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH,
    "confirmed",
  );

  // SystemProgram.createNonceAccount returns a legacy Transaction that
  // contains TWO ixs per call: SystemProgram.createAccount + nonceInitialize.
  // We strip the Transaction wrapper, flatten ixs into our V0 message.
  const instructions: TransactionInstruction[] = [];
  for (const entry of pool) {
    const legacyTx = SystemProgram.createNonceAccount({
      fromPubkey: payer,
      noncePubkey: entry.publicKey,
      authorizedPubkey: payer,
      lamports: rentLamports,
    });
    for (const ix of legacyTx.instructions) {
      instructions.push(ix);
    }
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  // Each pool keypair must sign its own createAccount. Partial-sign; payer
  // (Solflare) will add the final signature when the user approves.
  tx.sign(pool.map((e) => e.keypair));
  return tx;
}

/**
 * Fetch the current on-chain nonce value for each pool entry. Must be
 * called AFTER the setup tx confirms — before that the accounts don't
 * exist and getNonceAndContext returns null.
 *
 * Any null/missing account is a hard error — the execution plan built on
 * top depends on every nonce being live.
 */
export async function fetchNonceValues(
  connection: Connection,
  pool: NoncePoolEntry[],
): Promise<NonceValue[]> {
  if (pool.length === 0) return [];

  const results = await Promise.all(
    pool.map(async (entry): Promise<NonceValue> => {
      const nonce = await connection.getNonce(entry.publicKey, "confirmed");
      if (!nonce) {
        throw new Error(
          `durableNonce.fetchNonceValues: account ${entry.publicKey.toBase58().slice(0, 8)}… ` +
            "not found on-chain. Did the setup tx confirm?",
        );
      }
      return {
        account: entry.publicKey,
        value: nonce.nonce,
        authority: nonce.authorizedPubkey,
      };
    }),
  );
  return results;
}

/**
 * Deserialize raw account data into a NonceAccount. Exposed for callers
 * that already have the raw bytes (e.g. batched getMultipleAccountsInfo
 * reads) and want to avoid a per-account RPC round trip.
 */
export function decodeNonceAccount(data: Buffer | Uint8Array): NonceAccount {
  return NonceAccount.fromAccountData(data);
}

// ---------------------------------------------------------------------------
// Instruction builders — used by durableTx.ts
// ---------------------------------------------------------------------------

/**
 * Build the nonceAdvance instruction that MUST be the first ix of every
 * durable-nonced transaction. Solana runtime requires this ordering and
 * will reject the tx otherwise.
 */
export function buildAdvanceNonceIx(
  authority: PublicKey,
  noncePubkey: PublicKey,
): TransactionInstruction {
  return SystemProgram.nonceAdvance({
    noncePubkey,
    authorizedPubkey: authority,
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Build a tx that closes every nonce account, refunding rent back to
 * `payer`. Intended to run AFTER the execution completes (DONE state) so
 * the user reclaims the ~0.00148 SOL × N upfront cost.
 *
 * Safe to call even if some nonces were consumed — `nonceWithdraw` just
 * drains whatever's left and zeroes the account. If the account no
 * longer exists (already closed) the tx will fail; caller should tolerate
 * partial cleanup as non-fatal.
 */
export async function buildCloseNonceAccountsTx(
  payer: PublicKey,
  pool: NoncePoolEntry[],
  connection: Connection,
): Promise<VersionedTransaction> {
  if (pool.length === 0) {
    throw new Error(
      "durableNonce.buildCloseNonceAccountsTx: empty pool — nothing to close.",
    );
  }

  // Drain each account's full lamports balance — that's the rent we paid
  // plus anything else that's been deposited. Using the full balance is
  // why we fetch each account's lamports first.
  const lamports = await Promise.all(
    pool.map(async (entry) => {
      const info = await connection.getAccountInfo(entry.publicKey, "confirmed");
      return info?.lamports ?? 0;
    }),
  );

  const instructions: TransactionInstruction[] = [];
  for (let i = 0; i < pool.length; i++) {
    const entry = pool[i];
    const balance = lamports[i];
    if (balance <= 0) continue; // already closed — skip silently
    instructions.push(
      SystemProgram.nonceWithdraw({
        noncePubkey: entry.publicKey,
        authorizedPubkey: payer,
        toPubkey: payer,
        lamports: balance,
      }),
    );
  }

  if (instructions.length === 0) {
    throw new Error(
      "durableNonce.buildCloseNonceAccountsTx: all accounts already closed — nothing to do.",
    );
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  // Authority is the payer; no ephemeral signatures needed. Solflare will
  // supply the only signature when the user approves.
  return new VersionedTransaction(message);
}

// ---------------------------------------------------------------------------
// Cost helper — for UI preview ("you'll pre-fund $X for nonces, refunded
// at completion"). The caller already has a Connection; we expose this so
// ExecutionPanel can show the exact SOL figure without duplicating the
// rent calculation.
// ---------------------------------------------------------------------------

export async function estimateNoncePoolRent(
  count: number,
  connection: Connection,
): Promise<number> {
  if (count < 1) return 0;
  const perAccount = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH,
    "confirmed",
  );
  return perAccount * count;
}
