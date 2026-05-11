/**
 * LIMINAL — Solflare Wallet Service
 *
 * BLOK 6 (Solflare Entegrasyon Spesifikasyonu) altında:
 * - Sadece Solflare desteklenir. Phantom/Backpack/diğer adapter'lar
 *   KASITLI olarak eklenmez — integration depth dilüsyonunu önlemek için.
 * - Session persistence: sayfa yenilendiğinde `onlyIfTrusted` ile sessiz
 *   reconnect denenir, kullanıcı "Connect" butonuna tekrar basmak zorunda
 *   kalmaz.
 * - Kullanıcıya dönük hata metinleri Türkçe.
 *
 * Bakiye fonksiyonları (`getSOLBalance`, `getSPLTokenBalances`) BLOK 5
 * kapsamında `./quicknode` modülüne delege edilir — gerçek on-chain veri.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { getIsMobileGlobal } from "../hooks/useDeviceDetection";

export type { TokenBalance } from "./quicknode";
export {
  getSOLBalance,
  getSPLTokenBalances,
  getPythPrice,
} from "./quicknode";

export type WalletState = {
  connected: boolean;
  connecting: boolean;
  address: string | null;
};

/**
 * Tarayıcı eklentisinin `window.<wallet>` üzerinden expose ettiği minimum
 * arayüz. Solflare, Phantom ve Backpack üçü de aynı interface'i destekler
 * (Phantom Solflare API'sını birebir takip etmiş, Backpack da uyumlu).
 *
 * Transaction imzalama metodları Kamino deposit / DFlow swap / durable-
 * nonce pre-signing flow'ları için kullanılır.
 */
interface WalletProvider {
  isSolflare?: boolean;
  isPhantom?: boolean;
  isBackpack?: boolean;
  isConnected: boolean;
  publicKey: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  on(
    event: "connect" | "disconnect" | "accountChanged",
    handler: (...args: unknown[]) => void,
  ): void;
  off?(
    event: "connect" | "disconnect" | "accountChanged",
    handler: (...args: unknown[]) => void,
  ): void;
  signTransaction?<T>(tx: T): Promise<T>;
  signAllTransactions?<T>(txs: T[]): Promise<T[]>;
}

declare global {
  interface Window {
    solflare?: WalletProvider;
    phantom?: { solana?: WalletProvider };
    backpack?: WalletProvider;
  }
}

export type WalletId = "solflare" | "phantom" | "backpack";

export type WalletInfo = {
  id: WalletId;
  label: string;
  /** Browser download / install URL when extension isn't present. */
  downloadUrl: string;
  /** Returns true if the extension is installed in this browser. */
  detect: () => boolean;
};

export const SUPPORTED_WALLETS: readonly WalletInfo[] = [
  {
    id: "solflare",
    label: "Solflare",
    downloadUrl: "https://solflare.com/download",
    detect: () =>
      typeof window !== "undefined" && !!window.solflare?.isSolflare,
  },
  {
    id: "phantom",
    label: "Phantom",
    downloadUrl: "https://phantom.app/download",
    detect: () =>
      typeof window !== "undefined" && !!window.phantom?.solana?.isPhantom,
  },
  {
    id: "backpack",
    label: "Backpack",
    downloadUrl: "https://backpack.app/downloads",
    detect: () =>
      typeof window !== "undefined" && !!window.backpack?.isBackpack,
  },
] as const;

function resolveProvider(id: WalletId): WalletProvider | null {
  if (typeof window === "undefined") return null;
  if (id === "solflare") return window.solflare ?? null;
  if (id === "phantom") return window.phantom?.solana ?? null;
  if (id === "backpack") return window.backpack ?? null;
  return null;
}

function walletLabel(id: WalletId): string {
  return SUPPORTED_WALLETS.find((w) => w.id === id)?.label ?? id;
}

function walletDownloadUrl(id: WalletId): string {
  return SUPPORTED_WALLETS.find((w) => w.id === id)?.downloadUrl ?? "";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const SESSION_KEY = "liminal:solflare:connected";
const SELECTED_WALLET_KEY = "liminal:wallet:selected";
const DEFAULT_WALLET: WalletId = "solflare";

type Listener = (state: WalletState) => void;

class SolflareService {
  private state: WalletState = {
    connected: false,
    connecting: false,
    address: null,
  };
  private listeners = new Set<Listener>();
  private initialized = false;
  private selectedWallet: WalletId = DEFAULT_WALLET;
  private boundProvider: WalletProvider | null = null;
  private handlers: {
    connect: (...args: unknown[]) => void;
    disconnect: (...args: unknown[]) => void;
    accountChanged: (...args: unknown[]) => void;
  } | null = null;

  /** Reactive state subscription. Returns unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getState(): WalletState {
    return this.state;
  }

  private setState(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  /** Returns the active wallet's window provider, or null if it's
   * not installed. The "active" wallet is the one the user last
   * picked via the picker (persisted) or the default Solflare. */
  private getProvider(): WalletProvider | null {
    return resolveProvider(this.selectedWallet);
  }

  getSelectedWalletId(): WalletId {
    return this.selectedWallet;
  }

  getSelectedWalletLabel(): string {
    return walletLabel(this.selectedWallet);
  }

  private safeStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private bindListeners(provider: WalletProvider): void {
    // Tear down any previous binding so swapping wallets doesn't keep
    // stale listeners firing.
    if (this.boundProvider && this.handlers) {
      try {
        this.boundProvider.off?.("connect", this.handlers.connect);
        this.boundProvider.off?.("disconnect", this.handlers.disconnect);
        this.boundProvider.off?.(
          "accountChanged",
          this.handlers.accountChanged,
        );
      } catch {
        /* off() may not exist; ignore */
      }
    }
    const handlers = {
      connect: () => {
        const addr = provider.publicKey?.toString() ?? null;
        this.setState({
          connected: !!addr,
          connecting: false,
          address: addr,
        });
        if (addr) this.safeStorage()?.setItem(SESSION_KEY, "1");
      },
      disconnect: () => {
        this.setState({ connected: false, connecting: false, address: null });
        this.safeStorage()?.removeItem(SESSION_KEY);
      },
      accountChanged: () => {
        const addr = provider.publicKey?.toString() ?? null;
        this.setState({ connected: !!addr, address: addr });
      },
    };
    provider.on("connect", handlers.connect);
    provider.on("disconnect", handlers.disconnect);
    provider.on("accountChanged", handlers.accountChanged);
    this.boundProvider = provider;
    this.handlers = handlers;
  }

  /**
   * Pick which wallet the service should drive. Persisted so a refresh
   * keeps the choice. Called by the wallet picker modal before connect.
   */
  selectWallet(id: WalletId): void {
    if (id === this.selectedWallet) return;
    this.selectedWallet = id;
    this.safeStorage()?.setItem(SELECTED_WALLET_KEY, id);
    // Force re-bind on next init so listeners track the new provider.
    this.initialized = false;
    // Optimistic state reset — the new wallet hasn't connected yet.
    this.setState({ connected: false, connecting: false, address: null });
  }

  /**
   * Provider event listener'larını kurar ve session persistence için sessiz
   * reconnect dener. İdempotent — birden fazla çağrılabilir.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Read the persisted wallet choice on first init. After that the
    // user only changes it through selectWallet().
    const stored = this.safeStorage()?.getItem(SELECTED_WALLET_KEY) as
      | WalletId
      | null;
    if (
      stored &&
      SUPPORTED_WALLETS.some((w) => w.id === stored)
    ) {
      this.selectedWallet = stored;
    }

    const provider = this.getProvider();
    if (!provider) return;

    this.bindListeners(provider);

    // Session persistence: daha önce bağlanmışsa sessiz reconnect.
    if (this.safeStorage()?.getItem(SESSION_KEY) === "1") {
      try {
        this.setState({ connecting: true });
        await provider.connect({ onlyIfTrusted: true });
        // `connect` event listener state'i güncelleyecek.
      } catch {
        // Kullanıcı cüzdanda trust'ı kaldırmış olabilir — flag'i temizle.
        this.safeStorage()?.removeItem(SESSION_KEY);
        this.setState({ connecting: false });
      }
    }
  }

  /**
   * Active user-initiated wallet connection. Optional `id` argument
   * lets the picker modal pass a different wallet before connecting
   * (without forcing the caller to call selectWallet() separately).
   */
  async connectWallet(id?: WalletId): Promise<string> {
    if (id && id !== this.selectedWallet) {
      this.selectWallet(id);
    }
    await this.init();

    const provider = this.getProvider();
    const label = this.getSelectedWalletLabel();
    if (!provider) {
      throw new Error(
        `${label} wallet not found. Please install the ${label} extension: ${walletDownloadUrl(this.selectedWallet)}`,
      );
    }
    if (!this.boundProvider) {
      this.bindListeners(provider);
    }

    try {
      this.setState({ connecting: true });
      await provider.connect();
      const addr = provider.publicKey?.toString();
      if (!addr) {
        throw new Error(
          `${label} connection failed. Please try again.`,
        );
      }
      this.setState({
        connected: true,
        connecting: false,
        address: addr,
      });
      this.safeStorage()?.setItem(SESSION_KEY, "1");
      return addr;
    } catch (err: unknown) {
      this.setState({ connecting: false });
      throw normalizeConnectError(err, label);
    }
  }

  /**
   * Solflare provider üzerinden bir transaction imzalar. Kamino deposit/
   * withdraw ve DFlow swap akışları bu metodu kullanır (BLOK 6 signing flow).
   * Provider bağlı değilse veya sign desteklemiyorsa anlamlı hata fırlatır.
   */
  async signTransaction<T>(tx: T): Promise<T> {
    const provider = this.getProvider();
    const label = this.getSelectedWalletLabel();
    if (!provider) {
      throw new Error(
        `${label} wallet not found. Please install the ${label} extension and connect.`,
      );
    }
    if (!provider.isConnected || !this.state.connected) {
      throw new Error(
        `${label} not connected. Connect your wallet before signing a transaction.`,
      );
    }
    if (typeof provider.signTransaction !== "function") {
      throw new Error(
        `Your ${label} version does not support transaction signing. Please update ${label}.`,
      );
    }

    // Mobile: wallet popup'ının açılmasını beklemek için 50ms kısa
    // gecikme. Desktop'ta popup anında açılır, gecikme yok.
    if (getIsMobileGlobal()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    try {
      return await provider.signTransaction(tx);
    } catch (err: unknown) {
      throw normalizeSignError(err, label);
    }
  }

  /**
   * Solflare'in tek popup'ta N transaction imzalatma API'si. Durable-
   * nonce pre-signing akışı için kritik: TWAP'ın tüm Kamino tx'lerini
   * (deposit + N withdraw + final + cleanup) tek approve ile toplar.
   *
   * Provider `signAllTransactions` desteklemiyorsa sessizce tek-tek
   * sign'a düşeriz — bu N ayrı popup açar ama akış durmaz.
   */
  async signAllTransactions<T>(txs: T[]): Promise<T[]> {
    if (txs.length === 0) return [];
    const provider = this.getProvider();
    const label = this.getSelectedWalletLabel();
    if (!provider) {
      throw new Error(
        `${label} wallet not found. Please install the ${label} extension and connect.`,
      );
    }
    if (!provider.isConnected || !this.state.connected) {
      throw new Error(
        `${label} not connected. Connect your wallet before signing transactions.`,
      );
    }

    if (getIsMobileGlobal()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    try {
      if (typeof provider.signAllTransactions === "function") {
        return await provider.signAllTransactions(txs);
      }
      // Fallback — older builds only expose signTransaction. Sequential
      // sign keeps the flow alive at the cost of N popups.
      if (typeof provider.signTransaction !== "function") {
        throw new Error(
          `Your ${label} version does not support transaction signing. Please update ${label}.`,
        );
      }
      const signed: T[] = [];
      for (const tx of txs) {
        signed.push(await provider.signTransaction(tx));
      }
      return signed;
    } catch (err: unknown) {
      throw normalizeSignError(err, label);
    }
  }

  /** Bağlantıyı kes ve local state'i temizle. */
  async disconnectWallet(): Promise<void> {
    const provider = this.getProvider();
    try {
      if (provider && provider.isConnected) {
        await provider.disconnect();
      }
    } catch {
      // Provider tarafında bir hata olsa bile local state'i temizle.
    } finally {
      this.safeStorage()?.removeItem(SESSION_KEY);
      this.setState({ connected: false, connecting: false, address: null });
    }
  }
}

function normalizeSignError(err: unknown, label: string): Error {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  if (/reject|cancel|denied|user rejected/i.test(message)) {
    return new Error(
      `Transaction rejected in ${label}. Approve it to continue.`,
    );
  }
  return new Error(`${label} signing error: ${message}`);
}

function normalizeConnectError(err: unknown, label: string): Error {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: number }).code
      : undefined;

  // EIP-1193 style rejection codes (Solflare/Phantom/Backpack all share).
  if (code === 4001 || /reject|cancel|denied|user rejected/i.test(message)) {
    return new Error(
      `${label} connection rejected. Click "Approve" in the ${label} popup to connect your wallet.`,
    );
  }
  return new Error(`${label} connection error: ${message}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const solflareService = new SolflareService();

export function initSolflare(): Promise<void> {
  return solflareService.init();
}

export function connectWallet(id?: WalletId): Promise<string> {
  return solflareService.connectWallet(id);
}

export function selectWallet(id: WalletId): void {
  solflareService.selectWallet(id);
}

export function getSelectedWalletId(): WalletId {
  return solflareService.getSelectedWalletId();
}

export function getSelectedWalletLabel(): string {
  return solflareService.getSelectedWalletLabel();
}

export function disconnectWallet(): Promise<void> {
  return solflareService.disconnectWallet();
}

export function subscribeWallet(fn: (state: WalletState) => void): () => void {
  return solflareService.subscribe(fn);
}

export function getWalletState(): WalletState {
  return solflareService.getState();
}

/**
 * Solflare ile bir transaction imzalar. Kamino / DFlow servisleri bu
 * fonksiyonu `signTransaction` callback'i olarak alır — hook'ların ve
 * servislerin provider'a doğrudan erişmesine gerek kalmaz.
 */
export function signTransactionWithSolflare<T>(tx: T): Promise<T> {
  return solflareService.signTransaction(tx);
}

/**
 * Solflare üzerinden N tx'i tek popup'ta imzalatır. Durable-nonce
 * pre-signing flow'u için bu callback kullanılır (executionMachine
 * plan build aşaması).
 */
export function signAllTransactionsWithSolflare<T>(txs: T[]): Promise<T[]> {
  return solflareService.signAllTransactions(txs);
}

// ---------------------------------------------------------------------------
// Balance fetching
// ---------------------------------------------------------------------------
//
// `getSOLBalance`, `getSPLTokenBalances` ve `getPythPrice` bu dosyanın
// üst kısmında `./quicknode` modülünden re-export edilir. Bakiye / fiyat
// mantığının tek kaynağı quicknode.ts — burada tekrar tanımlanmaz.
