/**
 * LIMINAL — Transaction Batcher
 *
 * BLOK 2 "Transaction Sayısını Minimize Et" + BLOK 6 "Versioned Transaction
 * Batching" disiplininin core'u. Kamino partial withdraw ve DFlow swap
 * instruction'larını TEK versioned transaction'a paketleyip simüle eder,
 * imzalatır, broadcast eder, confirm bekler. Her dilim için 2 imza → 1 imza
 * (CLAUDE.md "4 dilim → 6 imza (10 değil)" hedefi).
 *
 * Kurallar:
 * - Instruction sırası MUTLAK: önce Kamino withdraw, sonra DFlow swap.
 *   Sıra bozulursa token çekilmeden swap denenir — fatal.
 * - Broadcast öncesi simulation zorunlu (BLOK 6 kural 5). Fail → throw.
 * - Commitment "confirmed", timeout 60s (BLOK 6 kural 6-7).
 * - Simulation failure analizi: InstructionError.index kaminoIxCount'tan
 *   küçükse Kamino fail, aksi halde DFlow fail. Ayrı Türkçe mesajlar.
 */

import {
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Commitment,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchResult = {
  signature: string;
  confirmedAt: Date;
  slot: number;
};

export type SimulationResult = {
  success: boolean;
  errorMessage: string | null;
  unitsConsumed: number | null;
  logs: string[];
};

export type BatchSignTransactionFn = <T extends VersionedTransaction>(
  tx: T,
) => Promise<T>;

const COMMITMENT: Commitment = "confirmed";
const CONFIRM_TIMEOUT_MS = 60_000;
const DEFAULT_FEE_LAMPORTS = 5000;

// ---------------------------------------------------------------------------
// SimulationFailedError
// ---------------------------------------------------------------------------

export class SimulationFailedError extends Error {
  public readonly simulationResult: SimulationResult;
  public readonly kaminoIxCount: number;
  public readonly dflowIxCount: number;
  /** "kamino" | "dflow" | "unknown" — hangi instruction kümesi fail etti. */
  public readonly failedComponent: "kamino" | "dflow" | "unknown";

  constructor(
    simulationResult: SimulationResult,
    rawErr: unknown,
    kaminoIxCount: number,
    dflowIxCount: number,
  ) {
    const { message, component } = analyzeSimulationFailure(
      simulationResult,
      rawErr,
      kaminoIxCount,
      dflowIxCount,
    );
    super(message);
    this.name = "SimulationFailedError";
    this.simulationResult = simulationResult;
    this.kaminoIxCount = kaminoIxCount;
    this.dflowIxCount = dflowIxCount;
    this.failedComponent = component;
  }
}

function analyzeSimulationFailure(
  result: SimulationResult,
  rawErr: unknown,
  kaminoIxCount: number,
  dflowIxCount: number,
): { message: string; component: "kamino" | "dflow" | "unknown" } {
  // 1) Solana RPC'nin döndürdüğü InstructionError.index'i kontrol et.
  //    Format: { InstructionError: [index, <programErr>] }
  const instructionIndex = extractInstructionIndex(rawErr);
  if (instructionIndex !== null) {
    if (instructionIndex < kaminoIxCount) {
      return {
        component: "kamino",
        message:
          "Vault çekim işlemi simulation'da başarısız. Vault likiditesi yetersiz olabilir.",
      };
    }
    if (instructionIndex < kaminoIxCount + dflowIxCount) {
      return {
        component: "dflow",
        message:
          "Swap işlemi simulation'da başarısız. Quote süresi dolmuş veya slippage aşılmış olabilir.",
      };
    }
  }

  // 2) Index yoksa log'lar üzerinden heuristic.
  const logs = (result.logs ?? []).join(" ").toLowerCase();
  if (/klend|kamino/i.test(logs)) {
    return {
      component: "kamino",
      message:
        "Vault çekim işlemi simulation'da başarısız. Vault likiditesi yetersiz olabilir.",
    };
  }
  if (/slippage|swap|dflow|price.*impact/i.test(logs)) {
    return {
      component: "dflow",
      message:
        "Swap işlemi simulation'da başarısız. Quote süresi dolmuş veya slippage aşılmış olabilir.",
    };
  }

  // 3) No clues at all — fall back to a raw log snippet.
  const snippet =
    result.errorMessage ??
    (result.logs ?? []).join(" ").slice(0, 180) ??
    "unknown error";
  return {
    component: "unknown",
    message: `Transaction simulation failed: ${snippet}`,
  };
}

function extractInstructionIndex(rawErr: unknown): number | null {
  if (!rawErr || typeof rawErr !== "object") return null;
  const withIE = rawErr as { InstructionError?: unknown };
  const ie = withIE.InstructionError;
  if (Array.isArray(ie) && ie.length > 0 && typeof ie[0] === "number") {
    return ie[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal simulate helper — rawErr'i SimulationResult'la birlikte döner
// ---------------------------------------------------------------------------

async function runSimulation(
  transaction: VersionedTransaction,
  connection: Connection,
): Promise<{ result: SimulationResult; rawErr: unknown }> {
  try {
    const response = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: COMMITMENT,
    });
    const { value } = response;
    return {
      result: {
        success: value.err === null,
        errorMessage:
          value.err === null ? null : safeStringify(value.err),
        unitsConsumed:
          typeof value.unitsConsumed === "number" ? value.unitsConsumed : null,
        logs: value.logs ?? [],
      },
      rawErr: value.err ?? undefined,
    };
  } catch (err) {
    // RPC erişim hatası — spec: hata fırlatma, success:false ile dön.
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: {
        success: false,
        errorMessage: `RPC simulation hatası: ${message}`,
        unitsConsumed: null,
        logs: [],
      },
      rawErr: undefined,
    };
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Public: simulateTransaction
// ---------------------------------------------------------------------------

/**
 * Versioned transaction'ı simüle eder. RPC hatası SimulationResult.success
 * false olarak döner, exception fırlatılmaz. `sigVerify=false`,
 * `replaceRecentBlockhash=true` — caller blockhash çakışmasından etkilenmez.
 */
export async function simulateTransaction(
  transaction: VersionedTransaction,
  connection: Connection,
): Promise<SimulationResult> {
  const { result } = await runSimulation(transaction, connection);
  return result;
}

// ---------------------------------------------------------------------------
// Public: estimateTransactionFee
// ---------------------------------------------------------------------------

/**
 * getFeeForMessage ile Solana network fee tahmini. Fee alınamazsa
 * varsayılan 5000 lamport döner (minimum base fee) ve console.warn basar.
 */
export async function estimateTransactionFee(
  transaction: VersionedTransaction,
  connection: Connection,
): Promise<number> {
  try {
    const res = await connection.getFeeForMessage(
      transaction.message,
      COMMITMENT,
    );
    if (res && typeof res.value === "number" && res.value > 0) {
      return res.value;
    }
    console.warn(
      "[LIMINAL] Fee tahmin edilemedi, varsayılan 5000 lamport kullanılıyor.",
    );
    return DEFAULT_FEE_LAMPORTS;
  } catch (err) {
    console.warn(
      `[LIMINAL] getFeeForMessage hatası: ${err instanceof Error ? err.message : String(err)}. Varsayılan 5000 lamport kullanılıyor.`,
    );
    return DEFAULT_FEE_LAMPORTS;
  }
}

// ---------------------------------------------------------------------------
// Public: batchWithdrawAndSwap
// ---------------------------------------------------------------------------

/**
 * Kamino withdraw + DFlow swap instruction'larını tek versioned tx içine
 * paketler, simüle eder, imzalatır, broadcast eder, confirm bekler.
 *
 * Instruction sırası: [...kaminoWithdrawIx, ...dflowSwapIx]
 * Bu sıra BOZULAMAZ — önce token Kamino'dan çıkmalı, sonra swap'a girmeli.
 *
 * @param lookupTables  Her iki protokolün referans ettiği address lookup
 *                      table'lar. Opsiyonel ama DFlow için gerçek swap'ta
 *                      zorunludur — dflow.fetchSwapInstructions bunları
 *                      döndürür, caller birleştirip geçirmelidir.
 */
export async function batchWithdrawAndSwap(
  walletPublicKey: PublicKey,
  kaminoWithdrawIx: TransactionInstruction[],
  dflowSwapIx: TransactionInstruction[],
  signTransaction: BatchSignTransactionFn,
  connection: Connection,
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<BatchResult> {
  // --- Validation --------------------------------------------------------
  if (!kaminoWithdrawIx || kaminoWithdrawIx.length === 0) {
    throw new Error(
      "Kamino withdraw instruction list is empty. Cannot build batch.",
    );
  }
  if (!dflowSwapIx || dflowSwapIx.length === 0) {
    throw new Error(
      "DFlow swap instruction list is empty. Cannot build batch.",
    );
  }

  // --- Build versioned transaction (Kamino ÖNCE, DFlow SONRA) -----------
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(COMMITMENT);

  const instructions: TransactionInstruction[] = [
    ...kaminoWithdrawIx,
    ...dflowSwapIx,
  ];

  let compiled;
  try {
    compiled = new TransactionMessage({
      payerKey: walletPublicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Batch transaction message compile error: ${message}`);
  }

  const transaction = new VersionedTransaction(compiled);

  // --- Size check (Solana packet limit) ----------------------------------
  // A VersionedTransaction must serialize into ≤1232 bytes (packet MTU
  // including Solana framing). If the Kamino withdraw + DFlow swap batch
  // busts this ceiling — either at our 1232 check OR at web3.js's
  // "encoding overruns Uint8Array" throw — we silently fall back to two
  // sequential transactions (withdraw, then swap). Atomicity is lost
  // but UX stays intact: the user signs twice instead of once and the
  // slice still completes.
  let tooLarge = false;
  try {
    const serialized = transaction.serialize();
    if (serialized.length > 1232) tooLarge = true;
  } catch {
    // web3.js pre-empts the size check with an "encoding overruns
    // Uint8Array" throw when the compiled message is way past the cap.
    // Treat that as the same signal.
    tooLarge = true;
  }
  if (tooLarge) {
    return fallbackSequentialSendSwap(
      walletPublicKey,
      kaminoWithdrawIx,
      dflowSwapIx,
      signTransaction,
      connection,
      lookupTables,
    );
  }

  // --- Simulate (BLOK 6 kural 5 — broadcast etmeden önce ZORUNLU) -------
  const { result: simResult, rawErr: simRawErr } = await runSimulation(
    transaction,
    connection,
  );
  if (!simResult.success) {
    throw new SimulationFailedError(
      simResult,
      simRawErr,
      kaminoWithdrawIx.length,
      dflowSwapIx.length,
    );
  }

  // --- Sign --------------------------------------------------------------
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(transaction);
  } catch (err) {
    // Solflare tarafı hatayı zaten Türkçeleştiriyor — olduğu gibi fırlat.
    throw err;
  }

  // --- Broadcast ---------------------------------------------------------
  // skipPreflight: true — see dflow.ts executeSwap broadcast comment.
  // Wallets (Solflare in particular) can mutate priority-fee
  // instructions during the sign pass; the resulting message-hash
  // drift fails preflight with "did not pass signature verification,
  // logs:[]". We already ran a full simulateTransaction above, and
  // on-chain execution validates the signature, so the redundant
  // preflight buys nothing but flakiness.
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      preflightCommitment: COMMITMENT,
      maxRetries: 2,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Batch broadcast error: ${message}`);
  }

  // --- Confirm with 60s timeout ------------------------------------------
  try {
    await Promise.race([
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        COMMITMENT,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Transaction was not confirmed in ${CONFIRM_TIMEOUT_MS / 1000} seconds. Signature: ${signature}`,
              ),
            ),
          CONFIRM_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const confirmedAt = new Date();

  // --- Slot fetch (analytics için) ---------------------------------------
  // getTransaction Finality ister; runtime değeri "confirmed" olduğundan
  // güvenli. Slot opsiyonel bir alan, başarısızlıkta 0 kalır.
  let slot = 0;
  try {
    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    slot = txInfo?.slot ?? 0;
  } catch {
    /* slot opsiyonel — başarısızlık fatal değil */
  }

  return { signature, confirmedAt, slot };
}

// ---------------------------------------------------------------------------
// Fallback: sequential Kamino-withdraw → DFlow-swap when the batched tx
// can't fit in a single Solana packet.
// ---------------------------------------------------------------------------

type SendInstructionSetInput = {
  walletPublicKey: PublicKey;
  instructions: TransactionInstruction[];
  signTransaction: BatchSignTransactionFn;
  connection: Connection;
  lookupTables: AddressLookupTableAccount[];
  label: string;
};

/**
 * Compile + simulate + sign + send + confirm a single VersionedTransaction.
 * Throws on any failure. Returns the signature and the confirmed block slot.
 */
async function sendInstructionSet({
  walletPublicKey,
  instructions,
  signTransaction,
  connection,
  lookupTables,
  label,
}: SendInstructionSetInput): Promise<{ signature: string; slot: number }> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(COMMITMENT);

  const compiled = new TransactionMessage({
    payerKey: walletPublicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(compiled);

  const { result: simResult, rawErr: simRawErr } = await runSimulation(
    transaction,
    connection,
  );
  if (!simResult.success) {
    throw new SimulationFailedError(simResult, simRawErr, instructions.length, 0);
  }

  const signed = await signTransaction(transaction);

  // skipPreflight: true — same rationale as the batched broadcast
  // path above: avoid the priority-fee-bump signature drift that
  // makes preflight's sigVerify unreliable. We simulated upstream
  // already; on-chain execution still validates the signature.
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      preflightCommitment: COMMITMENT,
      maxRetries: 2,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} broadcast error: ${message}`);
  }

  await Promise.race([
    connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      COMMITMENT,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label} was not confirmed in ${CONFIRM_TIMEOUT_MS / 1000} seconds. Signature: ${signature}`,
            ),
          ),
        CONFIRM_TIMEOUT_MS,
      ),
    ),
  ]);

  let slot = 0;
  try {
    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    slot = txInfo?.slot ?? 0;
  } catch {
    /* slot opsiyonel */
  }
  return { signature, slot };
}

/**
 * Fallback path used when the Kamino-withdraw + DFlow-swap batch doesn't
 * fit in a single 1232-byte transaction. Sends the two ix sets in sequence
 * instead — the user signs twice but the slice still completes.
 *
 * Return shape matches the happy-path `BatchResult` so `executionMachine`
 * treats it identically. The returned `signature` is the DFlow swap's
 * confirmed signature (the slice's authoritative on-chain proof); the
 * Kamino withdraw signature is logged for analytics but not surfaced.
 */
async function fallbackSequentialSendSwap(
  walletPublicKey: PublicKey,
  kaminoWithdrawIx: TransactionInstruction[],
  dflowSwapIx: TransactionInstruction[],
  signTransaction: BatchSignTransactionFn,
  connection: Connection,
  lookupTables: AddressLookupTableAccount[],
): Promise<BatchResult> {
  const kaminoResult = await sendInstructionSet({
    walletPublicKey,
    instructions: kaminoWithdrawIx,
    signTransaction,
    connection,
    lookupTables,
    label: "Kamino withdraw",
  });
  console.info(
    `[LIMINAL] Batched tx exceeded packet limit — fell back to sequential. ` +
      `Kamino withdraw confirmed: ${kaminoResult.signature}`,
  );

  const swapResult = await sendInstructionSet({
    walletPublicKey,
    instructions: dflowSwapIx,
    signTransaction,
    connection,
    lookupTables,
    label: "DFlow swap",
  });

  return {
    signature: swapResult.signature,
    confirmedAt: new Date(),
    slot: swapResult.slot,
  };
}
