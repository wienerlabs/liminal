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
 * Solflare tarayıcı eklentisinin `window.solflare` üzerinden expose ettiği
 * minimum arayüz. Transaction imzalama metodları bir sonraki bloklarda
 * kullanılacak (Kamino deposit, DFlow swap, vb.).
 */
interface SolflareProvider {
  isSolflare?: boolean;
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
    solflare?: SolflareProvider;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const SESSION_KEY = "liminal:solflare:connected";
const SOLFLARE_DOWNLOAD_URL = "https://solflare.com/download";

type Listener = (state: WalletState) => void;

class SolflareService {
  private state: WalletState = {
    connected: false,
    connecting: false,
    address: null,
  };
  private listeners = new Set<Listener>();
  private initialized = false;

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

  private getProvider(): SolflareProvider | null {
    if (typeof window === "undefined") return null;
    const provider = window.solflare;
    if (!provider || !provider.isSolflare) return null;
    return provider;
  }

  private safeStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  /**
   * Provider event listener'larını kurar ve session persistence için sessiz
   * reconnect dener. İdempotent — birden fazla çağrılabilir.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const provider = this.getProvider();
    if (!provider) return;

    provider.on("connect", () => {
      const addr = provider.publicKey?.toString() ?? null;
      this.setState({
        connected: !!addr,
        connecting: false,
        address: addr,
      });
      if (addr) this.safeStorage()?.setItem(SESSION_KEY, "1");
    });

    provider.on("disconnect", () => {
      this.setState({ connected: false, connecting: false, address: null });
      this.safeStorage()?.removeItem(SESSION_KEY);
    });

    provider.on("accountChanged", () => {
      const addr = provider.publicKey?.toString() ?? null;
      this.setState({ connected: !!addr, address: addr });
    });

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

  /** Aktif kullanıcı etkileşimi ile Solflare bağlantısı. */
  async connectWallet(): Promise<string> {
    await this.init();

    const provider = this.getProvider();
    if (!provider) {
      throw new Error(
        `Solflare cüzdanı bulunamadı. Lütfen Solflare eklentisini yükleyin: ${SOLFLARE_DOWNLOAD_URL}`,
      );
    }

    try {
      this.setState({ connecting: true });
      await provider.connect();
      const addr = provider.publicKey?.toString();
      if (!addr) {
        throw new Error(
          "Solflare bağlantısı kurulamadı. Lütfen tekrar deneyin.",
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
      throw normalizeConnectError(err);
    }
  }

  /**
   * Solflare provider üzerinden bir transaction imzalar. Kamino deposit/
   * withdraw ve DFlow swap akışları bu metodu kullanır (BLOK 6 signing flow).
   * Provider bağlı değilse veya sign desteklemiyorsa anlamlı hata fırlatır.
   */
  async signTransaction<T>(tx: T): Promise<T> {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error(
        "Solflare cüzdanı bulunamadı. Lütfen Solflare eklentisini yükleyin ve bağlanın.",
      );
    }
    if (!provider.isConnected || !this.state.connected) {
      throw new Error(
        "Solflare bağlı değil. İşlemi imzalamak için önce cüzdanınızı bağlayın.",
      );
    }
    if (typeof provider.signTransaction !== "function") {
      throw new Error(
        "Solflare sürümünüz transaction signing desteklemiyor. Lütfen Solflare'i güncelleyin.",
      );
    }

    // Mobile: Solflare popup'ının/modal'ının tam açılmasını beklemek için
    // 50ms kısa gecikme. Desktop'ta popup anında açılır, gecikme yok.
    if (getIsMobileGlobal()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    try {
      return await provider.signTransaction(tx);
    } catch (err: unknown) {
      throw normalizeSignError(err);
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

function normalizeSignError(err: unknown): Error {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "bilinmeyen hata";
  if (/reject|cancel|denied|user rejected/i.test(message)) {
    return new Error(
      "Solflare'de işlem reddedildi. Devam etmek için işlemi onaylamanız gerekir.",
    );
  }
  return new Error(`Solflare imza hatası: ${message}`);
}

function normalizeConnectError(err: unknown): Error {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "bilinmeyen hata";
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: number }).code
      : undefined;

  // Solflare ve EIP-1193 benzeri rejection kodları
  if (code === 4001 || /reject|cancel|denied|user rejected/i.test(message)) {
    return new Error(
      'Solflare bağlantısı reddedildi. Cüzdanı bağlamak için Solflare popup\'ında "Onayla" seçeneğine basmanız gerekir.',
    );
  }
  return new Error(`Solflare bağlantı hatası: ${message}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const solflareService = new SolflareService();

export function initSolflare(): Promise<void> {
  return solflareService.init();
}

export function connectWallet(): Promise<string> {
  return solflareService.connectWallet();
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

// ---------------------------------------------------------------------------
// Balance fetching
// ---------------------------------------------------------------------------
//
// `getSOLBalance`, `getSPLTokenBalances` ve `getPythPrice` bu dosyanın
// üst kısmında `./quicknode` modülünden re-export edilir. Bakiye / fiyat
// mantığının tek kaynağı quicknode.ts — burada tekrar tanımlanmaz.
