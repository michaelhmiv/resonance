import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import {
  buildBookBridgesFromData,
  buildConcordanceDayDetail,
  buildConcordanceSummary,
  classifyLiteratureGroup,
  LITERATURE_SHELF_GROUPS,
  normalizePatternDate,
  parseBibleBookName,
  resolveTimeframeWindow,
  shiftDateDays,
  type BookBridgeResult,
  type CandidateBookPassage,
  type ConcordanceRawInput,
  type CrossRefBridgePair,
  type InstalledVoiceBookInfo,
  type PatternDayDetail,
  type PatternTimeframe,
  type PatternsSummary,
} from '@resonance/core';
import { getEnabledVoiceBooks } from './library-prefs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

const VOICE_BOOKS_PATH = existsSync('/data/seeded_library/voice_books.json')
  ? '/data/seeded_library/voice_books.json'
  : './data/seeded_library/voice_books.json';
const BIBLE_PASSAGES_PATH = existsSync('/data/seeded_library/bible_passages.json')
  ? '/data/seeded_library/bible_passages.json'
  : './data/seeded_library/bible_passages.json';
const VOICE_PASSAGES_PATH = existsSync('/data/seeded_library/voice_passages.json')
  ? '/data/seeded_library/voice_passages.json'
  : './data/seeded_library/voice_passages.json';
const CROSS_REFS_PATH = existsSync('/data/seeded_library/cross_references.json')
  ? '/data/seeded_library/cross_references.json'
  : './data/seeded_library/cross_references.json';

export type {
  BookBridgeResult,
  PatternDayDetail,
  PatternTimeframe,
  PatternsSummary,
};

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

async function getUserId(): Promise<string> {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('profiles').select('id').eq('email', 'dev@resonance.local').single();
    return data?.id || DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

function clampDateInput(value: string | null | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export function normalizeWindow(startRaw?: string | null, endRaw?: string | null): { start: string; end: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const start = clampDateInput(startRaw, first);
  const end = clampDateInput(endRaw, last);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function normalizeTimeframe(raw?: string | null): PatternTimeframe {
  if (raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function inWindow(date: string | null, start: string, end: string): boolean {
  return Boolean(date && date >= start && date <= end);
}

async function safeQuery<T extends PromiseLike<{ data: any[] | null; error: any }>>(
  label: string,
  build: () => T,
): Promise<any[]> {
  try {
    const { data, error } = await build();
    if (error) {
      console.warn(`[patterns] ${label} unavailable:`, error.message ?? error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn(`[patterns] ${label} unavailable:`, err);
    return [];
  }
}

// ── Cached local corpus readers (for Study Bookshelf & Book Bridges) ─────────

interface RawVoiceBookRow {
  id: string;
  title?: string | null;
  author?: string | null;
  era?: string | null;
  package_id?: string | null;
}

let cachedVoiceCatalog: RawVoiceBookRow[] | null = null;
let cachedBiblePassages: any[] | null = null;
let cachedVoicePassages: any[] | null = null;
let cachedCrossRefMap: Map<string, string[]> | null = null;

function readVoiceCatalog(): RawVoiceBookRow[] {
  if (cachedVoiceCatalog) return cachedVoiceCatalog;
  try {
    if (!existsSync(VOICE_BOOKS_PATH)) return [];
    cachedVoiceCatalog = JSON.parse(readFileSync(VOICE_BOOKS_PATH, 'utf-8')) as RawVoiceBookRow[];
    return cachedVoiceCatalog;
  } catch {
    return [];
  }
}

async function loadEnabledVoices(): Promise<InstalledVoiceBookInfo[]> {
  const catalog = readVoiceCatalog();
  if (catalog.length === 0) return [];
  const bookIdToPackage = new Map<string, string>();
  for (const b of catalog) {
    bookIdToPackage.set(b.id, b.package_id ?? 'devotional');
  }
  const installedIds = catalog.map((b) => b.id).sort();
  let enabledSet: Set<string>;
  try {
    const { enabled } = await getEnabledVoiceBooks(installedIds, bookIdToPackage);
    enabledSet = new Set(enabled);
  } catch {
    enabledSet = new Set(installedIds);
  }
  return catalog
    .filter((b) => enabledSet.has(b.id))
    .map((b) => ({
      id: b.id,
      title: b.title ?? null,
      author: b.author ?? null,
      era: b.era ?? null,
      packageId: b.package_id ?? null,
    }));
}

function loadBiblePassagesForBook(bookName: string): CandidateBookPassage[] {
  try {
    if (!cachedBiblePassages) {
      if (!existsSync(BIBLE_PASSAGES_PATH)) return [];
      cachedBiblePassages = JSON.parse(readFileSync(BIBLE_PASSAGES_PATH, 'utf-8')) as any[];
    }
    const target = parseBibleBookName(bookName) ?? bookName;
    const out: CandidateBookPassage[] = [];
    for (const p of cachedBiblePassages) {
      // Prefer WEB translation for clean readable bridges, fall back if only KJV present
      if (p.translation && String(p.translation).toUpperCase() !== 'WEB') continue;
      if (parseBibleBookName(p.book) !== target) continue;
      const ref =
        p.verse_start != null
          ? `${target} ${p.chapter ?? ''}:${p.verse_start}`
          : `${target} ${p.chapter ?? ''}`;
      out.push({
        id: Number(p.id),
        ref: ref.trim(),
        bookId: `web_${target.replace(/\s+/g, '_')}`,
        chapter: p.chapter ?? null,
        verse: p.verse_start ?? null,
        text: String(p.text ?? ''),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function loadVoicePassagesForBook(bookId: string, authorTitle: string): CandidateBookPassage[] {
  try {
    if (!cachedVoicePassages) {
      if (!existsSync(VOICE_PASSAGES_PATH)) return [];
      cachedVoicePassages = JSON.parse(readFileSync(VOICE_PASSAGES_PATH, 'utf-8')) as any[];
    }
    const out: CandidateBookPassage[] = [];
    const lowerAuthor = authorTitle.toLowerCase();
    for (const p of cachedVoicePassages) {
      const matchId = p.book_id === bookId;
      const matchAuthor = p.author && String(p.author).toLowerCase() === lowerAuthor;
      if (!matchId && !matchAuthor) continue;
      const ref = [p.author, p.work].filter(Boolean).join(' · ') || authorTitle;
      out.push({
        id: Number(p.id),
        ref,
        bookId: String(p.book_id ?? bookId),
        chapter: null,
        verse: null,
        text: String(p.text ?? ''),
      });
      if (out.length >= 400) break;
    }
    return out;
  } catch {
    return [];
  }
}

function loadCrossRefLookup(): Map<string, string[]> {
  if (cachedCrossRefMap) return cachedCrossRefMap;
  const map = new Map<string, string[]>();
  try {
    if (!existsSync(CROSS_REFS_PATH)) {
      cachedCrossRefMap = map;
      return map;
    }
    const data = JSON.parse(readFileSync(CROSS_REFS_PATH, 'utf-8')) as Array<{
      from_ref?: string;
      to_ref?: string;
    }>;
    for (const row of data) {
      if (!row.from_ref || !row.to_ref) continue;
      const key = row.from_ref.toLowerCase().replace(/[^a-z0-9]/g, '');
      const list = map.get(key) ?? [];
      list.push(row.to_ref);
      map.set(key, list);
    }
  } catch {
    // ignore missing cross-ref asset
  }
  cachedCrossRefMap = map;
  return map;
}

// ── Supabase Raw Data Loader (now includes resonance_nodes!) ─────────────────

async function loadRawData(
  start: string,
  end: string,
  installedVoices: InstalledVoiceBookInfo[],
): Promise<ConcordanceRawInput> {
  const sb = getSupabase();
  const uid = await getUserId();
  const startTs = `${start}T00:00:00Z`;
  const endTs = `${end}T23:59:59Z`;

  const [journal, reading, highlights, bookmarks, events, nodes, edges, snapshots] = await Promise.all([
    safeQuery('journal_entries', () =>
      sb.from('journal_entries')
        .select('id,text,created_at,updated_at')
        .eq('user_id', uid)
        .gte('created_at', startTs)
        .lte('created_at', endTs)
        .order('created_at', { ascending: false })
        .limit(500),
    ),
    safeQuery('reading_events', () =>
      sb.from('reading_events')
        .select('*')
        .eq('user_id', uid)
        .gte('created_at', startTs)
        .lte('created_at', endTs)
        .order('created_at', { ascending: false })
        .limit(1000),
    ),
    safeQuery('highlights', () =>
      sb.from('highlights')
        .select('id,verse_ref,color,selected_text,note_text,note_updated_at,created_at,updated_at')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false })
        .limit(1000),
    ),
    safeQuery('bookmarks', () =>
      sb.from('bookmarks')
        .select('id,verse_ref,label,created_at')
        .eq('user_id', uid)
        .gte('created_at', startTs)
        .lte('created_at', endTs)
        .order('created_at', { ascending: false })
        .limit(500),
    ),
    safeQuery('resonance_events', () =>
      sb.from('resonance_events')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(400),
    ),
    safeQuery('resonance_nodes', () =>
      sb.from('resonance_nodes')
        .select('id,node_type,source_table,source_id,title,body_text,created_at,updated_at')
        .eq('user_id', uid)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(600),
    ),
    safeQuery('resonance_edges', () =>
      sb.from('resonance_edges')
        .select('*')
        .eq('user_id', uid)
        .in('state', ['candidate', 'active', 'reinforced'])
        .order('last_seen_at', { ascending: false })
        .limit(400),
    ),
    safeQuery('theme_snapshots', () =>
      sb.from('theme_snapshots')
        .select('*')
        .eq('user_id', uid)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
    ),
  ]);

  return {
    journal,
    reading,
    highlights: highlights.filter(
      (h) =>
        inWindow(normalizePatternDate(h.created_at), start, end) ||
        inWindow(normalizePatternDate(h.note_updated_at ?? h.updated_at), start, end),
    ),
    bookmarks,
    events: events.filter((e) => inWindow(normalizePatternDate(e.occurred_at ?? e.created_at), start, end)),
    nodes,
    edges: edges.filter(
      (e) => inWindow(normalizePatternDate(e.last_seen_at ?? e.created_at), start, end) || !e.last_seen_at,
    ),
    snapshots,
    installedVoices,
  };
}

function sliceRawToWindow(raw: ConcordanceRawInput, start: string, end: string): ConcordanceRawInput {
  return {
    journal: raw.journal.filter((r) => inWindow(normalizePatternDate(r.created_at), start, end)),
    reading: raw.reading.filter((r) => inWindow(normalizePatternDate(r.created_at), start, end)),
    highlights: raw.highlights.filter(
      (h) =>
        inWindow(normalizePatternDate(h.created_at), start, end) ||
        inWindow(normalizePatternDate(h.note_updated_at ?? h.updated_at), start, end),
    ),
    bookmarks: raw.bookmarks.filter((r) => inWindow(normalizePatternDate(r.created_at), start, end)),
    events: raw.events.filter((e) => inWindow(normalizePatternDate(e.occurred_at ?? e.created_at), start, end)),
    nodes: raw.nodes,
    edges: raw.edges.filter(
      (e) => inWindow(normalizePatternDate(e.last_seen_at ?? e.created_at), start, end) || !e.last_seen_at,
    ),
    snapshots: raw.snapshots,
    installedVoices: raw.installedVoices,
  };
}

// ── Public API Builders ──────────────────────────────────────────────────────

export async function buildPatternsSummary(
  start: string,
  end: string,
  timeframe: PatternTimeframe = '30d',
): Promise<PatternsSummary> {
  const installedVoices = await loadEnabledVoices();
  const tfWindow = resolveTimeframeWindow(timeframe);

  // Single superset query covering both the calendar month AND the chosen timeframe
  const supersetStart = start < tfWindow.start ? start : tfWindow.start;
  const supersetEnd = end > tfWindow.end ? end : tfWindow.end;
  const supersetRaw = await loadRawData(supersetStart, supersetEnd, installedVoices);

  const calendarRaw = sliceRawToWindow(supersetRaw, start, end);
  const timeframeRaw = sliceRawToWindow(supersetRaw, tfWindow.start, tfWindow.end);

  return buildConcordanceSummary({
    calendarRaw,
    timeframeRaw,
    calendarWindow: { start, end },
    timeframe,
  });
}

export async function buildPatternDayDetail(date: string): Promise<PatternDayDetail> {
  const installedVoices = await loadEnabledVoices();
  // Load a 30-day rolling context window ending on `date` (+ 7 days forward if looking at past dates)
  // so cross-day echoes, returns, and trails attach cleanly to traces recorded on `date`.
  const contextStart = shiftDateDays(date, -30);
  const todayStr = new Date().toISOString().slice(0, 10);
  const forward = shiftDateDays(date, 7);
  const contextEnd = forward > todayStr ? todayStr : forward;

  const contextRaw = await loadRawData(contextStart, contextEnd, installedVoices);

  return buildConcordanceDayDetail({
    date,
    contextRaw,
    contextStart,
    contextEnd,
  });
}

export async function buildPatternBookBridge(input: {
  kind: 'bible' | 'voice';
  id: string;
  timeframe: PatternTimeframe;
  bookId?: string | null;
}): Promise<BookBridgeResult> {
  const installedVoices = await loadEnabledVoices();
  const tfWindow = resolveTimeframeWindow(input.timeframe);
  const raw = await loadRawData(tfWindow.start, tfWindow.end, installedVoices);

  if (input.kind === 'bible') {
    const bookName = parseBibleBookName(input.id) ?? input.id;
    const bookId = input.bookId || `web_${bookName.replace(/\s+/g, '_')}`;
    const bookPassages = loadBiblePassagesForBook(bookName);

    // Find canonical cross-references from the user's highlights in OTHER books into this book
    const crossRefMap = loadCrossRefLookup();
    const passageByRef = new Map<string, CandidateBookPassage>();
    for (const p of bookPassages) {
      passageByRef.set(p.ref.toLowerCase().replace(/[^a-z0-9]/g, ''), p);
    }

    const crossRefPairs: CrossRefBridgePair[] = [];
    const seenTargets = new Set<string>();
    for (const hl of raw.highlights) {
      if (!hl.verse_ref) continue;
      if (parseBibleBookName(hl.verse_ref) === bookName) continue;
      const normKey = hl.verse_ref.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targets = crossRefMap.get(normKey) ?? [];
      for (const target of targets) {
        if (parseBibleBookName(target) !== bookName) continue;
        const normTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenTargets.has(normTarget)) continue;
        seenTargets.add(normTarget);
        const matchedPassage = passageByRef.get(normTarget);
        crossRefPairs.push({
          fromHighlightRef: hl.verse_ref,
          fromExcerpt: hl.note_text ?? hl.selected_text ?? null,
          targetRef: matchedPassage?.ref ?? target,
          targetText: matchedPassage?.text ?? null,
        });
        if (crossRefPairs.length >= 3) break;
      }
      if (crossRefPairs.length >= 3) break;
    }

    return buildBookBridgesFromData({
      kind: 'bible',
      id: bookName,
      bookId,
      title: bookName,
      subtitle: 'Scripture · Living Concordance',
      timeframe: input.timeframe,
      raw,
      bookPassages,
      crossRefPairs,
    });
  }

  // Installed Voice book
  const voice = installedVoices.find((v) => v.id === input.id || v.id === input.bookId) ?? null;
  const title = voice?.author ?? voice?.title ?? input.id;
  const resolvedBookId = voice?.id ?? input.bookId ?? input.id;
  const eraGroupId = classifyLiteratureGroup(voice?.packageId, voice?.era);
  const eraMeta = LITERATURE_SHELF_GROUPS.find((g) => g.id === eraGroupId);
  const subtitle = [voice?.title, eraMeta?.fullLabel].filter(Boolean).join(' · ') || 'Installed Literature';
  const bookPassages = loadVoicePassagesForBook(resolvedBookId, title);

  return buildBookBridgesFromData({
    kind: 'voice',
    id: resolvedBookId,
    bookId: resolvedBookId,
    title,
    subtitle,
    timeframe: input.timeframe,
    raw,
    bookPassages,
  });
}
