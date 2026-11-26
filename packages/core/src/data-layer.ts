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
  PersonalWorkMetadata,
  PersonalWorkMetadataPatch,
  JournalSegment,
  Highlight,
  Bookmark,
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
  /** Optional: list personal user-imported works with full metadata/embedding state. */
  getPersonalWorks?(): Promise<PersonalWorkMetadata[]>;
  /** Optional: update editable metadata (title, author, era, collection, tags, notes, resonance toggle). */
  updatePersonalWorkMetadata?(bookId: string, patch: PersonalWorkMetadataPatch): Promise<PersonalWorkMetadata | null>;
  /** Optional: delete a user-imported personal work, its passages, vectors, and local file copy. */
  deletePersonalWork?(bookId: string): Promise<boolean>;
  /**
   * Returns the full voice library catalog with the current user's per-book
   * opt-in state. Replaces the per-package `getLibraryPackagePrefs`.
   *
   * The `enabled` field is computed against user_settings(key='enabled_voice_books')
   * (with one-shot migration from the legacy 'enabled_voice_packages' key).
   */
  getLibraryBookPrefs(): Promise<{
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
  }>;
  /**
   * Toggle one book's opt-in state. Idempotent. Throws on unknown bookId.
   */
  setLibraryBookEnabled(bookId: string, enabled: boolean): Promise<{ enabledList: string[] }>;
  /**
   * Reset to "all enabled" (clears the user's opt-in preference).
   * Subsequent reads will return the full installed set.
   */
  resetLibraryBooks(): Promise<void>;
  /**
   * @deprecated Replaced by getLibraryBookPrefs. Kept as a thin wrapper for
   * backward compatibility with any caller that hasn't migrated yet.
   * Maps the per-book enabled set back to a per-package view.
   */
  getLibraryPackagePrefs?(): Promise<{
    installed: Array<{ packageId: string; label: string; bookCount: number; enabled: boolean }>;
    mode: 'all' | 'none' | 'subset';
  }>;
  /**
   * @deprecated Replaced by setLibraryBookEnabled. No-op fallback for the
   * old per-package toggle interface.
   */
  setLibraryPackageEnabled?(packageId: string, enabled: boolean): Promise<{ enabledList: string[] }>;
  /**
   * @deprecated Replaced by resetLibraryBooks. No-op fallback.
   */
  resetLibraryPackages?(): Promise<void>;

  // ── Journal segments ───────────────────────────────────────────────────
  loadSegments(): Promise<JournalSegment[]>;
  saveSegment(segment: JournalSegment): Promise<void>;
  deleteSegment(id: string): Promise<void>;

  // ── Reading state (highlights, bookmarks) ──────────────────────────────
  // A highlight is a phrase-range mark on a verse, with an optional note.
  // Notes live on the highlight row (note_text) — no separate annotations.
  getHighlightsForRefs(refs: string[]): Promise<Highlight[]>;
  saveHighlight(input: SaveHighlightInput): Promise<Highlight>;
  updateHighlight(id: string, patch: UpdateHighlightPatch): Promise<Highlight>;
  deleteHighlight(id: string): Promise<void>;
  saveBookmark(verseRef: string, label?: string): Promise<void>;
  removeBookmark(verseRef: string): Promise<void>;
  getBookmarks(): Promise<Bookmark[]>;
  getCrossReferences(verseRef: string): Promise<string[]>;
  getCrossReferencesBatch(refs: string[]): Promise<Record<string, string[]>>;
  recordReadingEvent(bookId: string, chapter: number, verseRef: string, timestamp: number): Promise<void>;
  getReadingHistory(startDate: string, endDate: string): Promise<{ date: string; count: number }[]>;
  getLastReadPosition?(): Promise<{ bookId: string; chapter: number; verseRef: string } | null>;

  // ── Resonance ──────────────────────────────────────────────────────────
  findResonance(journalText: string, segmentId?: string): Promise<ResonanceResult | null>;
  storeSegmentVector(segmentId: string, text: string): Promise<void>;
  appendQuoteToJournal(quote: string, source: string): Promise<void>;
  /**
   * How many of the user's past entries share a concept with the given
   * verse text. Returns matching entry ids and the shared concept names
   * so the client can render a glance line like "Today's verse has
   * echoed in 2 of your past entries — grace, salvation."
   * Optional in implementations; absence is fine for the journal screen.
   */
  findVerseEchoes?(verseText: string, verseRef?: string): Promise<{
    count: number;
    entryIds: string[];
    concepts: string[];
  }>;

  // ── Patterns ───────────────────────────────────────────────────────────
  clusterEntries(segments: JournalSegment[]): Promise<EntryCluster[]>;
  generateWeeklyRoundup(segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup>;
  generateShiftReport(segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport>;
  getCalendarDays(segments: JournalSegment[], year: number, month: number): Promise<CalendarDay[]>;
  getPatternsSummary?(start: string, end: string, timeframe?: PatternTimeframe): Promise<PatternsSummary>;
  getPatternDayDetail?(date: string): Promise<PatternDayDetail>;
  getBookBridges?(
    kind: 'bible' | 'voice',
    id: string,
    timeframe: PatternTimeframe,
    bookId?: string,
  ): Promise<BookBridgeResult>;
  recordPatternFeedback?(input: PatternFeedbackInput): Promise<{ ok: boolean }>;

  // ── LLM (reflection) ───────────────────────────────────────────────────
  generateReflectionPrompt(excerpts: string[]): Promise<ReflectionPrompt | null>;
  generateClusterLabel(excerpts: string[]): Promise<string | null>;
  generateShiftNarrative(p1Excerpts: string[], p2Excerpts: string[]): Promise<string | null>;

  // ── Settings ───────────────────────────────────────────────────────────
  getActiveEmbeddingModel(): Promise<EmbeddingModelId>;
  setActiveEmbeddingModel(id: EmbeddingModelId): Promise<void>;
  getSettings(): Promise<Record<string, string>>;
  setSetting?(key: string, value: string): Promise<void>;
}

/**
 * Input for creating a new phrase highlight.
 * - startOffset / endOffset are char indices into the verse text
 * - selectedText is the literal phrase (stored for note context)
 * - noteText is optional; omit or pass null for a "just a color" highlight
 */
export interface SaveHighlightInput {
  verseRef: string;
  color: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  noteText?: string | null;
}

/**
 * Patch for updating an existing highlight. All fields optional.
 * - Pass `noteText: null` (or empty string) to remove the note.
 * - Pass new offsets to resize the range (e.g. drag a handle).
 */
export interface UpdateHighlightPatch {
  color?: string;
  startOffset?: number;
  endOffset?: number;
  selectedText?: string;
  noteText?: string | null;
}
