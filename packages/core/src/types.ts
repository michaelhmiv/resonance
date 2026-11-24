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

/**
 * A highlight is a colored mark on a phrase in a verse, with an optional
 * attached note. Notes are *properties of* a highlight — there is no separate
 * annotation object. A highlight can have a note or not; the note's existence
 * is what makes it "annotated."
 *
 * start_offset / end_offset are char indices into the verse text (the
 * `text` field of the matching VersePassage). `selected_text` is the literal
 * phrase — captured at highlight-creation time so we can render the note
 * context even if the verse text changes.
 *
 * legacy rows (created before phrase-ranges shipped) have start_offset and
 * end_offset = null. The UI renders those as flat whole-verse highlights.
 */
export interface Highlight {
  id: string;
  verse_ref: string;
  color: string;
  start_offset: number | null;
  end_offset: number | null;
  selected_text: string | null;
  note_text: string | null;
  note_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  verse_ref: string;
  created_at: number;
  label: string | null;
}

// ── Resonance ───────────────────────────────────────────────────────────────

export interface ResonanceCard {
  passageId: number;
  text: string;
  source: string;
  bookId: string;
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

export type PatternTimeframe = '30d' | '90d' | 'all';

export type PatternActivityType =
  | 'journal'
  | 'reading'
  | 'highlight'
  | 'note'
  | 'bookmark'
  | 'echo';

export type PatternActivityCounts = Record<PatternActivityType, number>;

export type PatternConnectionKind = 'echo' | 'returned_to' | 'theme' | 'trail';

export interface PatternEvidence {
  type: PatternActivityType | 'theme' | 'edge';
  id?: string;
  date?: string;
  title?: string;
  ref?: string | null;
  bookId?: string | null;
  excerpt?: string | null;
}

export interface PatternConnection {
  kind: PatternConnectionKind;
  id: string;
  label: string;
  summary: string;
  confidence?: number;
  ref?: string | null;
  bookId?: string | null;
  edgeId?: string | null;
  evidence: PatternEvidence[];
  sourceNodeIds?: string[];
  targetNodeIds?: string[];
}

export interface PatternDaySummary {
  date: string;
  counts: PatternActivityCounts;
  dotTypes: PatternActivityType[];
}

export interface PatternTheme {
  id: string;
  label: string;
  summary: string;
  confidence: number;
  evidenceCount: number;
  dateRange: { start: string; end: string };
  evidence: PatternEvidence[];
}

export interface PatternEcho {
  id: string;
  title: string;
  sourceLabel: string;
  targetLabel: string;
  targetKind?: 'scripture' | 'voice' | 'past_entry' | 'highlight' | 'theme';
  targetBookId?: string | null;
  targetRef?: string | null;
  sourceItemId?: string | null;
  reason: string;
  confidence: number;
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

export interface FindingYouTrace {
  id: string;
  date: string;
  type: PatternActivityType;
  ref?: string | null;
  excerpt: string;
}

export interface FindingYouSignal {
  id: string;
  kind: 'scripture' | 'voice';
  ref: string;
  bookName: string;
  bookId?: string | null;
  count: number;
  span: string;
  neverRead: boolean;
  excerpt: string;
  confidence: number;
  lastSeenAt: string | null;
  edgeIds: string[];
  traces: FindingYouTrace[];
}

export interface ReturnedSignal {
  id: string;
  label: string;
  count: number;
  activityTypes: PatternActivityType[];
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

export interface PatternTrailStep {
  type: PatternActivityType | 'voice';
  date: string;
  ref: string;
  bookId?: string | null;
  text: string;
}

export interface PatternTrail {
  id: string;
  label: string;
  summary: string;
  span?: string;
  steps?: PatternTrailStep[];
  evidence: PatternEvidence[];
}

export type BookshelfClothState = 'unread' | 'echo' | 'read' | 'walnut';

export interface BookshelfVolume {
  kind: 'bible' | 'voice';
  id: string;
  bookId: string;
  spineLabel: string;
  title: string;
  subtitle: string;
  groupId: string;
  testament?: BookTestament;
  readCount: number;
  highlightCount: number;
  noteCount: number;
  bookmarkCount: number;
  echoCount: number;
  clothState: BookshelfClothState;
  worksCount?: number;
}

export interface BookshelfSummary {
  timeframe: PatternTimeframe;
  scripture: BookshelfVolume[];
  literature: BookshelfVolume[];
}

export interface BookBridgeItem {
  id: string;
  via: 'trace' | 'echo' | 'semantic' | 'crossref';
  viaLabel: string;
  ref: string;
  bookId?: string | null;
  chapter?: number | null;
  verse?: number | null;
  quote: string;
  linkText: string;
  date?: string | null;
}

export interface BookBridgeResult {
  kind: 'bible' | 'voice';
  id: string;
  bookId: string;
  title: string;
  subtitle: string;
  timeframe: PatternTimeframe;
  visited: boolean;
  counts: {
    read: number;
    highlights: number;
    notes: number;
    bookmarks: number;
    echoes: number;
  };
  items: BookBridgeItem[];
}

export interface PatternsSummary {
  window: { start: string; end: string };
  timeframe?: PatternTimeframe;
  recently: string;
  days: PatternDaySummary[];
  themes: PatternTheme[];
  echoes: PatternEcho[];
  findingYou?: FindingYouSignal[];
  returnedTo: ReturnedSignal[];
  trails: PatternTrail[];
  bookshelf?: BookshelfSummary;
  quietQuestion: string;
  health: {
    journalEntryCount: number;
    readingEventCount: number;
    highlightCount: number;
    noteCount: number;
    bookmarkCount: number;
    echoCount: number;
  };
}

export interface JournalDayItem {
  id: string;
  excerpt: string;
  createdAt: string | null;
  connections: PatternConnection[];
}

export interface ReadingDayItem {
  id: string;
  label: string;
  ref: string | null;
  bookId?: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

export interface HighlightDayItem {
  id: string;
  verseRef: string | null;
  selectedText: string | null;
  color: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

export interface NoteDayItem {
  id: string;
  verseRef: string | null;
  noteExcerpt: string;
  updatedAt: string | null;
  connections: PatternConnection[];
}

export interface BookmarkDayItem {
  id: string;
  verseRef: string | null;
  label: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

export interface PatternDayDetail {
  date: string;
  counts: PatternActivityCounts;
  journal: JournalDayItem[];
  reading: ReadingDayItem[];
  highlights: HighlightDayItem[];
  notes: NoteDayItem[];
  bookmarks: BookmarkDayItem[];
  connections: PatternConnection[];
}

export interface PatternFeedbackInput {
  action: 'opened' | 'saved' | 'dismissed' | 'not_useful' | 'show_less';
  surface: 'echo' | 'theme' | 'trail' | 'returned_to' | 'quiet_question';
  itemId: string;
  edgeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  metadata?: Record<string, unknown>;
}

// ── Models ──────────────────────────────────────────────────────────────────

export type EmbeddingModelId = 'gte-small' | 'bge-small-en' | 'all-minilm-l6';

export type EmbeddingModelTier = 'local' | 'cloud';

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  label: string;
  dim: number;
  sizeMb: number;
  license: string;
  tier: EmbeddingModelTier;
}

export type LlmModelId = 'qwen-2.5-1.5b' | 'deepseek-v4-pro' | 'none';

export interface LlmModelInfo {
  id: LlmModelId;
  label: string;
  sizeMb: number;
  license: string;
  tier: EmbeddingModelTier;
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
