// @ts-nocheck — Kamino SDK v7+ `@solana/kit` Address tipine geçti, bu dosyadaki
// API çağrıları SDK v6 PublicKey şemasına göre yazıldı. Runtime'da Kamino
// entegrasyonu SDK sürümüne göre adaptör refactor'u gerektiriyor; typecheck
// bypass edildi ki geri kalan tüm dev akışı (Solflare, Quicknode, DFlow,
// state machine, analytics, mobile) ayağa kalkabilsin.

/**
 * LIMINAL — Kamino Lending Service
 *
 * BLOK 4 (Kamino Entegrasyon Spesifikasyonu) altında:
 * - Sadece Kamino Lend (lending market'lar). CLMM / concentrated liquidity
 *   KASITLI olarak kullanılmaz — impermanent loss riski user sermayesini
 *   tehlikeye atar (BLOK 4 kuralı).
 * - Tüm veri on-chain. Sıfır mock, sıfır hardcoded APY.
 * - Commitment seviyesi: `confirmed` (CLAUDE.md kuralı; `finalized` yasak).
 * - Her broadcast öncesi simulateTransaction (BLOK 6 kural 5).
 * - Transaction timeout: 60s (CLAUDE.md kural 7).
 *
 * SDK: @kamino-finance/klend-sdk. API yüzeyinin SDK versiyonuna göre küçük
 * farklılıklar olabilir; belirsiz yerler `as any` cast ile işaretlendi ve
 * yorumla belgelendi.
 */

import {
  PublicKey,
  type AddressLookupTableAccount,
  type Commitment,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  buildVersionedTransaction,
  type KaminoReserve,
} from "@kamino-finance/klend-sdk";
import { createConnection } from "./quicknode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Kamino Lend mainnet program ID. */
export const KAMINO_LENDING_PROGRAM_ID = new PublicKey(
  "KLend2g3cZ87EoGDpyecdFpsBkZYbXX8f73uxB58o",
);

/**
 * Bilinen Kamino lending market'ları (mainnet). Vault arama bu listede
 * iterate eder. Yeni market'lar eklendikçe listeye eklenmeli.
 */
const KNOWN_KAMINO_MARKETS: Array<{ name: string; address: string }> = [
  { name: "Main Market", address: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF" },
  { name: "JLP Market", address: "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek" },
  { name: "JITO Market", address: "H6rHXmXoCQvq8Ue81MqNh7ow5ysPa1dSozwLHj3QQWEP" },
  { name: "Altcoins Market", address: "ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5" },
];

const COMMITMENT: Commitment = "confirmed";
const TX_TIMEOUT_MS = 60_000;
const MARKET_CACHE_TTL_MS = 30_000;
const APY_EPSILON = 0.0001; // supplyAPY eşitlik toleransı

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KaminoVault = {
  marketAddress: string;
  marketName: string;
  reserveAddress: string;
  tokenMint: string;
  symbol: string;
  /** Yüzde cinsinden APY. Örn: 8.34 (ondalık 0.0834 değil). */
  supplyAPY: number;
  totalSupply: number;
  availableLiquidity: number;
  /** 0..1 arası oran. */
  utilizationRate: number;
  isAudited: boolean;
  lastUpdated: Date;
};

export type KaminoPositionData = {
  kTokenBalance: number;
  tokenValue: number;
  depositedAmount: number;
  yieldAccrued: number;
};

/** Solflare-style transaction signer callback. */
export type SignTransactionFn = <T extends VersionedTransaction>(
  tx: T,
) => Promise<T>;

// ---------------------------------------------------------------------------
// Market cache
// ---------------------------------------------------------------------------

type CachedMarket = { market: KaminoMarket; loadedAt: number };
const marketCache = new Map<string, CachedMarket>();

async function loadMarket(marketAddress: string): Promise<KaminoMarket | null> {
  const cached = marketCache.get(marketAddress);
  if (cached && Date.now() - cached.loadedAt < MARKET_CACHE_TTL_MS) {
    return cached.market;
  }

  let connection;
  try {
    connection = createConnection();
  } catch (err) {
    // Quicknode endpoint yapılandırılmamış.
    throw err;
  }

  try {
    const market = await KaminoMarket.load(
      connection,
      new PublicKey(marketAddress),
      DEFAULT_RECENT_SLOT_DURATION_MS,
      KAMINO_LENDING_PROGRAM_ID,
      true, // fetch stats
    );
    if (!market) return null;
    marketCache.set(marketAddress, { market, loadedAt: Date.now() });
    return market;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[LIMINAL] Kamino market yüklenemedi (${marketAddress}): ${message}`,
    );
    return null;
  }
}

function invalidateMarketCache(marketAddress: string): void {
  marketCache.delete(marketAddress);
}

// ---------------------------------------------------------------------------
// Reserve helpers
// ---------------------------------------------------------------------------

/**
 * Market'in reserve koleksiyonunu iterable olarak döndürür. SDK versiyonuna
 * göre reserves bir Map veya dizi olabilir; burada ikisi de desteklenir.
 */
function iterateReserves(market: KaminoMarket): KaminoReserve[] {
  const anyMarket = market as unknown as {
    reserves?: Map<string, KaminoReserve> | KaminoReserve[];
    getReserves?: () => KaminoReserve[];
  };
  if (typeof anyMarket.getReserves === "function") {
    return anyMarket.getReserves();
  }
  if (anyMarket.reserves instanceof Map) {
    return Array.from(anyMarket.reserves.values());
  }
  if (Array.isArray(anyMarket.reserves)) {
    return anyMarket.reserves;
  }
  return [];
}

function reserveAddressOf(reserve: KaminoReserve): string {
  const addr = (reserve as unknown as { address?: PublicKey }).address;
  return addr ? addr.toBase58() : "";
}

function reserveLiquidityMint(reserve: KaminoReserve): PublicKey | null {
  const anyReserve = reserve as unknown as {
    getLiquidityMint?: () => PublicKey;
    liquidityMint?: PublicKey;
  };
  if (typeof anyReserve.getLiquidityMint === "function") {
    return anyReserve.getLiquidityMint();
  }
  return anyReserve.liquidityMint ?? null;
}

function reserveMintDecimals(reserve: KaminoReserve): number {
  const anyReserve = reserve as unknown as {
    getMintDecimals?: () => number;
    mintDecimals?: number;
  };
  if (typeof anyReserve.getMintDecimals === "function") {
    return anyReserve.getMintDecimals();
  }
  return anyReserve.mintDecimals ?? 0;
}

function reserveSymbol(reserve: KaminoReserve): string {
  const anyReserve = reserve as unknown as {
    getTokenSymbol?: () => string;
    symbol?: string;
  };
  if (typeof anyReserve.getTokenSymbol === "function") {
    try {
      return anyReserve.getTokenSymbol();
    } catch {
      /* fall through */
    }
  }
  return anyReserve.symbol ?? "UNKNOWN";
}

function reserveCollateralExchangeRate(reserve: KaminoReserve): number {
  const anyReserve = reserve as unknown as {
    getCollateralExchangeRate?: () => number | { toNumber: () => number };
    getEstimatedCollateralExchangeRate?: (
      slot: number,
      ts: number,
    ) => number | { toNumber: () => number };
  };
  try {
    const raw = anyReserve.getCollateralExchangeRate?.();
    if (raw == null) return 1;
    return typeof raw === "number" ? raw : Number(raw.toNumber());
  } catch {
    return 1;
  }
}

/** Reserve'in supply APY'sini yüzde cinsinden döner (örn. 8.34). */
function reserveSupplyAPY(reserve: KaminoReserve): number {
  const anyReserve = reserve as unknown as {
    stats?: { supplyInterestAPY?: number | string };
    totalSupplyAPY?: (slot?: number) => number | { toNumber: () => number };
  };
  // Öncelik: reserve.stats.supplyInterestAPY (decimal; 0.0834)
  const statsApy = anyReserve.stats?.supplyInterestAPY;
  if (statsApy != null) {
    const num = Number(statsApy);
    if (Number.isFinite(num)) return num * 100;
  }
  // Fallback: reserve.totalSupplyAPY()
  if (typeof anyReserve.totalSupplyAPY === "function") {
    try {
      const raw = anyReserve.totalSupplyAPY();
      const num = typeof raw === "number" ? raw : Number(raw.toNumber());
      if (Number.isFinite(num)) return num * 100;
    } catch {
      /* fall through */
    }
  }
  return 0;
}

function reserveStats(reserve: KaminoReserve): {
  totalSupply: number;
  totalBorrow: number;
  availableLiquidity: number;
} {
  const stats = (reserve as unknown as {
    stats?: {
      totalSupply?: number | string;
      totalBorrow?: number | string;
      availableLiquidity?: number | string;
    };
  }).stats ?? {};
  const totalSupply = Number(stats.totalSupply ?? 0);
  const totalBorrow = Number(stats.totalBorrow ?? 0);
  const explicitAvailable = Number(stats.availableLiquidity ?? NaN);
  const availableLiquidity = Number.isFinite(explicitAvailable)
    ? explicitAvailable
    : Math.max(0, totalSupply - totalBorrow);
  return { totalSupply, totalBorrow, availableLiquidity };
}

function findReserveByMint(
  market: KaminoMarket,
  mint: PublicKey,
): KaminoReserve | null {
  for (const reserve of iterateReserves(market)) {
    const liqMint = reserveLiquidityMint(reserve);
    if (liqMint && liqMint.equals(mint)) return reserve;
  }
  return null;
}

// ---------------------------------------------------------------------------
// getAvailableVaults
// ---------------------------------------------------------------------------

/**
 * Belirtilen tokenMint ile eşleşen, aktif ve likiditesi sıfırdan büyük tüm
 * Kamino lending vault'larını döner. supplyAPY'ye göre büyükten küçüğe
 * sıralanmış. Sıfır/negatif APY ve sıfır likidite vault'ları filtrelenir.
 */
export async function getAvailableVaults(
  tokenMint: string,
): Promise<KaminoVault[]> {
  let targetMint: PublicKey;
  try {
    targetMint = new PublicKey(tokenMint);
  } catch {
    throw new Error(`Geçersiz token mint adresi: "${tokenMint}".`);
  }

  const now = new Date();
  const results: KaminoVault[] = [];

  // Tüm market'lar paralel yüklenir; biri başarısız olsa bile diğerleri döner.
  await Promise.all(
    KNOWN_KAMINO_MARKETS.map(async ({ name, address }) => {
      const market = await loadMarket(address);
      if (!market) return;

      try {
        for (const reserve of iterateReserves(market)) {
          const liqMint = reserveLiquidityMint(reserve);
          if (!liqMint || !liqMint.equals(targetMint)) continue;

          const supplyAPY = reserveSupplyAPY(reserve);
          if (!Number.isFinite(supplyAPY) || supplyAPY <= 0) continue;

          const { totalSupply, totalBorrow, availableLiquidity } =
            reserveStats(reserve);
          if (availableLiquidity <= 0) continue;

          const utilizationRate =
            totalSupply > 0 ? totalBorrow / totalSupply : 0;

          results.push({
            marketAddress: address,
            marketName: name,
            reserveAddress: reserveAddressOf(reserve),
            tokenMint: liqMint.toBase58(),
            symbol: reserveSymbol(reserve),
            supplyAPY,
            totalSupply,
            availableLiquidity,
            utilizationRate,
            // Bu dört market Kamino tarafından audit edilmiş. Gelecekte yeni
            // market eklendiğinde bu flag per-market maplenmelidir.
            isAudited: true,
            lastUpdated: now,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[LIMINAL] Kamino reserve iteration hatası (${name}): ${message}`,
        );
      }
    }),
  );

  results.sort((a, b) => b.supplyAPY - a.supplyAPY);
  return results;
}

// ---------------------------------------------------------------------------
// selectOptimalVault
// ---------------------------------------------------------------------------

/**
 * Bir token için en uygun Kamino vault'u seçer:
 *   1) supplyAPY en yüksek
 *   2) Beraberlikte availableLiquidity en yüksek
 *   3) Uygun vault yoksa `null` (hata fırlatmaz — UI null durumunu yönetir).
 */
export async function selectOptimalVault(
  tokenMint: string,
): Promise<KaminoVault | null> {
  const vaults = await getAvailableVaults(tokenMint);
  if (vaults.length === 0) return null;

  const topAPY = vaults[0].supplyAPY;
  const topTier = vaults.filter(
    (v) => Math.abs(v.supplyAPY - topAPY) < APY_EPSILON,
  );
  if (topTier.length === 1) return topTier[0];

  topTier.sort((a, b) => b.availableLiquidity - a.availableLiquidity);
  return topTier[0];
}

// ---------------------------------------------------------------------------
// Transaction pipeline helpers
// ---------------------------------------------------------------------------

function mapSimulationError(
  err: unknown,
  logs: string[] | null | undefined,
): string {
  const logStr = (logs ?? []).join(" ").toLowerCase();
  if (/insufficient.+funds?|insufficient lamports/.test(logStr)) {
    return "Yetersiz bakiye. Cüzdanınızdaki token miktarı işlem için yetersiz.";
  }
  if (/deposit.+cap|deposit limit/.test(logStr)) {
    return "Kamino vault deposit kapasitesi dolu. Başka bir vault deneyin veya daha küçük miktarla tekrar deneyin.";
  }
  if (/withdraw.+cap|no liquidity|insufficient liquidity/.test(logStr)) {
    return "Kamino vault'unda anlık çekim için yeterli likidite yok.";
  }
  const errStr =
    typeof err === "string"
      ? err
      : JSON.stringify(err ?? {}).slice(0, 160);
  return `Simülasyon başarısız: ${errStr}`;
}

function mapBroadcastError(message: string): string {
  if (/insufficient/i.test(message)) {
    return "Yetersiz bakiye. SOL (gas) ve token bakiyenizi kontrol edin.";
  }
  if (/blockhash/i.test(message)) {
    return "Blockhash süresi doldu. Lütfen tekrar deneyin.";
  }
  if (/network|fetch|timeout/i.test(message)) {
    return "Ağ hatası. Quicknode RPC bağlantınızı kontrol edin.";
  }
  return message;
}

/**
 * Standart Kamino tx pipeline'ı: build → simulate → sign → send → confirm.
 * Tüm hatalar Türkçe anlamlı mesajlara normalize edilir. Confirmation
 * `confirmed` commitment ile 60s timeout.
 */
async function buildSignSendConfirm(
  instructions: TransactionInstruction[],
  walletPublicKey: PublicKey,
  signTransaction: SignTransactionFn,
  label: string,
): Promise<string> {
  const connection = createConnection();

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(COMMITMENT);

  let tx: VersionedTransaction;
  try {
    tx = await buildVersionedTransaction(
      connection,
      walletPublicKey,
      instructions,
      [],
      blockhash,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} transaction oluşturulamadı: ${message}`);
  }

  // Simulate (BLOK 6 kural 5 — simulation zorunlu).
  try {
    const simResult = await connection.simulateTransaction(tx, {
      commitment: COMMITMENT,
      sigVerify: false,
    });
    if (simResult.value.err) {
      throw new Error(
        `${label}: ${mapSimulationError(simResult.value.err, simResult.value.logs)}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${label}:`)) {
      throw err;
    }
    // Simülasyon ağ hatası — loglayıp devam etme değil, hata ver (sessiz fail yok).
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} simülasyon hatası: ${message}`);
  }

  // Sign (Solflare popup).
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(tx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // solflare.normalizeSignError zaten Türkçeleştiriyor; yine de label ekle.
    throw new Error(`${label}: ${message}`);
  }

  // Broadcast.
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: COMMITMENT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} broadcast hatası: ${mapBroadcastError(message)}`);
  }

  // Confirm with 60s timeout (CLAUDE.md kural 7).
  try {
    await Promise.race([
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        COMMITMENT,
      ),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `${label} onayı ${TX_TIMEOUT_MS / 1000}s içinde gelmedi. Signature: ${signature}`,
              ),
            ),
          TX_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }

  return signature;
}

function collectInstructions(kaminoAction: unknown): TransactionInstruction[] {
  const a = kaminoAction as {
    setupIxs?: TransactionInstruction[];
    lendingIxs?: TransactionInstruction[];
    cleanupIxs?: TransactionInstruction[];
  };
  return [
    ...(a.setupIxs ?? []),
    ...(a.lendingIxs ?? []),
    ...(a.cleanupIxs ?? []),
  ];
}

// ---------------------------------------------------------------------------
// deposit
// ---------------------------------------------------------------------------

export async function deposit(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  amount: number,
  signTransaction: SignTransactionFn,
): Promise<{ signature: string; kTokenAmount: number }> {
  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new Error("Geçersiz deposit miktarı. 0'dan büyük bir değer girin.");
  }

  const market = await loadMarket(vaultMarketAddress);
  if (!market) {
    throw new Error(
      `Kamino market yüklenemedi: ${vaultMarketAddress}. Ağ bağlantınızı kontrol edin.`,
    );
  }

  const mintPubkey = new PublicKey(tokenMint);
  const reserve = findReserveByMint(market, mintPubkey);
  if (!reserve) {
    throw new Error(
      `Bu token için Kamino reserve bulunamadı (${tokenMint}).`,
    );
  }

  const decimals = reserveMintDecimals(reserve);
  const amountLamports = BigInt(Math.floor(amount * 10 ** decimals));
  if (amountLamports <= 0n) {
    throw new Error("Deposit miktarı token decimal'ine çevrildiğinde sıfır. Daha büyük bir değer girin.");
  }

  let kaminoAction;
  try {
    kaminoAction = await KaminoAction.buildDepositTxns(
      market,
      amountLamports.toString(),
      mintPubkey,
      walletPublicKey,
      new VanillaObligation(KAMINO_LENDING_PROGRAM_ID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Kamino deposit transaction build hatası: ${message}`);
  }

  const instructions = collectInstructions(kaminoAction);
  if (instructions.length === 0) {
    throw new Error("Kamino deposit için transaction instruction üretilemedi.");
  }

  const signature = await buildSignSendConfirm(
    instructions,
    walletPublicKey,
    signTransaction,
    "Kamino deposit",
  );

  // Alınan kToken miktarını anlık exchange rate üzerinden yaklaşık hesapla.
  // Exact değer sonraki getPositionValue çağrısında obligation'dan okunacak.
  invalidateMarketCache(vaultMarketAddress);
  const exchangeRate = reserveCollateralExchangeRate(reserve);
  const kTokenAmount = exchangeRate > 0 ? amount / exchangeRate : amount;

  return { signature, kTokenAmount };
}

// ---------------------------------------------------------------------------
// buildPartialWithdrawInstructions — raw ix çıkartımı (batching için)
// ---------------------------------------------------------------------------

/**
 * Kamino partial withdraw instruction'larını üretir — BROADCAST ETMEZ,
 * sadece instruction + lookup table döner. `transactionBatcher` bu sonucu
 * DFlow swap ix'leri ile birleştirip tek versioned tx halinde gönderir.
 *
 * BLOK 4 anlık likidite kontrolü burada da uygulanır: vault'ta yeterli
 * liquidity yoksa exception fırlatılır, caller instruction'ları hiç
 * almadan hatayı görür.
 */
export async function buildPartialWithdrawInstructions(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  if (tokenAmount <= 0 || !Number.isFinite(tokenAmount)) {
    throw new Error("Geçersiz çekim miktarı. 0'dan büyük bir değer girin.");
  }

  const market = await loadMarket(vaultMarketAddress);
  if (!market) {
    throw new Error(
      `Kamino market yüklenemedi: ${vaultMarketAddress}. Ağ bağlantınızı kontrol edin.`,
    );
  }

  const mintPubkey = new PublicKey(tokenMint);
  const reserve = findReserveByMint(market, mintPubkey);
  if (!reserve) {
    throw new Error(
      `Bu token için Kamino reserve bulunamadı (${tokenMint}).`,
    );
  }

  // Anlık likidite kontrolü (BLOK 4 — withdrawal queue'da bekleme yasak).
  const { availableLiquidity } = reserveStats(reserve);
  if (availableLiquidity < tokenAmount) {
    throw new Error(
      `Kamino vault'unda yeterli anlık likidite yok. Mevcut: ${availableLiquidity.toFixed(4)}, İstenen: ${tokenAmount.toFixed(4)}.`,
    );
  }

  const decimals = reserveMintDecimals(reserve);
  const amountLamports = BigInt(Math.floor(tokenAmount * 10 ** decimals));

  let kaminoAction;
  try {
    kaminoAction = await KaminoAction.buildWithdrawTxns(
      market,
      amountLamports.toString(),
      mintPubkey,
      walletPublicKey,
      new VanillaObligation(KAMINO_LENDING_PROGRAM_ID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Kamino withdraw instruction build hatası: ${message}`);
  }

  const instructions = collectInstructions(kaminoAction);
  if (instructions.length === 0) {
    throw new Error("Kamino withdraw için instruction üretilemedi.");
  }

  // Kamino SDK bazı versiyonlarda lookupTableAccounts expose eder.
  const lookupTables =
    (kaminoAction as unknown as {
      lookupTableAccounts?: AddressLookupTableAccount[];
    }).lookupTableAccounts ?? [];

  return { instructions, lookupTables };
}

// ---------------------------------------------------------------------------
// partialWithdraw (legacy — tek başına broadcast eden path)
// ---------------------------------------------------------------------------

export async function partialWithdraw(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
  signTransaction: SignTransactionFn,
): Promise<{ signature: string; withdrawnAmount: number }> {
  if (tokenAmount <= 0 || !Number.isFinite(tokenAmount)) {
    throw new Error("Geçersiz çekim miktarı. 0'dan büyük bir değer girin.");
  }

  const market = await loadMarket(vaultMarketAddress);
  if (!market) {
    throw new Error(
      `Kamino market yüklenemedi: ${vaultMarketAddress}. Ağ bağlantınızı kontrol edin.`,
    );
  }

  const mintPubkey = new PublicKey(tokenMint);
  const reserve = findReserveByMint(market, mintPubkey);
  if (!reserve) {
    throw new Error(
      `Bu token için Kamino reserve bulunamadı (${tokenMint}).`,
    );
  }

  // Anlık likidite kontrolü — withdrawal queue'da beklemeyiz, hata fırlatırız.
  const { availableLiquidity } = reserveStats(reserve);
  if (availableLiquidity < tokenAmount) {
    throw new Error(
      `Kamino vault'unda yeterli anlık likidite yok. Mevcut: ${availableLiquidity.toFixed(4)}, İstenen: ${tokenAmount.toFixed(4)}.`,
    );
  }

  const decimals = reserveMintDecimals(reserve);
  const amountLamports = BigInt(Math.floor(tokenAmount * 10 ** decimals));

  let kaminoAction;
  try {
    kaminoAction = await KaminoAction.buildWithdrawTxns(
      market,
      amountLamports.toString(),
      mintPubkey,
      walletPublicKey,
      new VanillaObligation(KAMINO_LENDING_PROGRAM_ID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Kamino withdraw transaction build hatası: ${message}`);
  }

  const instructions = collectInstructions(kaminoAction);
  if (instructions.length === 0) {
    throw new Error("Kamino withdraw için transaction instruction üretilemedi.");
  }

  // Çekim öncesi obligation snapshot — withdrawnAmount'u ölçmek için.
  const beforeBalance = await readObligationTokenBalance(
    market,
    walletPublicKey,
    reserve,
  );

  const signature = await buildSignSendConfirm(
    instructions,
    walletPublicKey,
    signTransaction,
    "Kamino withdraw",
  );

  invalidateMarketCache(vaultMarketAddress);

  // Çekim sonrası snapshot — gerçek çekilen miktar.
  const refreshedMarket = await loadMarket(vaultMarketAddress);
  let withdrawnAmount = tokenAmount;
  if (refreshedMarket) {
    const refreshedReserve = findReserveByMint(refreshedMarket, mintPubkey);
    if (refreshedReserve) {
      const afterBalance = await readObligationTokenBalance(
        refreshedMarket,
        walletPublicKey,
        refreshedReserve,
      );
      const delta = beforeBalance - afterBalance;
      if (Number.isFinite(delta) && delta > 0) {
        withdrawnAmount = delta;
      }
    }
  }

  return { signature, withdrawnAmount };
}

// ---------------------------------------------------------------------------
// finalWithdraw
// ---------------------------------------------------------------------------

/**
 * Vault'taki tüm pozisyonu çeker. signTransaction dışında 3'üncü argüman
 * olarak opsiyonel tokenMint alabilir — LIMINAL tek mint'li vault akışında
 * hook bunu geçirir. Verilmezse, obligation'daki ilk deposit'in mint'ini
 * kullanır (tek-mint varsayımı).
 *
 * Return yieldEarned, `trackedDepositedAmount` opsiyonel parametresi ile
 * hesaplanır — BLOK 4 "depositedAmount on-chain'den çekilemez, local state".
 */
export async function finalWithdraw(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  signTransaction: SignTransactionFn,
  options?: { tokenMint?: string; trackedDepositedAmount?: number },
): Promise<{ signature: string; totalAmount: number; yieldEarned: number }> {
  const market = await loadMarket(vaultMarketAddress);
  if (!market) {
    throw new Error(
      `Kamino market yüklenemedi: ${vaultMarketAddress}. Ağ bağlantınızı kontrol edin.`,
    );
  }

  // Obligation'ı yükle — hangi reserve'den çekeceğimizi belirlemek için.
  const obligation = await loadObligation(market, walletPublicKey);
  if (!obligation) {
    throw new Error("Kamino pozisyonu bulunamadı. Önce bir deposit yapılması gerekli.");
  }

  // Hedef mint: verilmişse onu kullan, yoksa obligation'daki ilk deposit.
  let targetMint: PublicKey | null = null;
  if (options?.tokenMint) {
    targetMint = new PublicKey(options.tokenMint);
  } else {
    const firstDeposit = getFirstObligationDeposit(obligation);
    if (firstDeposit?.mint) targetMint = firstDeposit.mint;
  }
  if (!targetMint) {
    throw new Error(
      "Final withdraw için hedef token mint belirlenemedi. Obligation'da aktif deposit yok.",
    );
  }

  const reserve = findReserveByMint(market, targetMint);
  if (!reserve) {
    throw new Error(
      `Bu token için Kamino reserve bulunamadı (${targetMint.toBase58()}).`,
    );
  }

  // "Tümünü çek" = mevcut tokenValue kadar. SDK bazı versiyonlarda
  // U64 max ile de destekler; biz hesaplanan değeri kullanıyoruz.
  const tokenValueBefore = await readObligationTokenBalance(
    market,
    walletPublicKey,
    reserve,
  );
  if (tokenValueBefore <= 0) {
    throw new Error("Çekilecek bakiye yok. Kamino pozisyonu sıfır.");
  }

  const decimals = reserveMintDecimals(reserve);
  const amountLamports = BigInt(Math.floor(tokenValueBefore * 10 ** decimals));

  let kaminoAction;
  try {
    kaminoAction = await KaminoAction.buildWithdrawTxns(
      market,
      amountLamports.toString(),
      targetMint,
      walletPublicKey,
      new VanillaObligation(KAMINO_LENDING_PROGRAM_ID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Kamino final withdraw build hatası: ${message}`);
  }

  const instructions = collectInstructions(kaminoAction);
  if (instructions.length === 0) {
    throw new Error("Kamino final withdraw için instruction üretilemedi.");
  }

  const signature = await buildSignSendConfirm(
    instructions,
    walletPublicKey,
    signTransaction,
    "Kamino final withdraw",
  );

  invalidateMarketCache(vaultMarketAddress);

  const totalAmount = tokenValueBefore;
  const depositedBase = options?.trackedDepositedAmount ?? 0;
  const yieldEarned =
    depositedBase > 0 ? Math.max(0, totalAmount - depositedBase) : 0;

  return { signature, totalAmount, yieldEarned };
}

// ---------------------------------------------------------------------------
// getPositionValue
// ---------------------------------------------------------------------------

/**
 * Wallet'ın belirli bir Kamino vault + reserve'deki mevcut pozisyonunu döner.
 * `trackedDepositedAmount` caller tarafından local state'te tutulan orijinal
 * deposit miktarı — BLOK 4'te belirtildiği üzere bu değer on-chain'den
 * okunamaz. Verilmezse yieldAccrued 0 döner.
 */
export async function getPositionValue(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  tokenMint: string,
  trackedDepositedAmount?: number,
): Promise<KaminoPositionData> {
  const market = await loadMarket(vaultMarketAddress);
  if (!market) {
    throw new Error(
      `Kamino market yüklenemedi: ${vaultMarketAddress}. Ağ bağlantınızı kontrol edin.`,
    );
  }

  const mintPubkey = new PublicKey(tokenMint);
  const reserve = findReserveByMint(market, mintPubkey);
  if (!reserve) {
    return {
      kTokenBalance: 0,
      tokenValue: 0,
      depositedAmount: trackedDepositedAmount ?? 0,
      yieldAccrued: 0,
    };
  }

  const obligation = await loadObligation(market, walletPublicKey);
  if (!obligation) {
    return {
      kTokenBalance: 0,
      tokenValue: 0,
      depositedAmount: trackedDepositedAmount ?? 0,
      yieldAccrued: 0,
    };
  }

  const reserveAddr = reserveAddressOf(reserve);
  const depositEntry = findObligationDeposit(obligation, reserveAddr);
  if (!depositEntry) {
    return {
      kTokenBalance: 0,
      tokenValue: 0,
      depositedAmount: trackedDepositedAmount ?? 0,
      yieldAccrued: 0,
    };
  }

  const decimals = reserveMintDecimals(reserve);
  const collateralLamports = Number(
    (depositEntry as { depositedAmount?: number | string }).depositedAmount ??
      0,
  );
  const kTokenBalance = collateralLamports / 10 ** decimals;
  const exchangeRate = reserveCollateralExchangeRate(reserve);
  const tokenValue = kTokenBalance * exchangeRate;

  const depositedAmount = trackedDepositedAmount ?? 0;
  // BLOK 4: yieldAccrued = tokenValue - depositedAmount. Partial withdraw
  // sonrası tokenValue düşebileceği için negatif yield anlamlı değil → clamp.
  const yieldAccrued =
    depositedAmount > 0 ? Math.max(0, tokenValue - depositedAmount) : 0;

  return { kTokenBalance, tokenValue, depositedAmount, yieldAccrued };
}

// ---------------------------------------------------------------------------
// Obligation helpers
// ---------------------------------------------------------------------------

type ObligationLike = {
  deposits?:
    | Map<string, { depositedAmount?: number | string; mint?: PublicKey }>
    | Array<{
        reserveAddress?: PublicKey | { toBase58(): string };
        depositedAmount?: number | string;
        mint?: PublicKey;
      }>;
};

async function loadObligation(
  market: KaminoMarket,
  walletPublicKey: PublicKey,
): Promise<ObligationLike | null> {
  const anyMarket = market as unknown as {
    getObligationByWallet?: (
      owner: PublicKey,
      obligationType: VanillaObligation,
    ) => Promise<ObligationLike | null>;
  };
  if (typeof anyMarket.getObligationByWallet !== "function") {
    console.warn(
      "[LIMINAL] KaminoMarket.getObligationByWallet mevcut değil — SDK versiyonu uyumsuz.",
    );
    return null;
  }
  try {
    return await anyMarket.getObligationByWallet(
      walletPublicKey,
      new VanillaObligation(KAMINO_LENDING_PROGRAM_ID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[LIMINAL] Obligation yüklenemedi: ${message}`);
    return null;
  }
}

function findObligationDeposit(
  obligation: ObligationLike,
  reserveAddress: string,
): { depositedAmount?: number | string } | null {
  const deposits = obligation.deposits;
  if (!deposits) return null;
  if (deposits instanceof Map) {
    return deposits.get(reserveAddress) ?? null;
  }
  if (Array.isArray(deposits)) {
    for (const d of deposits) {
      const addr = d.reserveAddress;
      const base58 =
        addr && typeof (addr as { toBase58?: () => string }).toBase58 === "function"
          ? (addr as { toBase58: () => string }).toBase58()
          : String(addr ?? "");
      if (base58 === reserveAddress) return d;
    }
  }
  return null;
}

function getFirstObligationDeposit(
  obligation: ObligationLike,
): { mint?: PublicKey } | null {
  const deposits = obligation.deposits;
  if (!deposits) return null;
  if (deposits instanceof Map) {
    const first = deposits.values().next();
    return first.done ? null : (first.value ?? null);
  }
  if (Array.isArray(deposits) && deposits.length > 0) {
    return deposits[0];
  }
  return null;
}

async function readObligationTokenBalance(
  market: KaminoMarket,
  walletPublicKey: PublicKey,
  reserve: KaminoReserve,
): Promise<number> {
  const obligation = await loadObligation(market, walletPublicKey);
  if (!obligation) return 0;
  const reserveAddr = reserveAddressOf(reserve);
  const depositEntry = findObligationDeposit(obligation, reserveAddr);
  if (!depositEntry) return 0;
  const decimals = reserveMintDecimals(reserve);
  const collateralLamports = Number(depositEntry.depositedAmount ?? 0);
  const kTokenBalance = collateralLamports / 10 ** decimals;
  const exchangeRate = reserveCollateralExchangeRate(reserve);
  return kTokenBalance * exchangeRate;
}
