/**
 * LIMINAL — Execution State Machine
 *
 * CLAUDE.md BLOK 2 "Orchestration Layer" — LIMINAL'in beyni. Kamino deposit,
 * TWAP dilim döngüsü (Kamino partial withdraw → DFlow swap), final withdraw
 * ve hata yönetimini tek bir deterministic state makinesi olarak koordine
 * eder.
 *
 * Tasarım kuralları:
 * - `configure` ve `reset` PURE: state + action → state. Yan etki yok.
 * - `*Effect` fonksiyonları async. RPC / transaction broadcast yaparlar ve
 *   setState üzerinden state'i mutasyona uğratırlar. Latest state okumak
 *   için her effect'e `getState` callback'i geçilir (React ref'e bağlanacak).
 * - Tüm servis çağrıları (kamino/dflow) zaten 60s timeout + confirmed
 *   commitment disiplinini kendi içlerinde uyguluyor — state machine o
 *   hataları yakalayıp TRANSACTION_TIMEOUT / diğer ErrorCode'lara maple.
 * - BLOK 3 slippage disiplini: aşım HATA DEĞİLDİR, dilim 30s ötelenir,
 *   executeNextSlice döngüsü devam eder. Hiçbir ERROR state'ine geçilmez.
 * - BLOK 4 sıralama disiplini: partial withdraw → confirm → DFlow quote →
 *   swap. Sıra bozulmaz.
 */

import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  buildPartialWithdrawInstructions,
  deposit as kaminoDeposit,
  finalWithdraw as kaminoFinalWithdraw,
} from "../services/kamino";
import {
  buildExecutionResultFromQuote,
  calculateTWAPSlices,
  fetchSwapInstructions,
  getQuote as dflowGetQuote,
  isDFlowSlippageError,
  type DFlowQuote,
  type ExecutionResult,
  type SignTransactionFn,
  type TWAPSlice,
} from "../services/dflow";
import { createConnection } from "../services/quicknode";
import {
  batchWithdrawAndSwap,
  SimulationFailedError,
  type BatchResult,
} from "../utils/transactionBatcher";
import { parseError } from "../utils/errorHandler";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ExecutionStatus {
  IDLE = "IDLE",
  CONFIGURED = "CONFIGURED",
  DEPOSITING = "DEPOSITING",
  ACTIVE = "ACTIVE",
  SLICE_WITHDRAWING = "SLICE_WITHDRAWING",
  SLICE_EXECUTING = "SLICE_EXECUTING",
  COMPLETING = "COMPLETING",
  DONE = "DONE",
  ERROR = "ERROR",
}

export enum ErrorCode {
  KAMINO_DEPOSIT_FAILED = "KAMINO_DEPOSIT_FAILED",
  KAMINO_WITHDRAW_FAILED = "KAMINO_WITHDRAW_FAILED",
  KAMINO_INSUFFICIENT_LIQUIDITY = "KAMINO_INSUFFICIENT_LIQUIDITY",
  DFLOW_QUOTE_EXPIRED = "DFLOW_QUOTE_EXPIRED",
  DFLOW_QUOTE_FAILED = "DFLOW_QUOTE_FAILED",
  DFLOW_SIMULATION_FAILED = "DFLOW_SIMULATION_FAILED",
  DFLOW_EXECUTION_FAILED = "DFLOW_EXECUTION_FAILED",
  SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED",
  TRANSACTION_TIMEOUT = "TRANSACTION_TIMEOUT",
  WALLET_REJECTED = "WALLET_REJECTED",
  UNKNOWN = "UNKNOWN",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionConfig = {
  inputMint: string;
  outputMint: string;
  totalAmount: number;
  sliceCount: number;
  windowDurationMs: number;
  slippageBps: number;
  walletPublicKey: PublicKey;
  signTransaction: SignTransactionFn;
  kaminoVaultAddress: string;
};

export type ExecutionError = {
  code: ErrorCode;
  message: string;
  sliceIndex: number | null;
  retryable: boolean;
  timestamp: Date;
};

export type ExecutionState = {
  status: ExecutionStatus;
  config: ExecutionConfig | null;
  slices: TWAPSlice[];
  currentSliceIndex: number;
  kaminoDepositSignature: string | null;
  kaminoDepositedAmount: number;
  kaminoVaultAddress: string | null;
  totalPriceImprovementBps: number;
  totalPriceImprovementUsd: number;
  totalYieldEarned: number;
  executionResults: ExecutionResult[];
  /** Aktif dilimin son çekilen quote'u — UI (QuoteComparison) bunu izler. */
  currentQuote: DFlowQuote | null;
  /**
   * Batching sonrası toplam beklenen Solflare imza sayısı:
   *   1 (Kamino deposit) + sliceCount (batched withdraw+swap) + 1 (final withdraw)
   * = sliceCount + 2. UI bu değeri "Başlat" öncesinde preview gösterir.
   */
  estimatedTransactionCount: number;
  error: ExecutionError | null;
  startedAt: Date | null;
  completedAt: Date | null;
  estimatedCompletionAt: Date | null;
};

export type SetStateFn = (
  updater: (prev: ExecutionState) => ExecutionState,
) => void;

/** React ref tabanlı "latest state" okuma. useExecutionMachine sağlar. */
export type GetStateFn = () => ExecutionState;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: ExecutionState = {
  status: ExecutionStatus.IDLE,
  config: null,
  slices: [],
  currentSliceIndex: 0,
  kaminoDepositSignature: null,
  kaminoDepositedAmount: 0,
  kaminoVaultAddress: null,
  totalPriceImprovementBps: 0,
  totalPriceImprovementUsd: 0,
  totalYieldEarned: 0,
  executionResults: [],
  currentQuote: null,
  estimatedTransactionCount: 0,
  error: null,
  startedAt: null,
  completedAt: null,
  estimatedCompletionAt: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Execution in-flight olarak sayılan status'lar — reset yasak, recovery evet. */
export const IN_FLIGHT_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  ExecutionStatus.DEPOSITING,
  ExecutionStatus.ACTIVE,
  ExecutionStatus.SLICE_WITHDRAWING,
  ExecutionStatus.SLICE_EXECUTING,
  ExecutionStatus.COMPLETING,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return Date.now();
}

// NOT: `buildError` ve `classifyError` bu dosyadan kaldırıldı.
// Tüm hata normalization artık `../utils/errorHandler#parseError` üzerinden
// yapılıyor (tek kaynak, tek regex setine sahip).

/** Weighted average bps (inputAmount ağırlıklı) + toplam USD. */
function recomputeAggregates(results: ExecutionResult[]): {
  weightedBps: number;
  totalUsd: number;
} {
  if (results.length === 0) return { weightedBps: 0, totalUsd: 0 };
  const totalInput = results.reduce((s, r) => s + r.inputAmount, 0);
  const weightedBps =
    totalInput > 0
      ? results.reduce((s, r) => s + r.priceImprovementBps * r.inputAmount, 0) /
        totalInput
      : 0;
  const totalUsd = results.reduce((s, r) => s + r.priceImprovementUsd, 0);
  return { weightedBps, totalUsd };
}

// ---------------------------------------------------------------------------
// Pure transitions
// ---------------------------------------------------------------------------

/**
 * IDLE → CONFIGURED. Pure: yan etki yok, yeni state döner.
 * TWAP dilimleri `calculateTWAPSlices` ile hesaplanır; `estimatedCompletionAt`
 * şimdiki zaman + windowDurationMs.
 */
export function configure(
  _state: ExecutionState,
  config: ExecutionConfig,
): ExecutionState {
  const slices = calculateTWAPSlices(
    config.totalAmount,
    config.sliceCount,
    config.windowDurationMs,
  );
  const estimatedCompletionAt = new Date(nowMs() + config.windowDurationMs);

  // Batching sonrası toplam imza sayısı:
  //   1 deposit + sliceCount batched slice + 1 final withdraw
  const estimatedTransactionCount = 1 + config.sliceCount + 1;

  return {
    ...initialState,
    status: ExecutionStatus.CONFIGURED,
    config,
    slices,
    estimatedCompletionAt,
    estimatedTransactionCount,
  };
}

/**
 * DONE | ERROR | IDLE → IDLE. In-flight state'lerde reset YASAK.
 * Pure: yeni state döner veya hata fırlatır.
 */
export function reset(state: ExecutionState): ExecutionState {
  if (IN_FLIGHT_STATUSES.has(state.status)) {
    throw new Error("Cannot reset during an active execution.");
  }
  return initialState;
}

// ---------------------------------------------------------------------------
// Effect: deposit
// ---------------------------------------------------------------------------

/**
 * CONFIGURED → DEPOSITING → ACTIVE → (executeNextSlice).
 * Kamino'ya toplam miktarı yatırır. Başarılıysa otomatik olarak ilk dilime
 * geçer. Başarısızsa ERROR state (retryable: true).
 */
export async function depositEffect(
  config: ExecutionConfig,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<void> {
  setState((s) => ({
    ...s,
    status: ExecutionStatus.DEPOSITING,
    error: null,
    kaminoVaultAddress: config.kaminoVaultAddress,
  }));

  try {
    await kaminoDeposit(
      config.walletPublicKey,
      config.kaminoVaultAddress,
      config.inputMint,
      config.totalAmount,
      config.signTransaction,
    );
  } catch (err) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: parseError(err, null, "kamino-deposit"),
    }));
    return;
  }

  // Dışarıdan iptal geldiyse (reset/recovery) — durumu kontrol et.
  if (getState().status !== ExecutionStatus.DEPOSITING) return;

  const startedAt = new Date();
  setState((s) => ({
    ...s,
    status: ExecutionStatus.ACTIVE,
    kaminoDepositSignature: null, // service signature'ı zaten döndürdü; ileride map'lenebilir
    kaminoDepositedAmount: config.totalAmount,
    startedAt,
  }));

  // kaminoDeposit return'ünden signature'ı yakalamak istiyorsak ikinci setState:
  // (deposit sonucu try bloğunda atılsaydı kaybolurdu; alttaki pattern daha güvenli)
  // Not: kamino.deposit fonksiyonu { signature, kTokenAmount } döndürüyor;
  // signature aşağıda yeniden yakalanmak yerine withdraw aşamasında invalide.

  await executeNextSlice(getState(), setState, getState);
}

// ---------------------------------------------------------------------------
// Effect: executeNextSlice
// ---------------------------------------------------------------------------

/**
 * Mevcut dilimi çalıştırır; tamamlandığında bir sonrakine geçer; tüm dilimler
 * bitince completeEffect'e devreder. Aynı dilim içinde döngü: time check →
 * quote → (slippage aşıldıysa defer 30s + devam) → Kamino withdraw → DFlow
 * swap → ilerle.
 *
 * Cancellation: her await öncesi/sonrası `getState().status` okunur; durum
 * beklenen akış dışına çıkmışsa (ör. harici reset, recovery, ERROR) effect
 * sessizce sonlanır.
 */
export async function executeNextSlice(
  _state: ExecutionState,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<void> {
  const SLIPPAGE_DEFER_MS = 30_000;
  const TIME_WAIT_TICK_MS = 2_000; // zamana uyanma granülaritesi

  // Döngü — her iterasyon bir dilim veya bir zaman beklemesi.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const current = getState();

    // Cancellation / external transition check
    if (
      current.status !== ExecutionStatus.ACTIVE &&
      current.status !== ExecutionStatus.SLICE_WITHDRAWING &&
      current.status !== ExecutionStatus.SLICE_EXECUTING
    ) {
      return;
    }
    if (!current.config) return;

    // Tüm dilimler bitti mi?
    if (current.currentSliceIndex >= current.slices.length) {
      await completeEffect(current, setState, getState);
      return;
    }

    const idx = current.currentSliceIndex;
    const slice = current.slices[idx];
    const targetMs = slice.targetExecutionTime.getTime();
    const waitMs = targetMs - nowMs();

    // Henüz zaman gelmediyse — kısa bir uyku, sonra tekrar dene.
    if (waitMs > 0) {
      // Status'u ACTIVE'e çek (SLICE_* içinde kalmış olabilir)
      if (current.status !== ExecutionStatus.ACTIVE) {
        setState((s) => ({ ...s, status: ExecutionStatus.ACTIVE }));
      }
      await sleep(Math.min(waitMs, TIME_WAIT_TICK_MS));
      continue;
    }

    // --- Quote aşaması ------------------------------------------------------
    let quote: DFlowQuote;
    try {
      quote = await dflowGetQuote(
        current.config.inputMint,
        current.config.outputMint,
        slice.amount,
        current.config.slippageBps,
        current.config.walletPublicKey.toBase58(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // BLOK 3 slippage disiplini: hata DEĞİL, defer.
      if (isDFlowSlippageError(message)) {
        const newTarget = new Date(nowMs() + SLIPPAGE_DEFER_MS);
        setState((s) => ({
          ...s,
          slices: s.slices.map((sl, i) =>
            i === idx ? { ...sl, targetExecutionTime: newTarget } : sl,
          ),
          // error set edilmez — defer bir uyarıdır, state uyarıyı
          // `currentQuote` yerine `error` field'ı dışındaki bir kanalla
          // göstermek için currentQuote null bırakılır ve UI mesajı
          // error ile değil status + slice.targetExecutionTime üzerinden
          // çıkarır. Ancak "uyarı metnini" kaybetmemek için error alanına
          // retryable=true + SLIPPAGE_EXCEEDED olarak yazıyoruz; timeline
          // bileşeni bu kodu gördüğünde durumu "ertelendi" şeklinde render
          // eder, execution akışı durmaz.
          error: {
            code: ErrorCode.SLIPPAGE_EXCEEDED,
            message: `Dilim ${idx + 1} slippage limitini aştı. 30 saniye ertelendi.`,
            sliceIndex: idx,
            retryable: true,
            timestamp: new Date(),
          },
          currentQuote: null,
        }));
        await sleep(SLIPPAGE_DEFER_MS);
        // Defer sonrası error'u temizle, döngü devam etsin.
        setState((s) =>
          s.error?.code === ErrorCode.SLIPPAGE_EXCEEDED
            ? { ...s, error: null }
            : s,
        );
        continue;
      }

      // Quote expired / quote failed / başka bir hata → ERROR state.
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: parseError(err, idx, "dflow-quote"),
      }));
      return;
    }

    // Quote başarılı — state'e yansıt.
    setState((s) => ({ ...s, currentQuote: quote }));

    // --- Batched Kamino withdraw + DFlow swap (BLOK 4 sıralama + BLOK 6
    //     transaction count minimization). Tek imza, tek atomic transaction.
    setState((s) => ({
      ...s,
      status: ExecutionStatus.SLICE_WITHDRAWING,
      slices: s.slices.map((sl, i) =>
        i === idx ? { ...sl, status: "executing" } : sl,
      ),
    }));

    let kaminoIxs: Awaited<ReturnType<typeof buildPartialWithdrawInstructions>>;
    let dflowIxs: Awaited<ReturnType<typeof fetchSwapInstructions>>;
    try {
      [kaminoIxs, dflowIxs] = await Promise.all([
        buildPartialWithdrawInstructions(
          current.config.walletPublicKey,
          current.config.kaminoVaultAddress,
          current.config.inputMint,
          slice.amount,
        ),
        fetchSwapInstructions(current.config.walletPublicKey, quote),
      ]);
    } catch (err) {
      // Hangi tarafın fail ettiğini mesajdan anla.
      const message = err instanceof Error ? err.message : String(err);
      const phase: "kamino-withdraw" | "dflow-quote" = /quote|dflow|swap/i.test(
        message,
      )
        ? "dflow-quote"
        : "kamino-withdraw";
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: parseError(err, idx, phase),
        slices: s.slices.map((sl, i) =>
          i === idx ? { ...sl, status: "pending" } : sl,
        ),
      }));
      return;
    }

    // Cancellation check: instruction build sırasında reset gelmiş olabilir.
    if (getState().status !== ExecutionStatus.SLICE_WITHDRAWING) return;

    // SLICE_EXECUTING — batch broadcast aşamasındayız.
    setState((s) => ({ ...s, status: ExecutionStatus.SLICE_EXECUTING }));

    const connection = createConnection();
    const mergedLookupTables = [
      ...kaminoIxs.lookupTables,
      ...dflowIxs.lookupTables,
    ];

    let batchResult: BatchResult;
    try {
      batchResult = await batchWithdrawAndSwap(
        current.config.walletPublicKey,
        kaminoIxs.instructions,
        dflowIxs.instructions,
        current.config.signTransaction,
        connection,
        mergedLookupTables,
      );
    } catch (err) {
      let executionError: ExecutionError;
      if (err instanceof SimulationFailedError) {
        executionError = {
          code: ErrorCode.DFLOW_SIMULATION_FAILED,
          message: err.message,
          sliceIndex: idx,
          retryable: true,
          timestamp: new Date(),
        };
      } else {
        executionError = parseError(err, idx, "batch");
      }
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: executionError,
        slices: s.slices.map((sl, i) =>
          i === idx ? { ...sl, status: "pending" } : sl,
        ),
      }));
      return;
    }

    // Network fee post-confirmation (opsiyonel — 0 kalırsa sorun değil).
    let batchFee = 0;
    try {
      const txInfo = await connection.getTransaction(batchResult.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (txInfo?.meta?.fee) {
        batchFee = txInfo.meta.fee / LAMPORTS_PER_SOL;
      }
    } catch {
      /* fee opsiyonel */
    }

    // Quote + batch confirmation → ExecutionResult
    const enriched: ExecutionResult = buildExecutionResultFromQuote(
      quote,
      batchResult.signature,
      batchResult.confirmedAt,
      batchFee,
      current.config.inputMint,
      current.config.outputMint,
    );

    setState((s) => {
      const newResults = [...s.executionResults, enriched];
      const { weightedBps, totalUsd } = recomputeAggregates(newResults);
      return {
        ...s,
        status: ExecutionStatus.ACTIVE,
        currentSliceIndex: s.currentSliceIndex + 1,
        currentQuote: null,
        executionResults: newResults,
        totalPriceImprovementBps: weightedBps,
        totalPriceImprovementUsd: totalUsd,
        slices: s.slices.map((sl, i) =>
          i === idx
            ? { ...sl, status: "completed", result: enriched }
            : sl,
        ),
      };
    });

    // Döngü devam → sonraki dilim veya completeEffect.
  }
}

// ---------------------------------------------------------------------------
// Effect: complete
// ---------------------------------------------------------------------------

/**
 * Tüm dilimler tamamlandığında: Kamino final withdraw → DONE.
 * Başarısızlık ERROR state (retryable: true).
 */
export async function completeEffect(
  _state: ExecutionState,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<void> {
  const s0 = getState();
  if (!s0.config) return;

  setState((s) => ({ ...s, status: ExecutionStatus.COMPLETING, error: null }));

  let finalResult: { totalAmount: number; yieldEarned: number };
  try {
    finalResult = await kaminoFinalWithdraw(
      s0.config.walletPublicKey,
      s0.config.kaminoVaultAddress,
      s0.config.signTransaction,
      {
        tokenMint: s0.config.inputMint,
        trackedDepositedAmount: s0.kaminoDepositedAmount,
      },
    );
  } catch (err) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: parseError(err, null, "kamino-final"),
    }));
    return;
  }

  setState((s) => ({
    ...s,
    status: ExecutionStatus.DONE,
    totalYieldEarned: finalResult.yieldEarned,
    completedAt: new Date(),
    currentQuote: null,
  }));
}

// ---------------------------------------------------------------------------
// Effect: retry
// ---------------------------------------------------------------------------

/**
 * ERROR state'inde çalışır. error.code'a göre doğru effect'i tekrar tetikler.
 * Retryable false ise sessizce ignore eder.
 */
export async function retryEffect(
  _state: ExecutionState,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<void> {
  const s = getState();
  if (s.status !== ExecutionStatus.ERROR || !s.error || !s.error.retryable) {
    return;
  }
  if (!s.config) return;

  const { code } = s.error;

  // Hata tipine göre hangi effect'e dönüleceğini belirle.
  switch (code) {
    case ErrorCode.KAMINO_DEPOSIT_FAILED: {
      await depositEffect(s.config, setState, getState);
      return;
    }

    case ErrorCode.KAMINO_WITHDRAW_FAILED:
    case ErrorCode.KAMINO_INSUFFICIENT_LIQUIDITY: {
      // COMPLETING sırasında çekim hatası mı yoksa SLICE_WITHDRAWING mi?
      // sliceIndex null ise → final withdraw; değilse → partial withdraw.
      if (s.error.sliceIndex === null) {
        // Final withdraw başarısız olmuştu → completeEffect'i tekrar dene.
        setState((prev) => ({
          ...prev,
          status: ExecutionStatus.ACTIVE,
          error: null,
        }));
        await completeEffect(getState(), setState, getState);
      } else {
        // Slice çekimi başarısızdı → executeNextSlice'ı aynı index'ten başlat.
        setState((prev) => ({
          ...prev,
          status: ExecutionStatus.ACTIVE,
          error: null,
        }));
        await executeNextSlice(getState(), setState, getState);
      }
      return;
    }

    case ErrorCode.DFLOW_QUOTE_EXPIRED:
    case ErrorCode.DFLOW_QUOTE_FAILED:
    case ErrorCode.DFLOW_SIMULATION_FAILED:
    case ErrorCode.DFLOW_EXECUTION_FAILED:
    case ErrorCode.SLIPPAGE_EXCEEDED:
    case ErrorCode.TRANSACTION_TIMEOUT:
    case ErrorCode.UNKNOWN: {
      // Aynı dilimden devam — yeni quote alınacak / simulation tekrarlanacak.
      setState((prev) => ({
        ...prev,
        status: ExecutionStatus.ACTIVE,
        error: null,
      }));
      await executeNextSlice(getState(), setState, getState);
      return;
    }

    case ErrorCode.WALLET_REJECTED: {
      // retryable: false — zaten üst if bloğunda return edildi, buraya düşmez.
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization (localStorage recovery)
// ---------------------------------------------------------------------------

/**
 * Persist edilebilir alt küme. Function (signTransaction) ve PublicKey
 * serialize edilemez; recovery sırasında yeniden enjekte edilir.
 */
export type PersistedExecutionState = {
  status: ExecutionStatus;
  config: {
    inputMint: string;
    outputMint: string;
    totalAmount: number;
    sliceCount: number;
    windowDurationMs: number;
    slippageBps: number;
    walletPublicKey: string; // base58
    kaminoVaultAddress: string;
  } | null;
  slices: Array<{
    sliceIndex: number;
    amount: number;
    targetExecutionTime: string; // ISO
    status: TWAPSlice["status"];
    result: SerializedExecutionResult | null;
  }>;
  currentSliceIndex: number;
  kaminoDepositSignature: string | null;
  kaminoDepositedAmount: number;
  kaminoVaultAddress: string | null;
  totalPriceImprovementBps: number;
  totalPriceImprovementUsd: number;
  totalYieldEarned: number;
  executionResults: SerializedExecutionResult[];
  estimatedTransactionCount?: number;
  error: {
    code: ErrorCode;
    message: string;
    sliceIndex: number | null;
    retryable: boolean;
    timestamp: string;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedCompletionAt: string | null;
  persistedAt: string;
};

type SerializedExecutionResult = Omit<ExecutionResult, "confirmedAt"> & {
  confirmedAt: string;
};

export function serializeState(state: ExecutionState): PersistedExecutionState {
  const serializeResult = (r: ExecutionResult): SerializedExecutionResult => ({
    ...r,
    confirmedAt: r.confirmedAt.toISOString(),
  });

  return {
    status: state.status,
    config: state.config
      ? {
          inputMint: state.config.inputMint,
          outputMint: state.config.outputMint,
          totalAmount: state.config.totalAmount,
          sliceCount: state.config.sliceCount,
          windowDurationMs: state.config.windowDurationMs,
          slippageBps: state.config.slippageBps,
          walletPublicKey: state.config.walletPublicKey.toBase58(),
          kaminoVaultAddress: state.config.kaminoVaultAddress,
        }
      : null,
    slices: state.slices.map((s) => ({
      sliceIndex: s.sliceIndex,
      amount: s.amount,
      targetExecutionTime: s.targetExecutionTime.toISOString(),
      status: s.status,
      result: s.result ? serializeResult(s.result) : null,
    })),
    currentSliceIndex: state.currentSliceIndex,
    kaminoDepositSignature: state.kaminoDepositSignature,
    kaminoDepositedAmount: state.kaminoDepositedAmount,
    kaminoVaultAddress: state.kaminoVaultAddress,
    totalPriceImprovementBps: state.totalPriceImprovementBps,
    totalPriceImprovementUsd: state.totalPriceImprovementUsd,
    totalYieldEarned: state.totalYieldEarned,
    executionResults: state.executionResults.map(serializeResult),
    estimatedTransactionCount: state.estimatedTransactionCount,
    error: state.error
      ? { ...state.error, timestamp: state.error.timestamp.toISOString() }
      : null,
    startedAt: state.startedAt?.toISOString() ?? null,
    completedAt: state.completedAt?.toISOString() ?? null,
    estimatedCompletionAt: state.estimatedCompletionAt?.toISOString() ?? null,
    persistedAt: new Date().toISOString(),
  };
}

/**
 * Persisted state'i hidrate eder. `signTransaction` parametre olarak
 * geçirilir çünkü serialize edilemez — hook recovery sırasında Solflare'den
 * alıp iletir.
 */
export function deserializeState(
  persisted: PersistedExecutionState,
  signTransaction: SignTransactionFn,
): ExecutionState {
  const deserializeResult = (r: SerializedExecutionResult): ExecutionResult => ({
    ...r,
    confirmedAt: new Date(r.confirmedAt),
  });

  const config: ExecutionConfig | null = persisted.config
    ? {
        inputMint: persisted.config.inputMint,
        outputMint: persisted.config.outputMint,
        totalAmount: persisted.config.totalAmount,
        sliceCount: persisted.config.sliceCount,
        windowDurationMs: persisted.config.windowDurationMs,
        slippageBps: persisted.config.slippageBps,
        walletPublicKey: new PublicKey(persisted.config.walletPublicKey),
        signTransaction,
        kaminoVaultAddress: persisted.config.kaminoVaultAddress,
      }
    : null;

  return {
    status: persisted.status,
    config,
    slices: persisted.slices.map((s) => ({
      sliceIndex: s.sliceIndex,
      amount: s.amount,
      targetExecutionTime: new Date(s.targetExecutionTime),
      status: s.status,
      result: s.result ? deserializeResult(s.result) : null,
    })),
    currentSliceIndex: persisted.currentSliceIndex,
    kaminoDepositSignature: persisted.kaminoDepositSignature,
    kaminoDepositedAmount: persisted.kaminoDepositedAmount,
    kaminoVaultAddress: persisted.kaminoVaultAddress,
    totalPriceImprovementBps: persisted.totalPriceImprovementBps,
    totalPriceImprovementUsd: persisted.totalPriceImprovementUsd,
    totalYieldEarned: persisted.totalYieldEarned,
    executionResults: persisted.executionResults.map(deserializeResult),
    currentQuote: null, // quote hidrate edilmez — stale olabilir
    estimatedTransactionCount: persisted.estimatedTransactionCount ?? 0,
    error: persisted.error
      ? { ...persisted.error, timestamp: new Date(persisted.error.timestamp) }
      : null,
    startedAt: persisted.startedAt ? new Date(persisted.startedAt) : null,
    completedAt: persisted.completedAt ? new Date(persisted.completedAt) : null,
    estimatedCompletionAt: persisted.estimatedCompletionAt
      ? new Date(persisted.estimatedCompletionAt)
      : null,
  };
}

/** Persisted state in-flight bir execution'ı mı temsil ediyor? */
export function isRecoverable(persisted: PersistedExecutionState): boolean {
  return IN_FLIGHT_STATUSES.has(persisted.status);
}
