/**
 * LIMINAL — Token Registry
 *
 * Strateji (fallback chain):
 *   1. Module-level in-memory Map cache (instant hit)
 *   2. localStorage 24h TTL cache (cross-session persistence)
 *   3. Jupiter v2 search API per-mint (resolves even pump/unverified tokens)
 *
 * Jupiter v2 search endpoint accepts a mint address as `query` and returns
 * `[{ id, name, symbol, icon, decimals, ... }]`. It covers verified,
 * community, and LST pools — effectively every SPL token that has on-chain
 * metadata visible to Jupiter's indexer. Pump.fun tokens resolve correctly.
 *
 * Batch policy: requests are coalesced within a 50ms window. If a component
 * asks for 10 mints at once, the registry hits the API 10x (one per mint;
 * search API doesn't accept arrays) but all in parallel, caches each, and
 * notifies subscribers in bulk when the last one resolves.
 */

const JUP_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const STORAGE_KEY = "liminal:token-registry:v2";
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type TokenInfo = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  /** Verification flag derived from Jupiter v2 `tags` (verified ⇢ true)
   * plus a hardcoded known-good allowlist for the canonical mints
   * the Jupiter search occasionally misclassifies. UI surfaces a ✓
   * for verified, ⚠ for unverified to help the user spot honeypot /
   * scam tokens before swapping. */
  verified: boolean;
};

type StoredPayload = {
  fetchedAt: number;
  tokens: Record<string, TokenInfo>;
};

// Module-level state
const registry = new Map<string, TokenInfo>();
const inFlight = new Map<string, Promise<TokenInfo | null>>();
const failed = new Set<string>(); // mints that failed recently; retry after TTL

const subscribers = new Set<() => void>();
let notifyScheduled = false;

function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Coalesce: batch multiple registry.set() calls into one render.
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of subscribers) fn();
  });
}

export function subscribeRegistry(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function readCache(): Record<string, TokenInfo> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed?.fetchedAt || typeof parsed.tokens !== "object") return null;
    if (Date.now() - parsed.fetchedAt > STORAGE_TTL_MS) return null;
    // Backfill missing fields from older cache entries — `verified` was
    // added in PR #5q. Default to allowlist membership so canonical
    // mints don't suddenly read as unverified after a token-registry
    // upgrade.
    for (const mint of Object.keys(parsed.tokens)) {
      const t = parsed.tokens[mint];
      if (typeof (t as Partial<TokenInfo>).verified !== "boolean") {
        (t as TokenInfo).verified = ALLOWLIST_MINTS.has(mint);
      }
    }
    return parsed.tokens;
  } catch {
    return null;
  }
}

let writeScheduled = false;
function scheduleWriteCache(): void {
  if (writeScheduled) return;
  writeScheduled = true;
  setTimeout(() => {
    writeScheduled = false;
    try {
      const out: Record<string, TokenInfo> = {};
      for (const [k, v] of registry.entries()) out[k] = v;
      const payload: StoredPayload = { fetchedAt: Date.now(), tokens: out };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage quota / privacy mode — silently ignore.
    }
  }, 500);
}

// ---------------------------------------------------------------------------
// Load cache on module init (synchronous)
// ---------------------------------------------------------------------------

(function bootstrap(): void {
  if (typeof localStorage === "undefined") return;
  const cached = readCache();
  if (cached) {
    for (const [mint, info] of Object.entries(cached)) {
      registry.set(mint, info);
    }
  }
})();

// ---------------------------------------------------------------------------
// Jupiter v2 search API — per-mint fetch
// ---------------------------------------------------------------------------

type JupSearchRow = {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  tags?: string[];
  isVerified?: boolean;
};

// Hardcoded canonical mints we trust regardless of what Jupiter's
// classifier says. Covers the major SPL tokens LIMINAL users hold.
const ALLOWLIST_MINTS = new Set<string>([
  "So11111111111111111111111111111111111111112", // SOL (wrapped)
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
  "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",  // JTO
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", // INF
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
]);

/** Normalize various IPFS/Arweave URI schemes into browser-loadable HTTPS URLs. */
function normalizeLogoURI(uri: string | undefined | null): string | null {
  if (!uri || typeof uri !== "string") return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;
  // ipfs://<cid> → public gateway
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${cid}`;
  }
  // ar://<tx> → arweave.net gateway
  if (trimmed.startsWith("ar://")) {
    return `https://arweave.net/${trimmed.slice("ar://".length)}`;
  }
  // Relative / protocol-less — bail
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

async function fetchOne(mint: string): Promise<TokenInfo | null> {
  try {
    const url = `${JUP_SEARCH_URL}?query=${encodeURIComponent(mint)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`Jupiter search ${res.status}`);
    const data = (await res.json()) as JupSearchRow[];
    if (!Array.isArray(data)) return null;
    // Search may return multiple rows that match the query loosely; only the
    // exact mint match is authoritative.
    const match = data.find((r) => r.id === mint);
    if (!match || !match.symbol) return null;
    // Verified iff (a) Jupiter tagged it explicitly OR (b) the mint
    // is in our hardcoded canonical allowlist. Either signal alone
    // is sufficient — the allowlist exists because Jupiter v2 search
    // sometimes returns canonical mints without the verified tag.
    const tagSet = new Set(
      Array.isArray(match.tags)
        ? match.tags.map((t) => String(t).toLowerCase())
        : [],
    );
    const verified =
      tagSet.has("verified") ||
      tagSet.has("strict") ||
      match.isVerified === true ||
      ALLOWLIST_MINTS.has(match.id!);
    const info: TokenInfo = {
      mint: match.id!,
      symbol: match.symbol,
      name: typeof match.name === "string" ? match.name : match.symbol,
      decimals: typeof match.decimals === "number" ? match.decimals : 0,
      logoURI: normalizeLogoURI(match.icon),
      verified,
    };
    return info;
  } catch (err) {
    console.warn(
      `[LIMINAL/tokenRegistry] fetchOne(${mint.slice(0, 4)}…) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Request metadata for a single mint. Returns immediately if cached.
 * Deduplicates concurrent requests for the same mint.
 */
export function requestToken(mint: string): Promise<TokenInfo | null> {
  if (!mint) return Promise.resolve(null);
  const cached = registry.get(mint);
  if (cached) return Promise.resolve(cached);
  if (failed.has(mint)) return Promise.resolve(null);
  const existing = inFlight.get(mint);
  if (existing) return existing;

  const promise = (async () => {
    const info = await fetchOne(mint);
    inFlight.delete(mint);
    if (info) {
      registry.set(mint, info);
      scheduleWriteCache();
      scheduleNotify();
      return info;
    }
    failed.add(mint);
    // Re-allow retry after 5 minutes so transient errors recover.
    setTimeout(() => failed.delete(mint), 5 * 60 * 1000);
    return null;
  })();

  inFlight.set(mint, promise);
  return promise;
}

/**
 * Warm up the registry for a list of mints. Fires all missing ones in
 * parallel; resolves when all settle. UI is not blocked — subscribers
 * receive notifications as each mint lands.
 */
export function requestMany(mints: string[]): Promise<void> {
  const missing = mints.filter(
    (m) => m && !registry.has(m) && !inFlight.has(m) && !failed.has(m),
  );
  if (missing.length === 0) return Promise.resolve();
  return Promise.all(missing.map((m) => requestToken(m))).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Public sync lookups
// ---------------------------------------------------------------------------

export function lookupToken(mint: string): TokenInfo | null {
  return registry.get(mint) ?? null;
}

export function symbolFor(mint: string, fallbackShort = true): string {
  const t = registry.get(mint);
  if (t) return t.symbol;
  if (!fallbackShort) return mint;
  if (mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function isRegistryLoaded(): boolean {
  return registry.size > 0;
}

/**
 * Back-compat no-op. Previous version did an upfront bulk load; the new
 * flow is lazy per-mint via requestToken/requestMany. Components that call
 * `ensureRegistryLoaded()` still work — they just get an immediate resolve.
 */
export function ensureRegistryLoaded(): Promise<void> {
  return Promise.resolve();
}
