/**
 * Shared offline-capable Patterns & Study Bookshelf concordance engine.
 *
 * Pure TypeScript — zero platform, DOM, or database dependencies. Both
 * MobileDataLayer (local SQLite) and the web patterns backend (Supabase) feed
 * raw durable rows into these functions so the living concordance behaves
 * identically offline on-device and on the web.
 */

import { BIBLE_BOOKS } from './bible-canon';
import type {
  BookBridgeItem,
  BookBridgeResult,
  BookshelfClothState,
  BookshelfSummary,
  BookshelfVolume,
  FindingYouSignal,
  FindingYouTrace,
  JournalDayItem,
  NoteDayItem,
  HighlightDayItem,
  BookmarkDayItem,
  ReadingDayItem,
  PatternActivityCounts,
  PatternActivityType,
  PatternConnection,
  PatternDayDetail,
  PatternDaySummary,
  PatternEcho,
  PatternEvidence,
  PatternTheme,
  PatternTimeframe,
  PatternTrail,
  PatternTrailStep,
  PatternsSummary,
  ReturnedSignal,
} from './types';

const DAY_MS = 86_400_000;

// ── Canonical Scripture Shelf Groups (7 volumes) ─────────────────────────────

export interface ScriptureShelfGroup {
  id: string;
  label: string;
  testament: 'OT' | 'NT';
  books: readonly string[];
}

export const SCRIPTURE_SHELF_GROUPS: readonly ScriptureShelfGroup[] = [
  {
    id: 'law',
    label: 'Law',
    testament: 'OT',
    books: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'],
  },
  {
    id: 'history',
    label: 'History',
    testament: 'OT',
    books: [
      'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
      '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
      'Ezra', 'Nehemiah', 'Esther',
    ],
  },
  {
    id: 'wisdom',
    label: 'Wisdom',
    testament: 'OT',
    books: ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'],
  },
  {
    id: 'prophets',
    label: 'Prophets',
    testament: 'OT',
    books: [
      'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
      'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah',
      'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai',
      'Zechariah', 'Malachi',
    ],
  },
  {
    id: 'gospels',
    label: 'Gospels',
    testament: 'NT',
    books: ['Matthew', 'Mark', 'Luke', 'John', 'Acts'],
  },
  {
    id: 'epistles',
    label: 'Epistles',
    testament: 'NT',
    books: [
      'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
      'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
      '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
      'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
    ],
  },
  {
    id: 'revelation',
    label: 'Revelation',
    testament: 'NT',
    books: ['Revelation'],
  },
];

export const BIBLE_BOOK_ABBR: Readonly<Record<string, string>> = {
  Genesis: 'Gen', Exodus: 'Ex', Leviticus: 'Lev', Numbers: 'Num', Deuteronomy: 'Deut',
  Joshua: 'Josh', Judges: 'Jdg', Ruth: 'Ruth', '1 Samuel': '1Sa', '2 Samuel': '2Sa',
  '1 Kings': '1Ki', '2 Kings': '2Ki', '1 Chronicles': '1Ch', '2 Chronicles': '2Ch',
  Ezra: 'Ezr', Nehemiah: 'Neh', Esther: 'Est',
  Job: 'Job', Psalms: 'Psa', Proverbs: 'Prv', Ecclesiastes: 'Ecc', 'Song of Solomon': 'Song',
  Isaiah: 'Isa', Jeremiah: 'Jer', Lamentations: 'Lam', Ezekiel: 'Ezk', Daniel: 'Dan',
  Hosea: 'Hos', Joel: 'Jol', Amos: 'Amo', Obadiah: 'Oba', Jonah: 'Jon',
  Micah: 'Mic', Nahum: 'Nah', Habakkuk: 'Hab', Zephaniah: 'Zep', Haggai: 'Hag',
  Zechariah: 'Zec', Malachi: 'Mal',
  Matthew: 'Mat', Mark: 'Mrk', Luke: 'Luk', John: 'Jhn', Acts: 'Act',
  Romans: 'Rom', '1 Corinthians': '1Co', '2 Corinthians': '2Co', Galatians: 'Gal', Ephesians: 'Eph',
  Philippians: 'Php', Colossians: 'Col', '1 Thessalonians': '1Th', '2 Thessalonians': '2Th',
  '1 Timothy': '1Ti', '2 Timothy': '2Ti', Titus: 'Tit', Philemon: 'Phm', Hebrews: 'Heb',
  James: 'Jas', '1 Peter': '1Pe', '2 Peter': '2Pe', '1 John': '1Jn', '2 John': '2Jn', '3 John': '3Jn',
  Jude: 'Jud', Revelation: 'Rev',
};

export interface LiteratureShelfGroup {
  id: string;
  label: string;
  fullLabel: string;
}

export const LITERATURE_SHELF_GROUPS: readonly LiteratureShelfGroup[] = [
  { id: 'fathers', label: 'Fathers', fullLabel: 'Church Fathers' },
  { id: 'medieval', label: 'Medieval', fullLabel: 'Medieval Mystics' },
  { id: 'reform', label: 'Reform', fullLabel: 'Reform & Renewal' },
  { id: 'devotional', label: 'Devotional', fullLabel: 'Devotional & Poetry' },
  { id: 'personal', label: 'Personal', fullLabel: 'Personal Library' },
];

const BOOK_TO_GROUP = new Map<string, ScriptureShelfGroup>();
for (const group of SCRIPTURE_SHELF_GROUPS) {
  for (const book of group.books) {
    BOOK_TO_GROUP.set(book, group);
  }
}

const BOOK_ALIASES: Array<[RegExp, string]> = [
  [/^(?:psalms?|psa|ps)\b/i, 'Psalms'],
  [/^(?:song\s+of\s+solomon|song\s+of\s+songs|songs?|sng|sos)\b/i, 'Song of Solomon'],
  [/^(?:genesis|gen|ge)\b/i, 'Genesis'],
  [/^(?:exodus|exod|exo|ex)\b/i, 'Exodus'],
  [/^(?:leviticus|lev|le)\b/i, 'Leviticus'],
  [/^(?:numbers|num|nu)\b/i, 'Numbers'],
  [/^(?:deuteronomy|deut|deu|dt)\b/i, 'Deuteronomy'],
  [/^(?:joshua|josh|jos)\b/i, 'Joshua'],
  [/^(?:judges|judg|jdg)\b/i, 'Judges'],
  [/^(?:ruth|rut)\b/i, 'Ruth'],
  [/^(?:1\s*samuel|1\s*sam|1sa)\b/i, '1 Samuel'],
  [/^(?:2\s*samuel|2\s*sam|2sa)\b/i, '2 Samuel'],
  [/^(?:1\s*kings|1\s*kgs|1\s*ki|1ki)\b/i, '1 Kings'],
  [/^(?:2\s*kings|2\s*kgs|2\s*ki|2ki)\b/i, '2 Kings'],
  [/^(?:1\s*chronicles|1\s*chr|1\s*ch|1ch)\b/i, '1 Chronicles'],
  [/^(?:2\s*chronicles|2\s*chr|2\s*ch|2ch)\b/i, '2 Chronicles'],
  [/^(?:ezra|ezr)\b/i, 'Ezra'],
  [/^(?:nehemiah|neh)\b/i, 'Nehemiah'],
  [/^(?:esther|esth|est)\b/i, 'Esther'],
  [/^(?:job)\b/i, 'Job'],
  [/^(?:proverbs|prov|prv|pr)\b/i, 'Proverbs'],
  [/^(?:ecclesiastes|eccl|ecc)\b/i, 'Ecclesiastes'],
  [/^(?:isaiah|isa)\b/i, 'Isaiah'],
  [/^(?:jeremiah|jer)\b/i, 'Jeremiah'],
  [/^(?:lamentations|lam)\b/i, 'Lamentations'],
  [/^(?:ezekiel|ezek|ezk)\b/i, 'Ezekiel'],
  [/^(?:daniel|dan)\b/i, 'Daniel'],
  [/^(?:hosea|hos)\b/i, 'Hosea'],
  [/^(?:joel|jol)\b/i, 'Joel'],
  [/^(?:amos|amo)\b/i, 'Amos'],
  [/^(?:obadiah|obad|oba)\b/i, 'Obadiah'],
  [/^(?:jonah|jon)\b/i, 'Jonah'],
  [/^(?:micah|mic)\b/i, 'Micah'],
  [/^(?:nahum|nah)\b/i, 'Nahum'],
  [/^(?:habakkuk|hab)\b/i, 'Habakkuk'],
  [/^(?:zephaniah|zeph|zep)\b/i, 'Zephaniah'],
  [/^(?:haggai|hag)\b/i, 'Haggai'],
  [/^(?:zechariah|zech|zec)\b/i, 'Zechariah'],
  [/^(?:malachi|mal)\b/i, 'Malachi'],
  [/^(?:matthew|matt|mat|mt)\b/i, 'Matthew'],
  [/^(?:mark|mrk|mk)\b/i, 'Mark'],
  [/^(?:luke|luk|lk)\b/i, 'Luke'],
  [/^(?:1\s*john|1\s*jn|1jn)\b/i, '1 John'],
  [/^(?:2\s*john|2\s*jn|2jn)\b/i, '2 John'],
  [/^(?:3\s*john|3\s*jn|3jn)\b/i, '3 John'],
  [/^(?:john|joh|jhn|jn)\b/i, 'John'],
  [/^(?:acts|act)\b/i, 'Acts'],
  [/^(?:romans|rom)\b/i, 'Romans'],
  [/^(?:1\s*corinthians|1\s*cor|1co)\b/i, '1 Corinthians'],
  [/^(?:2\s*corinthians|2\s*cor|2co)\b/i, '2 Corinthians'],
  [/^(?:galatians|gal)\b/i, 'Galatians'],
  [/^(?:ephesians|eph)\b/i, 'Ephesians'],
  [/^(?:philippians|phil|php)\b/i, 'Philippians'],
  [/^(?:colossians|col)\b/i, 'Colossians'],
  [/^(?:1\s*thessalonians|1\s*thess|1th)\b/i, '1 Thessalonians'],
  [/^(?:2\s*thessalonians|2\s*thess|2th)\b/i, '2 Thessalonians'],
  [/^(?:1\s*timothy|1\s*tim|1ti)\b/i, '1 Timothy'],
  [/^(?:2\s*timothy|2\s*tim|2ti)\b/i, '2 Timothy'],
  [/^(?:titus|tit)\b/i, 'Titus'],
  [/^(?:philemon|phlm|phm)\b/i, 'Philemon'],
  [/^(?:hebrews|heb)\b/i, 'Hebrews'],
  [/^(?:james|jas|jam)\b/i, 'James'],
  [/^(?:1\s*peter|1\s*pet|1pe)\b/i, '1 Peter'],
  [/^(?:2\s*peter|2\s*pet|2pe)\b/i, '2 Peter'],
  [/^(?:jude|jud)\b/i, 'Jude'],
  [/^(?:revelation|rev)\b/i, 'Revelation'],
];

/**
 * Parse a canonical 66-book Bible name from a verse ref, chapter ref, or book_id
 * (e.g. "Matthew 6:34 (WEB)", "web_1_Peter", "Psalm 131:2", "Exod 16:4").
 */
export function parseBibleBookName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = String(raw).trim();
  if (!cleaned) return null;
  // Strip translation prefix like "web_", "WEB_", "kjv_"
  cleaned = cleaned.replace(/^(?:web|kjv|esv|niv|nrsv)[_-]+/i, '');
  // Replace underscores with spaces and strip trailing translation parenthetical
  cleaned = cleaned.replace(/_/g, ' ').replace(/\s*\([A-Z]{2,5}\)\s*$/i, '').trim();

  for (const [pattern, canonical] of BOOK_ALIASES) {
    if (pattern.test(cleaned)) return canonical;
  }
  return null;
}

/**
 * Parse `{ book, chapter, verse }` from a Scripture reference string.
 */
export function parseVerseRefParts(raw: string | null | undefined): {
  book: string | null;
  chapter: number | null;
  verse: number | null;
} {
  const book = parseBibleBookName(raw);
  if (!book || !raw) return { book: null, chapter: null, verse: null };
  const cleaned = String(raw).replace(/\s*\([A-Z]{2,5}\)\s*$/i, '').trim();
  const match = cleaned.match(/(\d+)(?::(\d+))?(?:\s*[-–]\s*\d+)?\s*$/);
  if (!match) return { book, chapter: null, verse: null };
  const chapter = Number(match[1]);
  const verse = match[2] ? Number(match[2]) : null;
  return {
    book,
    chapter: Number.isFinite(chapter) ? chapter : null,
    verse: verse !== null && Number.isFinite(verse) ? verse : null,
  };
}

/**
 * Map a library work's package_id / era / source string to one of the uniform
 * Literature shelf volumes: fathers | medieval | reform | devotional | personal.
 */
export function classifyLiteratureGroup(
  packageId?: string | null,
  era?: string | null,
  source?: string | null,
): string {
  if (
    source?.toLowerCase() === 'personal' ||
    packageId?.toLowerCase().startsWith('personal') ||
    era?.trim().toLowerCase() === 'personal'
  ) {
    return 'personal';
  }
  const combined = `${packageId ?? ''} ${era ?? ''}`.toLowerCase();
  if (/patristic|father|early|apostolic|nicene|antiquity/.test(combined)) return 'fathers';
  if (/medieval|mystic|scholastic|monastic|12th|13th|14th|15th/.test(combined)) return 'medieval';
  if (/reform|puritan|16th|17th|carmelite|jesuit/.test(combined)) return 'reform';
  return 'devotional';
}

/**
 * Short readable surname/label for a vertical book spine (e.g. "Julian of Norwich" -> "Julian",
 * "Thomas à Kempis" -> "Kempis", "John of the Cross" -> "John Cross").
 */
export function shortAuthorSpineLabel(author?: string | null, title?: string | null): string {
  const raw = (author ?? title ?? 'Voice').trim();
  if (!raw) return 'Voice';
  const lower = raw.toLowerCase();
  if (lower.includes('john of the cross')) return 'John Cross';
  if (lower.includes('thomas à kempis') || lower.includes('thomas a kempis')) return 'Kempis';
  if (lower.includes('thomas aquinas')) return 'Aquinas';
  if (lower.includes('brother lawrence')) return 'Lawrence';
  if (lower.includes('francis de sales')) return 'de Sales';
  if (lower.includes('cloud of unknowing')) return 'Cloud';
  if (lower.includes('caussade')) return 'Caussade';
  if (lower.includes('pseudo-dionysius') || lower.includes('dionysius')) return 'Dionysius';
  if (lower.includes('anonymous')) {
    const t = (title ?? 'Mystic').replace(/^The\s+/i, '').trim();
    return t.split(/\s+/)[0] || 'Mystic';
  }
  if (lower.includes('various')) {
    const t = (title ?? 'Fathers').replace(/^(?:ANF|NPNF)\s+Vol\.?\s*\d+:\s*/i, '').trim();
    return t.split(/[,:(\s]+/)[0] || 'Fathers';
  }
  // "Augustine of Hippo", "Julian of Norwich", "Catherine of Siena", "Anselm of Canterbury" -> first name
  const ofMatch = raw.match(/^([A-Za-zÀ-ÿ'-]+)\s+(?:of|the)\s+/i);
  if (ofMatch) return ofMatch[1];
  // "Martin Luther", "John Cassian", "Fyodor Dostoevsky" -> surname
  const parts = raw.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].replace(/[,.;:]+$/, '');
    if (last.length >= 3) return last;
  }
  return parts[0].slice(0, 12);
}

/**
 * Dynamically scale a vertical spine label's font size so long names like
 * "Devotional", "Revelation", or "Bonaventure" never clip.
 */
export function fitSpineFontSize(label: string, heightPx: number, baseSize = 11.5): number {
  const available = Math.max(24, heightPx - 43);
  const needed = label.length * baseSize * 0.62;
  if (needed <= available) return baseSize;
  const scaled = available / (label.length * 0.62);
  return Math.max(8, Math.floor(scaled * 2) / 2);
}

// ── Date / Timeframe Helpers ─────────────────────────────────────────────────

export function normalizePatternDate(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (value) {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

export function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function resolveTimeframeWindow(
  timeframe: PatternTimeframe = '30d',
  now: Date = new Date(),
): { start: string; end: string } {
  const end = now.toISOString().slice(0, 10);
  if (timeframe === 'all') {
    return { start: '2000-01-01', end };
  }
  const days = timeframe === '90d' ? 90 : 30;
  const startDate = new Date(now.getTime() - (days - 1) * DAY_MS);
  return { start: startDate.toISOString().slice(0, 10), end };
}

export function shiftDateDays(dateStr: string, deltaDays: number): string {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime();
  return new Date(t + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

export function eachDateInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(cur) || Number.isNaN(last)) return dates;
  for (let t = cur; t <= last; t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function inWindow(date: string | null, start: string, end: string): boolean {
  return Boolean(date && date >= start && date <= end);
}

function cleanExcerpt(text: unknown, max = 160): string {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
}

export function emptyActivityCounts(): PatternActivityCounts {
  return { journal: 0, reading: 0, highlight: 0, note: 0, bookmark: 0, echo: 0 };
}

// ── Raw Input Shapes (compatible with both SQLite & Supabase) ────────────────

export interface ConcordanceJournalRow {
  id: string;
  text: string;
  created_at: string | number | null;
  updated_at?: string | number | null;
}

export interface ConcordanceReadingRow {
  id?: string;
  book_id?: string | null;
  chapter?: number | null;
  verse_ref?: string | null;
  created_at: string | number | null;
}

export interface ConcordanceHighlightRow {
  id: string;
  verse_ref: string | null;
  color?: string | null;
  selected_text?: string | null;
  note_text?: string | null;
  note_updated_at?: string | number | null;
  created_at: string | number | null;
  updated_at?: string | number | null;
}

export interface ConcordanceBookmarkRow {
  id: string;
  verse_ref: string | null;
  label?: string | null;
  created_at: string | number | null;
}

export interface ConcordanceEventRow {
  id?: string;
  event_type?: string | null;
  occurred_at?: string | number | null;
  created_at?: string | number | null;
}

export interface ConcordanceNodeRow {
  id: string;
  node_type: string;
  source_table?: string | null;
  source_id: string;
  title?: string | null;
  body_text?: string | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

export interface ConcordanceEdgeRow {
  id: string;
  source_node_id?: string | null;
  source_type?: string | null;
  target_kind?: string | null;
  target_source?: string | null;
  target_id?: string | null;
  target_ref?: string | null;
  score?: number | null;
  confidence?: number | null;
  state?: string | null;
  evidence?: unknown;
  first_seen_at?: string | number | null;
  last_seen_at?: string | number | null;
  created_at?: string | number | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface ConcordanceThemeRow {
  id: string;
  label?: string | null;
  summary?: string | null;
  confidence?: number | null;
  evidence?: unknown;
  metadata?: Record<string, unknown> | string | null;
  valid_from?: string | number | null;
  window_start?: string | number | null;
  expires_at?: string | number | null;
  window_end?: string | number | null;
}

export interface InstalledVoiceBookInfo {
  id: string;
  title: string | null;
  author: string | null;
  era?: string | null;
  packageId?: string | null;
  source?: string | null;
}

export interface ConcordanceRawInput {
  journal: ConcordanceJournalRow[];
  reading: ConcordanceReadingRow[];
  highlights: ConcordanceHighlightRow[];
  bookmarks: ConcordanceBookmarkRow[];
  events: ConcordanceEventRow[];
  nodes: ConcordanceNodeRow[];
  edges: ConcordanceEdgeRow[];
  snapshots: ConcordanceThemeRow[];
  installedVoices: InstalledVoiceBookInfo[];
}

// ── Internal Parsing Helpers ─────────────────────────────────────────────────

function parseJsonSafe<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

function evidenceTypeFromRaw(raw: unknown): PatternEvidence['type'] {
  switch (raw) {
    case 'journal':
    case 'journal_entry':
      return 'journal';
    case 'reading':
    case 'reading_event':
    case 'scripture_passage':
    case 'voice_passage':
      return 'reading';
    case 'highlight':
      return 'highlight';
    case 'note':
      return 'note';
    case 'bookmark':
      return 'bookmark';
    case 'echo':
    case 'resonance':
      return 'echo';
    case 'edge':
      return 'edge';
    default:
      return 'theme';
  }
}

/**
 * Strip `:note` suffix from note resonance_node source_ids so connections attach
 * back to the underlying highlight/note item ID cleanly.
 */
function normalizeSourceItemId(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  return sourceId.endsWith(':note') ? sourceId.slice(0, -5) : sourceId;
}

function clothStateForCounts(counts: {
  read: number;
  highlights: number;
  notes: number;
  bookmarks: number;
  echoes: number;
}): BookshelfClothState {
  const visited = counts.read + counts.highlights + counts.notes + counts.bookmarks > 0;
  if (visited && counts.echoes >= 2) return 'walnut';
  if (visited) return 'read';
  if (counts.echoes > 0) return 'echo';
  return 'unread';
}

// ── Core Concordance Builders ────────────────────────────────────────────────

function addDayDot(
  days: Map<string, PatternDaySummary>,
  date: string | null,
  type: PatternActivityType,
): void {
  if (!date) return;
  const day = days.get(date);
  if (!day) return;
  day.counts[type] += 1;
  if (!day.dotTypes.includes(type)) day.dotTypes.push(type);
}

export function summarizeCalendarDays(
  raw: ConcordanceRawInput,
  start: string,
  end: string,
): PatternDaySummary[] {
  const days = new Map<string, PatternDaySummary>();
  for (const date of eachDateInRange(start, end)) {
    days.set(date, { date, counts: emptyActivityCounts(), dotTypes: [] });
  }

  for (const row of raw.journal) {
    addDayDot(days, normalizePatternDate(row.created_at), 'journal');
  }
  for (const row of raw.reading) {
    addDayDot(days, normalizePatternDate(row.created_at), 'reading');
  }
  for (const row of raw.highlights) {
    const createdDate = normalizePatternDate(row.created_at);
    if (inWindow(createdDate, start, end)) addDayDot(days, createdDate, 'highlight');
    if (row.note_text) {
      const noteDate = normalizePatternDate(row.note_updated_at ?? row.updated_at);
      if (inWindow(noteDate, start, end)) addDayDot(days, noteDate, 'note');
    }
  }
  for (const row of raw.bookmarks) {
    addDayDot(days, normalizePatternDate(row.created_at), 'bookmark');
  }
  for (const row of raw.events) {
    if (String(row.event_type ?? '').startsWith('resonance.')) {
      addDayDot(days, normalizePatternDate(row.occurred_at ?? row.created_at), 'echo');
    }
  }
  for (const row of raw.edges) {
    if (row.state === 'dismissed' || row.state === 'dormant') continue;
    addDayDot(days, normalizePatternDate(row.last_seen_at ?? row.created_at), 'echo');
  }

  return Array.from(days.values());
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had', 'was', 'were',
  'are', 'but', 'not', 'you', 'your', 'his', 'her', 'their', 'our', 'into', 'about', 'feel',
  'feeling', 'felt', 'really', 'just', 'been', 'being', 'will', 'would', 'could', 'should',
  'there', 'here', 'when', 'where', 'what', 'which', 'while', 'through', 'because', 'things',
  'thing', 'today', 'week', 'month', 'still', 'again', 'much', 'more', 'some', 'than', 'then',
  'they', 'them', 'very', 'only', 'also', 'like', 'want', 'need', 'know', 'think', 'thought',
  'going', 'trying', 'after', 'before', 'every', 'other', 'around', 'myself', 'without',
]);

function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function buildThemes(
  raw: ConcordanceRawInput,
  start: string,
  end: string,
): PatternTheme[] {
  const fromSnapshots: PatternTheme[] = raw.snapshots.map((row, index) => {
    const meta = parseJsonSafe<Record<string, unknown>>(row.metadata, {});
    const evidenceRaw = Array.isArray(row.evidence)
      ? row.evidence
      : Array.isArray(meta?.evidence)
        ? (meta.evidence as unknown[])
        : parseJsonSafe<unknown[]>(row.evidence, []);
    const evidence: PatternEvidence[] = evidenceRaw.slice(0, 8).map((item: any) => ({
      type: evidenceTypeFromRaw(item?.source_type),
      id: normalizeSourceItemId(item?.source_id ?? item?.source_node_id) ?? undefined,
      date: normalizePatternDate(item?.seen_at ?? item?.created_at) ?? undefined,
      title: item?.title ?? item?.source_type ?? 'Evidence',
      excerpt: cleanExcerpt(item?.excerpt ?? item?.text ?? item?.body_text),
    }));
    return {
      id: String(row.id ?? `theme-${index}`),
      label: String(row.label ?? 'Recent thread'),
      summary: String(row.summary ?? `Recently echoed around ${row.label ?? 'this thread'}`),
      confidence: Number(row.confidence ?? 0.5),
      evidenceCount: evidence.length || 0,
      dateRange: {
        start: normalizePatternDate(row.valid_from ?? row.window_start) ?? start,
        end: normalizePatternDate(row.expires_at ?? row.window_end) ?? end,
      },
      evidence,
    };
  });

  if (fromSnapshots.length > 0) {
    return fromSnapshots
      .filter((t) => t.confidence >= 0.45 || t.evidence.length >= 2)
      .slice(0, 5);
  }

  // Multi-source fallback across journal entries + highlight notes
  const buckets = new Map<string, PatternEvidence[]>();
  const addText = (text: string, ev: PatternEvidence) => {
    const words = extractTokens(text).filter((w) => w.length > 4);
    for (const word of new Set(words.slice(0, 60))) {
      const list = buckets.get(word) ?? [];
      list.push(ev);
      buckets.set(word, list);
    }
  };

  for (const entry of raw.journal) {
    addText(entry.text ?? '', {
      type: 'journal',
      id: String(entry.id),
      date: normalizePatternDate(entry.created_at) ?? undefined,
      title: 'Journal entry',
      excerpt: cleanExcerpt(entry.text),
    });
  }
  for (const hl of raw.highlights) {
    if (hl.note_text) {
      addText(hl.note_text, {
        type: 'note',
        id: String(hl.id),
        date: normalizePatternDate(hl.note_updated_at ?? hl.updated_at ?? hl.created_at) ?? undefined,
        title: hl.verse_ref ? `Note on ${hl.verse_ref}` : 'Note',
        ref: hl.verse_ref,
        excerpt: cleanExcerpt(hl.note_text),
      });
    }
  }

  return Array.from(buckets.entries())
    .filter(([, evidence]) => evidence.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label, evidence], index) => ({
      id: `fallback-theme-${index}-${label}`,
      label,
      summary: `Several traces touched on ${label}.`,
      confidence: Math.min(0.85, 0.3 + evidence.length * 0.12),
      evidenceCount: evidence.length,
      dateRange: { start, end },
      evidence: evidence.slice(0, 6),
    }));
}

interface ResolvedEdge {
  edge: ConcordanceEdgeRow;
  node: ConcordanceNodeRow | null;
  sourceItemId: string | null;
  sourceType: PatternActivityType;
  sourceExcerpt: string;
  sourceDate: string | null;
  targetKind: 'scripture' | 'voice' | 'past_entry' | 'highlight' | 'theme';
  targetLabel: string;
  targetBookName: string | null;
  targetBookId: string | null;
  targetExcerpt: string;
  confidence: number;
  lastSeenAt: string | null;
}

function resolveEdges(raw: ConcordanceRawInput): ResolvedEdge[] {
  const nodeById = new Map<string, ConcordanceNodeRow>();
  for (const n of raw.nodes) nodeById.set(n.id, n);

  const journalById = new Map<string, ConcordanceJournalRow>();
  for (const j of raw.journal) journalById.set(String(j.id), j);

  const highlightById = new Map<string, ConcordanceHighlightRow>();
  for (const h of raw.highlights) highlightById.set(String(h.id), h);

  const voiceById = new Map<string, InstalledVoiceBookInfo>();
  for (const v of raw.installedVoices) voiceById.set(v.id, v);

  const out: ResolvedEdge[] = [];

  for (const edge of raw.edges) {
    if (edge.state === 'dismissed' || edge.state === 'dormant') continue;
    const confidence = Number(edge.confidence ?? edge.score ?? 0);
    if (confidence < 0.15) continue;

    const meta = parseJsonSafe<Record<string, unknown>>(edge.metadata, {});
    const evidenceArr = parseJsonSafe<Array<Record<string, unknown>>>(edge.evidence, []);
    const node = edge.source_node_id ? nodeById.get(edge.source_node_id) ?? null : null;
    const sourceItemId = normalizeSourceItemId(node?.source_id);

    let sourceType: PatternActivityType = 'journal';
    let sourceExcerpt = cleanExcerpt(node?.body_text ?? '');
    let sourceDate = normalizePatternDate(
      node?.updated_at ?? node?.created_at ?? edge.last_seen_at ?? edge.created_at,
    );

    if (node?.node_type === 'highlight') {
      sourceType = 'highlight';
      const hl = sourceItemId ? highlightById.get(sourceItemId) : null;
      if (hl) {
        sourceExcerpt = cleanExcerpt(hl.selected_text ?? hl.note_text ?? hl.verse_ref ?? sourceExcerpt);
        sourceDate = normalizePatternDate(hl.created_at) ?? sourceDate;
      }
    } else if (node?.node_type === 'note') {
      sourceType = 'note';
      const hl = sourceItemId ? highlightById.get(sourceItemId) : null;
      if (hl) {
        sourceExcerpt = cleanExcerpt(hl.note_text ?? sourceExcerpt);
        sourceDate = normalizePatternDate(hl.note_updated_at ?? hl.updated_at ?? hl.created_at) ?? sourceDate;
      }
    } else if (sourceItemId && journalById.has(sourceItemId)) {
      const j = journalById.get(sourceItemId)!;
      sourceExcerpt = cleanExcerpt(j.text);
      sourceDate = normalizePatternDate(j.created_at) ?? sourceDate;
    }

    const targetKindRaw = String(edge.target_kind ?? meta.kind ?? 'scripture');
    const targetKind: ResolvedEdge['targetKind'] =
      targetKindRaw === 'voice'
        ? 'voice'
        : targetKindRaw === 'past_entry'
          ? 'past_entry'
          : targetKindRaw === 'highlight'
            ? 'highlight'
            : targetKindRaw === 'theme'
              ? 'theme'
              : 'scripture';

    const targetBookId =
      typeof meta.bookId === 'string'
        ? meta.bookId
        : typeof edge.target_source === 'string'
          ? edge.target_source
          : null;

    let targetLabel = String(
      edge.target_ref ?? meta.source ?? edge.target_source ?? edge.target_id ?? 'Related passage',
    ).trim();

    let targetBookName: string | null = null;
    if (targetKind === 'scripture') {
      targetBookName = parseBibleBookName(targetLabel) ?? parseBibleBookName(targetBookId);
    } else if (targetKind === 'voice') {
      const voice = targetBookId ? voiceById.get(targetBookId) : null;
      if (voice) {
        targetBookName = voice.author ?? voice.title ?? targetLabel;
        if (!targetLabel || targetLabel === targetBookId) {
          targetLabel = [voice.author, voice.title].filter(Boolean).join(' · ') || targetLabel;
        }
      } else {
        targetBookName = targetLabel.split(/\s+[—·-]\s+/)[0]?.trim() || targetLabel;
      }
    }

    const targetExcerpt = cleanExcerpt(
      evidenceArr[0]?.excerpt ?? meta.text ?? '',
      220,
    );

    out.push({
      edge,
      node,
      sourceItemId,
      sourceType,
      sourceExcerpt,
      sourceDate,
      targetKind,
      targetLabel,
      targetBookName,
      targetBookId,
      targetExcerpt,
      confidence,
      lastSeenAt: toIsoTimestamp(edge.last_seen_at ?? edge.created_at),
    });
  }

  return out;
}

function buildEchoes(resolved: ResolvedEdge[]): PatternEcho[] {
  return resolved
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((r, index) => {
      const evidence: PatternEvidence[] = [];
      if (r.sourceItemId) {
        evidence.push({
          type: r.sourceType,
          id: r.sourceItemId,
          date: r.sourceDate ?? undefined,
          title: r.sourceType === 'journal' ? 'Journal entry' : r.sourceType === 'note' ? 'Note' : 'Highlight',
          excerpt: r.sourceExcerpt || undefined,
        });
      }
      if (r.targetExcerpt) {
        evidence.push({
          type: 'edge',
          date: normalizePatternDate(r.lastSeenAt) ?? undefined,
          title: r.targetLabel,
          ref: r.targetLabel,
          bookId: r.targetBookId,
          excerpt: r.targetExcerpt,
        });
      }
      return {
        id: String(r.edge.id ?? `echo-${index}`),
        title: `This echoes ${r.targetLabel}`,
        sourceLabel: r.sourceType === 'journal' ? 'Journal entry' : r.sourceType,
        targetLabel: r.targetLabel,
        targetKind: r.targetKind,
        targetBookId: r.targetBookId,
        targetRef: r.targetLabel,
        sourceItemId: r.sourceItemId,
        reason: r.targetExcerpt
          ? `Sits near "${cleanExcerpt(r.targetExcerpt, 110)}"`
          : 'Semantic resonance',
        confidence: r.confidence,
        lastSeenAt: r.lastSeenAt,
        evidence,
      };
    });
}

/**
 * Build "What Kept Finding You" — passages and Christian voices that repeatedly
 * surfaced in resonance_edges across distinct journal entries / highlights / days,
 * noting when the user has not opened that book yet in this timeframe.
 */
function buildFindingYou(
  resolved: ResolvedEdge[],
  visitedBibleBooks: Set<string>,
  visitedVoiceIds: Set<string>,
): FindingYouSignal[] {
  interface Bucket {
    key: string;
    kind: 'scripture' | 'voice';
    ref: string;
    bookName: string;
    bookId: string | null;
    excerpt: string;
    maxConfidence: number;
    lastSeenAt: string | null;
    edgeIds: string[];
    tracesBySource: Map<string, FindingYouTrace>;
  }

  const buckets = new Map<string, Bucket>();

  for (const r of resolved) {
    if (r.targetKind !== 'scripture' && r.targetKind !== 'voice') continue;
    const refCleaned = r.targetLabel.replace(/\s*\([A-Z]{2,5}\)\s*$/i, '').trim();
    const key =
      r.targetKind === 'scripture'
        ? `scripture:${refCleaned.toLowerCase()}`
        : `voice:${(r.targetBookId ?? refCleaned).toLowerCase()}`;

    const existing = buckets.get(key) ?? {
      key,
      kind: r.targetKind,
      ref: refCleaned,
      bookName: r.targetBookName ?? refCleaned,
      bookId: r.targetBookId,
      excerpt: r.targetExcerpt,
      maxConfidence: r.confidence,
      lastSeenAt: r.lastSeenAt,
      edgeIds: [],
      tracesBySource: new Map<string, FindingYouTrace>(),
    };

    existing.edgeIds.push(String(r.edge.id));
    if (r.confidence > existing.maxConfidence) {
      existing.maxConfidence = r.confidence;
      if (r.targetExcerpt) existing.excerpt = r.targetExcerpt;
    }
    if (r.lastSeenAt && (!existing.lastSeenAt || r.lastSeenAt > existing.lastSeenAt)) {
      existing.lastSeenAt = r.lastSeenAt;
    }

    const traceKey = r.sourceItemId ?? `${r.sourceDate ?? 'recent'}-${r.edge.id}`;
    if (!existing.tracesBySource.has(traceKey)) {
      existing.tracesBySource.set(traceKey, {
        id: traceKey,
        date: r.sourceDate ?? '',
        type: r.sourceType,
        ref: r.node?.title ?? null,
        excerpt: r.sourceExcerpt || 'Recent reflection',
      });
    }

    buckets.set(key, existing);
  }

  // Prioritize targets echoed across 2+ distinct traces; if none yet, allow strong single echoes so the surface stays alive
  const all = Array.from(buckets.values());
  const multi = all.filter((b) => b.tracesBySource.size >= 2);
  const pool = multi.length > 0 ? multi : all.filter((b) => b.maxConfidence >= 0.35);

  return pool
    .sort(
      (a, b) =>
        b.tracesBySource.size - a.tracesBySource.size ||
        b.maxConfidence - a.maxConfidence,
    )
    .slice(0, 6)
    .map((b, idx) => {
      const traces = Array.from(b.tracesBySource.values()).sort((a, c) =>
        c.date.localeCompare(a.date),
      );
      const dated = traces.map((t) => t.date).filter(Boolean).sort();
      const dateSpan =
        dated.length >= 2 && dated[0] !== dated[dated.length - 1]
          ? `${formatShortDate(dated[0])} – ${formatShortDate(dated[dated.length - 1])}`
          : dated[0]
            ? formatShortDate(dated[0])
            : 'Recently';
      const count = traces.length;
      const neverRead =
        b.kind === 'scripture'
          ? !visitedBibleBooks.has(b.bookName)
          : !(b.bookId && visitedVoiceIds.has(b.bookId));

      return {
        id: `fy-${idx}-${b.key.replace(/[^a-z0-9]+/gi, '-')}`,
        kind: b.kind,
        ref: b.ref,
        bookName: b.bookName,
        bookId: b.bookId,
        count,
        span: `${count} ${count === 1 ? 'trace' : 'traces'} · ${dateSpan}`,
        neverRead,
        excerpt: b.excerpt,
        confidence: b.maxConfidence,
        lastSeenAt: b.lastSeenAt,
        edgeIds: b.edgeIds,
        traces: traces.slice(0, 4),
      };
    });
}

function buildReturnedTo(raw: ConcordanceRawInput): ReturnedSignal[] {
  const groups = new Map<string, ReturnedSignal>();
  const add = (
    key: string | null | undefined,
    type: PatternActivityType,
    evidence: PatternEvidence,
    when: string | null,
  ) => {
    if (!key) return;
    const normalizedKey = key.replace(/\s*\([A-Z]{2,5}\)\s*$/i, '').trim();
    if (!normalizedKey) return;
    const current = groups.get(normalizedKey) ?? {
      id: `returned-${normalizedKey}`,
      label: normalizedKey,
      count: 0,
      activityTypes: [],
      lastSeenAt: null,
      evidence: [],
    };
    current.count += 1;
    if (!current.activityTypes.includes(type)) current.activityTypes.push(type);
    current.evidence.push(evidence);
    if (when && (!current.lastSeenAt || when > current.lastSeenAt)) current.lastSeenAt = when;
    groups.set(normalizedKey, current);
  };

  for (const row of raw.reading) {
    const label = row.verse_ref || [parseBibleBookName(row.book_id) ?? row.book_id, row.chapter].filter(Boolean).join(' ');
    add(
      label,
      'reading',
      {
        type: 'reading',
        id: String(row.id ?? `${label}-${row.created_at}`),
        date: normalizePatternDate(row.created_at) ?? undefined,
        title: 'Read',
        ref: label,
        bookId: row.book_id ?? null,
      },
      toIsoTimestamp(row.created_at),
    );
  }
  for (const row of raw.highlights) {
    add(
      row.verse_ref,
      'highlight',
      {
        type: 'highlight',
        id: String(row.id),
        date: normalizePatternDate(row.created_at) ?? undefined,
        title: 'Highlight',
        ref: row.verse_ref,
        excerpt: cleanExcerpt(row.selected_text),
      },
      toIsoTimestamp(row.created_at),
    );
    if (row.note_text) {
      add(
        row.verse_ref,
        'note',
        {
          type: 'note',
          id: String(row.id),
          date: normalizePatternDate(row.note_updated_at ?? row.updated_at ?? row.created_at) ?? undefined,
          title: 'Note',
          ref: row.verse_ref,
          excerpt: cleanExcerpt(row.note_text),
        },
        toIsoTimestamp(row.note_updated_at ?? row.updated_at ?? row.created_at),
      );
    }
  }
  for (const row of raw.bookmarks) {
    add(
      row.verse_ref,
      'bookmark',
      {
        type: 'bookmark',
        id: String(row.id),
        date: normalizePatternDate(row.created_at) ?? undefined,
        title: row.label ?? 'Bookmark',
        ref: row.verse_ref,
      },
      toIsoTimestamp(row.created_at),
    );
  }

  return Array.from(groups.values())
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.activityTypes.length - a.activityTypes.length || b.count - a.count)
    .slice(0, 6)
    .map((s) => ({ ...s, evidence: s.evidence.slice(0, 6) }));
}

function buildTrails(
  findingYou: FindingYouSignal[],
  themes: PatternTheme[],
  returned: ReturnedSignal[],
  raw: ConcordanceRawInput,
): PatternTrail[] {
  const trails: PatternTrail[] = [];

  // 1. Multi-hop trails anchored by FindingYou + highlights/notes in the same book
  for (const fy of findingYou.slice(0, 2)) {
    const steps: PatternTrailStep[] = [];
    const evidence: PatternEvidence[] = [];

    for (const tr of fy.traces.slice(0, 2)) {
      steps.push({
        type: tr.type,
        date: formatShortDate(tr.date) || 'Recent',
        ref: tr.type === 'journal' ? 'Journal' : tr.ref || 'Trace',
        text: tr.excerpt,
      });
      evidence.push({
        type: tr.type,
        id: tr.id,
        date: tr.date || undefined,
        title: tr.ref ?? 'Journal',
        excerpt: tr.excerpt,
      });
    }

    steps.push({
      type: fy.kind === 'voice' ? 'voice' : 'echo',
      date: fy.neverRead ? 'Echoed (unread)' : 'Echoed',
      ref: fy.ref,
      bookId: fy.bookId,
      text: fy.excerpt || `Surfaced near ${fy.count} traces`,
    });
    evidence.push({
      type: 'echo',
      ref: fy.ref,
      bookId: fy.bookId,
      title: fy.ref,
      excerpt: fy.excerpt,
    });

    // Attach any highlight/note in the same Bible book as a cross-day bridge step
    if (fy.kind === 'scripture') {
      const bookHl = raw.highlights.find(
        (h) => parseBibleBookName(h.verse_ref) === fy.bookName,
      );
      if (bookHl) {
        const hlDate = normalizePatternDate(bookHl.note_updated_at ?? bookHl.created_at);
        steps.push({
          type: bookHl.note_text ? 'note' : 'highlight',
          date: formatShortDate(hlDate) || 'Highlight',
          ref: `${bookHl.verse_ref ?? fy.bookName} · ${bookHl.note_text ? 'Highlight + Note' : 'Highlight'}`,
          text: cleanExcerpt(bookHl.note_text ?? bookHl.selected_text ?? ''),
        });
        evidence.push({
          type: bookHl.note_text ? 'note' : 'highlight',
          id: String(bookHl.id),
          date: hlDate ?? undefined,
          ref: bookHl.verse_ref,
          excerpt: cleanExcerpt(bookHl.note_text ?? bookHl.selected_text ?? ''),
        });
      }
    }

    if (steps.length >= 2) {
      trails.push({
        id: `trail-fy-${fy.id}`,
        label: `Circling ${fy.ref}`,
        summary: `${steps.length} connected traces across ${fy.span}`,
        span: fy.span,
        steps,
        evidence,
      });
    }
  }

  // 2. Returned-to trails
  for (const signal of returned.slice(0, 2)) {
    if (trails.length >= 3) break;
    const steps: PatternTrailStep[] = signal.evidence.slice(0, 4).map((ev) => ({
      type: ev.type === 'theme' || ev.type === 'edge' ? 'reading' : ev.type,
      date: formatShortDate(ev.date) || 'Recent',
      ref: ev.ref ?? signal.label,
      bookId: ev.bookId ?? null,
      text: ev.excerpt || ev.title || 'Revisited',
    }));
    trails.push({
      id: `trail-returned-${signal.id}`,
      label: `Returned to ${signal.label}`,
      summary: `${signal.count} traces across ${signal.activityTypes.join(', ')}`,
      span: `${signal.count} traces`,
      steps,
      evidence: signal.evidence.slice(0, 5),
    });
  }

  // 3. Theme-based trails if space remains
  for (const theme of themes.slice(0, 2)) {
    if (trails.length >= 3) break;
    if (theme.evidence.length < 2) continue;
    const steps: PatternTrailStep[] = theme.evidence.slice(0, 4).map((ev) => ({
      type: ev.type === 'theme' || ev.type === 'edge' ? 'journal' : ev.type,
      date: formatShortDate(ev.date) || 'Recent',
      ref: ev.ref ?? ev.title ?? 'Trace',
      text: ev.excerpt || theme.summary,
    }));
    trails.push({
      id: `trail-theme-${theme.id}`,
      label: `A thread around ${theme.label}`,
      summary: `${theme.evidenceCount || theme.evidence.length} traces sit near this thread.`,
      span: `${formatShortDate(theme.dateRange.start)} – ${formatShortDate(theme.dateRange.end)}`,
      steps,
      evidence: theme.evidence.slice(0, 5),
    });
  }

  return trails.slice(0, 4);
}

/**
 * Build the 66-book Scripture shelf + Installed Literature shelf volumes with
 * exact read/highlight/note/bookmark/echo counts for the chosen timeframe.
 */
function buildBookshelf(
  raw: ConcordanceRawInput,
  resolved: ResolvedEdge[],
  timeframe: PatternTimeframe,
): {
  bookshelf: BookshelfSummary;
  visitedBibleBooks: Set<string>;
  visitedVoiceIds: Set<string>;
} {
  const bibleCounts = new Map<
    string,
    { read: number; highlights: number; notes: number; bookmarks: number; echoes: number }
  >();
  for (const b of BIBLE_BOOKS) {
    bibleCounts.set(b.name, { read: 0, highlights: 0, notes: 0, bookmarks: 0, echoes: 0 });
  }

  // Group installed voices by author (so multi-volume authors like Augustine stand as one crisp volume,
  // while keeping primary bookId & work subtitle for direct navigation)
  const voiceByBookId = new Map<string, InstalledVoiceBookInfo>();
  const voiceGroupsByAuthor = new Map<
    string,
    {
      id: string;
      primaryBookId: string;
      bookIds: Set<string>;
      author: string;
      spineLabel: string;
      primaryWork: string;
      groupId: string;
      worksCount: number;
      read: number;
      highlights: number;
      notes: number;
      bookmarks: number;
      echoes: number;
    }
  >();

  for (const v of raw.installedVoices) {
    voiceByBookId.set(v.id, v);
    const authorName = (v.author ?? v.title ?? v.id).trim();
    const spineLabel = shortAuthorSpineLabel(v.author, v.title);
    const authorKey = spineLabel.toLowerCase();
    const existing = voiceGroupsByAuthor.get(authorKey);
    if (existing) {
      existing.bookIds.add(v.id);
      existing.worksCount += 1;
    } else {
      voiceGroupsByAuthor.set(authorKey, {
        id: v.id,
        primaryBookId: v.id,
        bookIds: new Set([v.id]),
        author: authorName,
        spineLabel,
        primaryWork: (v.title ?? authorName).trim(),
        groupId: classifyLiteratureGroup(v.packageId, v.era, v.source),
        worksCount: 1,
        read: 0,
        highlights: 0,
        notes: 0,
        bookmarks: 0,
        echoes: 0,
      });
    }
  }

  const findVoiceGroup = (bookId?: string | null, ref?: string | null) => {
    if (bookId) {
      for (const g of voiceGroupsByAuthor.values()) {
        if (g.bookIds.has(bookId)) return g;
      }
    }
    if (ref) {
      const lower = ref.toLowerCase();
      for (const g of voiceGroupsByAuthor.values()) {
        if (
          lower.includes(g.spineLabel.toLowerCase()) ||
          lower.includes(g.author.toLowerCase())
        ) {
          return g;
        }
      }
    }
    return null;
  };

  for (const row of raw.reading) {
    const bibleBook = parseBibleBookName(row.verse_ref) ?? parseBibleBookName(row.book_id);
    if (bibleBook && bibleCounts.has(bibleBook)) {
      bibleCounts.get(bibleBook)!.read += 1;
    } else {
      const vg = findVoiceGroup(row.book_id, row.verse_ref);
      if (vg) vg.read += 1;
    }
  }

  for (const row of raw.highlights) {
    const bibleBook = parseBibleBookName(row.verse_ref);
    if (bibleBook && bibleCounts.has(bibleBook)) {
      bibleCounts.get(bibleBook)!.highlights += 1;
      if (row.note_text) bibleCounts.get(bibleBook)!.notes += 1;
    } else {
      const vg = findVoiceGroup(null, row.verse_ref);
      if (vg) {
        vg.highlights += 1;
        if (row.note_text) vg.notes += 1;
      }
    }
  }

  for (const row of raw.bookmarks) {
    const bibleBook = parseBibleBookName(row.verse_ref);
    if (bibleBook && bibleCounts.has(bibleBook)) {
      bibleCounts.get(bibleBook)!.bookmarks += 1;
    } else {
      const vg = findVoiceGroup(null, row.verse_ref);
      if (vg) vg.bookmarks += 1;
    }
  }

  for (const r of resolved) {
    if (r.targetKind === 'scripture' && r.targetBookName && bibleCounts.has(r.targetBookName)) {
      bibleCounts.get(r.targetBookName)!.echoes += 1;
    } else if (r.targetKind === 'voice') {
      const vg = findVoiceGroup(r.targetBookId, r.targetLabel);
      if (vg) vg.echoes += 1;
    }
  }

  const visitedBibleBooks = new Set<string>();
  const scripture: BookshelfVolume[] = BIBLE_BOOKS.map((b) => {
    const c = bibleCounts.get(b.name)!;
    const grp = BOOK_TO_GROUP.get(b.name);
    if (c.read + c.highlights + c.notes + c.bookmarks > 0) visitedBibleBooks.add(b.name);
    return {
      kind: 'bible',
      id: b.name,
      bookId: `web_${b.name.replace(/\s+/g, '_')}`,
      spineLabel: BIBLE_BOOK_ABBR[b.name] ?? b.name.slice(0, 4),
      title: b.name,
      subtitle: `${b.testament === 'OT' ? 'Old Testament' : 'New Testament'} · ${grp?.label ?? 'Scripture'}`,
      groupId: grp?.id ?? 'law',
      testament: b.testament,
      readCount: c.read,
      highlightCount: c.highlights,
      noteCount: c.notes,
      bookmarkCount: c.bookmarks,
      echoCount: c.echoes,
      clothState: clothStateForCounts(c),
    };
  });

  const visitedVoiceIds = new Set<string>();
  const literature: BookshelfVolume[] = Array.from(voiceGroupsByAuthor.values())
    .sort((a, b) => a.spineLabel.localeCompare(b.spineLabel))
    .map((g) => {
      if (g.read + g.highlights + g.notes + g.bookmarks > 0) {
        for (const bid of g.bookIds) visitedVoiceIds.add(bid);
      }
      const eraMeta = LITERATURE_SHELF_GROUPS.find((x) => x.id === g.groupId);
      return {
        kind: 'voice',
        id: g.primaryBookId,
        bookId: g.primaryBookId,
        spineLabel: g.spineLabel,
        title: g.author,
        subtitle: `${g.primaryWork}${g.worksCount > 1 ? ` (+${g.worksCount - 1})` : ''} · ${eraMeta?.fullLabel ?? 'Library'}`,
        groupId: g.groupId,
        readCount: g.read,
        highlightCount: g.highlights,
        noteCount: g.notes,
        bookmarkCount: g.bookmarks,
        echoCount: g.echoes,
        clothState: clothStateForCounts(g),
        worksCount: g.worksCount,
      };
    });

  return {
    bookshelf: { timeframe, scripture, literature },
    visitedBibleBooks,
    visitedVoiceIds,
  };
}

function buildRecentlyText(
  findingYou: FindingYouSignal[],
  themes: PatternTheme[],
  raw: ConcordanceRawInput,
  timeframe: PatternTimeframe,
): string {
  const windowPhrase =
    timeframe === 'all'
      ? 'Across your stored traces'
      : timeframe === '90d'
        ? 'Over the last 90 days'
        : 'Recently';

  if (findingYou.length > 0) {
    const names = findingYou
      .slice(0, 3)
      .map((f) => f.ref)
      .join(', ');
    return `${windowPhrase}, your writing kept circling near ${names}.`;
  }
  if (themes.length > 0) {
    const labels = themes
      .slice(0, 3)
      .map((t) => t.label)
      .join(', ');
    return `${windowPhrase}, several traces gathered around ${labels}.`;
  }
  const pieces: string[] = [];
  if (raw.journal.length) {
    pieces.push(`${raw.journal.length} journal ${raw.journal.length === 1 ? 'entry' : 'entries'}`);
  }
  if (raw.reading.length) {
    pieces.push(`${raw.reading.length} reading ${raw.reading.length === 1 ? 'trace' : 'traces'}`);
  }
  const noteCount = raw.highlights.filter((h) => h.note_text).length;
  if (raw.highlights.length) {
    pieces.push(`${raw.highlights.length} ${raw.highlights.length === 1 ? 'highlight' : 'highlights'}`);
  }
  if (noteCount) pieces.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
  if (pieces.length === 0) {
    return 'Patterns need a few traces: journal entries, readings, highlights, or notes.';
  }
  return `${windowPhrase}, your activity includes ${pieces.join(', ')}.`;
}

function buildQuietQuestion(
  findingYou: FindingYouSignal[],
  returned: ReturnedSignal[],
  themes: PatternTheme[],
  raw: ConcordanceRawInput,
): string {
  if (findingYou.length > 0) {
    const top = findingYou[0];
    return `${top.ref} surfaced near ${top.count} of your recent ${top.count === 1 ? 'traces' : 'traces'}. What part of that feels closest to what you are carrying?`;
  }
  if (returned.length > 0) {
    return `You returned to ${returned[0].label}. What part of that has stayed with you?`;
  }
  if (themes.length > 0) {
    return `Several traces touched ${themes[0].label}. What do you want to notice about that?`;
  }
  if (raw.journal.length > 0) {
    return 'Looking back at these entries, what seems worth remembering?';
  }
  return 'What are you noticing these days?';
}

// ── Unified Connections & Item Index ─────────────────────────────────────────

function nodeIdsFromEvidence(evidence: PatternEvidence[]): string[] {
  return evidence.map((e) => e.id).filter((id): id is string => Boolean(id));
}

function buildConnectionsList(
  echoes: PatternEcho[],
  returned: ReturnedSignal[],
  themes: PatternTheme[],
  trails: PatternTrail[],
): PatternConnection[] {
  const list: PatternConnection[] = [];

  for (const echo of echoes) {
    const srcIds = [
      ...(echo.sourceItemId ? [echo.sourceItemId] : []),
      ...nodeIdsFromEvidence(echo.evidence),
    ];
    list.push({
      kind: 'echo',
      id: echo.id,
      label: echo.title,
      summary: echo.reason,
      confidence: echo.confidence,
      ref: echo.targetRef ?? echo.targetLabel,
      bookId: echo.targetBookId ?? null,
      edgeId: echo.id,
      evidence: echo.evidence,
      sourceNodeIds: Array.from(new Set(srcIds)),
    });
  }

  for (const signal of returned) {
    list.push({
      kind: 'returned_to',
      id: signal.id,
      label: signal.label,
      summary: `${signal.count} traces across ${signal.activityTypes.join(', ')}`,
      ref: signal.label,
      evidence: signal.evidence,
      sourceNodeIds: nodeIdsFromEvidence(signal.evidence),
    });
  }

  for (const theme of themes) {
    list.push({
      kind: 'theme',
      id: theme.id,
      label: theme.label,
      summary: theme.summary,
      confidence: theme.confidence,
      evidence: theme.evidence,
      sourceNodeIds: nodeIdsFromEvidence(theme.evidence),
    });
  }

  for (const trail of trails) {
    list.push({
      kind: 'trail',
      id: trail.id,
      label: trail.label,
      summary: trail.summary,
      evidence: trail.evidence,
      sourceNodeIds: nodeIdsFromEvidence(trail.evidence),
    });
  }

  return list;
}

function buildItemConnectionIndex(
  connections: PatternConnection[],
): Map<string, PatternConnection[]> {
  const index = new Map<string, PatternConnection[]>();
  for (const connection of connections) {
    const ids = new Set<string>([
      ...(connection.sourceNodeIds ?? []),
      ...(connection.targetNodeIds ?? []),
      ...connection.evidence.map((e) => e.id).filter((id): id is string => Boolean(id)),
    ]);
    for (const id of ids) {
      const list = index.get(id) ?? [];
      if (!list.some((c) => c.kind === connection.kind && c.id === connection.id)) {
        list.push(connection);
        index.set(id, list);
      }
    }
  }
  return index;
}

// ── Public Entry Points ──────────────────────────────────────────────────────

export function buildConcordanceSummary(input: {
  calendarRaw: ConcordanceRawInput;
  timeframeRaw: ConcordanceRawInput;
  calendarWindow: { start: string; end: string };
  timeframe: PatternTimeframe;
}): PatternsSummary {
  const { calendarRaw, timeframeRaw, calendarWindow, timeframe } = input;
  const tfWindow = resolveTimeframeWindow(timeframe);

  const days = summarizeCalendarDays(calendarRaw, calendarWindow.start, calendarWindow.end);
  const resolvedEdges = resolveEdges(timeframeRaw);
  const { bookshelf, visitedBibleBooks, visitedVoiceIds } = buildBookshelf(
    timeframeRaw,
    resolvedEdges,
    timeframe,
  );
  const echoes = buildEchoes(resolvedEdges);
  const findingYou = buildFindingYou(resolvedEdges, visitedBibleBooks, visitedVoiceIds);
  const returned = buildReturnedTo(timeframeRaw);
  const themes = buildThemes(timeframeRaw, tfWindow.start, tfWindow.end);
  const trails = buildTrails(findingYou, themes, returned, timeframeRaw);
  const noteCount = timeframeRaw.highlights.filter((h) => h.note_text).length;

  return {
    window: calendarWindow,
    timeframe,
    recently: buildRecentlyText(findingYou, themes, timeframeRaw, timeframe),
    days,
    themes,
    echoes,
    findingYou,
    returnedTo: returned,
    trails,
    bookshelf,
    quietQuestion: buildQuietQuestion(findingYou, returned, themes, timeframeRaw),
    health: {
      journalEntryCount: timeframeRaw.journal.length,
      readingEventCount: timeframeRaw.reading.length,
      highlightCount: timeframeRaw.highlights.length,
      noteCount,
      bookmarkCount: timeframeRaw.bookmarks.length,
      echoCount: echoes.length,
    },
  };
}

/**
 * Build day detail for `date`, while computing connections across a wider
 * `contextRaw` (e.g. rolling 30-day window) so cross-day echoes, returns,
 * and trails properly attach to items recorded on `date`.
 */
export function buildConcordanceDayDetail(input: {
  date: string;
  contextRaw: ConcordanceRawInput;
  contextStart: string;
  contextEnd: string;
}): PatternDayDetail {
  const { date, contextRaw, contextStart, contextEnd } = input;

  // Filter activity items strictly to `date`
  const dayJournalRows = contextRaw.journal.filter(
    (r) => normalizePatternDate(r.created_at) === date,
  );
  const dayReadingRows = contextRaw.reading.filter(
    (r) => normalizePatternDate(r.created_at) === date,
  );
  const dayHighlightRows = contextRaw.highlights.filter(
    (r) => normalizePatternDate(r.created_at) === date,
  );
  const dayNoteRows = contextRaw.highlights.filter(
    (r) => r.note_text && normalizePatternDate(r.note_updated_at ?? r.updated_at) === date,
  );
  const dayBookmarkRows = contextRaw.bookmarks.filter(
    (r) => normalizePatternDate(r.created_at) === date,
  );

  const daySummary = summarizeCalendarDays(contextRaw, date, date)[0] ?? {
    date,
    counts: emptyActivityCounts(),
    dotTypes: [],
  };

  const journal: JournalDayItem[] = dayJournalRows.map((row) => ({
    id: String(row.id),
    excerpt: cleanExcerpt(row.text, 220),
    createdAt: toIsoTimestamp(row.created_at),
    connections: [],
  }));

  const reading: ReadingDayItem[] = dayReadingRows.map((row) => {
    const label = String(
      row.verse_ref ||
        [parseBibleBookName(row.book_id) ?? row.book_id, row.chapter].filter(Boolean).join(' ') ||
        'Reading',
    );
    return {
      id: String(row.id ?? `${label}-${row.created_at}`),
      label,
      ref: row.verse_ref ?? label,
      bookId: row.book_id ?? null,
      createdAt: toIsoTimestamp(row.created_at),
      connections: [],
    };
  });

  const highlights: HighlightDayItem[] = dayHighlightRows.map((row) => ({
    id: String(row.id),
    verseRef: row.verse_ref ?? null,
    selectedText: row.selected_text ?? null,
    color: row.color ?? null,
    createdAt: toIsoTimestamp(row.created_at),
    connections: [],
  }));

  const notes: NoteDayItem[] = dayNoteRows.map((row) => ({
    id: String(row.id),
    verseRef: row.verse_ref ?? null,
    noteExcerpt: cleanExcerpt(row.note_text, 220),
    updatedAt: toIsoTimestamp(row.note_updated_at ?? row.updated_at),
    connections: [],
  }));

  const bookmarks: BookmarkDayItem[] = dayBookmarkRows.map((row) => ({
    id: String(row.id),
    verseRef: row.verse_ref ?? null,
    label: row.label ?? null,
    createdAt: toIsoTimestamp(row.created_at),
    connections: [],
  }));

  // Compute cross-day connections across the full rolling context window
  const resolvedEdges = resolveEdges(contextRaw);
  const { visitedBibleBooks, visitedVoiceIds } = buildBookshelf(contextRaw, resolvedEdges, '30d');
  const echoes = buildEchoes(resolvedEdges);
  const findingYou = buildFindingYou(resolvedEdges, visitedBibleBooks, visitedVoiceIds);
  const returned = buildReturnedTo(contextRaw);
  const themes = buildThemes(contextRaw, contextStart, contextEnd);
  const trails = buildTrails(findingYou, themes, returned, contextRaw);

  const allConnections = buildConnectionsList(echoes, returned, themes, trails);
  const index = buildItemConnectionIndex(allConnections);

  const dayItemIds = new Set<string>();
  for (const item of journal) {
    item.connections = (index.get(item.id) ?? []).slice(0, 4);
    dayItemIds.add(item.id);
  }
  for (const item of reading) {
    item.connections = (index.get(item.id) ?? []).slice(0, 4);
    dayItemIds.add(item.id);
  }
  for (const item of highlights) {
    item.connections = (index.get(item.id) ?? []).slice(0, 4);
    dayItemIds.add(item.id);
  }
  for (const item of notes) {
    item.connections = (index.get(item.id) ?? []).slice(0, 4);
    dayItemIds.add(item.id);
  }
  for (const item of bookmarks) {
    item.connections = (index.get(item.id) ?? []).slice(0, 4);
    dayItemIds.add(item.id);
  }

  // Keep only connections touching at least one trace from this day
  const dayConnections = allConnections
    .filter((conn) => {
      const ids = [
        ...(conn.sourceNodeIds ?? []),
        ...(conn.targetNodeIds ?? []),
        ...conn.evidence.map((e) => e.id).filter((id): id is string => Boolean(id)),
      ];
      return ids.some((id) => dayItemIds.has(id));
    })
    .slice(0, 8);

  return {
    date,
    counts: daySummary.counts,
    journal,
    reading,
    highlights,
    notes,
    bookmarks,
    connections: dayConnections,
  };
}

// ── Book-Scoped Bridge Builder (Works for BOTH Visited & Unread Books!) ──────

export interface CandidateBookPassage {
  id: number;
  ref: string;
  bookId: string;
  chapter?: number | null;
  verse?: number | null;
  text: string;
}

export interface CrossRefBridgePair {
  fromHighlightRef: string;
  fromExcerpt?: string | null;
  targetRef: string;
  targetText?: string | null;
}

export interface VectorBridgeHit {
  passage: CandidateBookPassage;
  score: number;
  journalDate: string | null;
  journalExcerpt: string;
}

/**
 * Build the live Book Bridge card for ANY Bible book or installed Voice book —
 * combining user traces (if visited), stored echoes, canonical cross-references
 * from user highlights, 512d vector bridges (when present on-device), and
 * book-scoped lexical passage bridges against the user's recent journal & notes.
 */
export function buildBookBridgesFromData(input: {
  kind: 'bible' | 'voice';
  id: string;
  bookId: string;
  title: string;
  subtitle: string;
  timeframe: PatternTimeframe;
  raw: ConcordanceRawInput;
  bookPassages: CandidateBookPassage[];
  crossRefPairs?: CrossRefBridgePair[];
  vectorBridgeHits?: VectorBridgeHit[];
}): BookBridgeResult {
  const {
    kind,
    id,
    bookId,
    title,
    subtitle,
    timeframe,
    raw,
    bookPassages,
    crossRefPairs = [],
    vectorBridgeHits = [],
  } = input;
  const resolvedEdges = resolveEdges(raw);
  const items: BookBridgeItem[] = [];

  const matchesBook = (ref?: string | null, rowBookId?: string | null): boolean => {
    if (kind === 'bible') {
      const targetName = parseBibleBookName(id) ?? id;
      return (
        parseBibleBookName(ref) === targetName ||
        parseBibleBookName(rowBookId) === targetName
      );
    }
    const lowerTitle = title.toLowerCase();
    const lowerId = id.toLowerCase();
    const lowerBookId = bookId.toLowerCase();
    if (rowBookId && (rowBookId.toLowerCase() === lowerBookId || rowBookId.toLowerCase() === lowerId)) {
      return true;
    }
    if (ref && (ref.toLowerCase().includes(lowerTitle) || ref.toLowerCase().includes(shortAuthorSpineLabel(title).toLowerCase()))) {
      return true;
    }
    return false;
  };

  let readCount = 0;
  let highlightCount = 0;
  let noteCount = 0;
  let bookmarkCount = 0;
  let echoCount = 0;

  // 1. User's own traces inside this book
  for (const hl of raw.highlights) {
    if (!matchesBook(hl.verse_ref, null)) continue;
    highlightCount += 1;
    if (hl.note_text) noteCount += 1;
    const parts = parseVerseRefParts(hl.verse_ref);
    const d = normalizePatternDate(hl.note_updated_at ?? hl.created_at);
    items.push({
      id: `hl-${hl.id}`,
      via: 'trace',
      viaLabel: hl.note_text ? 'Your highlight & note' : 'Your highlight',
      ref: hl.verse_ref ?? title,
      bookId,
      chapter: parts.chapter,
      verse: parts.verse,
      quote: cleanExcerpt(hl.selected_text ?? hl.note_text ?? '', 170),
      linkText: hl.note_text
        ? `Note (${formatShortDate(d)}): “${cleanExcerpt(hl.note_text, 100)}”`
        : `Highlighted ${formatShortDate(d)}`,
      date: d,
    });
  }

  for (const r of raw.reading) {
    if (!matchesBook(r.verse_ref, r.book_id)) continue;
    readCount += 1;
  }

  for (const bm of raw.bookmarks) {
    if (!matchesBook(bm.verse_ref, null)) continue;
    bookmarkCount += 1;
  }

  // 2. Stored resonance echoes targeting this book
  for (const edge of resolvedEdges) {
    if (kind === 'bible' && edge.targetKind !== 'scripture') continue;
    if (kind === 'voice' && edge.targetKind !== 'voice') continue;
    if (!matchesBook(edge.targetLabel, edge.targetBookId)) continue;
    echoCount += 1;
    const parts = parseVerseRefParts(edge.targetLabel);
    items.push({
      id: `echo-${edge.edge.id}`,
      via: 'echo',
      viaLabel: '✦ Kept finding you',
      ref: edge.targetLabel.replace(/\s*\([A-Z]{2,5}\)\s*$/i, ''),
      bookId: edge.targetBookId ?? bookId,
      chapter: parts.chapter,
      verse: parts.verse,
      quote: edge.targetExcerpt || 'Echoed near your recent reflection',
      linkText: edge.sourceExcerpt
        ? `Near your ${formatShortDate(edge.sourceDate)} ${edge.sourceType}: “${cleanExcerpt(edge.sourceExcerpt, 90)}”`
        : `Echoed near your ${formatShortDate(edge.sourceDate)} activity`,
      date: edge.sourceDate,
    });
  }

  // 3. Cross-reference bridges from user highlights in OTHER books into this book
  for (let i = 0; i < crossRefPairs.length && items.length < 6; i++) {
    const pair = crossRefPairs[i];
    const parts = parseVerseRefParts(pair.targetRef);
    items.push({
      id: `xref-${i}-${pair.targetRef}`,
      via: 'crossref',
      viaLabel: 'Cross-ref',
      ref: pair.targetRef,
      bookId,
      chapter: parts.chapter,
      verse: parts.verse,
      quote: pair.targetText
        ? cleanExcerpt(pair.targetText, 170)
        : `Cross-referenced directly from ${pair.fromHighlightRef}`,
      linkText: pair.fromExcerpt
        ? `From your ${pair.fromHighlightRef} highlight: “${cleanExcerpt(pair.fromExcerpt, 85)}”`
        : `Canonically linked to your ${pair.fromHighlightRef} highlight`,
      date: null,
    });
  }

  // 3b. Precomputed 512d int8 semantic vector bridges (when offline engine vectors exist)
  if (vectorBridgeHits.length > 0 && items.length < 4) {
    const existingRefs = new Set(items.map((it) => it.ref.toLowerCase()));
    for (const hit of vectorBridgeHits) {
      if (items.length >= 4) break;
      if (existingRefs.has(hit.passage.ref.toLowerCase())) continue;
      existingRefs.add(hit.passage.ref.toLowerCase());
      items.push({
        id: `vec-${hit.passage.id}`,
        via: 'semantic',
        viaLabel: '✦ Near your words',
        ref: hit.passage.ref,
        bookId: hit.passage.bookId || bookId,
        chapter: hit.passage.chapter ?? null,
        verse: hit.passage.verse ?? null,
        quote: cleanExcerpt(hit.passage.text, 180),
        linkText: `Near your ${formatShortDate(hit.journalDate) || 'recent'} journal: “${cleanExcerpt(hit.journalExcerpt, 90)}”`,
        date: hit.journalDate,
      });
    }
  }

  // 4. Book-scoped lexical/concept bridge against user's recent journal entries & notes
  //    Guarantees EVEN COMPLETELY UNREAD books have warm, grounded ways in!
  if (bookPassages.length > 0 && items.length < 4) {
    const userDocs: Array<{ label: string; excerpt: string; tokens: Set<string>; date: string | null }> = [];
    for (const j of raw.journal.slice(0, 25)) {
      const toks = new Set(extractTokens(j.text ?? ''));
      if (toks.size > 0) {
        const d = normalizePatternDate(j.created_at);
        userDocs.push({
          label: `Near your ${formatShortDate(d) || 'recent'} journal`,
          excerpt: cleanExcerpt(j.text, 90),
          tokens: toks,
          date: d,
        });
      }
    }
    for (const hl of raw.highlights.slice(0, 25)) {
      if (!hl.note_text) continue;
      const toks = new Set(extractTokens(`${hl.selected_text ?? ''} ${hl.note_text}`));
      if (toks.size > 0) {
        const d = normalizePatternDate(hl.note_updated_at ?? hl.created_at);
        userDocs.push({
          label: `Near your ${hl.verse_ref ?? 'highlight'} note`,
          excerpt: cleanExcerpt(hl.note_text, 90),
          tokens: toks,
          date: d,
        });
      }
    }

    if (userDocs.length > 0) {
      const scored: Array<{
        passage: CandidateBookPassage;
        score: number;
        bestDoc: (typeof userDocs)[number];
      }> = [];

      const existingRefs = new Set(items.map((it) => it.ref.toLowerCase()));

      for (const p of bookPassages) {
        if (existingRefs.has(p.ref.toLowerCase())) continue;
        const pTokens = new Set(extractTokens(p.text));
        if (pTokens.size === 0) continue;

        let bestScore = 0;
        let bestDoc = userDocs[0];
        for (const doc of userDocs) {
          let overlap = 0;
          for (const t of doc.tokens) {
            if (pTokens.has(t)) overlap += 1;
          }
          if (overlap === 0) continue;
          const score = overlap / Math.sqrt(doc.tokens.size * pTokens.size);
          if (score > bestScore) {
            bestScore = score;
            bestDoc = doc;
          }
        }

        if (bestScore > 0.04) {
          scored.push({ passage: p, score: bestScore, bestDoc });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const needed = Math.max(1, 3 - items.length);
      for (const hit of scored.slice(0, needed)) {
        items.push({
          id: `bridge-${hit.passage.id}`,
          via: 'semantic',
          viaLabel: '✦ Near your words',
          ref: hit.passage.ref,
          bookId: hit.passage.bookId || bookId,
          chapter: hit.passage.chapter ?? null,
          verse: hit.passage.verse ?? null,
          quote: cleanExcerpt(hit.passage.text, 180),
          linkText: `${hit.bestDoc.label}: “${hit.bestDoc.excerpt}”`,
          date: hit.bestDoc.date,
        });
      }
    }

    // Gentle opening invitation if user has zero journal/highlight tokens yet
    if (items.length === 0) {
      const opening = bookPassages[0];
      items.push({
        id: `open-${opening.id}`,
        via: 'semantic',
        viaLabel: 'Opening passage',
        ref: opening.ref,
        bookId: opening.bookId || bookId,
        chapter: opening.chapter ?? null,
        verse: opening.verse ?? null,
        quote: cleanExcerpt(opening.text, 180),
        linkText: 'Start reading here — as you write and highlight, Resonance will bridge passages directly to your life.',
        date: null,
      });
    }
  }

  const visited = readCount + highlightCount + noteCount + bookmarkCount > 0;

  return {
    kind,
    id,
    bookId,
    title,
    subtitle,
    timeframe,
    visited,
    counts: {
      read: readCount,
      highlights: highlightCount,
      notes: noteCount,
      bookmarks: bookmarkCount,
      echoes: echoCount,
    },
    items: items.slice(0, 5),
  };
}
