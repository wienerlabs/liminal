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
// Pyth pricing moved off-chain (Hermes HTTP API); the @pythnetwork/client
// on-chain parser is no longer required.

// ---------------------------------------------------------------------------
// Endpoint configuration
// ---------------------------------------------------------------------------
//
// RPC URL kaynağı: `.env.local` içindeki `VITE_QUICKNODE_RPC_URL`.
// Vite `import.meta.env` üzerinden compile-time'da inject edilir.
// Setup: `.env.example` dosyasını `.env.local`'a kopyala, URL'yi doldur.
// `.env.local` gitignore'lı — token git'e sızmaz.

export const QUICKNODE_RPC_ENDPOINT: string =
  (import.meta.env.VITE_QUICKNODE_RPC_URL as string | undefined) ?? "";

const COMMITMENT: Commitment = "confirmed";
const RPC_TIMEOUT_MS = 15_000;
const PYTH_STALE_CONFIDENCE_RATIO = 0.05; // confidence > 5% of price → stale

// Module-load-time safety: never fail silently if the developer forgets it.
if (typeof console !== "undefined" && !QUICKNODE_RPC_ENDPOINT) {
  console.error(
    "[LIMINAL] WARNING: VITE_QUICKNODE_RPC_URL is empty. All RPC calls will throw. " +
      "Copy `.env.example` to `.env.local` and fill in your QuickNode " +
      "dashboard > Endpoints > HTTP Provider URL.",
  );
}

function requireEndpoint(): string {
  if (!QUICKNODE_RPC_ENDPOINT) {
    throw new Error(
      "QuickNode RPC endpoint is not configured. " +
        "Set VITE_QUICKNODE_RPC_URL in `.env.local` and restart the dev server.",
    );
  }
  return QUICKNODE_RPC_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Mint → symbol / Pyth feed mappings
// ---------------------------------------------------------------------------
//
// All addresses below are canonical mainnet — verified via on-chain
// getAccountInfo (owner == TokenkegQ… SPL Token program) and base58
// round-trip through @solana/web3.js PublicKey constructor.
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

/**
 * Pyth Network **Hermes** price-feed IDs (not Solana accounts).
 *
 * Why Hermes over on-chain v1 Pyth accounts:
 *   - Pyth's v1 on-chain price accounts (e.g. H6ARHf6YX… for SOL) have
 *     been deprecated in favor of the V2 Pull Oracle, and a bare
 *     `getAccountInfo` on them returns `null` on mainnet today.
 *   - V2 on-chain accounts are shard-rotated and not stable.
 *   - Hermes exposes a stable HTTP API keyed by the canonical 32-byte
 *     hex feed ID, which is the documented public identifier for each
 *     Pyth price stream: https://pyth.network/developers/price-feed-ids
 *
 * Price is derived as `price.price * 10^price.expo`. A `conf > price *
 * PYTH_STALE_CONFIDENCE_RATIO` reading is treated as stale and returns
 * null — the caller never sees a guessed value.
 */
const HERMES_URL = "https://hermes.pyth.network";

const PYTH_FEED_ID_BY_MINT: Record<string, string> = {
  [SOL_MINT]:
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL/USD
  [USDC_MINT]:
    "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", // USDC/USD
  [USDT_MINT]:
    "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b", // USDT/USD
  [BONK_MINT]:
    "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419", // BONK/USD
};

/** SPL Token program ID (legacy Token Program). */
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/**
 * Token-2022 program ID. Many newer tokens (pump.fun memecoins,
 * USDC's Token-2022 variants, transfer-fee enabled tokens) live under
 * this program rather than the legacy SPL Token Program. Both must be
 * queried separately because `getParsedTokenAccountsByOwner` filters
 * by a single program at a time.
 */
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
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
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Registry-aware symbol resolver. Order:
//   1. Statik canonical mapping (SOL/USDC/USDT/BONK) — instant
//   2. Jupiter token registry (lazy loaded, cached) — async warmup
//   3. Shortened mint fallback
import { lookupToken as registryLookup } from "./tokenRegistry";

function symbolFor(mint: string): string {
  if (MINT_TO_SYMBOL[mint]) return MINT_TO_SYMBOL[mint];
  const reg = registryLookup(mint);
  if (reg?.symbol) return reg.symbol;
  return shortMint(mint);
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

/** Is an error a 429 Too Many Requests / rate-limit signal? */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b429\b|too many requests|rate ?limit|slow ?down|exceeded.*?(req|quota)/i.test(
      msg,
    )
  );
}

/**
 * Retries a promise-producing fn on 429 / rate-limit failures with
 * exponential backoff + jitter. Never retries on timeouts or arbitrary
 * errors — rate-limit is the only class of failure where re-running the
 * same call with no input change is legitimate.
 *
 * Delays: 500ms → 1s → 2s → 4s, capped at 4 retries (~7.5s total).
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  const MAX_RETRIES = 4;
  const BASE_DELAY_MS = 500;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RETRIES) {
        throw err;
      }
      const delay =
        BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(
        `[LIMINAL] ${label} rate-limited (attempt ${attempt + 1}/${MAX_RETRIES}), backing off ${Math.round(delay)}ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
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
    const lamports = await withRateLimitRetry(
      () =>
        withTimeout(
          connection.getBalance(pubkey, COMMITMENT),
          RPC_TIMEOUT_MS,
          "SOL balance query",
        ),
      "getBalance",
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

  // BUG FIX (AAA): query BOTH the legacy SPL Token program and Token-
  // 2022 separately. `getParsedTokenAccountsByOwner` only filters by
  // one program at a time, and many newer tokens (pump.fun memecoins,
  // USDC's Token-2022 variants, transfer-fee enabled tokens) live
  // under Token-2022. Without this, those balances were invisible in
  // the From/To dropdown — user couldn't trade them.
  let legacyAccounts;
  let token2022Accounts;
  try {
    [legacyAccounts, token2022Accounts] = await Promise.all([
      withRateLimitRetry(
        () =>
          withTimeout(
            connection.getParsedTokenAccountsByOwner(
              pubkey,
              { programId: TOKEN_PROGRAM_ID },
              COMMITMENT,
            ),
            RPC_TIMEOUT_MS,
            "SPL token accounts query",
          ),
        "getParsedTokenAccountsByOwner",
      ),
      // Token-2022: same query, different program id. We don't fail
      // the whole flow if Token-2022 is empty / errors — fall back to
      // legacy-only by treating an error as "no accounts".
      withRateLimitRetry(
        () =>
          withTimeout(
            connection.getParsedTokenAccountsByOwner(
              pubkey,
              { programId: TOKEN_2022_PROGRAM_ID },
              COMMITMENT,
            ),
            RPC_TIMEOUT_MS,
            "Token-2022 accounts query",
          ),
        "getParsedTokenAccountsByOwner",
      ).catch((err) => {
        console.warn(
          `[LIMINAL] Token-2022 fetch skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { value: [] };
      }),
    ]);
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
  for (const { account } of [
    ...legacyAccounts.value,
    ...token2022Accounts.value,
  ]) {
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

/** Hermes response shape (only the fields we actually read). */
type HermesParsedPrice = {
  id: string;
  price?: {
    price: string; // stringified int mantissa
    conf: string;  // stringified int confidence
    expo: number;  // e.g. -8
    publish_time: number;
  };
};

type HermesResponse = {
  parsed?: HermesParsedPrice[];
};

/**
 * Fetches one token's USD price from Pyth Hermes. Returns null on any
 * network / parse / stale condition — never guesses or falls back.
 *
 * Hermes returns price as `price × 10^expo`. Confidence interval > 5% of
 * price is treated as stale (per BLOK 5 discipline).
 */
export async function getPythPrice(
  tokenMint: string,
): Promise<number | null> {
  const feedId = PYTH_FEED_ID_BY_MINT[tokenMint];
  if (!feedId) {
    // Unknown mint — no Pyth feed. Silent null.
    return null;
  }

  const url = `${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`;
  let response: Response;
  try {
    response = await withRateLimitRetry(
      () =>
        withTimeout(
          fetch(url, { method: "GET" }),
          RPC_TIMEOUT_MS,
          `Pyth Hermes (${symbolFor(tokenMint)})`,
        ),
      `Pyth Hermes (${symbolFor(tokenMint)})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[LIMINAL] Pyth Hermes request failed (${symbolFor(tokenMint)}): ${message}`,
    );
    return null;
  }

  if (!response.ok) {
    console.warn(
      `[LIMINAL] Pyth Hermes non-OK (${symbolFor(tokenMint)}): ${response.status}`,
    );
    return null;
  }

  let json: HermesResponse;
  try {
    json = (await response.json()) as HermesResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[LIMINAL] Pyth Hermes parse error (${symbolFor(tokenMint)}): ${message}`,
    );
    return null;
  }

  const match = json.parsed?.find((p) => p.id === feedId);
  const p = match?.price;
  if (!p) {
    console.warn(
      `[LIMINAL] Pyth Hermes no parsed price (${symbolFor(tokenMint)}).`,
    );
    return null;
  }

  const mantissa = Number(p.price);
  const conf = Number(p.conf);
  if (
    !Number.isFinite(mantissa) ||
    !Number.isFinite(p.expo) ||
    mantissa <= 0
  ) {
    console.warn(
      `[LIMINAL] Pyth Hermes invalid price (${symbolFor(tokenMint)}): price=${p.price}`,
    );
    return null;
  }

  const scale = Math.pow(10, p.expo);
  const price = mantissa * scale;
  const confidence = Number.isFinite(conf) ? conf * scale : 0;

  if (!Number.isFinite(price) || price <= 0) {
    console.warn(
      `[LIMINAL] Pyth Hermes computed non-positive price (${symbolFor(tokenMint)}): ${price}`,
    );
    return null;
  }

  // Stale check: confidence interval > PYTH_STALE_CONFIDENCE_RATIO of price.
  if (confidence > 0 && confidence > price * PYTH_STALE_CONFIDENCE_RATIO) {
    console.warn(
      `[LIMINAL] Pyth Hermes stale (${symbolFor(tokenMint)}): price=${price}, conf=${confidence}`,
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
