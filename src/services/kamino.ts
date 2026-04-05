/**
 * LIMINAL — Kamino Lending Service (STUB)
 *
 * BLOK 4 spesifikasyonuna göre yazılan orijinal implementasyon
 * @kamino-finance/klend-sdk v6 PublicKey + Connection API'sine göreydi.
 * SDK v7'ye geçtiğinde:
 *   1. Named export'lar rename/remove oldu (ör. DEFAULT_RECENT_SLOT_DURATION_MS)
 *   2. Connection yerine @solana/kit Rpc tipi istiyor
 *   3. PublicKey yerine @solana/kit Address tipi istiyor
 *   4. SDK CommonJS formatında yayınlanıyor, Vite ESM resolver'da
 *      "exports is not defined" runtime hatası atıyor
 *
 * Bu dosya sayfa render'ını engellememek için geçici stub'a çevrildi.
 * Tüm fonksiyonlar public API yüzeyini koruyor ama runtime'da açık bir
 * "v7 refactor pending" hatası fırlatıyor. `ExecutionPanel`, `VaultPreview`,
 * `useKaminoPosition`, `executionMachine` import'ları bozulmaz — sayfa
 * yüklenir, kullanıcı Kamino feature'ını kullanmaya çalıştığında bilgi-
 * lendirici bir error state görür.
 *
 * TODO: Kamino SDK v7'ye göre refactor veya SDK v6.x'e downgrade.
 */

import {
  PublicKey,
  type AddressLookupTableAccount,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants — type-safe public API için sabitler korunuyor
// ---------------------------------------------------------------------------

// Kamino Lend mainnet program ID (base58 string).
// NOT: String olarak tutuluyor — orijinal prompt'ta verilen değer Solana
// PublicKey validation'ını geçmiyor (39 karakter, canonical 43-44 bekler).
// Doğru canonical değer SDK refactor sırasında doğrulanıp PublicKey'e
// çevrilecek. Stub mode'da hiç kullanılmıyor.
export const KAMINO_LENDING_PROGRAM_ID_STR =
  "KLend2g3cZ87EoGDpyecdFpsBkZYbXX8f73uxB58o";

// ---------------------------------------------------------------------------
// Types (public API yüzeyi — tüketicilerin import'ları bozulmaz)
// ---------------------------------------------------------------------------

export type KaminoVault = {
  marketAddress: string;
  marketName: string;
  reserveAddress: string;
  tokenMint: string;
  symbol: string;
  supplyAPY: number;
  totalSupply: number;
  availableLiquidity: number;
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

export type SignTransactionFn = <T extends VersionedTransaction>(
  tx: T,
) => Promise<T>;

// ---------------------------------------------------------------------------
// Stub error — tüm fonksiyonların fırlattığı açıklayıcı hata
// ---------------------------------------------------------------------------

const STUB_ERROR_MESSAGE =
  "Kamino SDK v7 uyumsuzluğu — src/services/kamino.ts geçici stub'da. " +
  "Vault listeleme ve deposit/withdraw akışları devre dışı. " +
  "Çözüm: klend-sdk v6.x'e downgrade veya v7 API'sine göre refactor " +
  "(Address tipi, Rpc client, yeni export'lar).";

function stubError(fn: string): never {
  throw new Error(`[LIMINAL/Kamino.${fn}] ${STUB_ERROR_MESSAGE}`);
}

// ---------------------------------------------------------------------------
// Public API — gerçek implementasyon ileride SDK refactor sonrası gelecek
// ---------------------------------------------------------------------------

export async function getAvailableVaults(
  _tokenMint: string,
): Promise<KaminoVault[]> {
  // Sayfa render'ını engellememesi için boş array döner — bu yalnızca
  // READ-ONLY bir sorgu ve bilgi eksikliği kullanıcıyı paniklatmaz.
  // ExecutionPanel "Bu token için aktif Kamino vault bulunamadı" gösterir.
  console.warn(
    "[LIMINAL/Kamino.getAvailableVaults] " + STUB_ERROR_MESSAGE,
  );
  return [];
}

export async function selectOptimalVault(
  _tokenMint: string,
): Promise<KaminoVault | null> {
  console.warn(
    "[LIMINAL/Kamino.selectOptimalVault] " + STUB_ERROR_MESSAGE,
  );
  return null;
}

export async function deposit(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  _amount: number,
  _signTransaction: SignTransactionFn,
): Promise<{ signature: string; kTokenAmount: number }> {
  stubError("deposit");
}

export async function partialWithdraw(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  _tokenAmount: number,
  _signTransaction: SignTransactionFn,
): Promise<{ signature: string; withdrawnAmount: number }> {
  stubError("partialWithdraw");
}

export async function finalWithdraw(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _signTransaction: SignTransactionFn,
  _options?: { tokenMint?: string; trackedDepositedAmount?: number },
): Promise<{ signature: string; totalAmount: number; yieldEarned: number }> {
  stubError("finalWithdraw");
}

export async function getPositionValue(
  _walletPublicKey: PublicKey,
  _vaultMarketAddress: string,
  _tokenMint: string,
  trackedDepositedAmount?: number,
): Promise<KaminoPositionData> {
  // Read-only — polling loop'larını kırmamak için boş position döner.
  return {
    kTokenBalance: 0,
    tokenValue: 0,
    depositedAmount: trackedDepositedAmount ?? 0,
    yieldAccrued: 0,
  };
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
  stubError("buildPartialWithdrawInstructions");
}
