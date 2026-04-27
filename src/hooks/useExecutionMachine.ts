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

import { useEffect, useState, useSyncExternalStore } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  configure as machineConfigure,
  completeEffect,
  depositEffect,
  deserializeState,
  ErrorCode,
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
  signAllTransactionsWithSolflare,
  signTransactionWithSolflare,
  subscribeWallet,
} from "../services/solflare";
import {
  createConnection,
  getPythPrice,
  resolveTokenSymbol,
} from "../services/quicknode";
import { closeNoncePool } from "../state/preSignPlan";
import {
  broadcast as broadcastTabStatus,
  subscribeOtherTabsInFlight,
} from "../services/multiTab";
import {
  buildFromExecutionState,
  saveExecution,
} from "../services/analyticsStore";

const STORAGE_KEY = "liminal:execution:state";

export type ConfigureInput = Omit<
  ExecutionConfig,
  "walletPublicKey" | "signTransaction" | "signAllTransactions"
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
  /**
   * True iff another LIMINAL tab in the same browser profile is
   * currently running an in-flight execution. UI surfaces this as a
   * warning banner before the user starts a second concurrent run.
   * Detection uses BroadcastChannel + storage event fallback —
   * works without backend coordination.
   */
  otherTabsInFlight: boolean;
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

/**
 * Detect QuotaExceededError across browsers. Some surface a numeric
 * `code = 22` (legacy), others use `code = 1014` (Firefox), others
 * just throw a DOMException with name "QuotaExceededError".
 */
function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 ||
      err.code === 1014
    );
  }
  return false;
}

/**
 * Persist execution state to localStorage. On QuotaExceededError, evict
 * non-critical LIMINAL keys (analytics history, token registry cache)
 * and retry once — the in-flight execution state is the most critical
 * thing for recovery, so it gets priority over historical analytics.
 *
 * If even the retry fails, log a clear warning so the user understands
 * a refresh would lose their execution. We never crash the state
 * machine over a persist failure.
 */
function persist(state: ExecutionState): void {
  const storage = safeStorage();
  if (!storage) return;
  const payload = JSON.stringify(serializeState(state));
  try {
    storage.setItem(STORAGE_KEY, payload);
    return;
  } catch (err) {
    if (!isQuotaExceededError(err)) {
      console.warn(
        `[LIMINAL] Execution state persist edilemedi: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    // Quota exceeded — evict expendable LIMINAL caches and retry.
    try {
      storage.removeItem("liminal:analytics:history");
      storage.removeItem("liminal:token-registry:v2");
      storage.setItem(STORAGE_KEY, payload);
      console.warn(
        "[LIMINAL] localStorage quota hit — evicted analytics history + token registry cache to make room for in-flight execution state.",
      );
    } catch (retryErr) {
      console.warn(
        `[LIMINAL] localStorage quota exceeded and retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}. ` +
          "Refreshing the tab will lose recovery state — finish or cancel the execution before navigating away.",
      );
    }
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

  // Multi-tab awareness: broadcast status changes so other LIMINAL
  // tabs in the same browser profile can warn the user about
  // overlapping executions. Cheap (single postMessage) and idempotent
  // — broadcast() handles the BroadcastChannel-unavailable case.
  if (prev.status !== next.status) {
    broadcastTabStatus(next.status);
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
  // BUG FIX: refuse re-configure during an in-flight execution.
  // Without this guard, a rapid double-click on START would call
  // configureAction twice — and machineConfigure (a pure transition)
  // returns `{ ...initialState, status: CONFIGURED, ... }`. That blasts
  // away an already-DEPOSITING/PREPARING/ACTIVE state along with the
  // pre-signed plan, while the original async effect is still
  // broadcasting on chain. Catastrophic. The guard keeps the running
  // execution intact.
  if (IN_FLIGHT_STATUSES.has(moduleState.status)) {
    throw new Error(
      "Cannot reconfigure during an active execution. Wait for it to finish or reset.",
    );
  }
  const fullConfig: ExecutionConfig = {
    ...input,
    walletPublicKey: new PublicKey(wallet.address),
    signTransaction: signTransactionWithSolflare,
    // Pre-sign plan'ını Solflare'in multi-tx API'si üzerinden imzalar.
    // JIT modunda da zararsız — config.preSignEnabled false'sa hiç çağrılmaz.
    signAllTransactions: signAllTransactionsWithSolflare,
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
  // BUG FIX: machineReset() throws if the state is in-flight. Without
  // the guard, calling reset() during DEPOSITING/PREPARING (e.g. from
  // a stale UI button or a keyboard shortcut) would throw inside the
  // setState callback — which crashes the React tree because setState
  // updaters are not catch-recoverable. Pre-check + log instead.
  if (IN_FLIGHT_STATUSES.has(moduleState.status)) {
    console.warn(
      "[LIMINAL] reset() blocked — execution is in-flight. Wait for it to settle or hit a terminal state.",
    );
    return;
  }

  // BUG FIX: when the user resets after a built but never-broadcasted
  // plan (e.g. ERROR'd during DEPOSITING with autopilot ON), the
  // pre-signed payloads are dropped from state but the on-chain nonce
  // accounts remain — about ~$2 of SOL rent locked per execution. We
  // capture the plan + config BEFORE clearing state and kick off a
  // background closeNoncePool. Fire-and-forget: if the user rejects the
  // cleanup popup or the broadcast fails, log and move on (the rent
  // can still be reclaimed manually with `nonceWithdraw`).
  const planForCleanup = moduleState.preSignedPlan;
  const configForCleanup = moduleState.config;

  setState((prev) => machineReset(prev));
  clearPersisted();

  if (planForCleanup && configForCleanup) {
    void (async (): Promise<void> => {
      try {
        const connection = createConnection();
        await closeNoncePool(
          planForCleanup,
          connection,
          configForCleanup.signTransaction,
          configForCleanup.walletPublicKey,
        );
        // Successful reclaim: caller's already moved on, no UI signal
        // needed — Solflare's own confirmation toast is the receipt.
      } catch (err) {
        console.warn(
          `[LIMINAL] Background nonce cleanup after reset skipped: ${err instanceof Error ? err.message : String(err)}. ` +
            "Funds are still recoverable manually via nonceWithdraw.",
        );
      }
    })();
  }
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
  if (status === ExecutionStatus.PREPARING) {
    // Pre-sign plan was being built when the tab refreshed. The
    // signed VersionedTransaction payloads + ephemeral nonce keypairs
    // lived only in-memory, so we cannot resume the autopilot path.
    // Drop the user back to CONFIGURED with a soft error so they can
    // retry — `deserializeState` already forced `preSignEnabled=false`
    // on the rehydrated config, so the next `start()` runs the JIT
    // hot path. Without this branch the state machine would sit in
    // PREPARING forever (reset is blocked by IN_FLIGHT, and no other
    // resume case applies).
    setState((s) => ({
      ...s,
      status: ExecutionStatus.CONFIGURED,
      preSignedPlan: null,
      error: {
        code: ErrorCode.UNKNOWN,
        message:
          "Page refreshed before the autopilot plan finished signing. " +
          "Click Start again — execution will run in classic JIT mode " +
          "(autopilot pre-sign payloads are not recoverable).",
        sliceIndex: null,
        retryable: false,
        timestamp: new Date(),
      },
    }));
  } else if (status === ExecutionStatus.DEPOSITING && rehydrated.config) {
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
  // BUG FIX (LL): use setState() instead of mutating moduleState
  // directly. Direct assignment bypasses persist(), DONE→analytics
  // hook, and any future setState side-effects — currently harmless
  // (initialState wouldn't trigger analytics save) but a regression
  // tripwire. Going through the canonical pipeline keeps recovery
  // discard symmetric with reset() and any user action.
  clearPersisted();
  moduleRecovery = null;
  setState(() => initialState);
  notifyRecoveryListeners();
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

  // BUG FIX: detect wallet account change mid-execution. Solflare's
  // `accountChanged` event fires when the user switches accounts inside
  // the wallet. The state machine's config still references the
  // original wallet — every pre-signed tx is signed by the old key,
  // every JIT swap popup would target the old key as taker. Cleanup
  // tx authority would mismatch the new wallet → cleanup popup
  // rejected. We push the user into ERROR with a clear message so
  // they can either reconnect the original wallet or reset and
  // reconfigure with the new one.
  useEffect(() => {
    return subscribeWallet((nextWallet) => {
      const current = moduleState;
      if (!IN_FLIGHT_STATUSES.has(current.status) || !current.config) return;
      const expected = current.config.walletPublicKey.toBase58();
      const actual = nextWallet.connected ? nextWallet.address : null;
      if (actual === expected) return;
      // Wallet diverged from the one that started this execution.
      setState((s) => ({
        ...s,
        status: ExecutionStatus.ERROR,
        error: {
          code: ErrorCode.WALLET_REJECTED,
          message: actual
            ? `Wallet changed mid-execution (now ${actual.slice(0, 4)}…${actual.slice(-4)}). ` +
              `Reconnect the original wallet (${expected.slice(0, 4)}…${expected.slice(-4)}) ` +
              "to keep going, or Reset and start over."
            : `Wallet disconnected mid-execution. Reconnect ${expected.slice(0, 4)}…${expected.slice(-4)} ` +
              "to resume or Reset to start over.",
          sliceIndex: null,
          retryable: false,
          timestamp: new Date(),
        },
      }));
    });
  }, []);

  // Multi-tab awareness — subscribe in a React state so re-renders
  // pick up changes from BroadcastChannel + storage event listeners.
  const [otherTabsInFlight, setOtherTabsInFlight] = useState<boolean>(false);
  useEffect(() => {
    return subscribeOtherTabsInFlight(setOtherTabsInFlight);
  }, []);

  return {
    state,
    otherTabsInFlight,
    configure: configureAction,
    start: startAction,
    retry: retryAction,
    reset: resetAction,
    pendingRecovery,
    resumeRecovery: resumeRecoveryAction,
    discardRecovery: discardRecoveryAction,
  };
}
