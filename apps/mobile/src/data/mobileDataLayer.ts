import type {
  DataLayer,
  SaveHighlightInput,
  UpdateHighlightPatch,
  Highlight,
  Translation,
  SearchScope,
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
  saveFullHighlight,
  updateFullHighlight,
  deleteFullHighlightById,
  saveBookmark,
  removeBookmark,
  getBookmarks,
  getCrossReferences,
  getCrossReferencesBatch,
} from '../db/queries/readingQueries';
import { useSettingsStore } from '../settings/settingsStore';
import { findResonance, storeSegmentVector } from '../embedding/resonanceService';
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

  async saveHighlight(input: SaveHighlightInput): Promise<Highlight> {
    return saveFullHighlight(input);
  }

  async updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight> {
    return updateFullHighlight(id, patch);
  }

  async deleteHighlight(id: string): Promise<void> {
    return deleteFullHighlightById(id);
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

  async findResonance(journalText: string): Promise<ResonanceResult | null> {
    return findResonance(journalText) as Promise<ResonanceResult | null>;
  }

  async storeSegmentVector(segmentId: string, text: string): Promise<void> {
    return storeSegmentVector(segmentId, text);
  }

  async appendQuoteToJournal(quote: string, source: string): Promise<void> {
    const text = source ? `"${quote}"\n\n— ${source}` : quote;
    const now = Date.now();
    const date = new Date(now).toISOString().slice(0, 10);
    await this.saveSegment({
      id: `seg-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: now,
      updated_at: now,
      segment_type: 'text',
      text,
      position_index: Math.floor(now / 1000),
      parent_date: date,
    });
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
