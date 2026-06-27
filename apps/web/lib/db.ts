/**
 * Supabase-backed data store — replaces JSON file store.
 * Same function signatures as before, now persisted in PostgreSQL.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Singleton client
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  }
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

// Default dev user ID (pre-auth, service role bypasses RLS)
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function getDevUserId(): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb.from('profiles').select('id').eq('email', 'dev@resonance.local').single();
  return data?.id || DEV_USER_ID;
}

// ── Journal entries ────────────────────────────────────────────────────────

export async function getJournalEntries() {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data } = await sb.from('journal_entries').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  return data || [];
}

export async function createJournalEntry(text: string, id?: string, createdAt?: number, updatedAt?: number) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const timestamp = createdAt ? new Date(createdAt * 1000).toISOString() : new Date().toISOString();
  const tsUpdated = updatedAt ? new Date(updatedAt * 1000).toISOString() : timestamp;

  if (id) {
    // Upsert
    const { data } = await sb.from('journal_entries')
      .upsert({ id, user_id: uid, text, created_at: timestamp, updated_at: tsUpdated })
      .select().single();
    return data;
  }

  const { data } = await sb.from('journal_entries')
    .insert({ user_id: uid, text, created_at: timestamp, updated_at: tsUpdated })
    .select().single();
  return data;
}

export async function updateJournalEntry(id: string, text: string) {
  const sb = getSupabase();
  const { error } = await sb.from('journal_entries')
    .update({ text, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function deleteJournalEntry(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('journal_entries').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ── Bookmarks ─────────────────────────────────────────────────────────────

export async function getBookmarks() {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data } = await sb.from('bookmarks').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  return data || [];
}

export async function createBookmark(verseRef: string, label: string | null) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data } = await sb.from('bookmarks')
    .upsert({ user_id: uid, verse_ref: verseRef, label }, { onConflict: 'user_id,verse_ref' })
    .select().single();
  return data;
}

export async function deleteBookmark(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('bookmarks').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ── Highlights ────────────────────────────────────────────────────────────

export async function getHighlights(verseRefPrefix?: string) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  let query = sb.from('highlights').select('*').eq('user_id', uid);
  if (verseRefPrefix) {
    query = query.ilike('verse_ref', `${verseRefPrefix}%`);
  }
  const { data } = await query.order('created_at', { ascending: true });
  return data || [];
}

export interface CreateHighlightInput {
  verseRef: string;
  color: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  noteText?: string | null;
}

export async function createHighlight(input: CreateHighlightInput) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const now = new Date().toISOString();
  const noteText = input.noteText && input.noteText.trim().length > 0 ? input.noteText : null;
  const { data, error } = await sb.from('highlights')
    .insert({
      user_id: uid,
      verse_ref: input.verseRef,
      color: input.color,
      start_offset: input.startOffset,
      end_offset: input.endOffset,
      selected_text: input.selectedText,
      note_text: noteText,
      note_updated_at: noteText ? now : null,
      updated_at: now,
      created_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface UpdateHighlightPatch {
  color?: string;
  startOffset?: number;
  endOffset?: number;
  selectedText?: string;
  noteText?: string | null;  // null/empty => clear the note
}

export async function updateHighlight(id: string, patch: UpdateHighlightPatch) {
  const sb = getSupabase();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.startOffset !== undefined) update.start_offset = patch.startOffset;
  if (patch.endOffset !== undefined) update.end_offset = patch.endOffset;
  if (patch.selectedText !== undefined) update.selected_text = patch.selectedText;
  if (patch.noteText !== undefined) {
    const cleaned = patch.noteText && String(patch.noteText).trim().length > 0 ? patch.noteText : null;
    update.note_text = cleaned;
    update.note_updated_at = cleaned ? now : null;
  }
  const { data, error } = await sb.from('highlights')
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHighlight(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('highlights').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ── Highlight note embedding (for resonance) ───────────────────────────

export async function storeHighlightEmbedding(highlightId: string, vector: number[]) {
  const sb = getSupabase();
  // Upsert — embedding is regenerated on every note update.
  // Server-side vectors are 2560d (pplx-embed-v1-4b). Mobile free-tier
  // highlights use 384d gte-small and never enter this table — they live
  // on-device in the mobile SQLite vector store.
  const { error } = await sb.from('highlight_vectors')
    .upsert(
      { highlight_id: highlightId, vector, model_id: 'pplx-embed-v1-4b', generated_at: new Date().toISOString() },
      { onConflict: 'highlight_id' },
    );
  if (error) {
    console.error('[db] storeHighlightEmbedding failed:', error);
    return { ok: false };
  }
  return { ok: true };
}

export async function deleteHighlightEmbedding(highlightId: string) {
  const sb = getSupabase();
  await sb.from('highlight_vectors').delete().eq('highlight_id', highlightId);
}

export async function getUserHighlightEmbeddings(userId?: string): Promise<number[][]> {
  return getUserHighlightEmbeddingsViaJoin(userId);
}

export async function getUserHighlightEmbeddingsViaJoin(userId?: string): Promise<number[][]> {
  // Supabase doesn't have a clean way to join → filter by user_id from a
  // related table without a foreign-key view. We do it via two queries.
  const sb = getSupabase();
  const uid = userId || (await getDevUserId());
  const { data: hlData } = await sb.from('highlights').select('id').eq('user_id', uid);
  if (!hlData || hlData.length === 0) return [];
  const ids = hlData.map((h: { id: string }) => h.id);
  const { data: vecData, error } = await sb.from('highlight_vectors')
    .select('vector')
    .in('highlight_id', ids)
    .not('vector', 'is', null);
  if (error) return [];
  return (vecData || []).map((row: { vector: number[] }) => row.vector);
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, string>> {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data } = await sb.from('user_settings').select('key,value').eq('user_id', uid);
  const result: Record<string, string> = {};
  if (data) {
    for (const row of data) {
      result[row.key] = row.value;
    }
  }
  return result;
}

export async function setSetting(key: string, value: string) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { error } = await sb.from('user_settings')
    .upsert({ user_id: uid, key, value }, { onConflict: 'user_id,key' });
  if (error) throw error;
  return { ok: true };
}

export async function deleteSetting(key: string) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { error } = await sb.from('user_settings')
    .delete()
    .eq('user_id', uid)
    .eq('key', key);
  if (error) throw error;
  return { ok: true };
}

// ── Reading events ─────────────────────────────────────────────────────────

export async function recordReadingEvent(bookId: string, chapter: number, verseRef: string, timestamp?: number) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const createdAt = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  try {
    await sb.from('reading_events').insert({
      user_id: uid,
      book_id: bookId,
      chapter,
      verse_ref: verseRef,
      created_at: createdAt,
    });
  } catch {
    // Table may not exist — this is best-effort
  }
}

export async function getReadingEvents(start: string, end: string): Promise<{ date: string; count: number }[]> {
  const sb = getSupabase();
  const uid = await getDevUserId();
  try {
    const { data } = await sb.from('reading_events')
      .select('created_at')
      .eq('user_id', uid)
      .gte('created_at', `${start}T00:00:00Z`)
      .lte('created_at', `${end}T23:59:59Z`);
    if (!data) return [];
    const byDate = new Map<string, number>();
    for (const row of data) {
      const date = String(row.created_at).slice(0, 10);
      byDate.set(date, (byDate.get(date) || 0) + 1);
    }
    return Array.from(byDate.entries()).map(([date, count]) => ({ date, count }));
  } catch {
    return [];
  }
}

// Auto-create the reading_events table on first import
export async function ensureReadingEventsTable(): Promise<void> {
  const sb = getSupabase();
  try {
    // Probe first
    const { error: probeErr } = await sb.from('reading_events').select('id').limit(1);
    if (!probeErr) return;
    // Try creating via rpc
    await sb.rpc('create_reading_events_table_if_needed');
  } catch {
    // Best-effort — table will be created manually or via migration
  }
}

// Auto-create the highlight_vectors table on first import
export async function ensureHighlightVectorsTable(): Promise<void> {
  if (!SUPABASE_SERVICE_KEY) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/run_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        sql: `
          CREATE TABLE IF NOT EXISTS public.highlight_vectors (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            highlight_id UUID NOT NULL REFERENCES public.highlights(id) ON DELETE CASCADE,
            vector vector(2560) NOT NULL,
            model_id TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b',
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (highlight_id)
          );
        `
      }),
    });
    if (!res.ok) {
      console.warn('[db] ensureHighlightVectorsTable failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[db] ensureHighlightVectorsTable error:', err);
  }
}


// ── Adaptive Resonance memory/jobs/cache ──────────────────────────────────

const RESONANCE_MODEL_ID = 'pplx-embed-v1-4b';
const OPENROUTER_EMBED_MODEL = 'perplexity/pplx-embed-v1-4b';
const EMBEDDING_DIM = 2560;
const RESONANCE_CACHE_TTL_DAYS = 7;

export function resonanceContentHash(text: string): string {
  return createHash('sha256').update(text.trim().replace(/\s+/g, ' ').toLowerCase(), 'utf8').digest('hex');
}

type AdaptiveSourceType = 'journal_entry' | 'highlight' | 'note' | 'reading_event' | 'corpus_passage' | 'theme_snapshot';

export function buildHighlightResonanceText(highlight: { verse_ref?: string; selected_text?: string | null; note_text?: string | null; color?: string | null }) {
  const parts = [
    highlight.verse_ref ? `Highlighted ${highlight.verse_ref}` : 'Highlight',
    highlight.selected_text ? `phrase: ${highlight.selected_text}` : '',
    highlight.note_text ? `note: ${highlight.note_text}` : '',
    highlight.color ? `color: ${highlight.color}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildNoteResonanceText(highlight: { verse_ref?: string; selected_text?: string | null; note_text?: string | null }) {
  const parts = [
    highlight.verse_ref ? `Note on ${highlight.verse_ref}` : 'Note',
    highlight.selected_text ? `highlighted phrase: ${highlight.selected_text}` : '',
    highlight.note_text ?? '',
  ].filter(Boolean);
  return parts.join('\n');
}

export async function upsertResonanceSourceNode(input: {
  nodeType: AdaptiveSourceType;
  sourceTable: string;
  sourceId: string;
  bodyText: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
  sourceType?: AdaptiveSourceType;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const contentHash = resonanceContentHash(input.bodyText);
  const now = new Date().toISOString();
  const { data, error } = await sb.from('resonance_nodes')
    .upsert({
      user_id: uid,
      node_type: input.nodeType,
      source_table: input.sourceTable,
      source_id: input.sourceId,
      title: input.title ?? null,
      body_text: input.bodyText,
      content_hash: contentHash,
      status: 'active',
      metadata: input.metadata ?? {},
      updated_at: now,
    }, { onConflict: 'user_id,node_type,source_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markResonanceSourceNodeDeleted(input: { nodeType: AdaptiveSourceType; sourceId: string }) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data, error } = await sb.from('resonance_nodes')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('user_id', uid)
    .eq('node_type', input.nodeType)
    .eq('source_id', input.sourceId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}


export async function upsertJournalResonanceNode(entry: { id: string; text: string; created_at?: string; updated_at?: string }) {
  return upsertResonanceSourceNode({
    nodeType: 'journal_entry',
    sourceTable: 'journal_entries',
    sourceId: entry.id,
    bodyText: entry.text,
    metadata: { created_at: entry.created_at ?? null, updated_at: entry.updated_at ?? null },
  });
}


export async function markJournalResonanceNodeDeleted(entryId: string) {
  return markResonanceSourceNodeDeleted({ nodeType: 'journal_entry', sourceId: entryId });
}

export async function upsertHighlightResonanceNodes(highlight: Record<string, any>) {
  const highlightText = buildHighlightResonanceText(highlight);
  const highlightNode = await upsertResonanceSourceNode({
    nodeType: 'highlight',
    sourceTable: 'highlights',
    sourceId: String(highlight.id),
    title: String(highlight.verse_ref ?? 'Highlight'),
    bodyText: highlightText,
    metadata: { verse_ref: highlight.verse_ref ?? null, selected_text: highlight.selected_text ?? null, color: highlight.color ?? null },
  });
  let noteNode: any = null;
  if (highlight.note_text && String(highlight.note_text).trim().length >= 3) {
    noteNode = await upsertResonanceSourceNode({
      nodeType: 'note',
      sourceTable: 'highlights',
      sourceId: `${highlight.id}:note`,
      title: `Note on ${highlight.verse_ref ?? 'highlight'}`,
      bodyText: buildNoteResonanceText(highlight),
      metadata: { highlight_id: highlight.id, verse_ref: highlight.verse_ref ?? null, selected_text: highlight.selected_text ?? null },
    });
  } else {
    await markResonanceSourceNodeDeleted({ nodeType: 'note', sourceId: `${highlight.id}:note` }).catch(() => null);
  }
  return { highlightNode, noteNode };
}

export async function markHighlightResonanceNodesDeleted(highlightId: string) {
  const [highlightNode, noteNode] = await Promise.all([
    markResonanceSourceNodeDeleted({ nodeType: 'highlight', sourceId: highlightId }),
    markResonanceSourceNodeDeleted({ nodeType: 'note', sourceId: `${highlightId}:note` }).catch(() => null),
  ]);
  return { highlightNode, noteNode };
}


export async function appendResonanceEvent(input: {
  eventType: string;
  sourceNodeId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data, error } = await sb.from('resonance_events')
    .insert({
      user_id: uid,
      event_type: input.eventType,
      source_node_id: input.sourceNodeId ?? null,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      payload: input.payload ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function enqueueResonanceJob(input: {
  jobType?: string;
  sourceNodeId: string;
  sourceTable?: string;
  sourceId: string;
  priority?: number;
  payload?: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  // Avoid duplicate pending/running work for the same source.
  const { data: existing } = await sb.from('resonance_jobs')
    .select('*')
    .eq('source_node_id', input.sourceNodeId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await sb.from('resonance_jobs')
    .insert({
      user_id: uid,
      job_type: input.jobType ?? 'journal_resonance',
      source_node_id: input.sourceNodeId,
      source_table: input.sourceTable ?? 'journal_entries',
      source_id: input.sourceId,
      status: 'pending',
      priority: input.priority ?? 100,
      payload: input.payload ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function cacheKeyFor(nodeId: string, contentHash: string, modelId = RESONANCE_MODEL_ID): string {
  return `${nodeId}:${contentHash}:${modelId}`;
}

export async function getFreshResonanceCacheForSource(sourceId: string, sourceType?: AdaptiveSourceType) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  let nodeQuery = sb.from('resonance_nodes')
    .select('id,content_hash,status,node_type')
    .eq('user_id', uid)
    .eq('source_id', sourceId)
    .eq('status', 'active');
  if (sourceType) nodeQuery = nodeQuery.eq('node_type', sourceType);
  const { data: nodes, error: nodeErr } = await nodeQuery.order('updated_at', { ascending: false }).limit(1);
  if (nodeErr) throw nodeErr;
  const node = nodes?.[0];
  if (!node?.id || !node.content_hash) return null;

  const { data, error } = await sb.from('resonance_result_cache')
    .select('*')
    .eq('source_node_id', node.id)
    .eq('content_hash', node.content_hash)
    .eq('model_id', RESONANCE_MODEL_ID)
    .eq('status', 'fresh')
    .gt('expires_at', new Date().toISOString())
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.result_json ?? null;
}


export async function storeResonanceEmbedding(input: {
  nodeId: string;
  contentHash: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const { data, error } = await sb.from('resonance_embeddings')
    .upsert({
      node_id: input.nodeId,
      user_id: uid,
      model_id: RESONANCE_MODEL_ID,
      content_hash: input.contentHash,
      dim: EMBEDDING_DIM,
      vector: input.vector,
      metadata: input.metadata ?? {},
      generated_at: new Date().toISOString(),
    }, { onConflict: 'node_id,model_id,content_hash' })
    .select('id,node_id,content_hash,generated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function getStoredResonanceEmbedding(nodeId: string, contentHash: string): Promise<number[] | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('resonance_embeddings')
    .select('vector')
    .eq('node_id', nodeId)
    .eq('model_id', RESONANCE_MODEL_ID)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (error) throw error;
  const vector = data?.vector;
  return Array.isArray(vector) ? vector as number[] : null;
}

export async function storeResonanceCache(input: {
  sourceNodeId: string;
  sourceId: string;
  sourceType?: AdaptiveSourceType;
  contentHash: string;
  result: unknown;
  metadata?: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const computedAt = new Date();
  const expiresAt = new Date(computedAt.getTime() + RESONANCE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await sb.from('resonance_result_cache')
    .upsert({
      user_id: uid,
      source_node_id: input.sourceNodeId,
      source_type: input.sourceType ?? 'journal_entry',
      source_id: input.sourceId,
      cache_key: cacheKeyFor(input.sourceNodeId, input.contentHash),
      content_hash: input.contentHash,
      model_id: RESONANCE_MODEL_ID,
      result_json: input.result,
      status: 'fresh',
      computed_at: computedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      metadata: input.metadata ?? {},
    }, { onConflict: 'cache_key' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

type ResonanceCardForEdge = {
  passageId?: number;
  text?: string;
  source?: string;
  bookId?: string;
  translation?: string | null;
  similarity?: number;
  kind?: string;
};

type ResonanceResultForEdges = {
  scripture?: ResonanceCardForEdge[];
  voices?: ResonanceCardForEdge[];
  pastEntries?: ResonanceCardForEdge[];
};

export async function replaceResonanceEdges(input: {
  sourceNodeId: string;
  result: ResonanceResultForEdges;
}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  await sb.from('resonance_edges')
    .update({ state: 'dormant', last_seen_at: new Date().toISOString() })
    .eq('source_node_id', input.sourceNodeId)
    .neq('state', 'dismissed');

  const cards: { target_kind: 'scripture' | 'voice' | 'past_entry'; card: ResonanceCardForEdge }[] = [];
  for (const card of input.result.scripture ?? []) cards.push({ target_kind: 'scripture', card });
  for (const card of input.result.voices ?? []) cards.push({ target_kind: 'voice', card });
  for (const card of input.result.pastEntries ?? []) cards.push({ target_kind: 'past_entry', card });

  if (cards.length === 0) return [];
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = cards.map(({ target_kind, card }) => ({
    user_id: uid,
    source_node_id: input.sourceNodeId,
    target_kind,
    target_source: card.bookId ?? card.source ?? null,
    target_id: String(card.passageId ?? card.source ?? card.text?.slice(0, 80) ?? 'unknown'),
    target_ref: card.source ?? null,
    score: typeof card.similarity === 'number' ? card.similarity : 0,
    confidence: Math.max(0, Math.min(1, typeof card.similarity === 'number' ? card.similarity : 0)),
    state: 'candidate',
    evidence: [{ reason: 'semantic_resonance', excerpt: card.text?.slice(0, 240) ?? null, seen_at: now.toISOString() }],
    last_seen_at: now.toISOString(),
    expires_at: expires,
    metadata: card,
  }));
  const { data, error } = await sb.from('resonance_edges')
    .upsert(rows, { onConflict: 'source_node_id,target_kind,target_id' })
    .select();
  if (error) throw error;
  return data ?? [];
}

async function embedTextForResonance(text: string): Promise<{ vector: number[]; usage?: unknown; cost_usd?: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://resonance.app',
      'X-Title': 'Resonance',
    },
    body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: text.length > 8000 ? text.slice(0, 8000) : text }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const json = await res.json() as { data?: { embedding?: number[] }[]; usage?: { cost?: number } };
  const vector = json.data?.[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIM) throw new Error('Unexpected embedding shape from provider');
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] = vector[i] / norm;
  return { vector, usage: json.usage, cost_usd: json.usage?.cost ?? 0 };
}

export async function processNextResonanceJob(origin: string) {
  const sb = getSupabase();
  const { data: job, error: selectErr } = await sb.from('resonance_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_after', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!job) return null;

  const startedAt = new Date().toISOString();
  await sb.from('resonance_jobs')
    .update({ status: 'running', locked_at: startedAt, attempts: (job.attempts ?? 0) + 1, updated_at: startedAt })
    .eq('id', job.id);

  try {
    const { data: node, error: nodeErr } = await sb.from('resonance_nodes')
      .select('*')
      .eq('id', job.source_node_id)
      .single();
    if (nodeErr) throw nodeErr;
    if (!node?.body_text || !node.content_hash) throw new Error('Job source node missing body_text/content_hash');

    let vector = await getStoredResonanceEmbedding(node.id, node.content_hash);
    let embedMeta: Record<string, unknown> = { reused: true };
    if (!vector) {
      const embedded = await embedTextForResonance(node.body_text);
      vector = embedded.vector;
      embedMeta = { reused: false, usage: embedded.usage ?? null, cost_usd: embedded.cost_usd ?? 0 };
      await storeResonanceEmbedding({ nodeId: node.id, contentHash: node.content_hash, vector, metadata: embedMeta });
    }

    const resonanceRes = await fetch(`${origin}/api/resonance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: node.body_text, vector, sourceId: node.source_id, sourceNodeId: node.id, sourceType: node.node_type }),
    });
    if (!resonanceRes.ok) throw new Error(`/api/resonance ${resonanceRes.status}: ${(await resonanceRes.text()).slice(0, 240)}`);
    const result = await resonanceRes.json();
    await storeResonanceCache({ sourceNodeId: node.id, sourceId: node.source_id, sourceType: node.node_type, contentHash: node.content_hash, result, metadata: { job_id: job.id } });
    const edges = await replaceResonanceEdges({ sourceNodeId: node.id, result });

    const completedAt = new Date().toISOString();
    const { data: completed, error: completeErr } = await sb.from('resonance_jobs')
      .update({ status: 'completed', completed_at: completedAt, updated_at: completedAt, error: null, payload: { ...(job.payload ?? {}), embed: embedMeta, edges: edges.length } })
      .eq('id', job.id)
      .select()
      .single();
    if (completeErr) throw completeErr;
    return { job: completed, result, edges: edges.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = (job.attempts ?? 0) + 1 >= (job.max_attempts ?? 3);
    await sb.from('resonance_jobs')
      .update({
        status: failed ? 'failed' : 'pending',
        error: message.slice(0, 1000),
        run_after: new Date(Date.now() + 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    throw err;
  }
}


// ── Theme snapshots + anti-staleness maintenance ───────────────────────────
const THEME_STOP_WORDS = new Set(['the','and','for','with','that','this','from','have','has','had','was','were','are','but','not','you','your','his','her','their','our','into','about','feel','feeling','really','just','been','being','will','would','could','should','there','here','when','where','what','which','while','through','because','things','thing']);

function extractThemeTerms(texts: string[], max = 6): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set<string>();
    for (const word of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (word.length < 4 || THEME_STOP_WORDS.has(word)) continue;
      seen.add(word);
    }
    for (const word of Array.from(seen)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w);
}

export async function generateThemeSnapshot(input: { windowDays?: number } = {}) {
  const sb = getSupabase();
  const uid = await getDevUserId();
  const windowDays = input.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: nodes, error } = await sb.from('resonance_nodes')
    .select('id,node_type,source_id,body_text,updated_at,metadata')
    .eq('user_id', uid)
    .eq('status', 'active')
    .in('node_type', ['journal_entry', 'highlight', 'note'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  const texts = (nodes ?? []).map((n: any) => String(n.body_text ?? '')).filter((t: string) => t.trim().length >= 12);
  if (texts.length < 2) return null;
  const terms = extractThemeTerms(texts, 4);
  if (terms.length === 0) return null;
  const label = terms.slice(0, 3).join(' · ');
  const confidence = Math.max(0.2, Math.min(0.9, (texts.length / 10) * 0.5 + (terms.length / 8) * 0.4));
  const now = new Date();
  const expires = new Date(now.getTime() + Math.max(7, Math.floor(windowDays / 2)) * 24 * 60 * 60 * 1000).toISOString();
  const evidence = (nodes ?? []).slice(0, 8).map((n: any) => ({ source_node_id: n.id, source_type: n.node_type, source_id: n.source_id, excerpt: String(n.body_text ?? '').slice(0, 180), seen_at: n.updated_at }));
  const { data, error: upsertErr } = await sb.from('theme_snapshots')
    .insert({ user_id: uid, label, summary: `Recently echoed around ${label}`, confidence, evidence, status: 'active', valid_from: since, expires_at: expires })
    .select()
    .single();
  if (upsertErr) throw upsertErr;
  return data;
}

export async function runResonanceMaintenance() {
  const sb = getSupabase();
  const now = new Date().toISOString();
  const { error: edgeErr } = await sb.from('resonance_edges')
    .update({ state: 'dormant', last_seen_at: now })
    .lt('expires_at', now)
    .in('state', ['candidate', 'active']);
  if (edgeErr) throw edgeErr;
  const { error: snapshotErr } = await sb.from('theme_snapshots')
    .update({ status: 'expired', updated_at: now })
    .lt('expires_at', now)
    .eq('status', 'active');
  if (snapshotErr) throw snapshotErr;
  const snapshot = await generateThemeSnapshot({ windowDays: 30 });
  return { ok: true, snapshot_created: Boolean(snapshot), snapshot };
}
