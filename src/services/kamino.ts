/**
 * LIMINAL — Kamino Lending Service (v7 SDK)
 *
 * Implementasyon stratejisi:
 *
 *   Read-only path (şu an aktif) — `KaminoMarket.load` + `market.getReserves()`
 *   ile on-chain vault listesi, APY, utilization ve kullanıcı pozisyonu çekilir.
 *   Bu katman VaultPreview ve Analytics'i gerçek veriyle besler.
 *
 *   Write path (deposit/withdraw) — KaminoAction v7 `@solana/kit` Instruction
 *   tipleri döner; @solana/web3.js Transaction'a bridge etmek ek iş
 *   gerektiriyor. Bir sonraki adımda `buildDeposit`/`buildPartialWithdraw`
 *   bu bridge'le doldurulur. Şu an bu fonksiyonlar açık bir "pending"
 *   mesajıyla throw ediyor — kullanıcı bilgilendiriliyor, UI crash etmiyor.
 *
 * Bridge:
 *   - @solana/kit `Rpc` ← `@solana/web3.js` Connection endpoint URL'inden
 *     createSolanaRpc() ile türetilir (aynı QuickNode RPC endpoint'i).
 *   - `Address` ← base58 string; kit'in `address()` helper'ı PublicKey string'iyle
 *     uyumlu.
 *
 * Hata davranışı:
 *   - Read-only fonksiyonlar bağlantı hatasında network error fırlatır.
 *   - Bilinmeyen mint → getAvailableVaults boş array (UI "no vault" gösterir).
 *   - Write fonksiyonları açıklayıcı "PENDING" hatası döndürür.
 */

import {
  PublicKey,
  type AddressLookupTableAccount,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { createSolanaRpc, address, type Rpc } from "@solana/kit";
import {
  KaminoMarket,
  DEFAULT_KLEND_PROGRAM_ID,
  type KaminoReserve,
  type KaminoMarketRpcApi,
} from "@kamino-finance/klend-sdk";
import Decimal from "decimal.js";
import { QUICKNODE_RPC_ENDPOINT } from "./quicknode";

// ---------------------------------------------------------------------------
// Constants — canonical mainnet addresses
// ---------------------------------------------------------------------------

/**
 * Kamino Lend mainnet program ID — sourced directly from the SDK so we can
 * never drift from the canonical value. Re-exported so UI and analytics
 * code can build Solana Explorer links without re-importing the SDK.
 */
export const KAMINO_LENDING_PROGRAM_ID_STR: string = DEFAULT_KLEND_PROGRAM_ID;

/** Kamino "Main Market" — the largest USDC/SOL/USDT lending pool. */
const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

/** Kamino'nun kullandığı default slot duration (mainnet ~400ms/slot). */
const DEFAULT_SLOT_DURATION_MS = 400;

// ---------------------------------------------------------------------------
// Types (public API surface — değişmez, tüketicilerin import'ları bozulmaz)
// ---------------------------------------------------------------------------

export type KaminoVault = {
  /** Reserve address (mainnet). UI "market" olarak refer eder. */
  marketAddress: string;
  marketName: string;
  /** Alternative reserve identifier (same as marketAddress in v7). */
  reserveAddress: string;
  tokenMint: string;
  symbol: string;
  /** Supply APY as percentage (e.g. 4.25 = 4.25%). */
  supplyAPY: number;
  /** Total deposited (in token units, not lamports). */
  totalSupply: number;
  /** Available for withdrawal right now (token units). */
  availableLiquidity: number;
  /** 0-100 (%). */
  utilizationRate: number;
  /** Heuristic: Kamino Main Market reserves are all audited. */
  isAudited: boolean;
  lastUpdated: Date;
};

export type KaminoPositionData = {
  kTokenBalance: number;
  tokenValue: number;
  depositedAmount: number;
  yieldAccrued: number;
};

export type SignTransactionFn = <T extends VersionedTransaction>(
  tx: T,
) => Promise<T>;

// ---------------------------------------------------------------------------
// RPC bridge — @solana/web3.js endpoint URL → @solana/kit Rpc instance
// ---------------------------------------------------------------------------

let cachedRpc: Rpc<KaminoMarketRpcApi> | null = null;
let cachedMarket: KaminoMarket | null = null;
let cachedMarketLoadedAt = 0;
const MARKET_CACHE_TTL_MS = 60_000; // Reserves drift, 1 dakikada bir refresh yeter.

function requireEndpoint(): string {
  if (!QUICKNODE_RPC_ENDPOINT) {
    throw new Error(
      "Kamino: RPC endpoint not configured. Set VITE_QUICKNODE_RPC_URL in .env.local.",
    );
  }
  return QUICKNODE_RPC_ENDPOINT;
}

function getRpc(): Rpc<KaminoMarketRpcApi> {
  if (cachedRpc) return cachedRpc;
  cachedRpc = createSolanaRpc(requireEndpoint()) as Rpc<KaminoMarketRpcApi>;
  return cachedRpc;
}

async function loadMarket(): Promise<KaminoMarket> {
  const now = Date.now();
  if (cachedMarket && now - cachedMarketLoadedAt < MARKET_CACHE_TTL_MS) {
    return cachedMarket;
  }
  const rpc = getRpc();
  // Omit programId so the SDK uses its built-in DEFAULT_KLEND_PROGRAM_ID —
  // this keeps us in lockstep with SDK upgrades.
  const market = await KaminoMarket.load(
    rpc,
    address(KAMINO_MAIN_MARKET),
    DEFAULT_SLOT_DURATION_MS,
  );
  if (!market) {
    throw new Error("Kamino: main market failed to load from RPC.");
  }
  cachedMarket = market;
  cachedMarketLoadedAt = now;
  return market;
}

/** Invalidate the cached market so the next `loadMarket()` refetches. */
export function invalidateKaminoMarketCache(): void {
  cachedMarket = null;
  cachedMarketLoadedAt = 0;
}

// ---------------------------------------------------------------------------
// Reserve → public KaminoVault shape
// ---------------------------------------------------------------------------

function reserveToVault(reserve: KaminoReserve, currentSlot: bigint): KaminoVault {
  const symbol = reserve.symbol;
  const mint = reserve.getLiquidityMint().toString();
  const addr = reserve.address.toString();

  // v7: totalSupplyAPY(slot) returns number in [0, 1] range. Multiply for %.
  let supplyAPY = 0;
  try {
    supplyAPY = reserve.totalSupplyAPY(currentSlot) * 100;
  } catch {
    supplyAPY = 0;
  }

  // Liquidity and supply: getTotalSupply / getLiquidityAvailableAmount
  // return Decimal; calculateUtilizationRatio returns number in [0, 1].
  let totalSupply = 0;
  let availableLiquidity = 0;
  let utilizationRate = 0;
  try {
    totalSupply = reserve.getTotalSupply().toNumber();
    availableLiquidity = reserve.getLiquidityAvailableAmount().toNumber();
    utilizationRate = reserve.calculateUtilizationRatio() * 100;
  } catch {
    // Leave zeros on error; caller can filter.
  }

  return {
    marketAddress: addr,
    marketName: `Kamino ${symbol}`,
    reserveAddress: addr,
    tokenMint: mint,
    symbol,
    supplyAPY,
    totalSupply,
    availableLiquidity,
    utilizationRate,
    isAudited: true, // Main market reserves are all audited.
    lastUpdated: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Public API — read-only
// ---------------------------------------------------------------------------

/**
 * List every reserve on Kamino Main Market whose liquidity mint matches the
 * given token. Returns an empty array (not an error) when the token has no
 * active reserve — UI shows "No vault found".
 */
async function getCurrentSlot(): Promise<bigint> {
  const rpc = getRpc();
  // getSlot() returns bigint in @solana/kit typings.
  const slot = await rpc.getSlot().send();
  return BigInt(slot);
}

export async function getAvailableVaults(
  tokenMint: string,
): Promise<KaminoVault[]> {
  if (!tokenMint) return [];
  try {
    const [market, slot] = await Promise.all([loadMarket(), getCurrentSlot()]);
    const reserves = market.getReserves();
    return reserves
      .filter((r) => r.getLiquidityMint().toString() === tokenMint)
      .map((r) => reserveToVault(r, slot));
  } catch (err) {
    console.warn(
      `[LIMINAL/Kamino.getAvailableVaults] ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Pick the best reserve for a given token. Selection criteria (ordered):
 *   1. Positive supplyAPY
 *   2. Non-zero available liquidity
 *   3. Highest APY wins (ties broken by larger liquidity)
 */
export async function selectOptimalVault(
  tokenMint: string,
): Promise<KaminoVault | null> {
  const vaults = await getAvailableVaults(tokenMint);
  const eligible = vaults.filter(
    (v) => v.supplyAPY > 0 && v.availableLiquidity > 0,
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (b.supplyAPY !== a.supplyAPY) return b.supplyAPY - a.supplyAPY;
    return b.availableLiquidity - a.availableLiquidity;
  });
  return eligible[0];
}

/**
 * Read the user's position on a specific reserve.
 *
 * `kTokenBalance`      — their cToken (receipt) balance
 * `tokenValue`         — current redeemable value in liquidity token units
 * `depositedAmount`    — caller-tracked principal (not on-chain; see BLOK 4)
 * `yieldAccrued`       — tokenValue - depositedAmount (non-negative)
 */
export async function getPositionValue(
  walletPublicKey: PublicKey,
  vaultMarketAddress: string,
  _tokenMint: string,
  trackedDepositedAmount?: number,
): Promise<KaminoPositionData> {
  const principal = Math.max(0, trackedDepositedAmount ?? 0);
  try {
    const market = await loadMarket();
    const reserve = market.reserves.get(address(vaultMarketAddress));
    if (!reserve) {
      return {
        kTokenBalance: 0,
        tokenValue: 0,
        depositedAmount: principal,
        yieldAccrued: 0,
      };
    }

    // Vanilla obligation (single-reserve deposit, no borrow) — Kamino's
    // canonical lending position for read-only queries.
    const owner = address(walletPublicKey.toBase58());
    let obligation;
    try {
      obligation = await market.getUserVanillaObligation(owner);
    } catch {
      obligation = null;
    }
    if (!obligation) {
      return {
        kTokenBalance: 0,
        tokenValue: 0,
        depositedAmount: principal,
        yieldAccrued: 0,
      };
    }

    // Find the deposit position for this reserve.
    const deposit = obligation.deposits.get(reserve.address);
    if (!deposit) {
      return {
        kTokenBalance: 0,
        tokenValue: 0,
        depositedAmount: principal,
        yieldAccrued: 0,
      };
    }

    // v7 deposit.amount → Decimal. Use toNumber() defensively.
    const rawAmount = (deposit as { amount?: unknown }).amount;
    let tokenValue = 0;
    if (rawAmount && typeof (rawAmount as Decimal).toNumber === "function") {
      tokenValue = (rawAmount as Decimal).toNumber();
    } else if (typeof rawAmount === "number") {
      tokenValue = rawAmount;
    }
    const kTokenBalance = tokenValue; // v7 vanilla obligation stores token-denominated deposit
    const yieldAccrued = Math.max(0, tokenValue - principal);

    return {
      kTokenBalance,
      tokenValue,
      depositedAmount: principal,
      yieldAccrued,
    };
  } catch (err) {
    console.warn(
      `[LIMINAL/Kamino.getPositionValue] ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      kTokenBalance: 0,
      tokenValue: 0,
      depositedAmount: principal,
      yieldAccrued: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Write path (deposit / withdraw) — @solana/kit Instruction → web3.js bridge
// is non-trivial. Tracked in PR description; pending sequel.
// ---------------------------------------------------------------------------

const WRITE_PENDING_MSG =
  "Kamino deposit/withdraw instruction builder pending bridge from @solana/kit" +
  " Instruction → @solana/web3.js TransactionInstruction. Read-only path" +
  " (APY, utilization, position) is fully functional.";

function writePending(fn: string): never {
  throw new Error(`[LIMINAL/Kamino.${fn}] ${WRITE_PENDING_MSG}`);
}

export async function deposit(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  _amount: number,
  _signTransaction: SignTransactionFn,
): Promise<{ signature: string; kTokenAmount: number }> {
  writePending("deposit");
}

export async function partialWithdraw(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  _tokenAmount: number,
  _signTransaction: SignTransactionFn,
): Promise<{ signature: string; withdrawnAmount: number }> {
  writePending("partialWithdraw");
}

export async function finalWithdraw(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _signTransaction: SignTransactionFn,
  _options?: { tokenMint?: string; trackedDepositedAmount?: number },
): Promise<{ signature: string; totalAmount: number; yieldEarned: number }> {
  writePending("finalWithdraw");
}

export async function buildPartialWithdrawInstructions(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  _tokenAmount: number,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  writePending("buildPartialWithdrawInstructions");
}

