/**
 * Browser-side HTTP cache for the web app.
 *
 * Used by WebDataLayer (`apps/web/lib/client-data-layer.ts`) to dedupe and
 * serve hot-path GETs without a network roundtrip. Lives in @resonance/core
 * so screen components can also peek at it synchronously via
 * `getCachedSync()` for `useState` lazy initializers.
 *
 * Mobile: a no-op — the mobile data layer uses SQLite, not HTTP. The cache
 * primitives are still safe to import; the Map is per-tab and stays empty.
 *
 * Server-side: should never reach this. Anything that runs during SSR or
 * API routes uses the Supabase client directly, not `cachedApi`.
 */

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  inflight?: Promise<T>;
}

const cache = new Map<string, CacheEntry>();

/** Per-path TTLs. Hot-path GETs only. Mutations pass through. */
export const TTL_MS: Record<string, number> = {
  '/api/bible/books':         5 * 60_000,
  '/api/bible/verse-of-day':  5 * 60_000,
  '/api/settings':            60_000,
  '/api/reading/events':      30_000,
  '/api/reading/highlights':  60_000,
  '/api/reading/bookmarks':   60_000,
  '/api/journal/entries':     30_000,
  '/api/embeddings/status':   30_000,
  '/api/vectors/status':      30_000,
  '/api/packages':            5 * 60_000,
  '/api/library/books':       5 * 60_000,
};

export function ttlFor(path: string): number {
  for (const [prefix, ttl] of Object.entries(TTL_MS)) {
    if (path === prefix || path.startsWith(prefix + '?') || path.startsWith(prefix + '/')) {
      return ttl;
    }
  }
  return 0;
}

export function getCachedSync<T>(path: string): T | null {
  if (typeof window === 'undefined') return null; // never on server
  const existing = cache.get(path);
  if (existing && existing.value != null && !existing.inflight) {
    return existing.value as T;
  }
  return null;
}

export function cacheSet<T>(path: string, value: T, ttl: number): void {
  if (typeof window === 'undefined') return;
  if (ttl > 0) {
    cache.set(path, { value, expiresAt: Date.now() + ttl });
  }
}

export function cacheGetEntry<T>(path: string): CacheEntry<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  return cache.get(path) as CacheEntry<T> | undefined;
}

export function cacheSetEntry(path: string, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  cache.set(path, entry);
}

export function cacheDelete(path: string): void {
  if (typeof window === 'undefined') return;
  for (const key of Array.from(cache.keys())) {
    if (key === path || key.startsWith(path + '?') || key.startsWith(path + '/')) {
      cache.delete(key);
    }
  }
}

export function cacheClear(): void {
  if (typeof window === 'undefined') return;
  cache.clear();
}
