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
  getPositionValue as kaminoGetPositionValue,
} from "../services/kamino";
import {
  buildExecutionResultFromQuote,
  calculateTWAPSlices,
  executeSwap as dflowExecuteSwap,
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
import {
  broadcastPreSigned,
  buildAndSignPlan,
  closeNoncePool,
  type PreSignedPlan,
  type SignAllFn,
} from "./preSignPlan";
import {
  notifyExecutionDone,
  notifyExecutionError,
  notifySliceReady,
} from "../services/notifications";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ExecutionStatus {
  IDLE = "IDLE",
  CONFIGURED = "CONFIGURED",
  /**
   * Pre-sign planını oluşturuyoruz: nonce hesapları açılıyor, durable tx
   * plan'ı inşa ediliyor, `signAllTransactions` popup'ı kullanıcıdan
   * onay bekliyor. Sadece `preSignEnabled=true` modunda geçilir.
   */
  PREPARING = "PREPARING",
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
  /**
   * Level 1 durable-nonce pre-sign mode. When true, the full Kamino tx
   * plan (deposit + per-slice withdraw + final withdraw) is built and
   * signed in a single Solflare `signAllTransactions` popup before the
   * first slice. Per-slice the user only needs to JIT-sign the Ultra
   * swap. Defaults to false (legacy JIT path), opt-in per execution.
   */
  preSignEnabled?: boolean;
  /**
   * Required iff `preSignEnabled = true`. Solflare's multi-tx signer;
   * injected from the wallet adapter so `preSignPlan.buildAndSignPlan`
   * can ask for a single popup covering the whole plan.
   */
  signAllTransactions?: SignAllFn;
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
  /**
   * Pre-sign plan — populated by `depositEffect` when `config.preSignEnabled`
   * is true. NOT serialized: on refresh the in-memory tx payloads are
   * lost, so recovery falls back to the JIT hot path.
   */
  preSignedPlan: PreSignedPlan | null;
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
  preSignedPlan: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Execution in-flight olarak sayılan status'lar — reset yasak, recovery evet. */
export const IN_FLIGHT_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  ExecutionStatus.PREPARING,
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
  // ------------------------------------------------------------------
  // Pre-sign path: plan inşa et (popup #1 + #2) → deposit'i broadcast et.
  // ------------------------------------------------------------------
  if (config.preSignEnabled && config.signAllTransactions) {
    const planBuilt = await buildPreSignPlanAndReport(
      config,
      setState,
      getState,
    );
    if (!planBuilt) return; // hata veya cancel — state zaten ERROR'a çekildi
  }

  setState((s) => ({
    ...s,
    status: ExecutionStatus.DEPOSITING,
    error: null,
    kaminoVaultAddress: config.kaminoVaultAddress,
  }));

  try {
    if (config.preSignEnabled) {
      const plan = getState().preSignedPlan;
      if (!plan) {
        throw new Error(
          "Pre-sign planı beklenmedik şekilde kaybolmuş. Lütfen CONFIGURED'dan tekrar başlatın.",
        );
      }
      const connection = createConnection();
      await broadcastPreSigned(plan.deposit, connection);
    } else {
      await kaminoDeposit(
        config.walletPublicKey,
        config.kaminoVaultAddress,
        config.inputMint,
        config.totalAmount,
        config.signTransaction,
      );
    }
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

  await executeNextSlice(getState(), setState, getState);
}

// ---------------------------------------------------------------------------
// Pre-sign plan orchestration (Level 1)
// ---------------------------------------------------------------------------

/**
 * Builds the pre-sign plan (popup #1: nonce setup tx; popup #2:
 * signAllTransactions for the full Kamino operational plan) and stores
 * it on state. Returns true on success; on failure sets the state to
 * ERROR with a user-meaningful message and returns false.
 *
 * Success-case side effects:
 *   - `state.status` transitions IDLE/CONFIGURED → PREPARING → (caller
 *     transitions to DEPOSITING).
 *   - `state.preSignedPlan` populated.
 */
async function buildPreSignPlanAndReport(
  config: ExecutionConfig,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<boolean> {
  if (!config.signAllTransactions) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: {
        code: ErrorCode.UNKNOWN,
        message:
          "Otopilot modu için `signAllTransactions` bağlı değil. Solflare sürümünüzü güncelleyin veya klasik moda geçin.",
        sliceIndex: null,
        retryable: false,
        timestamp: new Date(),
      },
    }));
    return false;
  }

  setState((s) => ({
    ...s,
    status: ExecutionStatus.PREPARING,
    error: null,
    kaminoVaultAddress: config.kaminoVaultAddress,
  }));

  // Dilim miktarlarını hesapla — preSignPlan tarafı TWAP dilimlerini bilmez,
  // her slice için ayrı Kamino withdraw ix'i gerekli.
  const perSlice = config.totalAmount / config.sliceCount;
  const sliceAmounts: number[] = new Array(config.sliceCount).fill(perSlice);

  try {
    const connection = createConnection();
    const plan = await buildAndSignPlan({
      connection,
      walletPublicKey: config.walletPublicKey,
      inputMint: config.inputMint,
      totalAmount: config.totalAmount,
      sliceAmounts,
      signOne: config.signTransaction,
      signAll: config.signAllTransactions,
    });
    setState((s) => ({ ...s, preSignedPlan: plan }));
  } catch (err) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: parseError(err, null, "kamino-deposit"),
    }));
    return false;
  }

  // Dış iptal kontrolü — PREPARING sırasında reset gelmiş olabilir.
  if (getState().status !== ExecutionStatus.PREPARING) return false;
  return true;
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
  // BLOK 3 slippage discipline still says "defer not error", but an
  // unbounded loop lets a volatile market stall the entire execution
  // window. Cap the number of consecutive defers per slice; past this,
  // surface it as a real error so the user can widen slippage or skip.
  const MAX_SLIPPAGE_DEFERS_PER_SLICE = 3;
  const sliceDeferCounts = new Map<number, number>();

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

      // BLOK 3 slippage disiplini: hata DEĞİL, defer. Defer count'u tut —
      // aynı dilim art arda MAX_SLIPPAGE_DEFERS_PER_SLICE kez ertelenmiş
      // ise real error olarak yükseltelim ki kullanıcı cancel/widen karar
      // alabilsin.
      if (isDFlowSlippageError(message)) {
        const prevCount = sliceDeferCounts.get(idx) ?? 0;
        const nextCount = prevCount + 1;
        sliceDeferCounts.set(idx, nextCount);

        if (nextCount > MAX_SLIPPAGE_DEFERS_PER_SLICE) {
          setState((s) => ({
            ...s,
            status: ExecutionStatus.ERROR,
            currentQuote: null,
            error: {
              code: ErrorCode.SLIPPAGE_EXCEEDED,
              message:
                `Slice ${idx + 1} kept exceeding the slippage limit for ${MAX_SLIPPAGE_DEFERS_PER_SLICE} consecutive attempts. ` +
                "Either widen the slippage threshold or retry from a fresh configuration.",
              sliceIndex: idx,
              retryable: false,
              timestamp: new Date(),
            },
          }));
          return;
        }

        const newTarget = new Date(nowMs() + SLIPPAGE_DEFER_MS);
        setState((s) => ({
          ...s,
          slices: s.slices.map((sl, i) =>
            i === idx ? { ...sl, targetExecutionTime: newTarget } : sl,
          ),
          error: {
            code: ErrorCode.SLIPPAGE_EXCEEDED,
            message: `Slice ${idx + 1} slippage exceeded — deferred 30s (attempt ${nextCount}/${MAX_SLIPPAGE_DEFERS_PER_SLICE}).`,
            sliceIndex: idx,
            retryable: true,
            timestamp: new Date(),
          },
          currentQuote: null,
        }));
        await sleep(SLIPPAGE_DEFER_MS);
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
    //     transaction count minimization). Tek imza, tek atomic transaction
    //     (klasik JIT mod); pre-sign modda withdraw pre-signed broadcast +
    //     swap JIT signed.
    setState((s) => ({
      ...s,
      status: ExecutionStatus.SLICE_WITHDRAWING,
      slices: s.slices.map((sl, i) =>
        i === idx ? { ...sl, status: "executing" } : sl,
      ),
    }));

    // ------------------------------------------------------------------
    // Pre-sign path — withdraw pre-signed, swap JIT. Delegates to a
    // dedicated helper so this function keeps one concern per branch.
    // ------------------------------------------------------------------
    if (current.config.preSignEnabled) {
      const handled = await executePreSignedSlice(
        idx,
        quote,
        current.config,
        setState,
        getState,
      );
      if (!handled) return; // ERROR state set inside helper
      continue; // loop → next slice or completeEffect
    }

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

    // Pre-sign quote freshness guard (H-9). If the user lingered on the
    // Solflare popup, the quote fetched above may be within seconds of
    // its expiry by the time they finally sign. Re-fetch the quote if we
    // have <10s left — this also refreshes Ultra's request ID so the
    // server-side execute endpoint accepts it.
    const msLeft = quote.dflowQuote.expiresAt - nowMs();
    if (msLeft < 10_000) {
      try {
        const fresh = await dflowGetQuote(
          current.config.inputMint,
          current.config.outputMint,
          slice.amount,
          current.config.slippageBps,
          current.config.walletPublicKey.toBase58(),
        );
        quote = fresh;
        setState((s) => ({ ...s, currentQuote: fresh }));
        // Instruction list uses the *fresh* quote's embedded transaction;
        // re-derive the DFlow ix set so it matches requestId.
        dflowIxs = await fetchSwapInstructions(
          current.config.walletPublicKey,
          fresh,
        );
      } catch (err) {
        // If re-quote fails, fall through with the old quote — simulation
        // will catch the staleness and we'll hit the standard error path.
        console.warn(
          `[LIMINAL] Pre-sign re-quote failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
// Pre-sign slice execution helper
// ---------------------------------------------------------------------------
//
// For the pre-sign path, each slice proceeds as:
//   1. Broadcast pre-signed Kamino withdraw (no popup).
//   2. Wait for confirm.
//   3. JIT-sign the Ultra swap via existing executeSwap (one popup).
//   4. Build the ExecutionResult from the fresh quote + confirmation.
//
// Atomicity cost: we split what was one versioned batch into two
// sequential txs. In the window between step 2 and step 4, a failure
// leaves the withdrawn tokens sitting in the wallet (not catastrophic —
// user can re-deposit or cancel execution). The upside: user never had
// to sit in front of the Solflare popup waiting.

async function executePreSignedSlice(
  idx: number,
  quote: DFlowQuote,
  config: ExecutionConfig,
  setState: SetStateFn,
  getState: GetStateFn,
): Promise<boolean> {
  const connection = createConnection();
  const plan = getState().preSignedPlan;
  if (!plan) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: {
        code: ErrorCode.UNKNOWN,
        message:
          "Pre-sign planı durumdan kayboldu (muhtemelen sayfa yenilendi). Klasik moda geçip dilimi tekrar deneyin.",
        sliceIndex: idx,
        retryable: false,
        timestamp: new Date(),
      },
      slices: s.slices.map((sl, i) =>
        i === idx ? { ...sl, status: "pending" } : sl,
      ),
    }));
    return false;
  }

  // --- Step 1+2: broadcast pre-signed withdraw + confirm ---
  // BUG FIX: retry-after-mid-flight-failure protection. If a previous
  // attempt already broadcast the withdraw but the swap failed, the
  // entry's `broadcasted` flag is set. broadcastPreSigned would throw
  // "refusing double-send" — instead we skip directly to the swap step,
  // since the withdrawn tokens are already in the wallet.
  if (!plan.slices[idx].broadcasted) {
    try {
      await broadcastPreSigned(plan.slices[idx], connection);
    } catch (err) {
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: parseError(err, idx, "kamino-withdraw"),
        slices: s.slices.map((sl, i) =>
          i === idx ? { ...sl, status: "pending" } : sl,
        ),
      }));
      return false;
    }
  }

  if (getState().status !== ExecutionStatus.SLICE_WITHDRAWING) return false;

  // --- Step 3: JIT swap (popup) ---
  setState((s) => ({ ...s, status: ExecutionStatus.SLICE_EXECUTING }));

  // Level 2: Notify the user BEFORE the Solflare popup opens so they
  // can return to the tab from wherever they were. Notification is
  // silent if the tab is already focused (no redundant alert).
  notifySliceReady(idx, config.sliceCount);

  // BUG FIX: Quote freshness guard mirroring the JIT path. The quote
  // we received from the outer loop was fetched before the durable-
  // nonce withdraw broadcast (~5-10s) and before any user delay in
  // returning to the tab to sign. If <10s of validity left, re-fetch
  // so Ultra's `requestId` is fresh; otherwise /execute will reject
  // the swap with a stale-quote error.
  let liveQuote: DFlowQuote = quote;
  const msLeft = liveQuote.dflowQuote.expiresAt - nowMs();
  if (msLeft < 10_000) {
    try {
      liveQuote = await dflowGetQuote(
        config.inputMint,
        config.outputMint,
        config.totalAmount / config.sliceCount,
        config.slippageBps,
        config.walletPublicKey.toBase58(),
      );
      setState((s) => ({ ...s, currentQuote: liveQuote }));
    } catch (refreshErr) {
      // Falling through with the stale quote — dflowExecuteSwap will
      // surface a clear error if /execute rejects. Logging the refresh
      // attempt gives diagnostic context.
      console.warn(
        `[LIMINAL] Autopilot pre-swap re-quote failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
      );
    }
  }

  let swapResult: ExecutionResult;
  try {
    swapResult = await dflowExecuteSwap(
      config.walletPublicKey,
      liveQuote,
      config.signTransaction,
    );
  } catch (err) {
    const parsed = parseError(err, idx, "dflow-swap");
    notifyExecutionError(parsed.message);
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ERROR,
      error: parsed,
      slices: s.slices.map((sl, i) =>
        i === idx ? { ...sl, status: "pending" } : sl,
      ),
    }));
    return false;
  }

  // Network fee post-confirmation
  let swapFee = 0;
  try {
    const txInfo = await connection.getTransaction(swapResult.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.fee) {
      swapFee = txInfo.meta.fee / LAMPORTS_PER_SOL;
    }
  } catch {
    /* fee opsiyonel */
  }

  // Use the *liveQuote* (re-fetched if necessary) to compute bps savings
  // — buildExecutionResultFromQuote diff'i `dflowQuote` vs `marketQuote`
  // ile hesaplar, eski stale quote yanıltıcı sonuç verir.
  const enriched: ExecutionResult = buildExecutionResultFromQuote(
    liveQuote,
    swapResult.signature,
    swapResult.confirmedAt,
    swapFee,
    config.inputMint,
    config.outputMint,
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
        i === idx ? { ...sl, status: "completed", result: enriched } : sl,
      ),
    };
  });
  return true;
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

  let finalResult: { totalAmount: number; yieldEarned: number } = {
    totalAmount: s0.kaminoDepositedAmount,
    yieldEarned: 0,
  };

  if (s0.config.preSignEnabled && s0.preSignedPlan) {
    // Pre-sign path: broadcast pre-signed final → then cleanup (popup).
    // BUG FIX: capture position value (incl. accrued yield) BEFORE
    // broadcasting the final withdraw — once it lands, the obligation
    // is drained and getPositionValue would return 0. Best-effort: if
    // the read fails we accept yield=0 rather than blocking the path.
    try {
      const connection = createConnection();
      if (s0.kaminoVaultAddress) {
        try {
          const pos = await kaminoGetPositionValue(
            s0.config.walletPublicKey,
            s0.kaminoVaultAddress,
            s0.config.inputMint,
            s0.kaminoDepositedAmount,
          );
          finalResult = {
            totalAmount: s0.kaminoDepositedAmount + pos.yieldAccrued,
            yieldEarned: pos.yieldAccrued,
          };
        } catch (yieldErr) {
          console.warn(
            `[LIMINAL] Pre-final yield read skipped: ${yieldErr instanceof Error ? yieldErr.message : String(yieldErr)}`,
          );
        }
      }
      await broadcastPreSigned(s0.preSignedPlan.finalWithdraw, connection);
      // Cleanup: one popup for rent refund. Non-fatal if the user
      // cancels — the user still holds the SOL in dormant nonce accts
      // and can reclaim later with nonceWithdraw.
      try {
        await closeNoncePool(
          s0.preSignedPlan,
          connection,
          s0.config.signTransaction,
          s0.config.walletPublicKey,
        );
      } catch (cleanupErr) {
        console.warn(
          `[LIMINAL] Nonce cleanup skipped: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: parseError(err, null, "kamino-final"),
      }));
      return;
    }
  } else {
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
  }

  setState((s) => ({
    ...s,
    status: ExecutionStatus.DONE,
    totalYieldEarned: finalResult.yieldEarned,
    completedAt: new Date(),
    currentQuote: null,
    // preSignedPlan kept through DONE so cleanup telemetry can surface
    // cleanup tx sig later; reset() clears it along with the rest of state.
  }));

  // Level 2: Final user-facing notification so they know execution
  // wrapped while they were away. Silent if the tab is currently
  // focused.
  // BUG FIX: read the *post-setState* totals via getState() — using
  // the stale `s0` snapshot from the function entry would always
  // notify yieldEarned = 0 because finalResult hadn't been computed
  // yet at that point. Price improvement also drifts during execution,
  // so prefer the latest tally.
  const final = getState();
  notifyExecutionDone(
    final.totalPriceImprovementUsd + final.totalYieldEarned,
  );
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
        // Pre-sign plan'ı VersionedTransaction payload'ı + ephemeral
        // nonce keypair'leri içeriyor — ikisi de serialize edilemez. Resume
        // sırasında plan yok, o yüzden config'i JIT'e düşürürüz. Kullanıcı
        // kalan dilimler için teker teker Solflare popup'larını onaylayacak.
        preSignEnabled: false,
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
    // Pre-signed plan is always lost on refresh (VersionedTransaction
    // payloads + nonce keypairs live only in-memory). Recovery drops
    // back to the JIT path — the user will see individual popups for
    // the remaining slices instead of the otopilot experience.
    preSignedPlan: null,
  };
}

/** Persisted state in-flight bir execution'ı mı temsil ediyor? */
export function isRecoverable(persisted: PersistedExecutionState): boolean {
  return IN_FLIGHT_STATUSES.has(persisted.status);
}
