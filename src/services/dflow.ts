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
 * Transport: Jupiter Ultra REST API (lite-api.jup.ag/ultra/v1). Ultra's
 * RFQ pool carries DFlow-endorsed private paths, so the MEV-protection
 * invariant survives without a DFlow-specific SDK in our dep tree.
 *
 * Historical note: `@dflow-protocol/client` was a peer dep in earlier
 * iterations when we planned to hit pond.dflow.net directly. That
 * endpoint was never publicly swap-capable (CORS-blocked + intent-based
 * behind a Turnstile CAPTCHA) and the SDK has since been removed — it
 * carried five critical `protobufjs` CVEs via the Cosmos bridge tree.
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

/**
 * Aggregator endpoint.
 *
 * Originally targeted DFlow's pond.dflow.net REST API, but that endpoint
 * was never publicly swap-capable (CORS-blocked, POST /api/quote returned
 * 405). DFlow's actual entry point is an intent-based Cloudflare Worker
 * behind Turnstile CAPTCHA — not consumable from a pure-browser client.
 *
 * We route through **Jupiter Ultra** instead. Ultra includes DFlow-
 * endorsed RFQs in its route pool, so the MEV-protection characteristic
 * (the LIMINAL value prop that "fallback to Jupiter" was meant to avoid)
 * is preserved as a native property of the route, not a fallback path.
 *
 * GET  /ultra/v1/order   → quote + ready-to-sign VersionedTransaction
 * POST /ultra/v1/execute → broadcast the signed transaction
 */
export const DFLOW_ENDORSEMENT_SERVER = "https://lite-api.jup.ag";
const ULTRA_ORDER_PATH = "/ultra/v1/order";

/**
 * Cap the number of accounts Ultra is allowed to include in a single
 * route. Lower = simpler route = smaller serialized tx (fits Solana's
 * 1232-byte packet MTU).
 *
 * History:
 *   - default (64) → 1872-byte tx, simulation failed (mainnet 16:37)
 *   - 30 → still failed on a subsequent attempt (mainnet 16:48)
 *   - 20 → current. Combined with `restrictIntermediateTokens: true`,
 *     this caps practical tx size at ~900 bytes worst case.
 *
 * The relationship between maxAccounts and serialized size isn't
 * linear because LUTs compress account references, but each AMM hop
 * still costs ~150-200 bytes of instruction data + signers/writables.
 * With 20 accounts we typically get 2-3 hop routes that comfortably
 * fit MTU even after our setup instructions are added.
 *
 * Trade-off: more aggressive than ideal — Ultra may find a slightly
 * better price with a complex 4+ hop route. Worth the tradeoff because
 * (1) MTU failures cost the user a slice slot AND a failed-simulation
 * tx fee, (2) DFlow RFQ paths within Ultra remain simpler than full-
 * aggregator routes, (3) 20-account routes already cover the popular
 * (SOL/USDC, USDC/USDT, etc.) trading pairs LIMINAL targets.
 */
const ULTRA_MAX_ACCOUNTS = 20;

/**
 * Force Ultra's intermediate hops to be drawn from a curated list of
 * highly-liquid tokens (SOL, USDC, USDT, etc.) rather than arbitrary
 * memecoins. Two benefits:
 *   - Deterministic routing → predictable tx size
 *   - Better fill quality on long-tail tokens (deeper books in the
 *     curated set)
 *
 * Default for Ultra is unclear from public docs (some endpoints
 * default true, some false). We pin true explicitly to remove
 * ambiguity.
 */
const ULTRA_RESTRICT_INTERMEDIATE = true;
const ULTRA_EXECUTE_PATH = "/ultra/v1/execute";

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
    /** Base64-encoded VersionedTransaction from the aggregator, ready to sign. */
    transaction?: string;
  };
  slippageBps: number;
  timestamp: Date;
  /**
   * Input mint address — kept on the quote so the executeSwap fallback
   * re-fetch path can resolve decimals correctly without a separate
   * mint lookup. BUG FIX (M-1, audit): without this the fallback
   * hardcoded 1e9 (SOL decimals), producing 1000× wrong amounts for
   * 6-decimal tokens like USDC.
   */
  inputMint: string;
  /** Input mint decimals — same purpose as inputMint above. */
  inputDecimals: number;
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

/**
 * Jupiter Ultra `/order` response shape (subset we care about). `transaction`
 * is the ready-to-sign base64 VersionedTransaction; `requestId` pairs with
 * the `/execute` POST to finalize broadcast.
 */
type UltraOrderResponse = {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct?: number;
  routePlan?: Array<{
    swapInfo?: { label?: string; ammKey?: string };
  }>;
  feeBps?: number;
  inUsdValue?: number;
  outUsdValue?: number;
  swapUsdValue?: number;
  transaction?: string;
  errorCode?: number;
  errorMessage?: string;
  router?: string;
};

type UltraExecuteResponse = {
  status: "Success" | "Failed" | string;
  signature?: string;
  code?: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function fetchJson<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<T> {
  const url = `${DFLOW_ENDORSEMENT_SERVER}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Aggregator ${res.status}: ${text.slice(0, 280) || res.statusText}`,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Aggregator did not respond within ${timeoutMs / 1000}s.`,
      );
    }
    if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
      throw new Error(
        `Aggregator not reachable (${DFLOW_ENDORSEMENT_SERVER}). Check your network connection.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getJson<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs?: number,
): Promise<T> {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");
  const fullPath = query ? `${path}?${query}` : path;
  return fetchJson<T>(fullPath, { method: "GET" }, timeoutMs);
}

/**
 * Detect transient Ultra failures that are worth retrying. Filters
 * 5xx + network errors as retry-worthy, leaves 4xx and timeouts alone.
 *
 * Why so narrow:
 *   - 4xx is almost always a client bug (bad mint, malformed query) —
 *     retrying won't help, just spams the user with delay
 *   - Timeouts already had 60s of patience; another retry would
 *     compound the wait beyond the slice loop's expectations
 *   - 5xx + "fetch failed" / "network" are exactly the transient
 *     classes (server overload, brief connectivity blip) where a
 *     quick retry pays off
 */
function isTransientUltraError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  // 5xx pattern from fetchJson's "Aggregator NNN: …" format
  if (/Aggregator 5\d{2}:/i.test(msg)) return true;
  // Network-not-reachable from fetchJson's TypeError fallback
  if (/Aggregator not reachable/i.test(msg)) return true;
  return false;
}

/**
 * Single-retry wrapper for Ultra GET endpoints (quote / order). The
 * backoff is intentionally short (250ms) — the slice loop's quote
 * window is tight and a longer wait might miss the targetExecutionTime.
 *
 * BUG FIX (DDD): without this, a single 5xx from Jupiter Ultra would
 * surface to the user as DFLOW_QUOTE_FAILED ERROR. The user could
 * RETRY but they'd hit the same upstream blip a moment later. With
 * the auto-retry, transient blips heal silently — the typical case
 * resolves in <1s and the user never sees ERROR.
 */
async function withQuoteRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientUltraError(err)) throw err;
    // 250ms backoff before single retry. Keeps total worst-case <
    // (HTTP_TIMEOUT_MS + 250 + HTTP_TIMEOUT_MS) so the slice loop
    // doesn't blow its quote-fresh budget.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    return fn();
  }
}

function postJsonUltra<T>(
  path: string,
  body: unknown,
  timeoutMs?: number,
): Promise<T> {
  return fetchJson<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
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
      `Failed to fetch token decimals (${mint}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
    ?.parsed;
  const decimals = parsed?.info?.decimals;
  if (typeof decimals !== "number") {
    throw new Error(
      `Not a valid SPL token mint or missing decimals: ${mint}`,
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
  taker?: string,
): Promise<DFlowQuote> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount. Enter a value greater than 0.");
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error("Invalid slippage tolerance.");
  }

  const [inDecimals, outDecimals, inUsd, outUsd] = await Promise.all([
    getMintDecimals(inputMint),
    getMintDecimals(outputMint),
    // Market baseline uses Pyth directly — same pricing source the user
    // already sees live in the Execution panel, so numbers line up.
    getPythPrice(inputMint).catch(() => null),
    getPythPrice(outputMint).catch(() => null),
  ]);

  const amountLamports = BigInt(Math.floor(amount * 10 ** inDecimals));
  if (amountLamports <= 0n) {
    throw new Error(
      "Amount converts to zero in token decimals. Enter a larger value.",
    );
  }

  // Auto-retry once on transient 5xx / network errors so a brief
  // upstream blip doesn't drag the user into ERROR (Bug DDD).
  const order = await withQuoteRetry(() =>
    getJson<UltraOrderResponse>(ULTRA_ORDER_PATH, {
      inputMint,
      outputMint,
      amount: amountLamports.toString(),
      slippageBps,
      // Cap route complexity to fit Solana's 1232-byte packet MTU.
      // History: 64 (default) → 1872 bytes failed; 30 → still failed
      // on some pairs; 20 + restrictIntermediateTokens reliably fits.
      maxAccounts: ULTRA_MAX_ACCOUNTS,
      restrictIntermediateTokens: ULTRA_RESTRICT_INTERMEDIATE,
      // Ultra takes a taker address to pre-bind fee ATAs. If not known yet
      // (pre-connect), we omit and ask the route-only (no signing).
      taker,
    }),
  );

  if (order.errorCode && order.errorCode !== 0 && !order.transaction) {
    // Ultra returned an actionable error — surface it verbatim so the UI
    // can classify insufficient-funds vs no-route vs slippage.
    throw new Error(
      order.errorMessage ?? `Aggregator error code ${order.errorCode}`,
    );
  }

  const dflowInAmount = Number(order.inAmount) / 10 ** inDecimals;
  const dflowOutAmount = Number(order.outAmount) / 10 ** outDecimals;
  if (
    !Number.isFinite(dflowInAmount) ||
    !Number.isFinite(dflowOutAmount) ||
    dflowInAmount <= 0 ||
    dflowOutAmount <= 0
  ) {
    throw new Error(
      "Aggregator returned an unusable quote. Retry or widen slippage.",
    );
  }

  const dflowPriceImpactPct = Number.isFinite(order.priceImpactPct)
    ? Math.abs(Number(order.priceImpactPct))
    : 0;
  const route: string[] = (order.routePlan ?? [])
    .map((step) => step.swapInfo?.label ?? step.swapInfo?.ammKey ?? "")
    .filter((x): x is string => !!x);

  // Market baseline derived from Pyth: what you'd get at mid-market with
  // zero spread / zero slippage / zero fees. Ultra's `outAmount` is the
  // real DFlow-endorsed delivery. The difference is the genuine price
  // improvement we surface to the user.
  let marketOutAmount = 0;
  if (inUsd != null && outUsd != null && outUsd > 0) {
    marketOutAmount = (dflowInAmount * inUsd) / outUsd;
  }
  // If Pyth didn't have either feed, fall back to the aggregator's own
  // number so we don't pretend a bogus improvement exists.
  if (!Number.isFinite(marketOutAmount) || marketOutAmount <= 0) {
    marketOutAmount = dflowOutAmount;
  }

  const priceImprovementBps =
    marketOutAmount > 0
      ? ((dflowOutAmount - marketOutAmount) / marketOutAmount) * 10_000
      : 0;
  const priceImprovement =
    inUsd != null
      ? (priceImprovementBps / 10_000) * dflowInAmount * inUsd
      : 0;

  const now = Date.now();
  const quote: DFlowQuote = {
    marketQuote: {
      inAmount: dflowInAmount,
      outAmount: marketOutAmount,
      priceImpactPct: 0, // Pyth baseline is by definition zero-impact
      route: ["pyth-baseline"],
    },
    dflowQuote: {
      inAmount: dflowInAmount,
      outAmount: dflowOutAmount,
      priceImpactPct: dflowPriceImpactPct,
      priceImprovement,
      priceImprovementBps,
      route: route.length > 0 ? route : [order.router ?? "ultra"],
      quoteId: order.requestId,
      // Ultra orders are generally valid for ~30s; mirror that here so
      // the state machine re-quotes if the user lingers before signing.
      expiresAt: now + 30_000,
      transaction: order.transaction,
    },
    slippageBps,
    timestamp: new Date(now),
    inputMint,
    inputDecimals: inDecimals,
  };

  // BLOK 3 two-tier slippage: Ultra priceImpactPct is in percent
  // (0.5 = %0.5). If observed impact exceeds the user's threshold, defer
  // the slice — this is NOT an error, the machine retries.
  const actualImpactBps = Math.round(dflowPriceImpactPct * 100);
  if (actualImpactBps > slippageBps) {
    throw new Error(
      `Current slippage %${(actualImpactBps / 100).toFixed(2)}, configured limit %${(slippageBps / 100).toFixed(2)}. Execution skipped.`,
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
    return "Insufficient balance. Your wallet does not have enough tokens for this transaction.";
  }
  if (/slippage|price impact/.test(logStr)) {
    return "Slippage limit exceeded. Price moved after quote was fetched.";
  }
  if (/blockhash/.test(logStr)) {
    return "Blockhash expired. Refresh the quote and retry.";
  }
  const errStr =
    typeof err === "string"
      ? err
      : JSON.stringify(err ?? {}).slice(0, 160);
  return `Simulation failed: ${errStr}`;
}

function mapBroadcastError(message: string): string {
  if (/insufficient/i.test(message)) {
    return "Insufficient balance. Check your SOL (gas) and token balances.";
  }
  if (/blockhash/i.test(message)) {
    return "Blockhash expired. Refresh the quote and retry.";
  }
  if (/network|fetch|timeout/i.test(message)) {
    return "Network error. Check your Quicknode RPC connection.";
  }
  return message;
}

function decodeSwapTransaction(raw: RawSwapResponse): VersionedTransaction {
  const b64 = raw.swapTransaction ?? raw.transaction ?? raw.tx;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("DFlow swap response did not contain a transaction.");
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
      `DFlow swap transaction base64 decode error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new Error(
      `DFlow swap transaction deserialize error: ${err instanceof Error ? err.message : String(err)}`,
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
    throw new Error("Quote expired, fetching a new quote.");
  }

  const connection = createConnection();

  // 1) Ultra's /order already returned the ready-to-sign transaction when
  //    we fetched the quote. If the caller obtained a quote in "no-taker"
  //    mode (no pre-bound fee ATAs) the transaction will be missing, in
  //    which case we re-fetch with the wallet bound as taker.
  let b64 = quote.dflowQuote.transaction;
  if (!b64) {
    // BUG FIX (M-1, audit): use the quote's stored inputDecimals
    // instead of hardcoded 1e9. Quotes for 6-decimal tokens (USDC,
    // USDT) were being re-fetched at 1000× the correct amount,
    // routing through different pools or rejecting outright.
    const refreshed = await getJson<UltraOrderResponse>(ULTRA_ORDER_PATH, {
      inputMint: "", // caller's route is captured inside the requestId
      outputMint: "",
      amount: BigInt(
        Math.floor(quote.dflowQuote.inAmount * 10 ** quote.inputDecimals),
      ).toString(),
      slippageBps: quote.slippageBps,
      maxAccounts: ULTRA_MAX_ACCOUNTS,
      restrictIntermediateTokens: ULTRA_RESTRICT_INTERMEDIATE,
      taker: walletPublicKey.toBase58(),
    }).catch(() => null);
    b64 = refreshed?.transaction;
  }
  if (!b64) {
    throw new Error(
      "Aggregator did not provide a signable transaction. Refresh the quote and retry.",
    );
  }

  const tx = decodeSwapTransaction({ transaction: b64 });

  // 1.5) Pre-flight size check. Solana's per-tx packet MTU is 1232
  // bytes raw / 1644 base64. If Ultra still returned a too-big route
  // despite our maxAccounts cap, fail fast with a clean retryable
  // error (parseError classifies this as DFLOW_SIMULATION_FAILED) —
  // saves a wasted RPC round-trip and the user gets a clear message
  // instead of the RPC's cryptic "VersionedTransaction too large".
  let preflightSize = 0;
  try {
    preflightSize = tx.serialize().length;
  } catch (err) {
    // serialize() can throw "encoding overruns Uint8Array" for huge
    // txs — same root cause, treat identically.
    throw new Error(
      `VersionedTransaction too large: encoding overruns Uint8Array. ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (preflightSize > 1232) {
    throw new Error(
      `VersionedTransaction too large: ${preflightSize} bytes (max raw 1232). ` +
        "Aggregator returned a route too large for Solana's packet limit.",
    );
  }

  // 2) Simulate (BLOK 6 kural 5 — zorunlu).
  try {
    const simResult = await connection.simulateTransaction(tx, {
      commitment: COMMITMENT,
      sigVerify: false,
    });
    if (simResult.value.err) {
      throw new Error(
        `Transaction simulation failed: ${mapSimulationError(simResult.value.err, simResult.value.logs)} Transaction aborted.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Transaction simulation")) {
      throw err;
    }
    throw new Error(
      `Aggregator simulation error: ${err instanceof Error ? err.message : String(err)}. Transaction aborted.`,
    );
  }

  // 3) Solflare sign.
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(tx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Aggregator execute: ${message}`);
  }

  // 4) Submit through Ultra's /execute endpoint. Ultra broadcasts server-
  //    side (handles retries, gets better landing rate) and returns the
  //    signature + final status. Fall back to direct sendRawTransaction
  //    if Ultra's execute surface is unavailable.
  let signature: string | undefined;
  try {
    const serialized = signed.serialize();
    const signedB64 =
      typeof btoa === "function"
        ? btoa(String.fromCharCode(...serialized))
        : Buffer.from(serialized).toString("base64");
    const execRes = await postJsonUltra<UltraExecuteResponse>(
      ULTRA_EXECUTE_PATH,
      {
        signedTransaction: signedB64,
        requestId: quote.dflowQuote.quoteId,
      },
    );
    if (execRes.status === "Success" && execRes.signature) {
      signature = execRes.signature;
    } else if (execRes.error) {
      throw new Error(
        `Aggregator execute rejected: ${mapBroadcastError(execRes.error)}`,
      );
    }
  } catch (err) {
    // Soft fallback to RPC-direct broadcast if Ultra's execute isn't
    // reachable — preserves user UX without a hard failure.
    console.warn(
      `[LIMINAL] Aggregator /execute unavailable, falling back to RPC broadcast: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!signature) {
    try {
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: COMMITMENT,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Broadcast error: ${mapBroadcastError(message)}`,
      );
    }
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
                `Confirmation ${TX_TIMEOUT_MS / 1000}s did not arrive in time. Signature: ${signature}`,
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
    throw new Error("Quote expired, fetching a new quote.");
  }

  // Ultra's /order already returned the VersionedTransaction when the
  // quote was fetched. If it wasn't in the cache (quote built without a
  // taker address) we re-request binding this wallet as taker.
  let b64 = quote.dflowQuote.transaction;
  if (!b64) {
    const refreshed = await getJson<UltraOrderResponse>(ULTRA_ORDER_PATH, {
      inputMint: "",
      outputMint: "",
      amount: "0",
      slippageBps: quote.slippageBps,
      maxAccounts: ULTRA_MAX_ACCOUNTS,
      restrictIntermediateTokens: ULTRA_RESTRICT_INTERMEDIATE,
      taker: walletPublicKey.toBase58(),
    }).catch(() => null);
    b64 = refreshed?.transaction;
  }
  if (!b64) {
    throw new Error(
      "Aggregator did not provide a signable transaction for this quote.",
    );
  }
  const tx = decodeSwapTransaction({ transaction: b64 });
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
    throw new Error("Invalid totalAmount. Enter a value greater than 0.");
  }
  if (!Number.isInteger(sliceCount) || sliceCount < 1) {
    throw new Error("Invalid sliceCount. Enter an integer of 1 or greater.");
  }
  if (!Number.isFinite(windowDurationMs) || windowDurationMs < 0) {
    throw new Error("Invalid windowDurationMs. Enter a non-negative number.");
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
    throw new Error("Baseline computation error: marketQuote.inAmount is zero.");
  }
  return outAmount / inAmount;
}
