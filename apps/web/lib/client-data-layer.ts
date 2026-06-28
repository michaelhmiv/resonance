'use client';

import {
  type DataLayer,
  type SaveHighlightInput,
  type UpdateHighlightPatch,
  type Translation,
  type BookSummary,
  type VersePassage,
  type PassageHit,
  type SearchScope,
  type LibraryPackage,
  type LibraryBook,
  type LibraryPassage,
  type JournalSegment,
  type Highlight,
  type Bookmark,
  type ResonanceResult,
  type EntryCluster,
  type WeeklyRoundup,
  type ShiftReport,
  type CalendarDay,
  type ReflectionPrompt,
  type EmbeddingModelId,
  cacheGetEntry,
  cacheSet,
  cacheSetEntry,
  cacheDelete,
  cacheClear,
  ttlFor,
  getCachedSync,
} from '@resonance/core';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// ── Client-side cache (shared via @resonance/core/http-cache) ──────────────
//
// Goal: eliminate the network waterfall on tab switches. The same data is
// requested every time you tap a tab (verse-of-day, books list, settings,
// reading events, journal entries). These are slow-changing — books don't
// change at all, verse-of-day changes daily, settings change when the user
// edits them, etc.
//
// Strategy: stale-while-revalidate with inflight dedup.
//   1. If we have a fresh cached entry, return it immediately and skip the
//      network call.
//   2. If the entry is stale, return it immediately AND fire a background
//      refresh (the screen will get fresh data on its next render trigger).
//   3. If multiple callers ask for the same URL while a request is in
//      flight, they all share the same Promise (no duplicate fetches).
//
// Mutation paths (POST/PUT/DELETE) bypass the cache entirely.
//
// The cache Map is module-scoped and shared with screen components via
// getCachedSync() so useState lazy initializers can paint content on the
// first render (no spinner flash on warm tab returns).
//
// All cache primitives live in @resonance/core/http-cache. This file just
// orchestrates the SWR flow.

/** Internal: actually perform the network call and update the cache. */
async function _fetchAndStore<T>(path: string, init?: RequestInit): Promise<T> {
  const value = await api<T>(path, init);
  const ttl = ttlFor(path);
  if (ttl > 0) {
    cacheSet(path, value, ttl);
  }
  return value;
}

/**
 * Cached fetch with SWR semantics. Only caches GETs.
 *
 * Callers should not assume a "fresh" network roundtrip — if cached data is
 * available, this returns it immediately and may refresh in the background.
 * For mutations (POST/PUT/DELETE), pass through to `api` directly.
 */
export function cachedApi<T>(path: string, init?: RequestInit): Promise<T> {
  const isRead = !init?.method || init.method === 'GET';
  if (!isRead || ttlFor(path) === 0) {
    return api<T>(path, init);
  }
  const now = Date.now();
  const existing = cacheGetEntry<T>(path);

  // 1. Fresh cache hit — return immediately.
  if (existing && existing.expiresAt > now && !existing.inflight) {
    return Promise.resolve(existing.value);
  }

  // 2. Stale cache hit — return cached value, refresh in background.
  if (existing && existing.value != null && !existing.inflight) {
    const stale = existing.value;
    const inflight = _fetchAndStore<T>(path, init).catch(err => {
      // If refresh fails, keep serving the stale value.
      console.warn(`[cache] background refresh failed for ${path}:`, err);
      throw err;
    });
    cacheSetEntry(path, { value: stale, expiresAt: 0, inflight: inflight as Promise<unknown> });
    // Resolve the original call with stale; the inflight is best-effort.
    void inflight;
    return Promise.resolve(stale);
  }

  // 3. Cache miss — fetch fresh. Dedupe concurrent calls.
  if (existing?.inflight) {
    return existing.inflight;
  }
  const inflight = _fetchAndStore<T>(path, init);
  // Sentinel entry so concurrent callers dedup. The real entry is written
  // when _fetchAndStore resolves.
  cacheSetEntry(path, { value: undefined as T, expiresAt: 0, inflight: inflight as Promise<unknown> });
  return inflight;
}

// Re-export shared cache primitives so existing callers in this file
// (and any future ones) can reach them.
export const invalidateCache = cacheDelete;
export const _clearCacheForTests = cacheClear;
export { getCachedSync };

function bibleBookId(bookName: string, translation: Translation): string {
  return `${translation}_${bookName.replace(/\s+/g, '_')}`;
}

function scriptureRef(bookName: string, chapter: number | null, verseStart: number | null, verseEnd: number | null): string {
  const ref = `${bookName} ${chapter ?? ''}:${verseStart ?? ''}`;
  return verseEnd != null && verseEnd !== verseStart ? `${ref}-${verseEnd}` : ref.trim();
}

interface WebBookRow {
  id: string;
  name: string;
  testament: 'OT' | 'NT';
  order: number;
  translation: string;
  chapterCount: number;
  chapters: number[];
}

interface WebSearchRow {
  id: number;
  book: string | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  text: string;
  translation: string | null;
  type: 'scripture' | 'library';
  source: string | null;
}

interface WebLibraryBookRow {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  source?: string | null;
  packageId: string;
  packageLabel: string;
  enabled: boolean;
}

export class WebDataLayer implements DataLayer {
  async getBooks(translation: Translation): Promise<BookSummary[]> {
    const data = await cachedApi<{ books: WebBookRow[] }>(`/api/bible/books?translation=${translation.toLowerCase()}`);
    return data.books.map((b) => ({
      name: b.name,
      testament: b.testament,
      order: b.order,
      available: b.chapterCount > 0,
      bookId: bibleBookId(b.name, translation),
    }));
  }

  async getChapters(bookName: string, translation: Translation): Promise<number[]> {
    const data = await cachedApi<{ books: WebBookRow[] }>(`/api/bible/books?translation=${translation.toLowerCase()}`);
    return data.books.find((b) => b.name === bookName)?.chapters ?? [];
  }

  async getVerses(bookName: string, chapter: number, translation: Translation): Promise<VersePassage[]> {
    const data = await api<{ verses: { id: number; verseStart: number; verseEnd: number; text: string }[] }>(
      `/api/bible/chapter?book=${encodeURIComponent(bookName)}&chapter=${chapter}&translation=${translation.toLowerCase()}`,
    );
    return data.verses.map((v) => ({
      id: v.id,
      book_id: bibleBookId(bookName, translation),
      chapter,
      verse_start: v.verseStart,
      verse_end: v.verseEnd,
      text: v.text,
      translation,
      chunk_id: null,
    }));
  }

  async searchPassages(query: string, scope: SearchScope): Promise<PassageHit[]> {
    const data = await api<{ results: WebSearchRow[] }>(`/api/bible/search?q=${encodeURIComponent(query)}&scope=${scope}`);
    return data.results.map((r) => ({
      id: r.id,
      book_id: r.translation ? bibleBookId(r.book ?? '', r.translation.toUpperCase() as Translation) : r.book ?? '',
      chapter: r.chapter,
      verse_start: r.verseStart,
      verse_end: r.verseEnd,
      text: r.text,
      translation: r.translation ? r.translation.toUpperCase() : null,
      source: r.translation
        ? `${scriptureRef(r.book ?? '', r.chapter, r.verseStart, r.verseEnd)} (${r.translation.toUpperCase()})`
        : [r.source, r.book].filter(Boolean).join(' — '),
    }));
  }

  async getLibraryPackages(): Promise<LibraryPackage[]> {
    const data = await cachedApi<{ books: WebLibraryBookRow[]; mode: 'all' | 'none' | 'subset' }>('/api/library/books');
    const byPackage = new Map<string, LibraryPackage>();

    for (const book of data.books) {
      const packageId = book.packageId;
      const existing = byPackage.get(packageId) ?? {
        package_id: packageId,
        label: book.packageLabel,
        books: [],
      };
      existing.books.push({
        id: book.id,
        title: book.title,
        author: book.author,
        era: book.era,
        package_id: packageId,
      });
      byPackage.set(packageId, existing);
    }

    return Array.from(byPackage.values()).sort((a, b) => a.package_id.localeCompare(b.package_id));
  }

  async getLibraryBookPrefs(): Promise<{
    books: Array<{
      id: string;
      title: string | null;
      author: string | null;
      era: string | null;
      packageId: string;
      packageLabel: string;
      enabled: boolean;
    }>;
    mode: 'all' | 'none' | 'subset';
  }> {
    return api<{
      books: Array<{
        id: string;
        title: string | null;
        author: string | null;
        era: string | null;
        packageId: string;
        packageLabel: string;
        enabled: boolean;
      }>;
      mode: 'all' | 'none' | 'subset';
    }>('/api/library/books');
  }

  /**
   * @deprecated Wrapper for getLibraryBookPrefs. Aggregates the per-book
   * enabled set into a per-package view for any caller that still wants it.
   */
  async getLibraryPackagePrefs(): Promise<{
    installed: Array<{ packageId: string; label: string; bookCount: number; enabled: boolean }>;
    mode: 'all' | 'none' | 'subset';
  }> {
    const prefs = await this.getLibraryBookPrefs();
    const byPackage = new Map<string, { bookCount: number; anyEnabled: boolean }>();
    for (const b of prefs.books) {
      const cur = byPackage.get(b.packageId) ?? { bookCount: 0, anyEnabled: false };
      cur.bookCount += 1;
      if (b.enabled) cur.anyEnabled = true;
      byPackage.set(b.packageId, cur);
    }
    const installed = [...byPackage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([packageId, agg]) => ({
        packageId,
        label: prefs.books.find((b) => b.packageId === packageId)?.packageLabel ?? packageId,
        bookCount: agg.bookCount,
        // Package is "enabled" if every book in it is enabled
        enabled: prefs.mode === 'all' || (prefs.mode !== 'none' && agg.anyEnabled),
      }));
    return { installed, mode: prefs.mode };
  }

  async setLibraryBookEnabled(bookId: string, enabled: boolean): Promise<{ enabledList: string[] }> {
    return api<{ bookId: string; enabled: boolean; enabledList: string[] }>(
      `/api/library/books/${encodeURIComponent(bookId)}`,
      { method: 'PUT', body: JSON.stringify({ enabled }) },
    ).then((r) => ({ enabledList: r.enabledList }));
  }

  /**
   * @deprecated Wraps setLibraryBookEnabled. Re-enables every book in
   * the given package, which is a no-op if the user is already in 'all'
   * mode or already has every book in the package enabled.
   */
  async setLibraryPackageEnabled(packageId: string, enabled: boolean): Promise<{ enabledList: string[] }> {
    const prefs = await this.getLibraryBookPrefs();
    const booksInPkg = prefs.books.filter((b) => b.packageId === packageId);
    let last: { enabledList: string[] } = { enabledList: [] };
    for (const b of booksInPkg) {
      if (b.enabled !== enabled) {
        last = await this.setLibraryBookEnabled(b.id, enabled);
      }
    }
    return last;
  }

  async resetLibraryBooks(): Promise<void> {
    // No dedicated reset endpoint; toggle every book on to clear the subset
    // list. The server's `toggleEnabledVoiceBook` treats a no-op (already
    // enabled) as a no-op write, so this just exits 'subset' mode.
    const prefs = await this.getLibraryBookPrefs();
    for (const book of prefs.books) {
      if (!book.enabled) {
        await this.setLibraryBookEnabled(book.id, true);
      }
    }
  }

  /**
   * @deprecated Wraps resetLibraryBooks.
   */
  async resetLibraryPackages(): Promise<void> {
    return this.resetLibraryBooks();
  }

  async getLibraryBook(bookId: string): Promise<LibraryBook | null> {
    const packages = await this.getLibraryPackages();
    for (const pkg of packages) {
      const found = pkg.books.find((book) => book.id === bookId);
      if (found) return found;
    }
    return null;
  }

  async getLibraryPassages(bookId: string): Promise<LibraryPassage[]> {
    const data = await api<{ passages: LibraryPassage[] }>(`/api/library/passages?bookId=${encodeURIComponent(bookId)}`);
    return data.passages;
  }

  async loadSegments(): Promise<JournalSegment[]> {
    const data = await cachedApi<{ entries: { id: string; text: string; created_at: number; updated_at?: number }[] }>('/api/journal/entries');
    return data.entries
      .slice()
      .map((entry, index) => {
        const ts = (val: unknown): number =>
          typeof val === 'number' ? val * 1000 : typeof val === 'string' ? new Date(val).getTime() : Date.now();
        const createdMs = ts(entry.created_at);
        const updatedMs = ts(entry.updated_at ?? entry.created_at);
        return {
          id: entry.id,
          created_at: createdMs,
          updated_at: updatedMs,
          segment_type: 'text' as const,
          text: entry.text,
          position_index: index,
          parent_date: new Date(createdMs).toISOString().slice(0, 10),
        };
      });
  }

  async saveSegment(segment: JournalSegment): Promise<void> {
    if (segment.segment_type !== 'text') return;
    // NOTE: id is omitted — Supabase journal_entries.id is UUID type.
    // Client-generated string IDs (e.g. "1750834593-k4jf8x2a") are rejected.
    // Let Supabase auto-generate the UUID; the response includes it.
    const entry = await api<{ id: string; text: string; created_at: string; updated_at: string }>(
      '/api/journal/entries',
      {
        method: 'POST',
        body: JSON.stringify({
          text: segment.text ?? '',
          created_at: Math.floor(segment.created_at / 1000),
          updated_at: Math.floor(segment.updated_at / 1000),
        }),
      },
    );
    // Invalidate cached journal list so the next loadSegments() call gets
    // the new entry.
    invalidateCache('/api/journal/entries');
    // Return the server-generated UUID so the caller can update optimistic state
    return entry as unknown as void;
  }

  async deleteSegment(id: string): Promise<void> {
    await fetch(`/api/journal/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    invalidateCache('/api/journal/entries');
  }

  async getHighlightsForRefs(refs: string[]): Promise<Highlight[]> {
    if (refs.length === 0) return [];
    const prefix = refs[0].replace(/:\d+.*$/, '');
    const data = await cachedApi<{ highlights: Highlight[] }>(`/api/reading/highlights?verseRef=${encodeURIComponent(prefix)}`);
    const wanted = new Set(refs);
    return (data.highlights || []).filter((h) => wanted.has(h.verse_ref));
  }

  async saveHighlight(input: SaveHighlightInput): Promise<Highlight> {
    const created = await api<Highlight>('/api/reading/highlights', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    invalidateCache('/api/reading/highlights');
    return created;
  }

  async updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight> {
    const updated = await api<Highlight>(`/api/reading/highlights/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    invalidateCache('/api/reading/highlights');
    return updated;
  }

  async deleteHighlight(id: string): Promise<void> {
    await fetch(`/api/reading/highlights/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    invalidateCache('/api/reading/highlights');
  }

  async saveBookmark(verseRef: string, label?: string): Promise<void> {
    await api('/api/reading/bookmarks', { method: 'POST', body: JSON.stringify({ verseRef, label }) });
  }

  async removeBookmark(verseRef: string): Promise<void> {
    const data = await api<{ bookmarks: { id: string; verse_ref: string }[] }>('/api/reading/bookmarks');
    const existing = data.bookmarks.find((b) => b.verse_ref === verseRef);
    if (existing) await fetch(`/api/reading/bookmarks/${existing.id}`, { method: 'DELETE' });
  }

  async getBookmarks(): Promise<Bookmark[]> {
    const data = await api<{ bookmarks: Bookmark[] }>('/api/reading/bookmarks');
    return data.bookmarks;
  }

  async getCrossReferences(verseRef: string): Promise<string[]> {
    const data = await api<{ refs: string[] }>(`/api/bible/cross-refs?ref=${encodeURIComponent(verseRef)}`);
    return data.refs;
  }

  async getCrossReferencesBatch(refs: string[]): Promise<Record<string, string[]>> {
    if (refs.length === 0) return {};
    const data = await api<{ refs: Record<string, string[]> }>('/api/bible/cross-refs', {
      method: 'POST',
      body: JSON.stringify({ refs }),
    });
    return data.refs;
  }

  async findResonance(journalText: string, segmentId?: string): Promise<ResonanceResult | null> {
    if (journalText.trim().length < 3) return null;

    // ── Single-request resonance: server handles cache + embed + search ──
    // Server checks Supabase cache first (if sourceId provided), then falls
    // back to server-side embed + HNSW search. One call handles everything.
    const body: Record<string, unknown> = { text: journalText };
    if (segmentId) body.sourceId = segmentId;

    const data = await api<ResonanceResult>('/api/resonance', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return data;
  }

  async storeSegmentVector(_segmentId: string, _text: string): Promise<void> {
    // Web resonance is server-side. Segment vectors are persisted once the
    // cloud/Supabase DataLayer replaces the temporary JSON store.
  }

  async appendQuoteToJournal(quote: string, source: string): Promise<void> {
    const formatted = `"${quote}"\n\n— ${source}`;
    await api('/api/journal/entries', {
      method: 'POST',
      body: JSON.stringify({ text: formatted }),
    });
  }

  async findVerseEchoes(verseText: string, verseRef?: string): Promise<{ count: number; entryIds: string[]; concepts: string[] }> {
    if (verseText.trim().length < 4) return { count: 0, entryIds: [], concepts: [] };
    try {
      return await api<{ count: number; entryIds: string[]; concepts: string[] }>('/api/journal/verse-echoes', {
        method: 'POST',
        body: JSON.stringify({ verseText, verseRef }),
      });
    } catch {
      return { count: 0, entryIds: [], concepts: [] };
    }
  }

  async recordReadingEvent(bookId: string, chapter: number, verseRef: string, timestamp: number): Promise<void> {
    await api('/api/reading/events', {
      method: 'POST',
      body: JSON.stringify({ bookId, chapter, verseRef, timestamp }),
    });
    // Reading events feed both getReadingHistory and the patterns page. The
    // user just changed state — invalidate so the next read returns fresh data.
    invalidateCache('/api/reading/events');
  }

  async getReadingHistory(startDate: string, endDate: string): Promise<{ date: string; count: number }[]> {
    const data = await cachedApi<{ events: { date: string; count: number }[] }>(
      `/api/reading/events?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`
    );
    return data.events || [];
  }

  async getLastReadPosition(): Promise<{ bookId: string; chapter: number; verseRef: string } | null> {
    try {
      const data = await cachedApi<{ position: { bookId: string; chapter: number; verseRef: string } | null }>('/api/reading/events?last=1');
      return data.position ?? null;
    } catch {
      return null;
    }
  }

  async clusterEntries(segments: JournalSegment[]): Promise<EntryCluster[]> {
    const textSegments = segments.filter((s) => s.segment_type === 'text' && (s.text ?? '').trim().length > 12);
    const byWord = new Map<string, JournalSegment[]>();
    const stop = new Set(['the','and','that','with','from','this','have','will','your','you','are','was','were','for','but','not','feel','feeling','really','just']);
    for (const seg of textSegments) {
      const words = (seg.text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4 && !stop.has(w));
      for (const word of new Set(words.slice(0, 30))) {
        const bucket = byWord.get(word) ?? [];
        bucket.push(seg);
        byWord.set(word, bucket);
      }
    }
    return Array.from(byWord.entries())
      .filter(([, bucket]) => bucket.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([label, bucket], index) => ({
        id: `cluster-${index}-${label}`,
        label,
        entryCount: bucket.length,
        excerpts: bucket.slice(0, 3).map((s) => s.text ?? ''),
        dateRange: { start: bucket[0]?.parent_date ?? '', end: bucket[bucket.length - 1]?.parent_date ?? '' },
      }));
  }

  async generateWeeklyRoundup(segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup> {
    const weekStartMs = new Date(`${weekStart}T00:00:00Z`).getTime();
    const weekEndMs = weekStartMs + 7 * 86400000;
    const week = segments.filter((s) => s.created_at >= weekStartMs && s.created_at < weekEndMs && s.segment_type === 'text' && (s.text ?? '').trim());
    const excerpt = week.slice().sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0))[0]?.text?.slice(0, 200) ?? '';
    const clusters = await this.clusterEntries(week);
    return { weekStart, entryCount: week.length, themes: clusters.map((c) => c.label).slice(0, 5), excerpt };
  }

  async generateShiftReport(_segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport> {
    return { comparisonDate: new Date().toISOString().slice(0, 10), period1Start: p1Start, period2Start: p2Start, narrative: null };
  }

  async getCalendarDays(segments: JournalSegment[], year: number, month: number): Promise<CalendarDay[]> {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const count = segments.filter((s) => s.parent_date === date && s.segment_type === 'text' && (s.text ?? '').trim()).length;
      return { date, hasEntries: count > 0, entryCount: count };
    });
  }

  async generateReflectionPrompt(excerpts: string[]): Promise<ReflectionPrompt | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'reflection_prompt', excerpts }) });
    return data.text ? { prompt: data.text, generatedAt: Date.now() } : null;
  }

  async generateClusterLabel(excerpts: string[]): Promise<string | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'cluster_label', excerpts }) });
    return data.text ?? null;
  }

  async generateShiftNarrative(p1Excerpts: string[], p2Excerpts: string[]): Promise<string | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'shift_narrative', period1Excerpts: p1Excerpts, period2Excerpts: p2Excerpts }) });
    return data.text ?? null;
  }
  // Embedding model is now server-managed. Web uses the single online model.
  async getActiveEmbeddingModel(): Promise<EmbeddingModelId> { return 'gte-small' as EmbeddingModelId; /* legacy, unused server-side */ }
  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> { /* no-op on web */ }
  async getSettings(): Promise<Record<string, string>> {
    try {
      const data = await cachedApi<Record<string, string>>('/api/settings');
      return data || {};
    } catch { return {}; }
  }
}
