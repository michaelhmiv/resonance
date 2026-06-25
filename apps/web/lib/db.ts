/**
 * Supabase-backed data store — replaces JSON file store.
 * Same function signatures as before, now persisted in PostgreSQL.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ldW12Z3dlY3F0cXFnYnlpdW5lIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI2NzkzOSwiZXhwIjoyMDk3ODQzOTM5fQ.9G6vG2GYD6DJy5rEPdPb-4LJ3yu6PYYJjVwjjc8dltw';

// Singleton client
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

// Default dev user ID (pre-auth, service role bypasses RLS)
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

async function getDevUserId(): Promise<string> {
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
  // Upsert — embedding is regenerated on every note update
  const { error } = await sb.from('highlight_vectors')
    .upsert(
      { highlight_id: highlightId, vector, model_id: 'gte-small', generated_at: new Date().toISOString() },
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
            vector vector(384) NOT NULL,
            model_id TEXT NOT NULL DEFAULT 'gte-small',
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
