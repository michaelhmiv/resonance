import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 86_400_000;

type ActivityType = 'journal' | 'reading' | 'highlight' | 'note' | 'bookmark' | 'echo';

type ActivityCounts = Record<ActivityType, number>;

interface PatternEvidence {
  type: ActivityType | 'theme' | 'edge';
  id?: string;
  date?: string;
  title?: string;
  ref?: string | null;
  excerpt?: string | null;
}

export interface PatternDaySummary {
  date: string;
  counts: ActivityCounts;
  dotTypes: ActivityType[];
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
  reason: string;
  confidence: number;
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

export interface ReturnedSignal {
  id: string;
  label: string;
  count: number;
  activityTypes: ActivityType[];
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

export interface PatternTrail {
  id: string;
  label: string;
  summary: string;
  evidence: PatternEvidence[];
}

export interface PatternsSummary {
  window: { start: string; end: string };
  recently: string;
  days: PatternDaySummary[];
  themes: PatternTheme[];
  echoes: PatternEcho[];
  returnedTo: ReturnedSignal[];
  trails: PatternTrail[];
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

export interface PatternDayDetail {
  date: string;
  counts: ActivityCounts;
  journal: Array<{ id: string; excerpt: string; createdAt: string | null }>;
  reading: Array<{ id: string; label: string; ref: string | null; createdAt: string | null }>;
  highlights: Array<{ id: string; verseRef: string | null; selectedText: string | null; color: string | null; createdAt: string | null }>;
  notes: Array<{ id: string; verseRef: string | null; noteExcerpt: string; updatedAt: string | null }>;
  bookmarks: Array<{ id: string; verseRef: string | null; label: string | null; createdAt: string | null }>;
  echoes: PatternEcho[];
}

interface RawData {
  journal: any[];
  reading: any[];
  highlights: any[];
  bookmarks: any[];
  events: any[];
  edges: any[];
  snapshots: any[];
}

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

function emptyCounts(): ActivityCounts {
  return { journal: 0, reading: 0, highlight: 0, note: 0, bookmark: 0, echo: 0 };
}

function normalizeDate(value: unknown): string | null {
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

function isoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  return null;
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

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  for (let t = cur; t <= last; t += DAY_MS) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

function inWindow(date: string | null, start: string, end: string): boolean {
  return Boolean(date && date >= start && date <= end);
}

function excerpt(text: unknown, max = 160): string {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

async function safeQuery(label: string, build: () => Promise<{ data: any[] | null; error: any }>): Promise<any[]> {
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

async function loadRawData(start: string, end: string): Promise<RawData> {
  const sb = getSupabase();
  const uid = await getUserId();
  const startTs = `${start}T00:00:00Z`;
  const endTs = `${end}T23:59:59Z`;

  const [journal, reading, highlights, bookmarks, events, edges, snapshots] = await Promise.all([
    safeQuery('journal_entries', () => sb.from('journal_entries').select('id,text,created_at,updated_at').eq('user_id', uid).gte('created_at', startTs).lte('created_at', endTs).order('created_at', { ascending: false })),
    safeQuery('reading_events', () => sb.from('reading_events').select('*').eq('user_id', uid).gte('created_at', startTs).lte('created_at', endTs).order('created_at', { ascending: false })),
    safeQuery('highlights', () => sb.from('highlights').select('id,verse_ref,color,selected_text,note_text,note_updated_at,created_at,updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(1000)),
    safeQuery('bookmarks', () => sb.from('bookmarks').select('id,verse_ref,label,created_at').eq('user_id', uid).gte('created_at', startTs).lte('created_at', endTs).order('created_at', { ascending: false })),
    safeQuery('resonance_events', () => sb.from('resonance_events').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(300)),
    safeQuery('resonance_edges', () => sb.from('resonance_edges').select('*').eq('user_id', uid).in('state', ['candidate', 'active', 'reinforced']).order('last_seen_at', { ascending: false }).limit(100)),
    safeQuery('theme_snapshots', () => sb.from('theme_snapshots').select('*').eq('user_id', uid).eq('status', 'active').order('created_at', { ascending: false }).limit(20)),
  ]);

  return {
    journal,
    reading,
    highlights: highlights.filter((h) => inWindow(normalizeDate(h.created_at), start, end) || inWindow(normalizeDate(h.note_updated_at ?? h.updated_at), start, end)),
    bookmarks,
    events: events.filter((e) => inWindow(normalizeDate(e.occurred_at ?? e.created_at), start, end)),
    edges: edges.filter((e) => inWindow(normalizeDate(e.last_seen_at ?? e.created_at), start, end) || !e.last_seen_at),
    snapshots,
  };
}

function addDay(days: Map<string, PatternDaySummary>, date: string | null, type: ActivityType): void {
  if (!date) return;
  const day = days.get(date);
  if (!day) return;
  day.counts[type] += 1;
  if (!day.dotTypes.includes(type)) day.dotTypes.push(type);
}

function summarizeDays(raw: RawData, start: string, end: string): PatternDaySummary[] {
  const days = new Map<string, PatternDaySummary>();
  for (const date of eachDate(start, end)) days.set(date, { date, counts: emptyCounts(), dotTypes: [] });

  for (const row of raw.journal) addDay(days, normalizeDate(row.created_at), 'journal');
  for (const row of raw.reading) addDay(days, normalizeDate(row.created_at), 'reading');
  for (const row of raw.highlights) {
    if (inWindow(normalizeDate(row.created_at), start, end)) addDay(days, normalizeDate(row.created_at), 'highlight');
    if (row.note_text && inWindow(normalizeDate(row.note_updated_at ?? row.updated_at), start, end)) addDay(days, normalizeDate(row.note_updated_at ?? row.updated_at), 'note');
  }
  for (const row of raw.bookmarks) addDay(days, normalizeDate(row.created_at), 'bookmark');
  for (const row of raw.events) {
    if (String(row.event_type ?? '').startsWith('resonance.')) addDay(days, normalizeDate(row.occurred_at ?? row.created_at), 'echo');
  }
  for (const row of raw.edges) addDay(days, normalizeDate(row.last_seen_at ?? row.created_at), 'echo');

  return Array.from(days.values());
}

const THEME_STOP_WORDS = new Set(['the','and','for','with','that','this','from','have','has','had','was','were','are','but','not','you','your','his','her','their','our','into','about','feel','feeling','really','just','been','being','will','would','could','should','there','here','when','where','what','which','while','through','because','things','thing','today','week','month']);

function fallbackThemes(raw: RawData, start: string, end: string): PatternTheme[] {
  const buckets = new Map<string, PatternEvidence[]>();
  for (const entry of raw.journal) {
    const date = normalizeDate(entry.created_at);
    const words = String(entry.text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4 && !THEME_STOP_WORDS.has(w));
    for (const word of new Set(words.slice(0, 80))) {
      const list = buckets.get(word) ?? [];
      list.push({ type: 'journal', id: String(entry.id), date: date ?? undefined, title: 'Journal entry', excerpt: excerpt(entry.text) });
      buckets.set(word, list);
    }
  }

  return Array.from(buckets.entries())
    .filter(([, evidence]) => evidence.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, evidence], index) => ({
      id: `fallback-theme-${index}-${label}`,
      label,
      summary: `Several recent entries touched on ${label}.`,
      confidence: Math.min(0.8, 0.25 + evidence.length * 0.1),
      evidenceCount: evidence.length,
      dateRange: { start, end },
      evidence: evidence.slice(0, 6),
    }));
}

function mapThemes(raw: RawData, start: string, end: string): PatternTheme[] {
  const fromSnapshots = raw.snapshots.map((row, index) => {
    const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : Array.isArray(row.metadata?.evidence) ? row.metadata.evidence : [];
    const evidence = evidenceRaw.slice(0, 8).map((item: any): PatternEvidence => ({
      type: item.source_type ?? 'theme',
      id: item.source_id ?? item.source_node_id,
      date: normalizeDate(item.seen_at ?? item.created_at) ?? undefined,
      title: item.title ?? item.source_type ?? 'Evidence',
      excerpt: excerpt(item.excerpt ?? item.text ?? item.body_text),
    }));
    return {
      id: String(row.id ?? `theme-${index}`),
      label: String(row.label ?? 'Recent thread'),
      summary: String(row.summary ?? `Recently echoed around ${row.label ?? 'this thread'}`),
      confidence: Number(row.confidence ?? 0.5),
      evidenceCount: evidence.length || Number(row.evidence_count ?? 0),
      dateRange: {
        start: normalizeDate(row.valid_from ?? row.window_start) ?? start,
        end: normalizeDate(row.expires_at ?? row.window_end) ?? end,
      },
      evidence,
    };
  });

  return fromSnapshots.length > 0 ? fromSnapshots : fallbackThemes(raw, start, end);
}

function mapEchoes(raw: RawData): PatternEcho[] {
  return raw.edges.slice(0, 8).map((row, index) => {
    const metadata = row.metadata ?? {};
    const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : [];
    const evidence = evidenceRaw.slice(0, 4).map((item: any): PatternEvidence => ({
      type: 'edge',
      date: normalizeDate(item.seen_at) ?? undefined,
      title: item.reason ?? 'Evidence',
      excerpt: excerpt(item.excerpt),
    }));
    const targetLabel = String(row.target_ref ?? metadata.source ?? metadata.bookId ?? row.target_kind ?? 'a related passage');
    const sourceLabel = String(row.source_type ?? 'Recent activity');
    return {
      id: String(row.id ?? `echo-${index}`),
      title: `This echoes ${targetLabel}`,
      sourceLabel,
      targetLabel,
      reason: String(evidenceRaw[0]?.reason ?? row.relation ?? 'semantic resonance'),
      confidence: Number(row.confidence ?? row.score ?? 0),
      lastSeenAt: isoTimestamp(row.last_seen_at ?? row.created_at),
      evidence,
    };
  });
}

function returnedTo(raw: RawData): ReturnedSignal[] {
  const groups = new Map<string, ReturnedSignal>();
  const add = (key: string | null | undefined, type: ActivityType, evidence: PatternEvidence, when: string | null) => {
    if (!key) return;
    const current = groups.get(key) ?? { id: `returned-${key}`, label: key, count: 0, activityTypes: [], lastSeenAt: null, evidence: [] };
    current.count += 1;
    if (!current.activityTypes.includes(type)) current.activityTypes.push(type);
    current.evidence.push(evidence);
    if (when && (!current.lastSeenAt || when > current.lastSeenAt)) current.lastSeenAt = when;
    groups.set(key, current);
  };

  for (const row of raw.reading) {
    const label = row.verse_ref || [row.book_id, row.chapter].filter(Boolean).join(' ');
    add(label, 'reading', { type: 'reading', id: String(row.id ?? `${label}-${row.created_at}`), date: normalizeDate(row.created_at) ?? undefined, title: 'Read', ref: label }, isoTimestamp(row.created_at));
  }
  for (const row of raw.highlights) {
    add(row.verse_ref, 'highlight', { type: 'highlight', id: String(row.id), date: normalizeDate(row.created_at) ?? undefined, title: 'Highlight', ref: row.verse_ref, excerpt: excerpt(row.selected_text) }, isoTimestamp(row.created_at));
    if (row.note_text) add(row.verse_ref, 'note', { type: 'note', id: String(row.id), date: normalizeDate(row.note_updated_at ?? row.updated_at) ?? undefined, title: 'Note', ref: row.verse_ref, excerpt: excerpt(row.note_text) }, isoTimestamp(row.note_updated_at ?? row.updated_at));
  }

  return Array.from(groups.values())
    .filter((signal) => signal.count >= 2 || signal.activityTypes.length >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((signal) => ({ ...signal, evidence: signal.evidence.slice(0, 6) }));
}

function mapTrails(themes: PatternTheme[], echoes: PatternEcho[], returned: ReturnedSignal[]): PatternTrail[] {
  const trails: PatternTrail[] = [];
  for (const theme of themes.slice(0, 3)) {
    if (theme.evidence.length >= 2) {
      trails.push({
        id: `trail-theme-${theme.id}`,
        label: `A thread around ${theme.label}`,
        summary: `${theme.evidenceCount || theme.evidence.length} pieces of evidence sit near this theme.`,
        evidence: theme.evidence.slice(0, 5),
      });
    }
  }
  for (const signal of returned.slice(0, 2)) {
    trails.push({
      id: `trail-returned-${signal.id}`,
      label: `Returned to ${signal.label}`,
      summary: `${signal.count} traces across ${signal.activityTypes.join(', ')}.`,
      evidence: signal.evidence.slice(0, 5),
    });
  }
  if (trails.length === 0 && echoes.length > 0) {
    const echo = echoes[0];
    trails.push({ id: `trail-echo-${echo.id}`, label: echo.title, summary: echo.reason, evidence: echo.evidence });
  }
  return trails.slice(0, 4);
}

function recentlyText(themes: PatternTheme[], raw: RawData): string {
  if (themes.length > 0) {
    const labels = themes.slice(0, 3).map((t) => t.label).join(', ');
    return `Recently, several traces gathered around ${labels}.`;
  }
  const pieces: string[] = [];
  if (raw.journal.length) pieces.push(`${raw.journal.length} journal ${raw.journal.length === 1 ? 'entry' : 'entries'}`);
  if (raw.reading.length) pieces.push(`${raw.reading.length} reading ${raw.reading.length === 1 ? 'trace' : 'traces'}`);
  const noteCount = raw.highlights.filter((h) => h.note_text).length;
  if (raw.highlights.length) pieces.push(`${raw.highlights.length} ${raw.highlights.length === 1 ? 'highlight' : 'highlights'}`);
  if (noteCount) pieces.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
  if (pieces.length === 0) return 'Patterns need a few traces: journal entries, readings, highlights, or notes.';
  return `Recently, your activity includes ${pieces.join(', ')}.`;
}

function quietQuestion(themes: PatternTheme[], returned: ReturnedSignal[], raw: RawData): string {
  if (returned.length > 0) return `You returned to ${returned[0].label}. What part of that has stayed with you?`;
  if (themes.length > 0) return `Several traces touched ${themes[0].label}. What do you want to notice about that?`;
  if (raw.journal.length > 0) return 'Looking back at these entries, what seems worth remembering?';
  return 'What are you noticing these days?';
}

export async function buildPatternsSummary(start: string, end: string): Promise<PatternsSummary> {
  const raw = await loadRawData(start, end);
  const days = summarizeDays(raw, start, end);
  const themes = mapThemes(raw, start, end);
  const echoes = mapEchoes(raw);
  const returned = returnedTo(raw);
  const trails = mapTrails(themes, echoes, returned);
  const noteCount = raw.highlights.filter((h) => h.note_text).length;

  return {
    window: { start, end },
    recently: recentlyText(themes, raw),
    days,
    themes,
    echoes,
    returnedTo: returned,
    trails,
    quietQuestion: quietQuestion(themes, returned, raw),
    health: {
      journalEntryCount: raw.journal.length,
      readingEventCount: raw.reading.length,
      highlightCount: raw.highlights.length,
      noteCount,
      bookmarkCount: raw.bookmarks.length,
      echoCount: echoes.length,
    },
  };
}

export async function buildPatternDayDetail(date: string): Promise<PatternDayDetail> {
  const raw = await loadRawData(date, date);
  const day = summarizeDays(raw, date, date)[0] ?? { date, counts: emptyCounts(), dotTypes: [] };
  const echoes = mapEchoes(raw);

  return {
    date,
    counts: day.counts,
    journal: raw.journal.map((row) => ({ id: String(row.id), excerpt: excerpt(row.text, 220), createdAt: isoTimestamp(row.created_at) })),
    reading: raw.reading.map((row) => ({
      id: String(row.id ?? `${row.verse_ref ?? row.book_id}-${row.created_at}`),
      label: String(row.verse_ref || [row.book_id, row.chapter].filter(Boolean).join(' ') || 'Reading'),
      ref: row.verse_ref ?? null,
      createdAt: isoTimestamp(row.created_at),
    })),
    highlights: raw.highlights
      .filter((row) => inWindow(normalizeDate(row.created_at), date, date))
      .map((row) => ({ id: String(row.id), verseRef: row.verse_ref ?? null, selectedText: row.selected_text ?? null, color: row.color ?? null, createdAt: isoTimestamp(row.created_at) })),
    notes: raw.highlights
      .filter((row) => row.note_text && inWindow(normalizeDate(row.note_updated_at ?? row.updated_at), date, date))
      .map((row) => ({ id: String(row.id), verseRef: row.verse_ref ?? null, noteExcerpt: excerpt(row.note_text, 220), updatedAt: isoTimestamp(row.note_updated_at ?? row.updated_at) })),
    bookmarks: raw.bookmarks.map((row) => ({ id: String(row.id), verseRef: row.verse_ref ?? null, label: row.label ?? null, createdAt: isoTimestamp(row.created_at) })),
    echoes,
  };
}
