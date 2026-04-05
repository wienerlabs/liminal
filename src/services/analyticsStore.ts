/**
 * LIMINAL — Analytics Store
 *
 * BLOK 7 "Sağ Panel: Real-Time Analytics" + BLOK 8 "Onchain Aktivite Modeli"
 * tarafında LIMINAL'in execution geçmişini localStorage'da tutar. Jüri
 * "real usage kanıtı" ister — bu store her tamamlanmış execution'ı kalıcı
 * şekilde kaydeder ve Protocol Stats sayfasını besler.
 *
 * Tasarım:
 * - Hiç hata fırlatmaz. Parse/storage hataları console.warn ile loglanır,
 *   `getHistory()` boş array döner. UI "geçmiş yok" state'ine düşer.
 * - Maksimum 50 kayıt. 51. geldiğinde en eski silinir (FIFO).
 * - Tüm veri tamamlanmış `ExecutionState`'den türetilir — sıfır mock.
 */

import type { ExecutionState } from "../state/executionMachine";
import type { ExecutionResult } from "./dflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SliceAnalytics = {
  sliceIndex: number;
  executedAt: Date;
  inputAmount: number;
  outputAmount: number;
  executionPrice: number;
  marketPrice: number;
  priceImprovementBps: number;
  priceImprovementUsd: number;
  kaminoDurationMs: number;
  kaminoYieldUsd: number;
  /** DFlow swap transaction signature — Solana explorer linki için. */
  signature: string;
};

export type SessionSummary = {
  totalInputAmount: number;
  totalOutputAmount: number;
  averageExecutionPrice: number;
  baselinePrice: number;
  totalPriceImprovementBps: number;
  totalPriceImprovementUsd: number;
  totalKaminoYieldUsd: number;
  totalValueCaptureUsd: number;
  executionDurationMs: number;
  completedSlices: number;
  skippedSlices: number;
  startedAt: Date;
  completedAt: Date;
};

export type HistoricalExecution = {
  id: string;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  summary: SessionSummary;
  slices: SliceAnalytics[];
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "liminal:analytics:history";
const MAX_HISTORY_SIZE = 50;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type SerializedSlice = Omit<SliceAnalytics, "executedAt"> & {
  executedAt: string;
};

type SerializedSummary = Omit<SessionSummary, "startedAt" | "completedAt"> & {
  startedAt: string;
  completedAt: string;
};

type SerializedExecution = {
  id: string;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  summary: SerializedSummary;
  slices: SerializedSlice[];
  createdAt: string;
};

function serializeSlice(s: SliceAnalytics): SerializedSlice {
  return { ...s, executedAt: s.executedAt.toISOString() };
}

function deserializeSlice(s: SerializedSlice): SliceAnalytics {
  return { ...s, executedAt: new Date(s.executedAt) };
}

function serializeSummary(s: SessionSummary): SerializedSummary {
  return {
    ...s,
    startedAt: s.startedAt.toISOString(),
    completedAt: s.completedAt.toISOString(),
  };
}

function deserializeSummary(s: SerializedSummary): SessionSummary {
  return {
    ...s,
    startedAt: new Date(s.startedAt),
    completedAt: new Date(s.completedAt),
  };
}

function serializeExecution(e: HistoricalExecution): SerializedExecution {
  return {
    id: e.id,
    inputMint: e.inputMint,
    outputMint: e.outputMint,
    inputSymbol: e.inputSymbol,
    outputSymbol: e.outputSymbol,
    summary: serializeSummary(e.summary),
    slices: e.slices.map(serializeSlice),
    createdAt: e.createdAt.toISOString(),
  };
}

function deserializeExecution(e: SerializedExecution): HistoricalExecution {
  return {
    id: e.id,
    inputMint: e.inputMint,
    outputMint: e.outputMint,
    inputSymbol: e.inputSymbol,
    outputSymbol: e.outputSymbol,
    summary: deserializeSummary(e.summary),
    slices: e.slices.map(deserializeSlice),
    createdAt: new Date(e.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Yeni execution'ı listeye ekler. FIFO limit: 50. */
export function saveExecution(execution: HistoricalExecution): void {
  const storage = safeStorage();
  if (!storage) return;

  try {
    const current = getHistory();
    const next = [execution, ...current].slice(0, MAX_HISTORY_SIZE);
    const serialized = next.map(serializeExecution);
    storage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn(
      `[LIMINAL] Analytics save hatası: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Tüm geçmişi getirir. Hiçbir koşulda throw etmez. */
export function getHistory(): HistoricalExecution[] {
  const storage = safeStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SerializedExecution[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(deserializeExecution);
  } catch (err) {
    console.warn(
      `[LIMINAL] Analytics geçmişi parse edilemedi: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/** ID'ye göre bir execution'ı siler. */
export function deleteExecution(id: string): void {
  const storage = safeStorage();
  if (!storage) return;

  try {
    const current = getHistory();
    const next = current.filter((e) => e.id !== id);
    const serialized = next.map(serializeExecution);
    storage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn(
      `[LIMINAL] Analytics delete hatası: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Tüm analytics geçmişini temizler. */
export function clearHistory(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// buildFromExecutionState
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random
  return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Tamamlanmış ExecutionState'den analytics kaydını oluşturur.
 *
 * @param state          DONE state'indeki execution
 * @param inputSymbol    Input token sembolü (quicknode.resolveTokenSymbol)
 * @param outputSymbol   Output token sembolü
 * @param inputTokenUsdPrice  Input token'ın USD fiyatı (Pyth'ten) — Kamino
 *                           yield'ın USD değerini hesaplamak için gerekli.
 *                           Alınamazsa 0 geçilir; totalKaminoYieldUsd 0 olur.
 */
export function buildFromExecutionState(
  state: ExecutionState,
  inputSymbol: string,
  outputSymbol: string,
  inputTokenUsdPrice: number = 0,
): HistoricalExecution {
  if (!state.config || !state.startedAt || !state.completedAt) {
    throw new Error(
      "HistoricalExecution oluşturulamıyor: state DONE durumda değil veya config eksik.",
    );
  }

  const startedAt = state.startedAt;
  const completedAt = state.completedAt;

  // Tamamlanan slice'ları sıralı olarak al.
  const completedSlices = state.slices
    .filter((s) => s.status === "completed" && s.result !== null)
    .sort((a, b) => a.sliceIndex - b.sliceIndex);

  // Kamino yield'i slice sayısına eşit ağırlıkla böl — gerçek per-slice
  // yield on-chain'den ayrıştırılamıyor (BLOK 4 "depositedAmount on-chain'den
  // çekilemez" kısıtlamasının bir uzantısı).
  const sliceCount = completedSlices.length || 1;
  const totalKaminoYieldUsd = state.totalYieldEarned * inputTokenUsdPrice;
  const perSliceKaminoYield = totalKaminoYieldUsd / sliceCount;

  // Slice analytics — kaminoDurationMs önceki slice'tan (veya deposit
  // başlangıcından) bu slice'ın confirmedAt'ine kadar geçen süre.
  let previousConfirmedMs = startedAt.getTime();
  const slices: SliceAnalytics[] = completedSlices.map((s) => {
    const result = s.result as ExecutionResult;
    const executedAt = result.confirmedAt;
    const executedMs = executedAt.getTime();
    const kaminoDurationMs = Math.max(0, executedMs - previousConfirmedMs);
    previousConfirmedMs = executedMs;

    return {
      sliceIndex: s.sliceIndex,
      executedAt,
      inputAmount: result.inputAmount,
      outputAmount: result.outputAmount,
      executionPrice: result.executionPrice,
      marketPrice: result.marketPrice,
      priceImprovementBps: result.priceImprovementBps,
      priceImprovementUsd: result.priceImprovementUsd,
      kaminoDurationMs,
      kaminoYieldUsd: perSliceKaminoYield,
      signature: result.signature,
    };
  });

  // Session summary
  const totalInputAmount = slices.reduce((s, x) => s + x.inputAmount, 0);
  const totalOutputAmount = slices.reduce((s, x) => s + x.outputAmount, 0);
  const averageExecutionPrice =
    totalInputAmount > 0 ? totalOutputAmount / totalInputAmount : 0;

  // Baseline price: ilk slice'ın marketPrice'ı (BLOK 3 "DFlow olmadan ne alırdın")
  const baselinePrice = slices.length > 0 ? slices[0].marketPrice : 0;

  const totalValueCaptureUsd =
    state.totalPriceImprovementUsd + totalKaminoYieldUsd;

  // Skipped slices: state machine'de "skipped" status kullanılmaz (defer
  // edilen dilimler sonunda "completed" olur), bu yüzden 0. Defer sayısı
  // ileride isteniyorsa slice.targetExecutionTime değişim sayısı üzerinden
  // türetilebilir.
  const skippedSlices = state.slices.filter((s) => s.status === "skipped").length;

  const summary: SessionSummary = {
    totalInputAmount,
    totalOutputAmount,
    averageExecutionPrice,
    baselinePrice,
    totalPriceImprovementBps: state.totalPriceImprovementBps,
    totalPriceImprovementUsd: state.totalPriceImprovementUsd,
    totalKaminoYieldUsd,
    totalValueCaptureUsd,
    executionDurationMs: completedAt.getTime() - startedAt.getTime(),
    completedSlices: slices.length,
    skippedSlices,
    startedAt,
    completedAt,
  };

  return {
    id: generateId(),
    inputMint: state.config.inputMint,
    outputMint: state.config.outputMint,
    inputSymbol,
    outputSymbol,
    summary,
    slices,
    createdAt: new Date(),
  };
}
