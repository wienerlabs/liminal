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
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createSolanaRpc, address, createNoopSigner, type Rpc } from "@solana/kit";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  DEFAULT_KLEND_PROGRAM_ID,
  type KaminoReserve,
  type KaminoMarketRpcApi,
} from "@kamino-finance/klend-sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import { createConnection, QUICKNODE_RPC_ENDPOINT } from "./quicknode";
import { simulateTransaction, SimulationFailedError } from "../utils/transactionBatcher";
import { kitInstructionsToWeb3 } from "./kitBridge";

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

/**
 * A single non-zero deposit the wallet currently has on Kamino. Powers the
 * emergency-withdraw UI: surfaces funds parked in Kamino independent of
 * any in-flight LIMINAL execution so the user can always see (and pull)
 * what they own.
 */
export type ActiveKaminoPosition = {
  reserveAddress: string;
  tokenMint: string;
  symbol: string;
  /** Redeemable token amount (human units, not lamports). */
  amount: number;
  /** Current supply APY on the underlying reserve. */
  supplyAPY: number;
  /** Deep link to Kamino app for manual withdrawal. */
  manageUrl: string;
};

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

/**
 * List every non-zero deposit the wallet has on Kamino Main Market.
 * Safe to call at any time — silently returns [] if the wallet has no
 * obligation or the RPC is unreachable. Used by the emergency-withdraw
 * surface in WalletPanel.
 */
export async function getActivePositions(
  walletAddress: string,
): Promise<ActiveKaminoPosition[]> {
  if (!walletAddress) return [];
  try {
    const [market, slot] = await Promise.all([loadMarket(), getCurrentSlot()]);
    const owner = address(walletAddress);
    let obligation;
    try {
      obligation = await market.getUserVanillaObligation(owner);
    } catch {
      return [];
    }
    if (!obligation) return [];

    const out: ActiveKaminoPosition[] = [];
    for (const [reserveAddr, deposit] of obligation.deposits.entries()) {
      const reserve = market.reserves.get(reserveAddr);
      if (!reserve) continue;

      const rawAmount = (deposit as { amount?: unknown }).amount;
      let amount = 0;
      if (rawAmount && typeof (rawAmount as Decimal).toNumber === "function") {
        amount = (rawAmount as Decimal).toNumber();
      } else if (typeof rawAmount === "number") {
        amount = rawAmount;
      }
      if (amount <= 0) continue;

      let supplyAPY = 0;
      try {
        supplyAPY = reserve.totalSupplyAPY(slot) * 100;
      } catch {
        supplyAPY = 0;
      }

      out.push({
        reserveAddress: reserveAddr.toString(),
        tokenMint: reserve.getLiquidityMint().toString(),
        symbol: reserve.symbol,
        amount,
        supplyAPY,
        manageUrl: `https://app.kamino.finance/lending`,
      });
    }
    // Largest position first so the emergency UI surfaces the biggest
    // exposure at the top.
    out.sort((a, b) => b.amount - a.amount);
    return out;
  } catch (err) {
    console.warn(
      `[LIMINAL/Kamino.getActivePositions] ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write path — @solana/kit Instruction → @solana/web3.js VersionedTransaction
// ---------------------------------------------------------------------------
//
// Flow for every write operation:
//   1. Load KaminoMarket + resolve reserve by liquidity mint.
//   2. Build KaminoAction.buildDepositTxns / buildWithdrawTxns — this
//      returns kit `Instruction[]` distributed across computeBudgetIxs /
//      setupIxs / lendingIxs / cleanupIxs.
//   3. Flatten & translate to web3.js TransactionInstruction[] via
//      `kitBridge.kitInstructionsToWeb3`.
//   4. Compile a v0 VersionedTransaction with the current blockhash.
//   5. Run simulation (BLOK 6 pre-broadcast simulation mandate).
//   6. Solflare-sign → sendRawTransaction → confirmTransaction.
//   7. Return the signature + best-effort output amount.
//
// Notes:
//   - `createNoopSigner` is used for the kit TransactionSigner parameter.
//     KaminoAction only reads the signer's address; signing happens in
//     web3.js-land through Solflare, so a noop kit signer is safe.
//   - `amount` argument into SDK is BN in lamports / raw token units. The
//     caller passes a UI (human) number; we multiply by 10^decimals from
//     the reserve config. One source of truth: `reserve.state.liquidity.mintDecimals`.
//   - Tracked deposited amount is caller-passed; SDK's obligation view is
//     the authoritative source for final yield calculation at the end.

type KaminoReserveAny = KaminoReserve & {
  state?: { liquidity?: { mintDecimals?: number | bigint } };
  stats?: { decimals?: number | bigint };
};

function reserveDecimals(reserve: KaminoReserve): number {
  const r = reserve as KaminoReserveAny;
  const fromState = r.state?.liquidity?.mintDecimals;
  if (typeof fromState === "number") return fromState;
  if (typeof fromState === "bigint") return Number(fromState);
  const fromStats = r.stats?.decimals;
  if (typeof fromStats === "number") return fromStats;
  if (typeof fromStats === "bigint") return Number(fromStats);
  // SOL (wrapped or native) is 9, everything else typically 6. Safe default.
  return reserve.symbol?.toUpperCase() === "SOL" ? 9 : 6;
}

function toRawAmount(amount: number, decimals: number): BN {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Kamino: amount must be positive finite number.");
  }
  // Build a safe integer via Decimal to avoid float precision drift.
  const raw = new Decimal(amount).mul(new Decimal(10).pow(decimals)).toFixed(0);
  return new BN(raw);
}

function collectKaminoActionIxs(action: KaminoAction): TransactionInstruction[] {
  const all = [
    ...(action.computeBudgetIxs ?? []),
    ...(action.setupIxs ?? []),
    ...(action.lendingIxs ?? []),
    ...(action.cleanupIxs ?? []),
  ];
  return kitInstructionsToWeb3(all);
}

async function executeKaminoAction(
  walletPublicKey: PublicKey,
  instructions: TransactionInstruction[],
  signTransaction: SignTransactionFn,
  label: string,
): Promise<string> {
  const connection = createConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: walletPublicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);

  const sim = await simulateTransaction(tx, connection);
  if (!sim.success) {
    // Kamino-only write path — ixCounts attribute the failure correctly.
    throw new SimulationFailedError(sim, undefined, instructions.length, 0);
  }
  void label;

  const signed = await signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

async function loadReserveByMint(
  tokenMint: string,
): Promise<{ market: KaminoMarket; reserve: KaminoReserve }> {
  const market = await loadMarket();
  const reserve = market
    .getReserves()
    .find((r) => r.getLiquidityMint().toString() === tokenMint);
  if (!reserve) {
    throw new Error(
      `Kamino: no reserve on Main Market for mint ${tokenMint.slice(0, 4)}…`,
    );
  }
  return { market, reserve };
}

// ---------------------------------------------------------------------------
// deposit — full amount into the chosen reserve
// ---------------------------------------------------------------------------

export async function deposit(
  walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  tokenMint: string,
  amount: number,
  signTransaction: SignTransactionFn,
): Promise<{ signature: string; kTokenAmount: number }> {
  const { market, reserve } = await loadReserveByMint(tokenMint);
  const decimals = reserveDecimals(reserve);
  const raw = toRawAmount(amount, decimals);

  const owner = createNoopSigner(address(walletPublicKey.toBase58()));
  const action = await KaminoAction.buildDepositTxns(
    market,
    raw,
    address(tokenMint),
    owner,
    new VanillaObligation(address(DEFAULT_KLEND_PROGRAM_ID)),
    false, // useV2Ixs — v1 is still widely supported; simpler surface.
    undefined, // scopeRefreshConfig — Kamino main market reserves don't need it.
    400_000, // extraComputeBudget — deposit instructions are CU-heavy.
    true, // includeAtaIxs — ensure the receipt-token ATA exists.
  );

  const instructions = collectKaminoActionIxs(action);
  const signature = await executeKaminoAction(
    walletPublicKey,
    instructions,
    signTransaction,
    "deposit",
  );

  // kTokenAmount is not returned by the SDK builder; 0 is acceptable here
  // since useKaminoPosition / getPositionValue will reconcile on the next
  // poll via on-chain obligation state.
  return { signature, kTokenAmount: 0 };
}

// ---------------------------------------------------------------------------
// partialWithdraw — redeem a subset of the reserve position
// ---------------------------------------------------------------------------

export async function partialWithdraw(
  walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
  signTransaction: SignTransactionFn,
): Promise<{ signature: string; withdrawnAmount: number }> {
  const { instructions } = await buildPartialWithdrawInstructions(
    walletPublicKey,
    _vaultMarketAddress,
    tokenMint,
    tokenAmount,
  );
  const signature = await executeKaminoAction(
    walletPublicKey,
    instructions,
    signTransaction,
    "partial withdraw",
  );
  return { signature, withdrawnAmount: tokenAmount };
}

// ---------------------------------------------------------------------------
// finalWithdraw — drain the obligation + collect accrued yield
// ---------------------------------------------------------------------------

const U64_MAX_BN = new BN("18446744073709551615");

export async function finalWithdraw(
  walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  signTransaction: SignTransactionFn,
  options?: { tokenMint?: string; trackedDepositedAmount?: number },
): Promise<{ signature: string; totalAmount: number; yieldEarned: number }> {
  if (!options?.tokenMint) {
    throw new Error("Kamino finalWithdraw requires tokenMint in options.");
  }
  const { market, reserve } = await loadReserveByMint(options.tokenMint);

  const owner = createNoopSigner(address(walletPublicKey.toBase58()));
  // U64_MAX is the Kamino convention for "withdraw everything".
  const action = await KaminoAction.buildWithdrawTxns(
    market,
    U64_MAX_BN,
    address(options.tokenMint),
    owner,
    new VanillaObligation(address(DEFAULT_KLEND_PROGRAM_ID)),
    false,
    undefined,
    400_000,
    true,
  );

  const instructions = collectKaminoActionIxs(action);
  const signature = await executeKaminoAction(
    walletPublicKey,
    instructions,
    signTransaction,
    "final withdraw",
  );

  // Best-effort yield accounting: read obligation _before_ this call is
  // tricky (we'd need a pre-simulation snapshot). For now, caller's
  // tracked principal + any residual poll result is the source of truth.
  const principal = Math.max(0, options.trackedDepositedAmount ?? 0);
  const pos = await getPositionValue(
    walletPublicKey,
    reserve.address.toString(),
    options.tokenMint,
    principal,
  );
  return {
    signature,
    totalAmount: principal + pos.yieldAccrued,
    yieldEarned: pos.yieldAccrued,
  };
}

// ---------------------------------------------------------------------------
// buildPartialWithdrawInstructions — used by transactionBatcher to compose
// one atomic (withdraw + DFlow swap) tx per slice.
// ---------------------------------------------------------------------------

export async function buildPartialWithdrawInstructions(
  walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  tokenMint: string,
  tokenAmount: number,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  const { market, reserve } = await loadReserveByMint(tokenMint);
  const decimals = reserveDecimals(reserve);
  const raw = toRawAmount(tokenAmount, decimals);

  const owner = createNoopSigner(address(walletPublicKey.toBase58()));
  const action = await KaminoAction.buildWithdrawTxns(
    market,
    raw,
    address(tokenMint),
    owner,
    new VanillaObligation(address(DEFAULT_KLEND_PROGRAM_ID)),
    false,
    undefined,
    300_000,
    true,
  );

  const instructions = collectKaminoActionIxs(action);
  // Kamino v7 Main Market deposit/withdraw paths don't require address
  // lookup tables on the read side; the batcher tops up its own LUTs for
  // DFlow when needed.
  return { instructions, lookupTables: [] };
}

