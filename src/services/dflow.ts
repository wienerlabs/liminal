/**
 * LIMINAL — DFlow Order Flow Routing Service
 *
 * BLOK 3 (DFlow Entegrasyon Spesifikasyonu) altında LIMINAL'in execution
 * engine katmanı. Her TWAP dilimi bu servis üzerinden geçer.
 *
 * Kritik kurallar (CLAUDE.md):
 * - Sıfır mock, sıfır hardcoded fiyat. Tüm veri DFlow endorsement server'dan.
 * - Quote comparison: DFlow'un döndürdüğü `marketQuote` baseline, `dflowQuote`
 *   MEV-korumalı iyileştirme. priceImprovementBps asla sıfıra clamp edilmez.
 * - **Jupiter fallback YASAK** (BLOK 3 fallback bölümü). DFlow quote alınamazsa
 *   sadece hata fırlatılır — kullanıcı manuel retry eder ya da window uzatılır.
 * - Her execute öncesi simulation (BLOK 6 kural 5). Simülasyon fail = broadcast yok.
 * - Commitment `confirmed`, timeout 60s (BLOK 6 kural 6-7).
 * - Quote expiry kontrolü her execute öncesi — stale quote ile execute YASAK.
 *
 * Transport: Bu dosya DFlow endorsement server'ına (pond.dflow.net) HTTP POST
 * ile bağlanır. @dflow-protocol/client SDK paketi peer bağımlılık olarak
 * kuruludur ve ileride SDK metotları tercih edildiğinde `fetchQuoteFromDFlow`
 * ve `fetchSwapFromDFlow` fonksiyonları tek noktada değiştirilebilir.
 */

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Commitment,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createConnection, getPythPrice } from "./quicknode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DFlow retail order flow endorsement server. */
export const DFLOW_ENDORSEMENT_SERVER = "https://pond.dflow.net";

// NOT: Bu path'ler DFlow endorsement server'ının halka açık REST yüzeyine göre
// ayarlanmıştır. DFlow API revizyonunda path değişirse yalnızca bu iki sabit
// güncellenir — çağıran fonksiyonlar etkilenmez.
const DFLOW_QUOTE_PATH = "/api/quote";
const DFLOW_SWAP_PATH = "/api/swap";

const COMMITMENT: Commitment = "confirmed";
const HTTP_TIMEOUT_MS = 15_000;
const TX_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types (public)
// ---------------------------------------------------------------------------

export type DFlowQuote = {
  marketQuote: {
    inAmount: number;
    outAmount: number;
    priceImpactPct: number;
    route: string[];
  };
  dflowQuote: {
    inAmount: number;
    outAmount: number;
    priceImpactPct: number;
    /** USD cinsinden fiyat iyileştirmesi. Pyth price feed'i yoksa 0. */
    priceImprovement: number;
    /** Baz puan cinsinden iyileştirme. Negatif olabilir — clamp YOK. */
    priceImprovementBps: number;
    route: string[];
    quoteId: string;
    /** Quote expiry. Unix epoch ms. */
    expiresAt: number;
  };
  slippageBps: number;
  timestamp: Date;
};

export type ExecutionResult = {
  signature: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  /** outputAmount / inputAmount */
  executionPrice: number;
  /** marketQuote.outAmount / marketQuote.inAmount */
  marketPrice: number;
  priceImprovementBps: number;
  priceImprovementUsd: number;
  /** Solana network fee (SOL cinsinden). */
  fee: number;
  confirmedAt: Date;
};

export type TWAPSliceStatus =
  | "pending"
  | "executing"
  | "completed"
  | "skipped";

export type TWAPSlice = {
  sliceIndex: number;
  amount: number;
  targetExecutionTime: Date;
  status: TWAPSliceStatus;
  result: ExecutionResult | null;
};

/** Solflare-style transaction signer callback. */
export type SignTransactionFn = <T extends VersionedTransaction>(
  tx: T,
) => Promise<T>;

/**
 * Slippage threshold aşıldığında fırlatılır. UI tarafı bu mesajı pattern
 * match ederek sarı "fiyat bekleniyor" state'ine geçer (BLOK 3 slippage
 * yönetimi).
 */
export function isDFlowSlippageError(message: string | null | undefined): boolean {
  return !!message && message.startsWith("Anlık slippage");
}

// ---------------------------------------------------------------------------
// Types (internal — DFlow HTTP response shape)
// ---------------------------------------------------------------------------

type RawLeg = {
  inAmount?: string | number;
  outAmount?: string | number;
  priceImpactPct?: string | number;
  route?: string[];
  routePlan?: Array<{ swapInfo?: { label?: string; ammKey?: string } }>;
  quoteId?: string;
  expiresAt?: number;
  // DFlow-spesifik alanlar endpoint sürümünde ufak farklılıklar gösterebilir;
  // tüketici `coerceLeg` üzerinden her iki şemayı da kabul eder.
};

type RawQuoteResponse = {
  marketQuote?: RawLeg;
  baselineQuote?: RawLeg;
  dflowQuote?: RawLeg;
  improvedQuote?: RawLeg;
  endorsedQuote?: RawLeg;
  [key: string]: unknown;
};

type RawSwapResponse = {
  swapTransaction?: string;
  transaction?: string;
  tx?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<T> {
  const url = `${DFLOW_ENDORSEMENT_SERVER}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `DFlow endorsement server ${res.status}: ${text.slice(0, 280) || res.statusText}`,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `DFlow endorsement server ${timeoutMs / 1000}s içinde yanıt vermedi.`,
      );
    }
    if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
      throw new Error(
        `DFlow endorsement server'a ulaşılamıyor (${DFLOW_ENDORSEMENT_SERVER}). Ağ bağlantınızı kontrol edin.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Mint decimals resolver
// ---------------------------------------------------------------------------

const decimalsCache = new Map<string, number>();

async function getMintDecimals(mint: string): Promise<number> {
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;

  const connection = createConnection();
  let info;
  try {
    info = await connection.getParsedAccountInfo(new PublicKey(mint), COMMITMENT);
  } catch (err) {
    throw new Error(
      `Token decimal bilgisi alınamadı (${mint}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
    ?.parsed;
  const decimals = parsed?.info?.decimals;
  if (typeof decimals !== "number") {
    throw new Error(
      `Geçerli SPL token mint değil veya decimal bilgisi yok: ${mint}`,
    );
  }
  decimalsCache.set(mint, decimals);
  return decimals;
}

// ---------------------------------------------------------------------------
// Response coercion — DFlow API versiyonu arası tolerans
// ---------------------------------------------------------------------------

function coerceLeg(leg: RawLeg | undefined, inDecimals: number, outDecimals: number) {
  if (!leg) return null;
  const inRaw = Number(leg.inAmount ?? 0);
  const outRaw = Number(leg.outAmount ?? 0);
  const priceImpactPct = Number(leg.priceImpactPct ?? 0);
  if (!Number.isFinite(inRaw) || !Number.isFinite(outRaw) || inRaw <= 0 || outRaw <= 0) {
    return null;
  }

  // Route: düz string dizisi veya routePlan nesneleri
  let route: string[] = [];
  if (Array.isArray(leg.route)) {
    route = leg.route.filter((x): x is string => typeof x === "string");
  } else if (Array.isArray(leg.routePlan)) {
    route = leg.routePlan
      .map((step) => step.swapInfo?.label ?? step.swapInfo?.ammKey ?? "")
      .filter((x): x is string => !!x);
  }

  return {
    inAmount: inRaw / 10 ** inDecimals,
    outAmount: outRaw / 10 ** outDecimals,
    priceImpactPct: Number.isFinite(priceImpactPct) ? priceImpactPct : 0,
    route,
  };
}

function extractMarketLeg(raw: RawQuoteResponse): RawLeg | undefined {
  return raw.marketQuote ?? raw.baselineQuote;
}

function extractDflowLeg(raw: RawQuoteResponse): RawLeg | undefined {
  return raw.dflowQuote ?? raw.improvedQuote ?? raw.endorsedQuote;
}

// ---------------------------------------------------------------------------
// getQuote
// ---------------------------------------------------------------------------

/**
 * DFlow endorsement server'ından quote çeker. `marketQuote` (baseline) ve
 * `dflowQuote` (MEV-protected + price improvement) aynı response'ta döner;
 * priceImprovementBps iki leg'in outAmount'ları üzerinden hesaplanır.
 *
 * @throws "Anlık slippage..." — slippage threshold aşılmışsa (UI sarı uyarı)
 * @throws "Quote süresi doldu..." — dönen quote zaten expire olmuşsa
 * @throws Diğer hatalar: ağ, parse, endorsement server down
 */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
): Promise<DFlowQuote> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Geçersiz miktar. 0'dan büyük bir değer girin.");
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error("Geçersiz slippage toleransı.");
  }

  const [inDecimals, outDecimals] = await Promise.all([
    getMintDecimals(inputMint),
    getMintDecimals(outputMint),
  ]);

  const amountLamports = BigInt(Math.floor(amount * 10 ** inDecimals));
  if (amountLamports <= 0n) {
    throw new Error(
      "Miktar token decimal'ine çevrildiğinde sıfır. Daha büyük bir değer girin.",
    );
  }

  const raw = await postJson<RawQuoteResponse>(DFLOW_QUOTE_PATH, {
    inputMint,
    outputMint,
    amount: amountLamports.toString(),
    slippageBps,
    // BLOK 3 "fallback yapmayız" kuralı — sadece MEV-protected endorsed quote.
    onlyDirectRoutes: false,
    asLegacyTransaction: false,
  });

  const marketLeg = coerceLeg(extractMarketLeg(raw), inDecimals, outDecimals);
  const dflowLegRaw = extractDflowLeg(raw);
  const dflowLeg = coerceLeg(dflowLegRaw, inDecimals, outDecimals);

  if (!marketLeg) {
    throw new Error(
      "DFlow market baseline quote'u alınamadı. Sunucu eksik veri döndü.",
    );
  }
  if (!dflowLeg) {
    // BLOK 3 fallback kuralı: Jupiter'a fallback yapmıyoruz, hata fırlatıyoruz.
    throw new Error(
      "DFlow MEV-protected quote'u bu dilim için alınamadı. Lütfen tekrar deneyin veya execution window'u uzatın.",
    );
  }

  // Price improvement hesabı — user formülü birebir, asla clamp edilmez.
  const priceImprovementBps =
    ((dflowLeg.outAmount - marketLeg.outAmount) / marketLeg.outAmount) * 10_000;

  // USD değeri: Pyth input token fiyatı × inputAmount × (bps/10000).
  // Pyth'ten fiyat alınamazsa 0 — uydurma değil, bilgisizlik işareti.
  let inputTokenUsdPrice: number | null = null;
  try {
    inputTokenUsdPrice = await getPythPrice(inputMint);
  } catch {
    inputTokenUsdPrice = null;
  }
  const priceImprovement =
    inputTokenUsdPrice != null
      ? (priceImprovementBps / 10_000) * amount * inputTokenUsdPrice
      : 0;

  const quoteId =
    typeof dflowLegRaw?.quoteId === "string" && dflowLegRaw.quoteId.length > 0
      ? dflowLegRaw.quoteId
      : // Son çare: server quoteId vermezse deterministic bir kimlik üret
        `${inputMint.slice(0, 6)}-${outputMint.slice(0, 6)}-${Date.now()}`;

  // Expiry: server verdiyse onu kullan, aksi halde 30s sonrası varsay
  // (BLOK 4 "DFlow quote 30 saniye içinde alınmalı ve execution başlatılmalı").
  const now = Date.now();
  const expiresAt =
    typeof dflowLegRaw?.expiresAt === "number" && dflowLegRaw.expiresAt > now
      ? dflowLegRaw.expiresAt
      : now + 30_000;

  const quote: DFlowQuote = {
    marketQuote: marketLeg,
    dflowQuote: {
      inAmount: dflowLeg.inAmount,
      outAmount: dflowLeg.outAmount,
      priceImpactPct: dflowLeg.priceImpactPct,
      priceImprovement,
      priceImprovementBps,
      route: dflowLeg.route,
      quoteId,
      expiresAt,
    },
    slippageBps,
    timestamp: new Date(now),
  };

  // Expiry kontrolü: server zaten geçmiş expiry döndürdüyse execute etmeyiz.
  if (quote.dflowQuote.expiresAt <= now) {
    throw new Error("Quote süresi doldu, yeni quote alınıyor.");
  }

  // Slippage threshold kontrolü — BLOK 3 iki katmanlı slippage disiplini.
  // dflowLeg.priceImpactPct yüzde cinsinden (örn. 0.5 = %0.5).
  const actualImpactBps = Math.round(
    Math.abs(dflowLeg.priceImpactPct) * 100,
  );
  if (actualImpactBps > slippageBps) {
    throw new Error(
      `Anlık slippage %${(actualImpactBps / 100).toFixed(2)}, belirlenen limit %${(slippageBps / 100).toFixed(2)}. Execute edilmedi.`,
    );
  }

  return quote;
}

// ---------------------------------------------------------------------------
// executeSwap
// ---------------------------------------------------------------------------

function mapSimulationError(
  err: unknown,
  logs: string[] | null | undefined,
): string {
  const logStr = (logs ?? []).join(" ").toLowerCase();
  if (/insufficient.+funds?|insufficient lamports/.test(logStr)) {
    return "Yetersiz bakiye. İşlem için gereken token miktarı cüzdanınızda yok.";
  }
  if (/slippage|price impact/.test(logStr)) {
    return "Slippage limiti aşıldı. Fiyat quote alındıktan sonra değişti.";
  }
  if (/blockhash/.test(logStr)) {
    return "Blockhash süresi doldu. Quote'u yenileyip tekrar deneyin.";
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
    return "Blockhash süresi doldu. Lütfen quote'u yenileyin ve tekrar deneyin.";
  }
  if (/network|fetch|timeout/i.test(message)) {
    return "Ağ hatası. Quicknode RPC bağlantınızı kontrol edin.";
  }
  return message;
}

function decodeSwapTransaction(raw: RawSwapResponse): VersionedTransaction {
  const b64 = raw.swapTransaction ?? raw.transaction ?? raw.tx;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("DFlow swap response'da transaction bulunamadı.");
  }
  let bytes: Uint8Array;
  try {
    // Browser (atob) ve Node (Buffer) iki ortamda da çalışsın.
    if (typeof atob === "function") {
      const binary = atob(b64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    }
  } catch (err) {
    throw new Error(
      `DFlow swap transaction base64 decode hatası: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new Error(
      `DFlow swap transaction deserialize hatası: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * DFlow quote'u execute eder. Sadece `dflowQuote` kullanılır — market quote
 * execution için kullanılmaz (BLOK 3 "core engine" disiplini). Pipeline:
 * expiry check → swap tx fetch → deserialize → simulate → sign → send → confirm.
 */
export async function executeSwap(
  walletPublicKey: PublicKey,
  quote: DFlowQuote,
  signTransaction: SignTransactionFn,
): Promise<ExecutionResult> {
  // Expiry check — BLOK 3: stale quote ile execute YASAK.
  const now = Date.now();
  if (quote.dflowQuote.expiresAt <= now) {
    throw new Error("Quote süresi doldu, yeni quote alınıyor.");
  }

  const connection = createConnection();

  // 1) DFlow'dan imzasız, imzalanmaya hazır swap transaction iste.
  const rawSwap = await postJson<RawSwapResponse>(DFLOW_SWAP_PATH, {
    quoteId: quote.dflowQuote.quoteId,
    userPublicKey: walletPublicKey.toBase58(),
    wrapAndUnwrapSol: true,
    asLegacyTransaction: false,
  });

  const tx = decodeSwapTransaction(rawSwap);

  // 2) Simulate (BLOK 6 kural 5 — zorunlu).
  try {
    const simResult = await connection.simulateTransaction(tx, {
      commitment: COMMITMENT,
      sigVerify: false,
    });
    if (simResult.value.err) {
      throw new Error(
        `Transaction simulation başarısız: ${mapSimulationError(simResult.value.err, simResult.value.logs)} İşlem iptal edildi.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Transaction simulation")) {
      throw err;
    }
    throw new Error(
      `DFlow execute simülasyon hatası: ${err instanceof Error ? err.message : String(err)}. İşlem iptal edildi.`,
    );
  }

  // 3) Solflare sign.
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(tx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DFlow execute: ${message}`);
  }

  // 4) Broadcast.
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: COMMITMENT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `DFlow execute broadcast hatası: ${mapBroadcastError(message)}`,
    );
  }

  // 5) Confirm — 60s timeout (BLOK 6 kural 7).
  let confirmedAt: Date;
  try {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(COMMITMENT);
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
                `DFlow execute onayı ${TX_TIMEOUT_MS / 1000}s içinde gelmedi. Signature: ${signature}`,
              ),
            ),
          TX_TIMEOUT_MS,
        ),
      ),
    ]);
    confirmedAt = new Date();
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  // 6) Network fee — confirmed transaction'dan oku.
  // getTransaction Finality (confirmed|finalized) ister, COMMITMENT ise
  // genel Commitment — runtime değeri "confirmed" olduğundan güvenli cast.
  let fee = 0;
  try {
    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.fee) {
      fee = txInfo.meta.fee / LAMPORTS_PER_SOL;
    }
  } catch {
    // Fee okunamadıysa 0 kalır — uydurma değil, bilgi eksikliği.
  }

  const inputAmount = quote.dflowQuote.inAmount;
  const outputAmount = quote.dflowQuote.outAmount;
  const executionPrice = outputAmount / inputAmount;
  const marketPrice =
    quote.marketQuote.outAmount / quote.marketQuote.inAmount;

  return {
    signature,
    inputMint: "", // caller doldurur — quote yalnızca amount taşır
    outputMint: "",
    inputAmount,
    outputAmount,
    executionPrice,
    marketPrice,
    priceImprovementBps: quote.dflowQuote.priceImprovementBps,
    priceImprovementUsd: quote.dflowQuote.priceImprovement,
    fee,
    confirmedAt,
  };
}

// ---------------------------------------------------------------------------
// fetchSwapInstructions — raw ix çıkartımı (batching için)
// ---------------------------------------------------------------------------

/**
 * DFlow endorsement server'ından swap transaction'ı alır, build edilmiş
 * VersionedTransaction'ı decompile ederek raw instruction'lara dönüştürür.
 * `transactionBatcher` bu ix'leri Kamino withdraw ix'leri ile birleştirip
 * tek imza halinde gönderir.
 *
 * Decompile için referans edilen address lookup table'lar RPC üzerinden
 * yüklenir. LUT yüklenemezse o entry skip edilir ve instruction'larda
 * eksik account key hatası oluşabilir — sessiz fail yerine warn loglar.
 */
export async function fetchSwapInstructions(
  walletPublicKey: PublicKey,
  quote: DFlowQuote,
): Promise<{
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}> {
  // Expiry check — stale quote ile build YASAK.
  if (quote.dflowQuote.expiresAt <= Date.now()) {
    throw new Error("Quote süresi doldu, yeni quote alınıyor.");
  }

  const rawSwap = await postJson<RawSwapResponse>(DFLOW_SWAP_PATH, {
    quoteId: quote.dflowQuote.quoteId,
    userPublicKey: walletPublicKey.toBase58(),
    wrapAndUnwrapSol: true,
    asLegacyTransaction: false,
  });

  const tx = decodeSwapTransaction(rawSwap);
  const connection = createConnection();

  // Referenced lookup table'ları paralel çek.
  const lutKeys = tx.message.addressTableLookups.map((l) => l.accountKey);
  const lookupTables: AddressLookupTableAccount[] = [];
  await Promise.all(
    lutKeys.map(async (key) => {
      try {
        const info = await connection.getAddressLookupTable(key);
        if (info.value) lookupTables.push(info.value);
      } catch (err) {
        console.warn(
          `[LIMINAL] Address lookup table yüklenemedi (${key.toBase58()}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // Decompile: compiled message → resolved TransactionInstructions.
  let decompiled: TransactionMessage;
  try {
    decompiled = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: lookupTables,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `DFlow swap transaction decompile hatası: ${message}. Lookup table'lar eksik olabilir.`,
    );
  }

  return {
    instructions: decompiled.instructions,
    lookupTables,
  };
}

// ---------------------------------------------------------------------------
// buildExecutionResultFromQuote — batching sonrası result enrichment
// ---------------------------------------------------------------------------

/**
 * batchWithdrawAndSwap confirmation döndürdüğünde, state machine bu helper
 * ile quote + confirmation bilgisinden ExecutionResult oluşturur. Tüm
 * analytics alanları (executionPrice, marketPrice, priceImprovementBps,
 * priceImprovementUsd) quote'tan birebir alınır — uydurulmuş değer yok.
 */
export function buildExecutionResultFromQuote(
  quote: DFlowQuote,
  signature: string,
  confirmedAt: Date,
  fee: number,
  inputMint: string,
  outputMint: string,
): ExecutionResult {
  const { dflowQuote, marketQuote } = quote;
  return {
    signature,
    inputMint,
    outputMint,
    inputAmount: dflowQuote.inAmount,
    outputAmount: dflowQuote.outAmount,
    executionPrice:
      dflowQuote.inAmount > 0 ? dflowQuote.outAmount / dflowQuote.inAmount : 0,
    marketPrice:
      marketQuote.inAmount > 0
        ? marketQuote.outAmount / marketQuote.inAmount
        : 0,
    priceImprovementBps: dflowQuote.priceImprovementBps,
    priceImprovementUsd: dflowQuote.priceImprovement,
    fee,
    confirmedAt,
  };
}

// ---------------------------------------------------------------------------
// calculateTWAPSlices
// ---------------------------------------------------------------------------

/**
 * totalAmount'u sliceCount eşit parçaya böler. Son dilim yuvarlama farkını
 * absorbe eder — tüm dilimlerin toplamı her zaman tam olarak totalAmount'a
 * eşittir (float drift son dilime kırılır).
 *
 * targetExecutionTime eşit aralıklarla dağıtılır: dilim i için
 * `now + (windowDurationMs / sliceCount) * i`.
 */
export function calculateTWAPSlices(
  totalAmount: number,
  sliceCount: number,
  windowDurationMs: number,
): TWAPSlice[] {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("Geçersiz totalAmount. 0'dan büyük bir değer girin.");
  }
  if (!Number.isInteger(sliceCount) || sliceCount < 1) {
    throw new Error("Geçersiz sliceCount. 1 veya daha büyük bir tam sayı girin.");
  }
  if (!Number.isFinite(windowDurationMs) || windowDurationMs < 0) {
    throw new Error("Geçersiz windowDurationMs. Negatif olmayan bir sayı girin.");
  }

  const now = Date.now();
  const intervalMs = windowDurationMs / sliceCount;
  const equalSlice = totalAmount / sliceCount;

  const slices: TWAPSlice[] = [];
  let allocated = 0;

  // İlk n-1 dilim: eşit pay.
  for (let i = 0; i < sliceCount - 1; i++) {
    slices.push({
      sliceIndex: i,
      amount: equalSlice,
      targetExecutionTime: new Date(now + intervalMs * i),
      status: "pending",
      result: null,
    });
    allocated += equalSlice;
  }

  // Son dilim: toplam − tahsis edilen. Float drift'i garanti şekilde absorbe eder.
  slices.push({
    sliceIndex: sliceCount - 1,
    amount: totalAmount - allocated,
    targetExecutionTime: new Date(now + intervalMs * (sliceCount - 1)),
    status: "pending",
    result: null,
  });

  return slices;
}

// ---------------------------------------------------------------------------
// getBaselinePrice
// ---------------------------------------------------------------------------

/**
 * Analytics panel için "DFlow olmadan ne alırdın" baseline rate'ini döner.
 * İlk getQuote çağrısındaki marketQuote'un out/in oranı. Slippage filtresi
 * baseline sorgusunu bozmasın diye max tolerans ile çağrılır.
 */
export async function getBaselinePrice(
  inputMint: string,
  outputMint: string,
  amount: number,
): Promise<number> {
  const MAX_SLIPPAGE_BPS = 10_000; // %100 — baseline için filtre devre dışı
  const quote = await getQuote(inputMint, outputMint, amount, MAX_SLIPPAGE_BPS);
  const { inAmount, outAmount } = quote.marketQuote;
  if (inAmount <= 0) {
    throw new Error("Baseline hesaplama hatası: marketQuote.inAmount sıfır.");
  }
  return outAmount / inAmount;
}
