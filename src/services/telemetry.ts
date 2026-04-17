/**
 * LIMINAL — telemetry (Sentry, opt-in)
 *
 * Zero data leaves the browser unless `VITE_SENTRY_DSN` is set. The
 * function is idempotent and safe to call from `main.tsx` whether or
 * not a DSN is configured — it resolves to a no-op quickly when unset.
 *
 * Scope of capture:
 *   - Unhandled errors
 *   - Unhandled promise rejections
 *   - Explicit `captureError()` calls from catch blocks where the user
 *     already sees a friendly error (so the raw stack still reaches
 *     Sentry for debugging).
 *
 * NOT captured:
 *   - console.log / warn (too noisy)
 *   - Network requests (separate Sentry integration; add when needed)
 *   - User wallet addresses (PII) — `beforeSend` scrubs obvious shapes
 *     just in case.
 *
 * Intentionally uses `@sentry/react` dynamic import so the SDK only
 * lands in the bundle of browsers that have a DSN configured.
 */

type SentryModule = typeof import("@sentry/react");

let initialized = false;
let sentryPromise: Promise<SentryModule | null> | null = null;

function getDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (typeof dsn === "string" && dsn.trim().length > 0) return dsn.trim();
  return undefined;
}

async function loadSentry(): Promise<SentryModule | null> {
  if (sentryPromise) return sentryPromise;
  const dsn = getDsn();
  if (!dsn) {
    sentryPromise = Promise.resolve(null);
    return sentryPromise;
  }
  sentryPromise = import("@sentry/react").catch((err) => {
    console.warn(
      `[LIMINAL/telemetry] @sentry/react failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });
  return sentryPromise;
}

/**
 * Best-effort PII redactor — never perfect, but covers the high-value
 * cases (base58 wallet addresses, Solana signatures). Extend as new
 * shapes appear in crash reports.
 */
const BASE58_PUBKEY_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

function scrub<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(BASE58_PUBKEY_RE, "[redacted]") as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Initialize Sentry once. Safe to call multiple times; subsequent calls
 * no-op. Resolves immediately when no DSN is configured.
 */
export async function initTelemetry(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const Sentry = await loadSentry();
  if (!Sentry) return;

  const dsn = getDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Low sample rate — hackathon MVP, not a paying customer. Raise
    // once we have real usage + a paying tier.
    tracesSampleRate: 0.1,
    // Send replays for errors only, never for happy-path sessions.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      try {
        return scrub(event);
      } catch {
        return event;
      }
    },
    integrations: [],
  });
}

/**
 * Explicit capture point for catch blocks. The user already sees a
 * friendly error via ErrorCard / toast; this sends the raw stack to
 * Sentry so we can debug without asking for reproduction.
 */
export function captureError(err: unknown, context?: string): void {
  void (async () => {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    try {
      if (context) Sentry.setTag("context", context);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    } catch {
      /* telemetry must never throw */
    }
  })();
}
