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
import { getLibraryPackages, getLibraryBook, getLibraryPassages } from '../db/queries/libraryQueries';
import {
  getHighlightsForRefs as _getHighlightsForRefsMobile,
  saveHighlight as _saveHighlightMobile,
  removeHighlight as _removeHighlightMobile,
  saveBookmark,
  removeBookmark,
  getBookmarks,
  getCrossReferences,
} from '../db/queries/readingQueries';
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
    // Mobile still uses whole-verse highlights — convert the legacy map to
    // a Highlight[] with null offsets.
    const map = await _getHighlightsForRefsMobile(refs);
    return Object.entries(map).map(([verse_ref, color]) => ({
      id: `legacy-${verse_ref}`,
      verse_ref,
      color,
      start_offset: null,
      end_offset: null,
      selected_text: null,
      note_text: null,
      note_updated_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }

  async saveHighlight(input: SaveHighlightInput): Promise<Highlight> {
    // Mobile doesn't yet support phrase-level highlights — save the color
    // for the whole verse and return a legacy-shaped row.
    await _saveHighlightMobile(input.verseRef, input.color);
    return {
      id: `mobile-${Date.now()}`,
      verse_ref: input.verseRef,
      color: input.color,
      start_offset: input.startOffset,
      end_offset: input.endOffset,
      selected_text: input.selectedText,
      note_text: input.noteText ?? null,
      note_updated_at: input.noteText ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight> {
    // Mobile: best-effort — only color updates land in the local DB.
    if (patch.color) {
      const verseRef = id.replace(/^mobile-/, '').replace(/^legacy-/, '');
      await _saveHighlightMobile(verseRef, patch.color);
    }
    return {
      id,
      verse_ref: id.replace(/^mobile-/, '').replace(/^legacy-/, ''),
      color: patch.color ?? '#d4a574',
      start_offset: patch.startOffset ?? null,
      end_offset: patch.endOffset ?? null,
      selected_text: patch.selectedText ?? null,
      note_text: patch.noteText ?? null,
      note_updated_at: patch.noteText ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async deleteHighlight(id: string): Promise<void> {
    const verseRef = id.replace(/^mobile-/, '').replace(/^legacy-/, '');
    await _removeHighlightMobile(verseRef);
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
    if (refs.length === 0) return {};
    const result: Record<string, string[]> = {};
    await Promise.all(refs.map(async (ref) => {
      const targets = await getCrossReferences(ref);
      if (targets.length > 0) result[ref] = targets;
    }));
    return result;
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
    return 'gte-small';
  }

  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> {}

  async getSettings(): Promise<Record<string, string>> {
    return {};
  }
}
