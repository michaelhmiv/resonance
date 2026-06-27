/**
 * user-vector-store.ts — Zone B: per-user in-memory vector cache.
 *
 * Caches user highlight embeddings in-process so that resonance
 * requests don't hit Supabase for user data on every call.
 *
 * Auto-sync: mutations (highlights added/removed) invalidate the
 * cache for that user, so the next resonance request pulls fresh data.
 * This is the "zero-tinker" guarantee for user content: no manual
 * cache busting, no stale data.
 *
 * Memory: ~2 MB per user (typical: 50–200 highlights × 2560 floats × 4 bytes).
 * Only active users are cached; entries expire after 10 min TTL.
 */

import { getUserHighlightEmbeddings } from './db';
import { incCounter, setGauge, recordEvent } from './resonance-metrics';

interface UserCacheEntry {
  vectors: number[][];
  /** Fingerprint: vector count + first element of first vector (if any).
   *  Changes whenever highlights are added or removed. */
  fingerprint: string;
  fetchedAt: number; // Date.now() at fetch time
}

// ── In-memory store ──────────────────────────────────────────────────────────
const store = new Map<string, UserCacheEntry>();

/** TTL: 10 minutes. After this, next access re-fetches from Supabase. */
const CACHE_TTL_MS = 10 * 60 * 1000;

// ── Fingerprint ──────────────────────────────────────────────────────────────

function computeFingerprint(vectors: number[][]): string {
  if (vectors.length === 0) return 'empty';
  // count + first value of first vector — fast, catches additions/removals
  const first = vectors[0];
  return `${vectors.length}:${first[0] ?? 'blank'}:${first[first.length - 1] ?? ''}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get cached highlight embeddings for a user.
 * Returns from memory if fresh; re-fetches from Supabase if stale or missing.
 */
export async function getCachedUserEmbeddings(
  userId: string,
): Promise<number[][]> {
  const entry = store.get(userId);

  // Cache hit + not expired
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    incCounter('resonance.user_vector_cache_hits');
    return entry.vectors;
  }

  // Cache miss or expired: fetch from Supabase
  incCounter('resonance.user_vector_cache_misses');
  const vectors = await getUserHighlightEmbeddings(userId);
  const fingerprint = computeFingerprint(vectors);

  store.set(userId, {
    vectors,
    fingerprint,
    fetchedAt: Date.now(),
  });

  return vectors;
}

/**
 * Check if cached data is still consistent with Supabase.
 * Re-fetches vectors and compares fingerprint; if different, updates cache.
 * Returns true if the cache was stale (and is now refreshed).
 */
export async function checkAndRefreshIfStale(
  userId: string,
): Promise<boolean> {
  const entry = store.get(userId);
  if (!entry) return false; // not cached = not stale

  // Not expired yet — skip the check
  if (Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return false;
  }

  // TTL expired: re-fetch and compare fingerprint
  const freshVectors = await getUserHighlightEmbeddings(userId);
  const freshFp = computeFingerprint(freshVectors);

  if (freshFp !== entry.fingerprint) {
    // Data changed — update cache
    incCounter('resonance.user_vector_stale_refreshes');
    recordEvent('user_vector_stale', `userId=${userId} oldFp=${entry.fingerprint} newFp=${freshFp}`);
    store.set(userId, {
      vectors: freshVectors,
      fingerprint: freshFp,
      fetchedAt: Date.now(),
    });
    return true; // was stale, now refreshed
  }

  // Same data — just refresh TTL
  entry.fetchedAt = Date.now();
  return false;
}

/**
 * Invalidate cache for a specific user.
 * Call this when a highlight is added, removed, or edited.
 */
export function invalidateUser(userId: string): void {
  store.delete(userId);
}

/**
 * Invalidate all user caches.
 * Call this on server boot or when global data changes.
 */
export function invalidateAllUsers(): void {
  store.clear();
}

// ── Metrics ──────────────────────────────────────────────────────────────────
export function getCacheStats(): {
  usersCached: number;
  totalVectors: number;
  memoryEstimateMB: number;
} {
  let totalVectors = 0;
  const entries = Array.from(store.values());
  for (const entry of entries) {
    totalVectors += entry.vectors.length;
  }
  // 2560 dims × 8 bytes (JS number) per vector element (rough upper bound)
  const bytesEstimate = totalVectors * 2560 * 8;
  return {
    usersCached: store.size,
    totalVectors,
    memoryEstimateMB: Math.round(bytesEstimate / 1024 / 1024),
  };
}
