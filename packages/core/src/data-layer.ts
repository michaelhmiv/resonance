/**
 * DataLayer — the contract that both mobile (local) and web (cloud)
 * implementations satisfy. Every screen and service in the app calls
 * these methods, never touching the database directly.
 *
 * Mobile free tier: implemented via expo-sqlite + local models
 * Mobile premium tier: implemented via Supabase + API routes
 * Web (always cloud): implemented via Supabase + API routes
 */

import type {
  Translation,
  BookSummary,
  VersePassage,
  PassageHit,
  SearchScope,
  LibraryPackage,
  LibraryBook,
  LibraryPassage,
  JournalSegment,
  Highlight,
  Annotation,
  Bookmark,
  HighlightMap,
  AnnotationMap,
  ResonanceResult,
  EntryCluster,
  WeeklyRoundup,
  ShiftReport,
  CalendarDay,
  ReflectionPrompt,
  EmbeddingModelId,
} from './types';

export interface DataLayer {
  // ── Bible / Scripture ──────────────────────────────────────────────────
  getBooks(translation: Translation): Promise<BookSummary[]>;
  getChapters(bookName: string, translation: Translation): Promise<number[]>;
  getVerses(bookName: string, chapter: number, translation: Translation): Promise<VersePassage[]>;
  searchPassages(query: string, scope: SearchScope): Promise<PassageHit[]>;

  // ── Library ────────────────────────────────────────────────────────────
  getLibraryPackages(): Promise<LibraryPackage[]>;
  getLibraryBook(bookId: string): Promise<LibraryBook | null>;
  getLibraryPassages(bookId: string): Promise<LibraryPassage[]>;

  // ── Journal segments ───────────────────────────────────────────────────
  loadSegments(): Promise<JournalSegment[]>;
  saveSegment(segment: JournalSegment): Promise<void>;
  deleteSegment(id: string): Promise<void>;

  // ── Reading state (highlights, annotations, bookmarks) ────────────────
  getHighlightsForRefs(refs: string[]): Promise<HighlightMap>;
  saveHighlight(verseRef: string, color: string): Promise<void>;
  removeHighlight(verseRef: string): Promise<void>;
  getAnnotationsForRefs(refs: string[], translation: Translation): Promise<AnnotationMap>;
  saveAnnotation(verseRef: string, translation: Translation, text: string): Promise<void>;
  saveBookmark(verseRef: string, label?: string): Promise<void>;
  removeBookmark(verseRef: string): Promise<void>;
  getBookmarks(): Promise<Bookmark[]>;
  getCrossReferences(verseRef: string): Promise<string[]>;

  // ── Resonance ──────────────────────────────────────────────────────────
  findResonance(journalText: string): Promise<ResonanceResult | null>;
  storeSegmentVector(segmentId: string, text: string): Promise<void>;

  // ── Patterns ───────────────────────────────────────────────────────────
  clusterEntries(segments: JournalSegment[]): Promise<EntryCluster[]>;
  generateWeeklyRoundup(segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup>;
  generateShiftReport(segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport>;
  getCalendarDays(segments: JournalSegment[], year: number, month: number): Promise<CalendarDay[]>;

  // ── LLM (reflection) ───────────────────────────────────────────────────
  generateReflectionPrompt(excerpts: string[]): Promise<ReflectionPrompt | null>;
  generateClusterLabel(excerpts: string[]): Promise<string | null>;
  generateShiftNarrative(p1Excerpts: string[], p2Excerpts: string[]): Promise<string | null>;

  // ── Settings ───────────────────────────────────────────────────────────
  getActiveEmbeddingModel(): Promise<EmbeddingModelId>;
  setActiveEmbeddingModel(id: EmbeddingModelId): Promise<void>;
}
