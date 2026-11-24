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

export interface ExtractedBlock {
  kind: 'heading' | 'paragraph' | 'poetry';
  text: string;
  level?: number;
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

export interface CorpusPacksManifest {
  schemaVersion: number;
  releaseTag: string;
  updatedAt: string;
  modelId: EmbeddingModelId;
  dim: number;
  quantization: 'int8';
  packs: CorpusPackManifestEntry[];
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
