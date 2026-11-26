import type {
  DataLayer,
  SaveHighlightInput,
  UpdateHighlightPatch,
  Highlight,
  Translation,
  SearchScope,
  SearchMode,
  PassageHit,
  InBookSearchHit,
  ReadingProgress,
  JournalSegment,
  ResonanceResult,
  EntryCluster,
  WeeklyRoundup,
  ShiftReport,
  CalendarDay,
  PatternTimeframe,
  PatternsSummary,
  PatternDayDetail,
  BookBridgeResult,
  PatternFeedbackInput,
  ReflectionPrompt,
  EmbeddingModelId,
} from '@resonance/core';
import { reconstructBookDocument, searchBlocksKeyword } from '@resonance/core';
import { getDatabase } from '../db/database';
import { getBooks, getChapters, getVerses, searchPassages } from '../db/queries/bibleQueries';
import {
  getLibraryPackages,
  getLibraryBook,
  getLibraryPassages,
  getPersonalWorks,
  updatePersonalWorkMetadata,
  deletePersonalWork,
} from '../db/queries/libraryQueries';
import type { PersonalWorkMetadataPatch } from '@resonance/core';
import {
  getFullHighlightsForRefs,
  getHighlightsForBook,
  getAllFullHighlights,
  saveFullHighlight,
  updateFullHighlight,
  deleteFullHighlightById,
  saveBookmark,
  removeBookmark,
  getBookmarks,
  getCrossReferences,
  getCrossReferencesBatch,
  getReadingProgress,
  saveReadingProgress,
} from '../db/queries/readingQueries';
import { useSettingsStore } from '../settings/settingsStore';
import {
  findResonance,
  findPassageEchoes,
  searchInBookSemantic,
  searchLibrarySemantic,
  storeSegmentVector,
} from '../embedding/resonanceService';
import {
  syncHighlightToResonance,
  removeHighlightFromResonance,
} from '../embedding/highlightEmbeddingService';
import {
  clusterEntries,
  generateWeeklyRoundup,
  generateShiftReport,
  getCalendarDays,
} from '../embedding/patternsService';
import {
  getOfflinePatternsSummary,
  getOfflinePatternDayDetail,
  getOfflineBookBridges,
  recordOfflinePatternFeedback,
} from '../embedding/offlinePatternsStore';
import {
  generateReflectionPrompt,
  generateClusterLabel,
  generateShiftNarrative,
} from '../embedding/reflectionService';

export class MobileDataLayer implements DataLayer {
  async getBooks(translation: Translation) {
    return getBooks(translation);
  }

  async getChapters(bookName: string, translation: Translation) {
    return getChapters(bookName, translation);
  }

  async getVerses(bookName: string, chapter: number, translation: Translation) {
    return getVerses(bookName, chapter, translation);
  }

  async searchPassages(query: string, scope: SearchScope) {
    return searchPassages(query, scope);
  }

  async searchPassagesHybrid(
    query: string,
    scope: SearchScope,
    mode: SearchMode = 'hybrid',
    options?: { bookId?: string; limit?: number }
  ): Promise<PassageHit[]> {
    const limit = options?.limit ?? 60;
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (mode === 'keyword') {
      return searchPassages(trimmed, scope, options);
    }

    const semanticRaw = await searchLibrarySemantic(trimmed, scope, limit);
    const semanticHits: PassageHit[] = semanticRaw.map((m) => {
      const refMatch = m.translation ? /^(.+?)\s+(\d+):(\d+)/.exec(m.source) : null;
      return {
        id: m.passageId,
        book_id: m.bookId,
        chapter: refMatch ? parseInt(refMatch[2], 10) : null,
        verse_start: refMatch ? parseInt(refMatch[3], 10) : null,
        verse_end: refMatch ? parseInt(refMatch[3], 10) : null,
        text: m.text,
        translation: m.translation,
        source: m.source,
        score: m.similarity,
        matchKind: m.library === 'highlight' ? 'highlight' : 'semantic',
        highlightNote: m.highlightNote ?? null,
        highlightColor: m.highlightColor ?? null,
        highlightId: m.highlightId ?? null,
      };
    });

    if (mode === 'semantic') {
      return semanticHits.length > 0
        ? semanticHits.slice(0, limit)
        : searchPassages(trimmed, scope, options);
    }

    // Hybrid: Reciprocal Rank Fusion (RRF, k = 45) of keyword + semantic lists
    const keywordHits = await searchPassages(trimmed, scope, { ...options, limit });
    if (semanticHits.length === 0) return keywordHits;

    const RRF_K = 45;
    const fused = new Map<string, { hit: PassageHit; score: number; fromKw: boolean; fromSem: boolean }>();

    const keyFor = (h: PassageHit) =>
      h.highlightId ? `hl:${h.highlightId}` : `${h.book_id}:${h.id}:${h.chapter ?? ''}:${h.verse_start ?? ''}`;

    keywordHits.forEach((hit, rank) => {
      const k = keyFor(hit);
      const rrf = 1 / (RRF_K + rank + 1);
      fused.set(k, { hit, score: rrf, fromKw: true, fromSem: false });
    });

    semanticHits.forEach((hit, rank) => {
      const k = keyFor(hit);
      const rrf = 1.15 / (RRF_K + rank + 1);
      const existing = fused.get(k);
      if (existing) {
        existing.score += rrf;
        existing.fromSem = true;
        existing.hit = {
          ...existing.hit,
          matchKind: existing.hit.matchKind === 'highlight' ? 'highlight' : 'hybrid',
        };
      } else {
        fused.set(k, { hit, score: rrf, fromKw: false, fromSem: true });
      }
    });

    return Array.from(fused.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => ({ ...entry.hit, score: entry.score }));
  }

  async searchInBook(
    bookId: string,
    query: string,
    mode: 'keyword' | 'semantic' = 'keyword'
  ): Promise<InBookSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const passages = await getLibraryPassages(bookId);
    const doc = reconstructBookDocument(bookId, passages);

    if (mode === 'keyword') {
      return searchBlocksKeyword(doc.blocks, doc.chapters, trimmed);
    }

    const semHits = await searchInBookSemantic(bookId, trimmed, 30);
    if (semHits.length === 0) {
      return searchBlocksKeyword(doc.blocks, doc.chapters, trimmed);
    }

    const blockByPassageId = new Map<number, (typeof doc.blocks)[number]>();
    for (const blk of doc.blocks) {
      if (blk.passageId != null && !blockByPassageId.has(blk.passageId)) {
        blockByPassageId.set(blk.passageId, blk);
      }
    }

    const mapped: InBookSearchHit[] = [];
    for (const hit of semHits) {
      const blk = blockByPassageId.get(hit.passageId);
      if (!blk) continue;
      const chTitle = doc.chapters[blk.chapterIndex]?.title ?? blk.division ?? `Section ${blk.chapterIndex + 1}`;
      mapped.push({
        blockId: blk.id,
        anchorRef: blk.anchorRef,
        passageId: hit.passageId,
        chapterIndex: blk.chapterIndex,
        chapterTitle: chTitle,
        blockIndex: blk.blockIndex,
        snippet: blk.text.slice(0, 140) + (blk.text.length > 140 ? '…' : ''),
        matchStart: 0,
        matchEnd: 0,
        score: hit.similarity,
        mode: 'semantic',
      });
    }
    return mapped;
  }

  async getLibraryPackages() {
    return getLibraryPackages();
  }

  /**
   * Mobile free-tier stub: returns all books as enabled, mode 'all'.
   * Free-tier users always see the full catalog (no per-device opt-in).
   * When the user upgrades to premium and signs in, the cloud-backed
   * per-book prefs will take over.
   */
  async getLibraryBookPrefs() {
    const packages = await getLibraryPackages();
    const books = packages.flatMap((p) =>
      p.books.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        era: b.era,
        packageId: p.package_id,
        packageLabel: p.label,
        enabled: true,
      })),
    );
    return { books, mode: 'all' as const };
  }

  /** @deprecated Wraps getLibraryBookPrefs. Aggregates per-book into per-package. */
  async getLibraryPackagePrefs() {
    const prefs = await this.getLibraryBookPrefs();
    const byPackage = new Map<string, { label: string; bookCount: number; anyEnabled: boolean }>();
    for (const b of prefs.books) {
      const cur = byPackage.get(b.packageId) ?? { label: b.packageLabel, bookCount: 0, anyEnabled: false };
      cur.bookCount += 1;
      if (b.enabled) cur.anyEnabled = true;
      byPackage.set(b.packageId, cur);
    }
    return {
      installed: [...byPackage.entries()].map(([packageId, agg]) => ({
        packageId,
        label: agg.label,
        bookCount: agg.bookCount,
        enabled: agg.anyEnabled,
      })),
      mode: prefs.mode,
    };
  }

  /** Free-tier stub: toggle is a no-op. */
  async setLibraryBookEnabled(_bookId: string, _enabled: boolean): Promise<{ enabledList: string[] }> {
    // No-op on free tier — settings persist only when the user has a cloud account.
    return { enabledList: [] };
  }

  /** @deprecated Wraps setLibraryBookEnabled; iterates books in the package. */
  async setLibraryPackageEnabled(packageId: string, enabled: boolean): Promise<{ enabledList: string[] }> {
    const prefs = await this.getLibraryBookPrefs();
    const books = prefs.books.filter((b) => b.packageId === packageId && b.enabled !== enabled);
    for (const b of books) {
      await this.setLibraryBookEnabled(b.id, enabled);
    }
    return { enabledList: [] };
  }

  /** Free-tier stub: reset is a no-op. */
  async resetLibraryBooks(): Promise<void> {
    // No-op on free tier.
  }

  /** @deprecated Wraps resetLibraryBooks. */
  async resetLibraryPackages(): Promise<void> {
    return this.resetLibraryBooks();
  }

  async getLibraryBook(bookId: string) {
    return getLibraryBook(bookId);
  }

  async getLibraryPassages(bookId: string) {
    return getLibraryPassages(bookId);
  }

  async getPersonalWorks() {
    return getPersonalWorks();
  }

  async updatePersonalWorkMetadata(bookId: string, patch: PersonalWorkMetadataPatch) {
    return updatePersonalWorkMetadata(bookId, patch);
  }

  async deletePersonalWork(bookId: string) {
    return deletePersonalWork(bookId);
  }

  async loadSegments(): Promise<JournalSegment[]> {
    const db = getDatabase();
    if (!db) return [];
    try {
      return await db.getAllAsync<JournalSegment>(
        `SELECT id, created_at, updated_at, segment_type, text, position_index, parent_date
         FROM journal_segments
         ORDER BY position_index ASC;`,
      );
    } catch {
      return [];
    }
  }

  async saveSegment(segment: JournalSegment): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO journal_segments
           (id, created_at, updated_at, segment_type, text, position_index, parent_date)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          segment.id,
          segment.created_at,
          segment.updated_at,
          segment.segment_type,
          segment.text,
          segment.position_index,
          segment.parent_date,
        ],
      );
    } catch {
      // best-effort
    }
  }

  async deleteSegment(id: string): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    try {
      await db.runAsync(`DELETE FROM journal_segments WHERE id = ?;`, [id]);
    } catch {
      // best-effort
    }
  }

  async getHighlightsForRefs(refs: string[]): Promise<Highlight[]> {
    return getFullHighlightsForRefs(refs);
  }

  async getBookHighlights(bookId: string): Promise<Highlight[]> {
    return getHighlightsForBook(bookId);
  }

  async getAllHighlights(options?: {
    color?: string;
    tag?: string;
    query?: string;
  }): Promise<Highlight[]> {
    return getAllFullHighlights(options);
  }

  async saveHighlight(input: SaveHighlightInput): Promise<Highlight> {
    const saved = await saveFullHighlight(input);
    // Fire-and-forget on-device embedding into highlight_vectors + resonance_nodes
    void syncHighlightToResonance(saved, 'created', {
      contextText: input.contextText,
      sourceLabel: input.sourceLabel,
    });
    return saved;
  }

  async updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight> {
    const updated = await updateFullHighlight(id, patch);
    void syncHighlightToResonance(updated, 'updated', {
      contextText: patch.contextText,
      sourceLabel: patch.sourceLabel,
    });
    return updated;
  }

  async deleteHighlight(id: string): Promise<void> {
    await deleteFullHighlightById(id);
    void removeHighlightFromResonance(id);
  }

  async saveBookmark(verseRef: string, label?: string) {
    return saveBookmark(verseRef, label);
  }

  async removeBookmark(verseRef: string) {
    return removeBookmark(verseRef);
  }

  async getBookmarks() {
    return getBookmarks();
  }

  async getCrossReferences(verseRef: string) {
    return getCrossReferences(verseRef);
  }

  async getCrossReferencesBatch(refs: string[]): Promise<Record<string, string[]>> {
    return getCrossReferencesBatch(refs);
  }

  async recordReadingEvent(bookId: string, chapter: number, verseRef: string, timestamp: number): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    try {
      const id = `read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await db.runAsync(
        `INSERT INTO reading_events (id, book_id, chapter, verse_ref, created_at) VALUES (?, ?, ?, ?, ?);`,
        [id, bookId, chapter, verseRef, timestamp || Date.now()],
      );
    } catch {
      // best-effort
    }
  }

  async getReadingHistory(startDate: string, endDate: string): Promise<{ date: string; count: number }[]> {
    const db = getDatabase();
    if (!db) return [];
    try {
      const rows = await db.getAllAsync<{ created_at: number }>(`SELECT created_at FROM reading_events;`);
      const byDate = new Map<string, number>();
      for (const r of rows) {
        const ms = r.created_at > 10_000_000_000 ? r.created_at : r.created_at * 1000;
        const d = new Date(ms).toISOString().slice(0, 10);
        if (d >= startDate && d <= endDate) {
          byDate.set(d, (byDate.get(d) ?? 0) + 1);
        }
      }
      return Array.from(byDate.entries()).map(([date, count]) => ({ date, count }));
    } catch {
      return [];
    }
  }

  async getLastReadPosition(): Promise<{ bookId: string; chapter: number; verseRef: string } | null> {
    const db = getDatabase();
    if (!db) return null;
    try {
      const row = await db.getFirstAsync<{ book_id: string; chapter: number; verse_ref: string }>(
        `SELECT book_id, chapter, verse_ref FROM reading_events ORDER BY created_at DESC LIMIT 1;`,
      );
      return row ? { bookId: row.book_id, chapter: row.chapter, verseRef: row.verse_ref } : null;
    } catch {
      return null;
    }
  }

  async getReadingProgress(bookId: string): Promise<ReadingProgress | null> {
    return getReadingProgress(bookId);
  }

  async saveReadingProgress(progress: ReadingProgress): Promise<void> {
    return saveReadingProgress(progress);
  }

  async findResonance(journalText: string): Promise<ResonanceResult | null> {
    return findResonance(journalText) as Promise<ResonanceResult | null>;
  }

  async findPassageEchoes(
    passageText: string,
    sourceRef: string,
    options?: { bookId?: string; excludePassageId?: number | null }
  ): Promise<ResonanceResult | null> {
    return findPassageEchoes(passageText, sourceRef, options);
  }

  async storeSegmentVector(segmentId: string, text: string): Promise<void> {
    return storeSegmentVector(segmentId, text);
  }

  async appendQuoteToJournal(quote: string, source: string): Promise<void> {
    const text = source ? `"${quote}"\n\n— ${source}` : quote;
    const now = Date.now();
    const date = new Date(now).toISOString().slice(0, 10);
    const id = `seg-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await this.saveSegment({
      id,
      created_at: now,
      updated_at: now,
      segment_type: 'text',
      text,
      position_index: Math.floor(now / 1000),
      parent_date: date,
    });
    void storeSegmentVector(id, text);
  }

  async clusterEntries(segments: JournalSegment[]): Promise<EntryCluster[]> {
    return clusterEntries(segments) as Promise<EntryCluster[]>;
  }

  async generateWeeklyRoundup(segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup> {
    return generateWeeklyRoundup(segments, weekStart) as Promise<WeeklyRoundup>;
  }

  async generateShiftReport(segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport> {
    return generateShiftReport(segments, p1Start, p2Start) as Promise<ShiftReport>;
  }

  async getCalendarDays(segments: JournalSegment[], year: number, month: number): Promise<CalendarDay[]> {
    return getCalendarDays(segments, year, month) as Promise<CalendarDay[]>;
  }

  async getPatternsSummary(
    start: string,
    end: string,
    timeframe: PatternTimeframe = '30d',
  ): Promise<PatternsSummary> {
    return getOfflinePatternsSummary(start, end, timeframe);
  }

  async getPatternDayDetail(date: string): Promise<PatternDayDetail> {
    return getOfflinePatternDayDetail(date);
  }

  async getBookBridges(
    kind: 'bible' | 'voice',
    id: string,
    timeframe: PatternTimeframe,
    bookId?: string,
  ): Promise<BookBridgeResult> {
    return getOfflineBookBridges(kind, id, timeframe, bookId);
  }

  async recordPatternFeedback(input: PatternFeedbackInput): Promise<{ ok: boolean }> {
    return recordOfflinePatternFeedback(input);
  }

  async generateReflectionPrompt(excerpts: string[]): Promise<ReflectionPrompt | null> {
    return generateReflectionPrompt(excerpts) as Promise<ReflectionPrompt | null>;
  }

  async generateClusterLabel(excerpts: string[]): Promise<string | null> {
    return generateClusterLabel(excerpts);
  }

  async generateShiftNarrative(p1Excerpts: string[], p2Excerpts: string[]): Promise<string | null> {
    return generateShiftNarrative(p1Excerpts, p2Excerpts);
  }

  async getActiveEmbeddingModel(): Promise<EmbeddingModelId> {
    return 'voyage-4-nano';
  }

  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> {}

  async getSettings(): Promise<Record<string, string>> {
    const store = useSettingsStore.getState();
    const result: Record<string, string> = {
      translation: store.readingTranslation.toLowerCase(),
      fontSize: store.readingFontSize,
      theme: store.theme,
      textScale: store.textScale,
    };
    const db = getDatabase();
    if (db) {
      try {
        const rows = await db.getAllAsync<{ key: string; value: string }>(
          `SELECT key, value FROM app_settings;`
        );
        for (const r of rows) {
          if (!(r.key in result)) {
            result[r.key] = r.value;
          }
        }
      } catch {
        // best-effort
      }
    }
    return result;
  }

  async setSetting(key: string, value: string): Promise<void> {
    if (key === 'translation') {
      const upper = value.toUpperCase();
      if (upper === 'WEB' || upper === 'KJV') {
        useSettingsStore.getState().setReadingTranslation(upper);
      }
    } else if (key === 'fontSize') {
      if (value === 'small' || value === 'medium' || value === 'large') {
        useSettingsStore.getState().setReadingFontSize(value);
      }
    }
    const db = getDatabase();
    if (!db) return;
    try {
      await db.runAsync(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
        [key, value]
      );
    } catch {
      // best-effort
    }
  }
}
