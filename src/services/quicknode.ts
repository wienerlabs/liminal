/**
 * LIMINAL — Quicknode RPC Service
 *
 * BLOK 5 (Quicknode Entegrasyon Spesifikasyonu) altında:
 * - Solana RPC (getBalance, getParsedTokenAccountsByOwner)
 * - Pyth Network fiyat feed'leri (real-time monitoring)
 * - Price polling loop (5s interval, BLOK 5 Senaryo 1)
 *
 * Mutlak kurallar:
 * - Commitment seviyesi: `confirmed` (BLOK 5'te `finalized` yasak)
 * - Sessiz fail YOK. Her hata anlamlı Türkçe mesaj ile fırlatılır.
 * - Fiyat uydurma YOK. getPythPrice parse/stale/network hatasında null döner.
 */

import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type Commitment,
  type ParsedAccountData,
} from "@solana/web3.js";
import { parsePriceData, PriceStatus } from "@pythnetwork/client";

// ---------------------------------------------------------------------------
// Endpoint configuration
// ---------------------------------------------------------------------------

// QUICKNODE DASHBOARD > SOLANA MAINNET > HTTP PROVIDER URL BURAYA
export const QUICKNODE_RPC_ENDPOINT = "";

const COMMITMENT: Commitment = "confirmed";
const RPC_TIMEOUT_MS = 15_000;
const PYTH_STALE_CONFIDENCE_RATIO = 0.05; // confidence > 5% of price → stale

// Module-load-time safety: never fail silently if the developer forgets it.
if (typeof console !== "undefined" && !QUICKNODE_RPC_ENDPOINT) {
  console.error(
    "[LIMINAL] WARNING: QUICKNODE_RPC_ENDPOINT is empty. All RPC calls will throw. " +
      "Fill the constant at the top of src/services/quicknode.ts with " +
      "your Quicknode dashboard > Solana Mainnet > HTTP Provider URL.",
  );
}

function requireEndpoint(): string {
  if (!QUICKNODE_RPC_ENDPOINT) {
    throw new Error(
      "Quicknode RPC endpoint is not configured. " +
        "Fill the QUICKNODE_RPC_ENDPOINT constant at the top of src/services/quicknode.ts.",
    );
  }
  return QUICKNODE_RPC_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Mint → symbol / Pyth feed mappings
// ---------------------------------------------------------------------------
//
// !!! DİKKAT — USDC MINT ADRESİ DOĞRULANMALI !!!
// Prompt'tan alınan USDC mint ("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
// canonical mainnet USDC mint'i ("EPjFWdd5AufqSSqeM2qN1xzybapC8GAnTfFTKCgY4wEG")
// ile birebir eşleşmiyor. Mainnet'e deploy öncesi canonical değerle değiştir.
// USDT / BONK / SOL adresleri canonical ile uyumlu.
// ---------------------------------------------------------------------------

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Bilinen mainnet mint adreslerinden sembol çözümlemesi. */
const MINT_TO_SYMBOL: Record<string, string> = {
  [USDC_MINT]: "USDC",
  [USDT_MINT]: "USDT",
  [BONK_MINT]: "BONK",
  [SOL_MINT]: "SOL",
};

/** Pyth Network price feed hesap adresleri (Solana mainnet). */
const PYTH_FEED_BY_MINT: Record<string, string> = {
  [SOL_MINT]: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4GGKBG", // SOL/USD
  [USDC_MINT]: "Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD", // USDC/USD
  [USDT_MINT]: "3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL", // USDT/USD
  [BONK_MINT]: "8ihFLu5FimgTQ1Unh4dVyEHUGodJ738bWzdxjsClQpfh", // BONK/USD
};

/** SPL Token program ID (legacy Token Program). */
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenBalance = {
  mint: string;
  symbol: string;
  balance: number;
  usdValue: number;
};

/** Pyth fiyat haritası: mint → USD fiyatı. Feed'i olmayan mintler map'te yok. */
export type PriceMap = { [mint: string]: number };

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let cachedConnection: Connection | null = null;
let cachedEndpoint = "";

/**
 * @solana/web3.js Connection — commitment "confirmed" (BLOK 5 kuralı,
 * `finalized` beklemek her dilim arası kabul edilemez gecikme yaratır).
 */
export function createConnection(): Connection {
  const endpoint = requireEndpoint();
  if (cachedConnection && cachedEndpoint === endpoint) {
    return cachedConnection;
  }
  cachedConnection = new Connection(endpoint, {
    commitment: COMMITMENT,
    confirmTransactionInitialTimeout: 60_000,
  });
  cachedEndpoint = endpoint;
  return cachedConnection;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortMint(mint: string): string {
  if (mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function symbolFor(mint: string): string {
  return MINT_TO_SYMBOL[mint] ?? shortMint(mint);
}

/**
 * Mint → insan-okunabilir sembol çözümleyici. Bilinen mainnet mintler için
 * canonical sembol, bilinmeyenler için kısaltılmış "Ab12...Xy89" formatı.
 * Analytics ve geçmiş kayıtları bu fonksiyonu kullanır.
 */
export function resolveTokenSymbol(mint: string): string {
  return symbolFor(mint);
}

function parsePublicKey(address: string, label = "wallet address"): PublicKey {
  try {
    return new PublicKey(address);
  } catch {
    throw new Error(
      `Invalid Solana ${label}: "${address}". Please reconnect Solflare.`,
    );
  }
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /fetch failed|network|ECONNRESET|ENOTFOUND|Failed to fetch|ERR_NETWORK/i.test(
    err.message,
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out (${ms}ms).`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// getSOLBalance
// ---------------------------------------------------------------------------

/** Wallet'ın native SOL bakiyesini döner. Lamport → SOL dönüşümü dahil. */
export async function getSOLBalance(walletAddress: string): Promise<number> {
  if (!walletAddress) {
    throw new Error("Wallet address required — connect Solflare first.");
  }
  const pubkey = parsePublicKey(walletAddress);
  const connection = createConnection();

  try {
    const lamports = await withTimeout(
      connection.getBalance(pubkey, COMMITMENT),
      RPC_TIMEOUT_MS,
      "SOL balance query",
    );
    return lamports / LAMPORTS_PER_SOL;
  } catch (err) {
    if (err instanceof Error && /timed out/.test(err.message)) {
      throw err;
    }
    if (isNetworkError(err)) {
      throw new Error(
        "Cannot reach Quicknode RPC. Check your internet connection and RPC endpoint.",
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch SOL balance: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// getSPLTokenBalances
// ---------------------------------------------------------------------------

type ParsedTokenInfo = {
  mint?: string;
  tokenAmount?: { uiAmount?: number | null };
};

/**
 * Wallet'ın tüm SPL token hesaplarını çeker; sıfır bakiyelileri filtreler;
 * bilinen mintler için sembol çözümler, bilinmeyen mintleri kısaltılmış
 * "Ab12...Xy89" formatında etiketler. USD değerleri Pyth'ten hesaplanır —
 * fiyat alınamazsa o token'ın usdValue'su 0 olarak kalır ama token listeden
 * düşürülmez.
 */
export async function getSPLTokenBalances(
  walletAddress: string,
): Promise<TokenBalance[]> {
  if (!walletAddress) {
    throw new Error("Wallet address required — connect Solflare first.");
  }
  const pubkey = parsePublicKey(walletAddress);
  const connection = createConnection();

  let accounts;
  try {
    accounts = await withTimeout(
      connection.getParsedTokenAccountsByOwner(
        pubkey,
        { programId: TOKEN_PROGRAM_ID },
        COMMITMENT,
      ),
      RPC_TIMEOUT_MS,
      "SPL token accounts query",
    );
  } catch (err) {
    if (err instanceof Error && /timed out/.test(err.message)) {
      throw err;
    }
    if (isNetworkError(err)) {
      throw new Error(
        "Cannot reach Quicknode RPC. Check your internet connection and RPC endpoint.",
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch SPL token balances: ${message}`);
  }

  type Row = { mint: string; balance: number };
  const rows: Row[] = [];
  for (const { account } of accounts.value) {
    const data = account.data as ParsedAccountData;
    const parsed = data.parsed as { info?: ParsedTokenInfo } | undefined;
    const info = parsed?.info;
    const mint = info?.mint;
    const uiAmount = info?.tokenAmount?.uiAmount;
    if (!mint || uiAmount == null || uiAmount <= 0) continue;
    rows.push({ mint, balance: uiAmount });
  }

  if (rows.length === 0) return [];

  // Tüm benzersiz mintler için Pyth fiyatlarını paralel çek.
  const uniqueMints = Array.from(new Set(rows.map((r) => r.mint)));
  const prices = await fetchPricesMap(uniqueMints);

  return rows.map((row) => ({
    mint: row.mint,
    symbol: symbolFor(row.mint),
    balance: row.balance,
    usdValue: (prices[row.mint] ?? 0) * row.balance,
  }));
}

// ---------------------------------------------------------------------------
// Pyth price fetching
// ---------------------------------------------------------------------------

/**
 * Pyth Network price feed account'undan tek bir token için on-chain fiyat
 * okur. Bilinmeyen mint, parse hatası, stale fiyat (confidence > %5) veya
 * bağlantı hatası durumunda `null` döner ve console.warn ile loglar —
 * fiyatı hiçbir zaman uydurmaz.
 */
export async function getPythPrice(
  tokenMint: string,
): Promise<number | null> {
  const feedAddress = PYTH_FEED_BY_MINT[tokenMint];
  if (!feedAddress) {
    // Bilinmeyen mint — Pyth feed'i yok. Uydurma, sessizce null dön.
    return null;
  }

  let connection: Connection;
  try {
    connection = createConnection();
  } catch {
    console.warn(
      `[LIMINAL] Pyth fiyat çekilemedi (${symbolFor(tokenMint)}): Quicknode endpoint yapılandırılmamış.`,
    );
    return null;
  }

  const feedPubkey = parsePublicKey(feedAddress, "Pyth feed adresi");

  let accountInfo;
  try {
    accountInfo = await withTimeout(
      connection.getAccountInfo(feedPubkey, COMMITMENT),
      RPC_TIMEOUT_MS,
      `Pyth feed sorgusu (${symbolFor(tokenMint)})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[LIMINAL] Pyth bağlantı hatası (${symbolFor(tokenMint)}): ${message}`,
    );
    return null;
  }

  if (!accountInfo || !accountInfo.data) {
    console.warn(
      `[LIMINAL] Pyth feed account bulunamadı (${symbolFor(tokenMint)}/${feedAddress}).`,
    );
    return null;
  }

  let priceData;
  try {
    priceData = parsePriceData(accountInfo.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[LIMINAL] Pyth parse hatası (${symbolFor(tokenMint)}): ${message}`,
    );
    return null;
  }

  // Trading dışı durumlar (Halted, Auction, Unknown) → stale kabul et.
  if (
    priceData.status !== undefined &&
    priceData.status !== PriceStatus.Trading
  ) {
    console.warn(
      `[LIMINAL] Pyth feed trading durumunda değil (${symbolFor(tokenMint)}): status=${priceData.status}`,
    );
    return null;
  }

  const price = priceData.price;
  const confidence = priceData.confidence;

  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    console.warn(
      `[LIMINAL] Pyth geçerli fiyat döndürmedi (${symbolFor(tokenMint)}): price=${String(price)}`,
    );
    return null;
  }

  // Stale check: confidence interval fiyatın %5'inden geniş → güvenme.
  if (
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence > price * PYTH_STALE_CONFIDENCE_RATIO
  ) {
    console.warn(
      `[LIMINAL] Pyth fiyat stale (${symbolFor(tokenMint)}): price=${price}, confidence=${confidence}`,
    );
    return null;
  }

  return price;
}

/** Çoklu mint için paralel fiyat çekimi. Başarısız olanlar map'te yer almaz. */
async function fetchPricesMap(mints: string[]): Promise<PriceMap> {
  if (mints.length === 0) return {};
  const entries = await Promise.all(
    mints.map(
      async (mint) => [mint, await getPythPrice(mint)] as const,
    ),
  );
  const map: PriceMap = {};
  for (const [mint, price] of entries) {
    if (price != null) map[mint] = price;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Price polling
// ---------------------------------------------------------------------------

/**
 * Verilen mintler için `intervalMs`'de bir Pyth fiyatlarını çeker ve her tick
 * sonrası callback'i çağırır. Bir tick başarısız olursa callback boş map ile
 * çağrılır (hook tarafı ardışık hata sayımı yapabilsin). İlk tick immediate —
 * UX gecikmesini engellemek için.
 *
 * Return: cleanup fonksiyonu (useEffect'te çağrılacak).
 */
export function startPricePolling(
  tokenMints: string[],
  intervalMs: number,
  callback: (prices: PriceMap) => void,
): () => void {
  if (tokenMints.length === 0 || intervalMs <= 0) {
    return () => {};
  }

  // Stabil referans — tüketici array mutate etse bile aynı tick çalışsın.
  const mints = [...tokenMints];
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (cancelled) return;

    let prices: PriceMap = {};
    try {
      prices = await fetchPricesMap(mints);
    } catch (err) {
      console.warn(
        `[LIMINAL] Pyth polling tick istisnası: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Boş map kalır — hook bunu ardışık hata olarak sayacak.
    }

    if (cancelled) return;
    callback(prices);

    if (cancelled) return;
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  // İlk tick immediate.
  void tick();

  return () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
