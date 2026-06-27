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
  ReflectionPrompt,
  EmbeddingModelId,
} from '@resonance/core';
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
   * Mobile free-tier stub: returns all packages as enabled, mode 'all'.
   * Free-tier users always see the full catalog (no per-device opt-in).
   * When the user upgrades to premium and signs in, the cloud-backed
   * per-package prefs will take over (this method is replaced by a
   * network-backed implementation in the premium tier).
   */
  async getLibraryPackagePrefs() {
    const packages = await getLibraryPackages();
    return {
      installed: packages.map((p) => ({
        packageId: p.package_id,
        label: p.label,
        bookCount: p.books.length,
        enabled: true,
      })),
      mode: 'all' as const,
    };
  }

  /** Free-tier stub: toggle is a no-op. */
  async setLibraryPackageEnabled(_packageId: string, _enabled: boolean): Promise<{ enabledList: string[] }> {
    // No-op on free tier — settings persist only when the user has a cloud account.
    return { enabledList: [] };
  }

  /** Free-tier stub: reset is a no-op. */
  async resetLibraryPackages(): Promise<void> {
    // No-op on free tier.
  }

  async getLibraryBook(bookId: string) {
    return getLibraryBook(bookId);
  }

  async getLibraryPassages(bookId: string) {
    return getLibraryPassages(bookId);
  }

  async loadSegments(): Promise<JournalSegment[]> {
    return [];
  }

  async saveSegment(_segment: JournalSegment): Promise<void> {}

  async deleteSegment(_id: string): Promise<void> {}

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

  async recordReadingEvent(_bookId: string, _chapter: number, _verseRef: string, _timestamp: number): Promise<void> {}

  async getReadingHistory(_startDate: string, _endDate: string): Promise<{ date: string; count: number }[]> {
    return [];
  }

  async getLastReadPosition(): Promise<{ bookId: string; chapter: number; verseRef: string } | null> {
    return null; // Mobile: not implemented yet
  }

  async findResonance(journalText: string): Promise<ResonanceResult | null> {
    return findResonance(journalText) as Promise<ResonanceResult | null>;
  }

  async storeSegmentVector(segmentId: string, text: string): Promise<void> {
    return storeSegmentVector(segmentId, text);
  }

  async appendQuoteToJournal(_quote: string, _source: string): Promise<void> {}

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
