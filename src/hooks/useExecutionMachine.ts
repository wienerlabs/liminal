/**
 * LIMINAL — useExecutionMachine hook
 *
 * executionMachine.ts'in React binding'i. Hook'u çağıran TÜM component'ler
 * aynı module-level store'a abone olur — bu sayede ExecutionPanel ve
 * AnalyticsPanel aynı state'i görür, senkronizasyon sorunu olmaz.
 *
 * Sorumluluklar:
 * - configure / start / retry / reset actions'larını expose eder.
 * - stateRef yerine module-level state + useSyncExternalStore pattern.
 * - Her state değişikliğinde localStorage'a yedekler.
 * - DONE geçişinde analytics history'e kayıt düşer (buildFromExecutionState).
 * - Mount'ta persist edilmiş in-flight state varsa `pendingRecovery` döner.
 *
 * Recovery tasarımı: serialize edilen state signTransaction callback'ini
 * içermez (function JSON'a girmez). `resume()` çağrısı sırasında hook
 * aktif Solflare adapter'ından signTransaction'ı yeniden enjekte eder.
 */

import { useEffect, useSyncExternalStore } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  configure as machineConfigure,
  completeEffect,
  depositEffect,
  deserializeState,
  executeNextSlice,
  ExecutionStatus,
  IN_FLIGHT_STATUSES,
  initialState,
  isRecoverable,
  reset as machineReset,
  retryEffect,
  serializeState,
  type ExecutionConfig,
  type ExecutionState,
  type GetStateFn,
  type PersistedExecutionState,
  type SetStateFn,
} from "../state/executionMachine";
import {
  getWalletState,
  signTransactionWithSolflare,
} from "../services/solflare";
import { getPythPrice, resolveTokenSymbol } from "../services/quicknode";
import {
  buildFromExecutionState,
  saveExecution,
} from "../services/analyticsStore";

const STORAGE_KEY = "liminal:execution:state";

export type ConfigureInput = Omit<
  ExecutionConfig,
  "walletPublicKey" | "signTransaction"
>;

export type RecoveryPrompt = {
  persisted: PersistedExecutionState;
  /** Kaydın ait olduğu cüzdan adresi — güvenlik kontrolü için. */
  walletAddress: string;
  /** Aktif cüzdan adresi — kayıtla uyuşmazsa resume engellenir. */
  canResume: boolean;
};

export type UseExecutionMachineResult = {
  state: ExecutionState;
  configure: (input: ConfigureInput) => void;
  start: () => void;
  retry: () => void;
  reset: () => void;
  /** Recovery prompt — null değilse UI kullanıcıya sormalı. */
  pendingRecovery: RecoveryPrompt | null;
  resumeRecovery: () => void;
  discardRecovery: () => void;
};

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function persist(state: ExecutionState): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
  } catch (err) {
    console.warn(
      `[LIMINAL] Execution state persist edilemedi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function loadPersisted(): PersistedExecutionState | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedExecutionState;
  } catch (err) {
    console.warn(
      `[LIMINAL] Persisted execution state parse edilemedi: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function clearPersisted(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Module-level store (singleton)
// ---------------------------------------------------------------------------
//
// Hook'u çağıran birden fazla component aynı state'i paylaşsın diye store
// module-level tutulur. Tek instance, her subscriber aynı snapshot'ı görür.

let moduleState: ExecutionState = initialState;
let moduleRecovery: RecoveryPrompt | null = null;
let storeInitialized = false;

const stateListeners = new Set<() => void>();
const recoveryListeners = new Set<() => void>();

function notifyStateListeners(): void {
  stateListeners.forEach((fn) => fn());
}
function notifyRecoveryListeners(): void {
  recoveryListeners.forEach((fn) => fn());
}

const subscribeState = (cb: () => void): (() => void) => {
  stateListeners.add(cb);
  return () => {
    stateListeners.delete(cb);
  };
};
const getStateSnapshot = (): ExecutionState => moduleState;

const subscribeRecovery = (cb: () => void): (() => void) => {
  recoveryListeners.add(cb);
  return () => {
    recoveryListeners.delete(cb);
  };
};
const getRecoverySnapshot = (): RecoveryPrompt | null => moduleRecovery;

// ---------------------------------------------------------------------------
// State mutation + side effects
// ---------------------------------------------------------------------------

const setState: SetStateFn = (updater) => {
  const prev = moduleState;
  const next = updater(prev);
  moduleState = next;
  persist(next);

  // DONE transition → analytics save
  if (
    prev.status !== ExecutionStatus.DONE &&
    next.status === ExecutionStatus.DONE
  ) {
    void trySaveAnalytics(next);
  }

  notifyStateListeners();
};

const getState: GetStateFn = () => moduleState;

/**
 * DONE state'e geçişte tetiklenir. Pyth'ten input token USD fiyatını alır
 * (Kamino yield USD dönüşümü için) ve analytics store'a kayıt düşer.
 * Hata durumunda sessizce log'lar — execution akışını bloklamamalı.
 */
async function trySaveAnalytics(state: ExecutionState): Promise<void> {
  try {
    if (!state.config) return;
    const inputSymbol = resolveTokenSymbol(state.config.inputMint);
    const outputSymbol = resolveTokenSymbol(state.config.outputMint);

    let inputTokenUsdPrice = 0;
    try {
      inputTokenUsdPrice = (await getPythPrice(state.config.inputMint)) ?? 0;
    } catch {
      /* Pyth alınamadı — yield USD 0 olur, log var */
    }

    const historical = buildFromExecutionState(
      state,
      inputSymbol,
      outputSymbol,
      inputTokenUsdPrice,
    );
    saveExecution(historical);
  } catch (err) {
    console.warn(
      `[LIMINAL] Analytics save hatası: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Store initialization (mount-time recovery detection)
// ---------------------------------------------------------------------------

function initStoreOnce(): void {
  if (storeInitialized) return;
  storeInitialized = true;

  const persisted = loadPersisted();
  if (!persisted) return;

  if (!isRecoverable(persisted)) {
    // DONE / ERROR / IDLE / CONFIGURED → recovery gerekmez.
    clearPersisted();
    return;
  }

  const walletAddress = persisted.config?.walletPublicKey ?? "";
  const currentWallet = getWalletState();
  const canResume =
    !!walletAddress &&
    currentWallet.connected &&
    currentWallet.address === walletAddress;

  moduleRecovery = { persisted, walletAddress, canResume };
  notifyRecoveryListeners();
}

// ---------------------------------------------------------------------------
// Actions (module-level)
// ---------------------------------------------------------------------------

function configureAction(input: ConfigureInput): void {
  const wallet = getWalletState();
  if (!wallet.connected || !wallet.address) {
    throw new Error(
      "Solflare bağlı değil. Configure için önce cüzdanınızı bağlayın.",
    );
  }
  const fullConfig: ExecutionConfig = {
    ...input,
    walletPublicKey: new PublicKey(wallet.address),
    signTransaction: signTransactionWithSolflare,
  };
  setState((prev) => machineConfigure(prev, fullConfig));
}

function startAction(): void {
  const current = moduleState;
  if (current.status !== ExecutionStatus.CONFIGURED || !current.config) {
    return;
  }
  void depositEffect(current.config, setState, getState);
}

function retryAction(): void {
  if (moduleState.status !== ExecutionStatus.ERROR) {
    return;
  }
  void retryEffect(moduleState, setState, getState);
}

function resetAction(): void {
  setState((prev) => machineReset(prev));
  clearPersisted();
}

function resumeRecoveryAction(): void {
  const current = moduleRecovery;
  if (!current) return;
  if (!current.canResume) {
    console.warn(
      "[LIMINAL] Recovery resume yapılamaz: Solflare bağlı değil veya cüzdan adresi farklı.",
    );
    return;
  }

  const rehydrated = deserializeState(
    current.persisted,
    signTransactionWithSolflare,
  );
  setState(() => rehydrated);
  moduleRecovery = null;
  notifyRecoveryListeners();

  const status = rehydrated.status;
  if (status === ExecutionStatus.DEPOSITING && rehydrated.config) {
    void depositEffect(rehydrated.config, setState, getState);
  } else if (
    status === ExecutionStatus.ACTIVE ||
    status === ExecutionStatus.SLICE_WITHDRAWING ||
    status === ExecutionStatus.SLICE_EXECUTING
  ) {
    setState((s) => ({
      ...s,
      status: ExecutionStatus.ACTIVE,
      slices: s.slices.map((sl, i) =>
        i === s.currentSliceIndex && sl.status === "executing"
          ? { ...sl, status: "pending" }
          : sl,
      ),
    }));
    void executeNextSlice(getState(), setState, getState);
  } else if (status === ExecutionStatus.COMPLETING) {
    void completeEffect(getState(), setState, getState);
  }
}

function discardRecoveryAction(): void {
  clearPersisted();
  moduleRecovery = null;
  moduleState = initialState;
  notifyRecoveryListeners();
  notifyStateListeners();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExecutionMachine(): UseExecutionMachineResult {
  // Mount'ta store'u init et (idempotent — sadece ilk çağrıda çalışır).
  useEffect(() => {
    initStoreOnce();
  }, []);

  const state = useSyncExternalStore(
    subscribeState,
    getStateSnapshot,
    getStateSnapshot,
  );
  const pendingRecovery = useSyncExternalStore(
    subscribeRecovery,
    getRecoverySnapshot,
    getRecoverySnapshot,
  );

  // In-flight iken sayfa kapatılırsa uyar.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = (e: BeforeUnloadEvent): void => {
      if (IN_FLIGHT_STATUSES.has(moduleState.status)) {
        e.preventDefault();
        e.returnValue =
          "LIMINAL must stay open during an active execution.";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return {
    state,
    configure: configureAction,
    start: startAction,
    retry: retryAction,
    reset: resetAction,
    pendingRecovery,
    resumeRecovery: resumeRecoveryAction,
    discardRecovery: discardRecoveryAction,
  };
}
