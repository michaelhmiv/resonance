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
  division?: string | null;
  score?: number;
  matchKind?: 'keyword' | 'semantic' | 'hybrid' | 'highlight';
  highlightNote?: string | null;
  highlightColor?: string | null;
  highlightId?: string | null;
}

export type SearchScope = 'scripture' | 'library' | 'all' | 'highlights';
export type SearchMode = 'hybrid' | 'keyword' | 'semantic';

// ── Library ─────────────────────────────────────────────────────────────────

export interface LibraryBook {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  package_id: string | null;
  source?: string | null;
  isPersonal?: boolean;
  sourceFormat?: PersonalSourceFormat | null;
  collection?: string | null;
  tags?: string[];
  notes?: string | null;
  includeInResonance?: boolean;
  embeddingStatus?: PersonalEmbeddingStatus | null;
  embeddedChunks?: number;
  totalChunks?: number;
  ocrRequired?: boolean;
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
  division?: string | null;
}

// ── Personal Library (User-Owned Device Corpora — chunking-spec §7) ─────────

export type PersonalSourceFormat = 'epub' | 'pdf' | 'docx' | 'html' | 'md' | 'txt';

export type PersonalEmbeddingStatus = 'pending' | 'embedding' | 'ready' | 'error';

export interface PersonalWorkMetadata {
  bookId: string;
  title: string;
  author: string;
  era: string;
  collection: string;
  tags: string[];
  notes: string;
  sourceFormat: PersonalSourceFormat;
  sourceFilename: string;
  localFilePath: string | null;
  fileSizeBytes: number;
  fileHash: string;
  includeInResonance: boolean;
  embeddingStatus: PersonalEmbeddingStatus;
  embeddedChunks: number;
  totalChunks: number;
  embeddingModel: string | null;
  lastError: string | null;
  ocrRequired: boolean;
  warnings: string[];
  importedAt: number;
  updatedAt: number;
}

export interface PersonalWorkMetadataPatch {
  title?: string;
  author?: string;
  era?: string;
  collection?: string;
  tags?: string[];
  notes?: string;
  includeInResonance?: boolean;
}

export type InlineSpanKind =
  | 'italic'
  | 'bold'
  | 'boldItalic'
  | 'smallcaps'
  | 'sup'
  | 'footnote_ref'
  | 'scripture_ref';

export interface InlineSpan {
  start: number;
  end: number;
  kind: InlineSpanKind;
  target?: string;
}

export interface TocEntry {
  title: string;
  level: number;
  href?: string;
  blockIndex?: number;
}

export interface ExtractedBlock {
  kind: 'heading' | 'paragraph' | 'poetry' | 'blockquote' | 'list_item' | 'divider';
  text: string;
  level?: number;
  spans?: InlineSpan[];
}

export interface DetectedDocumentMetadata {
  title?: string;
  author?: string;
  era?: string;
  language?: string;
  description?: string;
  tags?: string[];
  pageCount?: number;
  chapterCount?: number;
}

export interface RawDocumentExtraction {
  format: PersonalSourceFormat;
  filename: string;
  blocks: ExtractedBlock[];
  rawText: string;
  detectedMetadata: DetectedDocumentMetadata;
  detectedToc?: TocEntry[];
  ocrRequired: boolean;
  warnings: string[];
}

export interface CanonicalUnit {
  seq: number;
  division: string | null;
  chapter: number;
  kind: 'prose' | 'poetry';
  text: string;
  words: number;
}

export interface ChunkedPassage {
  chunkIndex: number;
  division: string | null;
  chapter: number;
  kind: 'prose' | 'poetry';
  text: string;
  words: number;
  unitSeqs: number[];
}

export interface ProcessedPersonalDocument {
  format: PersonalSourceFormat;
  filename: string;
  suggestedTitle: string;
  suggestedAuthor: string;
  suggestedEra: string;
  suggestedTags: string[];
  suggestedNotes: string;
  units: CanonicalUnit[];
  chunks: ChunkedPassage[];
  divisions: string[];
  wordCount: number;
  quarantinedCount: number;
  ocrRequired: boolean;
  warnings: string[];
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
export type HighlightStyle = 'fill' | 'underline';

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
  /** Durable book anchor (canonical Bible book name or Library book_id). */
  book_id?: string | null;
  /** Chapter or section anchor within the book. */
  chapter_id?: string | null;
  /** W3C TextQuoteSelector prefix for resilient re-anchoring. */
  quote_prefix?: string | null;
  /** W3C TextQuoteSelector suffix for resilient re-anchoring. */
  quote_suffix?: string | null;
  /** User-applied tags (e.g. ["prayer", "grace"]). */
  tags?: string[];
  /** Visual rendering style ('fill' tint or 'underline'). */
  style?: HighlightStyle;
  /** Epoch ms when last embedded into highlight_vectors (null if pending). */
  embedded_at?: number | null;
}

export interface Bookmark {
  id: string;
  verse_ref: string;
  created_at: number;
  label: string | null;
  book_id?: string | null;
  chapter_id?: string | null;
  passage_id?: number | null;
}

// ── Resonance ───────────────────────────────────────────────────────────────

export interface ResonanceCard {
  passageId: number;
  text: string;
  source: string;
  bookId: string;
  translation: string | null;
  similarity: number;
  kind: 'scripture' | 'voice' | 'past_entry' | 'highlight';
  /** Gentle provenance cue, e.g. "Echoes a passage you highlighted & noted". */
  provenance?: string | null;
  /** Optional margin note text when card comes from a user highlight/note. */
  noteText?: string | null;
  /** Optional highlight id when card comes from or aligns with a highlight. */
  highlightId?: string | null;
}

export interface ResonanceResult {
  scripture: ResonanceCard[];
  voices: ResonanceCard[];
  pastEntries: ResonanceCard[];
  /** High-signal echoes directly from the user's highlights & margin notes. */
  highlights?: ResonanceCard[];
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

// ── Models & Offline Engine Manifest ────────────────────────────────────────

export type EmbeddingModelId =
  | 'voyage-4-nano'
  | 'gte-small'
  | 'bge-small-en'
  | 'all-minilm-l6';

export type EmbeddingModelTier = 'local' | 'cloud';

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  label: string;
  dim: number;
  sizeMb: number;
  license: string;
  tier: EmbeddingModelTier;
  quantization?: 'int8' | 'fp32';
  huggingfaceRepo?: string;
  commitSha?: string;
}

export type RerankerModelId = 'qwen3-reranker-0.6b' | 'none';

export interface RerankerModelInfo {
  id: RerankerModelId;
  label: string;
  sizeMb: number;
  license: string;
  quantization: 'int8' | 'none';
  huggingfaceRepo?: string;
  commitSha?: string;
}

export interface DownloadArtifactSpec {
  /** Stable identifier persisted in offline_downloads. */
  id: string;
  /** Logical component group ('embedder' | 'reranker' | 'corpus'). */
  group: 'embedder' | 'reranker' | 'corpus';
  /** Human-readable display label. */
  label: string;
  /** Pinned immutable download URL. */
  url: string;
  /** Relative local path inside Resonance's offline_engine directory. */
  relativePath: string;
  /** Exact expected byte size (0 if dynamically resolved from manifest). */
  sizeBytes: number;
  /** Expected lowercase hex SHA-256 digest (null if resolved dynamically). */
  sha256: string | null;
}

export interface CorpusPackManifestEntry {
  id: string;
  label: string;
  description: string;
  version: string;
  kind: 'bible' | 'witnesses' | 'mixed';
  workCount: number;
  passageCount: number;
  dim: number;
  quantization: 'int8';
  modelId: EmbeddingModelId;
  passagesUrl: string;
  passagesBytes: number;
  passagesSha256: string | null;
  vectorsUrl: string;
  vectorsBytes: number;
  vectorsSha256: string | null;
}

export type CatalogCollectionId =
  | 'church-fathers'
  | 'medieval-mystics'
  | 'reformation-puritans'
  | 'modern-witnesses';

export interface CatalogCollectionEntry {
  id: CatalogCollectionId;
  label: string;
  era: string;
  description: string;
  workIds: string[];
  passageCount: number;
  totalBytes: number;
}

export interface CatalogWorkEntry {
  id: string;
  slug: string;
  title: string;
  author: string;
  era: string;
  collectionId: CatalogCollectionId;
  passageCount: number;
  passagesUrl: string;
  passagesBytes: number;
  passagesSha256: string | null;
  vectorsUrl: string;
  vectorsBytes: number;
  vectorsSha256: string | null;
}

export interface CorpusPacksManifest {
  schemaVersion: number;
  releaseTag: string;
  updatedAt: string;
  modelId: EmbeddingModelId;
  dim: number;
  quantization: 'int8';
  packs: CorpusPackManifestEntry[];
  collections?: CatalogCollectionEntry[];
  works?: CatalogWorkEntry[];
}

export interface OfflineEngineManifest {
  version: string;
  embeddingModelId: EmbeddingModelId;
  rerankerModelId: RerankerModelId;
  dim: number;
  fusionAlpha: number;
  silenceThreshold: number;
  perWorkCap: number;
  modelArtifacts: readonly DownloadArtifactSpec[];
  corpusManifestUrl: string;
  fallbackCorpusManifest: CorpusPacksManifest;
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

// ── Reader v2 (Rich Blocks, Chapters, Progress, Appearance, Search) ─────────

export type ReadingBlockKind =
  | 'title'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'blockquote'
  | 'poetry'
  | 'epigraph'
  | 'list_item'
  | 'divider'
  | 'footnote';

export interface ReadingBlock {
  /** Stable local render key (e.g., "p:123:0" or "v:Genesis:1:1"). */
  id: string;
  /** Stable highlight/bookmark anchor ref (e.g. "Genesis 1:1" or "bookId#chunkIdx"). */
  anchorRef: string;
  /** Legacy highlight ref (numeric passage.id as string) for backward compatibility. */
  legacyRef?: string;
  bookId: string;
  chapterId: string | null;
  chapterIndex: number;
  blockIndex: number;
  kind: ReadingBlockKind;
  text: string;
  spans?: InlineSpan[];
  passageId?: number | null;
  chunkIndex?: number | null;
  verseStart?: number | null;
  verseEnd?: number | null;
  division?: string | null;
  level?: number;
}

export interface BookChapter {
  id: string;
  bookId: string;
  parentId: string | null;
  level: number; // 1 = Book/Part, 2 = Chapter/Section, 3 = Subsection
  orderIndex: number;
  title: string;
  startBlockIndex: number;
  endBlockIndex: number;
  wordCount: number;
  estimatedMinutes: number;
  passageCount: number;
}

export interface ReadingProgress {
  bookId: string;
  chapterId: string | null;
  chapterIndex: number;
  blockIndex: number;
  passageId: number | null;
  verseNumber?: number | null;
  scrollPct: number;
  updatedAt: number;
}

export type ReaderFontId = 'garamond' | 'serif' | 'sans';
export type ReaderMarginId = 'compact' | 'book' | 'wide';
export type ReaderAlignId = 'left' | 'justify';
export type ScriptureDisplayMode = 'flow' | 'study';

export interface ReaderPreferences {
  fontFamily: ReaderFontId;
  fontSize: number; // 14..28
  lineHeightMultiplier: number; // 1.4..2.0
  margin: ReaderMarginId;
  align: ReaderAlignId;
  scriptureMode: ScriptureDisplayMode;
  showMarginEchoes: boolean;
}

export interface InBookSearchHit {
  blockId: string;
  anchorRef: string;
  passageId: number | null;
  chapterIndex: number;
  chapterTitle: string;
  blockIndex: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
  score: number;
  mode: 'keyword' | 'semantic';
}

export interface SmartReferenceJump {
  kind: 'scripture';
  bookName: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  label: string;
}

