/**
 * LIMINAL — Profile Store
 *
 * Wallet-keyed profile registry. The hackathon-spirit position is that
 * the wallet *is* the account: there's no email, no password, no server
 * dependency. The user picks a username + avatar once after their
 * first connect, and the choice persists in `localStorage` keyed by
 * their Solana address. Reconnecting the same wallet restores the
 * profile; connecting a different wallet creates a fresh slot.
 *
 * Module-level subscriber pattern — same shape as `solflare`,
 * `tokenRegistry`, etc. — so React components can subscribe via
 * `useSyncExternalStore` and re-render on writes from anywhere.
 *
 * No PII is stored. Username is opaque ASCII the user picks. Avatar
 * id is an integer pointing into the static avatar registry shipped
 * with the bundle (`ProfileAvatar.tsx`). If we add a server-side
 * sync later, the local copy stays the source of truth — server
 * pulls FROM here, not the other way around.
 */

const STORAGE_KEY = "liminal:profiles:v1";
const MAX_USERNAME_LEN = 20;
const MIN_USERNAME_LEN = 3;

export type ProfileRecord = {
  /** Solana wallet address (base58). Acts as the primary key. */
  address: string;
  /** Display name chosen by the user. Trimmed, 3-20 chars. */
  username: string;
  /** Index into the static avatar registry (1-based). */
  avatarId: number;
  /** ISO timestamp of first creation. */
  createdAt: string;
  /** ISO timestamp of last edit (username/avatar change). */
  updatedAt: string;
};

type Registry = Record<string, ProfileRecord>;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRegistry(): Registry {
  const ls = safeStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Registry;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed;
  } catch {
    // Corrupt JSON shouldn't take down the app; treat as empty.
    return {};
  }
}

function writeRegistry(reg: Registry): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(reg));
  } catch {
    // Quota exceeded or storage disabled — silently no-op so the app
    // keeps working with an in-memory registry until the next reload.
  }
}

// ---------------------------------------------------------------------------
// In-memory mirror + subscriber pattern
// ---------------------------------------------------------------------------

let registry: Registry = readRegistry();
const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) {
    try {
      fn();
    } catch {
      /* defensive — don't let one bad subscriber break the others */
    }
  }
}

export function subscribeProfiles(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getProfile(address: string | null | undefined): ProfileRecord | null {
  if (!address) return null;
  return registry[address] ?? null;
}

/**
 * Validates a username. Returns null if valid, or an error message
 * for the UI to render. Pure — does not mutate state.
 */
export function validateUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_USERNAME_LEN) {
    return `Username must be at least ${MIN_USERNAME_LEN} characters.`;
  }
  if (trimmed.length > MAX_USERNAME_LEN) {
    return `Username can't exceed ${MAX_USERNAME_LEN} characters.`;
  }
  // Allow letters, numbers, underscore, dash, dot. Conservative — keeps
  // the namespace from drifting into emoji / Unicode lookalike attacks
  // if we ever expose usernames publicly.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return "Use letters, numbers, underscore, dash, or dot only.";
  }
  return null;
}

export type SaveProfileInput = {
  address: string;
  username: string;
  avatarId: number;
};

export function saveProfile(input: SaveProfileInput): ProfileRecord {
  const error = validateUsername(input.username);
  if (error) throw new Error(error);

  const now = new Date().toISOString();
  const existing = registry[input.address];
  const record: ProfileRecord = {
    address: input.address,
    username: input.username.trim(),
    avatarId: input.avatarId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  registry = { ...registry, [input.address]: record };
  writeRegistry(registry);
  notify();
  return record;
}

export function deleteProfile(address: string): void {
  if (!(address in registry)) return;
  const next = { ...registry };
  delete next[address];
  registry = next;
  writeRegistry(registry);
  notify();
}

export function getAllProfiles(): ProfileRecord[] {
  return Object.values(registry).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export const PROFILE_USERNAME_LIMITS = {
  min: MIN_USERNAME_LEN,
  max: MAX_USERNAME_LEN,
} as const;
