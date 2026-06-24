import type {
  DataLayer,
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
  getHighlightsForRefs,
  saveHighlight,
  removeHighlight,
  getAnnotationsForRefs,
  saveAnnotation,
  saveBookmark,
  removeBookmark,
  getBookmarks,
  getCrossReferences,
} from '../db/queries/readingQueries';

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

  async getHighlightsForRefs(refs: string[]) {
    return getHighlightsForRefs(refs);
  }

  async saveHighlight(verseRef: string, color: string) {
    return saveHighlight(verseRef, color);
  }

  async removeHighlight(verseRef: string) {
    return removeHighlight(verseRef);
  }

  async getAnnotationsForRefs(refs: string[], translation: Translation) {
    return getAnnotationsForRefs(refs, translation);
  }

  async saveAnnotation(verseRef: string, translation: Translation, text: string) {
    return saveAnnotation(verseRef, translation, text);
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

  async findResonance(_journalText: string): Promise<ResonanceResult | null> {
    return null;
  }

  async storeSegmentVector(_segmentId: string, _text: string): Promise<void> {}

  async clusterEntries(_segments: JournalSegment[]): Promise<EntryCluster[]> {
    return [];
  }

  async generateWeeklyRoundup(_segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup> {
    return { weekStart, entryCount: 0, themes: [], excerpt: '' };
  }

  async generateShiftReport(_segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport> {
    return { comparisonDate: '', period1Start: p1Start, period2Start: p2Start, narrative: null };
  }

  async getCalendarDays(_segments: JournalSegment[], _year: number, _month: number): Promise<CalendarDay[]> {
    return [];
  }

  async generateReflectionPrompt(_excerpts: string[]): Promise<ReflectionPrompt | null> {
    return null;
  }

  async generateClusterLabel(_excerpts: string[]): Promise<string | null> {
    return null;
  }

  async generateShiftNarrative(_p1Excerpts: string[], _p2Excerpts: string[]): Promise<string | null> {
    return null;
  }

  async getActiveEmbeddingModel(): Promise<EmbeddingModelId> {
    return 'gte-small';
  }

  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> {}
}
