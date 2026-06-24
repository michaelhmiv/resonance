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

  async getCrossReferencesBatch(refs: string[]): Promise<Record<string, string[]>> {
    if (refs.length === 0) return {};
    const result: Record<string, string[]> = {};
    await Promise.all(refs.map(async (ref) => {
      const targets = await getCrossReferences(ref);
      if (targets.length > 0) result[ref] = targets;
    }));
    return result;
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
}
