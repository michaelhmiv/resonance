/**
 * Shared types — used by both mobile and web implementations.
 * No platform-specific imports. Pure type declarations.
 */

// ── Bible / Translation ─────────────────────────────────────────────────────

export type Translation = 'WEB' | 'KJV';

export type BookTestament = 'OT' | 'NT';

export interface CanonicalBook {
  name: string;
  testament: BookTestament;
  order: number;
}

export interface BookSummary {
  name: string;
  testament: BookTestament;
  order: number;
  available: boolean;
  bookId: string;
}

export interface VersePassage {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  chunk_id: number | null;
}

export interface PassageHit {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  source: string;
}

export type SearchScope = 'scripture' | 'library';

// ── Library ─────────────────────────────────────────────────────────────────

export interface LibraryBook {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  package_id: string | null;
}

export interface LibraryPackage {
  package_id: string;
  label: string;
  books: LibraryBook[];
}

export interface LibraryPassage {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  chunk_id: number | null;
}

// ── Journal Segments ────────────────────────────────────────────────────────

export type SegmentType =
  | 'text'
  | 'date_divider'
  | 'verse_day'
  | 'footnote'
  | 'resonance_cards';

export interface JournalSegment {
  id: string;
  created_at: number;
  updated_at: number;
  segment_type: SegmentType;
  text: string | null;
  position_index: number;
  parent_date: string | null;
}

// ── Reading state ───────────────────────────────────────────────────────────

export interface Highlight {
  id: string;
  verse_ref: string;
  color: string;
  created_at: number;
}

export interface Annotation {
  id: string;
  verse_ref: string;
  translation: string;
  text: string;
  created_at: number;
}

export interface Bookmark {
  id: string;
  verse_ref: string;
  created_at: number;
  label: string | null;
}

export type HighlightMap = Record<string, string>;
export type AnnotationMap = Record<string, string>;

// ── Resonance ───────────────────────────────────────────────────────────────

export interface ResonanceCard {
  passageId: number;
  text: string;
  source: string;
  translation: string | null;
  similarity: number;
  kind: 'scripture' | 'voice' | 'past_entry';
}

export interface ResonanceResult {
  scripture: ResonanceCard[];
  voices: ResonanceCard[];
  pastEntries: ResonanceCard[];
}

// ── Patterns ────────────────────────────────────────────────────────────────

export interface EntryCluster {
  id: string;
  label: string;
  entryCount: number;
  excerpts: string[];
  dateRange: { start: string; end: string };
}

export interface WeeklyRoundup {
  weekStart: string;
  entryCount: number;
  themes: string[];
  excerpt: string;
}

export interface ShiftReport {
  comparisonDate: string;
  period1Start: string;
  period2Start: string;
  narrative: string | null;
}

export interface CalendarDay {
  date: string;
  hasEntries: boolean;
  entryCount: number;
}

// ── Models ──────────────────────────────────────────────────────────────────

export type EmbeddingModelId = 'gte-small' | 'bge-small-en' | 'all-minilm-l6';

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  label: string;
  dim: number;
  sizeMb: number;
  license: string;
}

export type LlmModelId = 'qwen-2.5-1.5b' | 'deepseek-v4-pro' | 'none';

export interface LlmModelInfo {
  id: LlmModelId;
  label: string;
  sizeMb: number;
  license: string;
}

export interface ReflectionPrompt {
  prompt: string;
  generatedAt: number;
}

// ── Settings ────────────────────────────────────────────────────────────────

export type TextScale = 'small' | 'medium' | 'large' | 'extra_large';
export type ReadingFontSize = 'small' | 'medium' | 'large';
export type ThemeMode = 'auto' | 'light';
export type TranslationPref = 'WEB' | 'KJV';
