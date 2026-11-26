/**
 * Reading-state data access — highlights, annotations, bookmarks,
 * and cross-references for the Word tab's reading surface.
 *
 * Highlights are shared across translations (keyed by `verse_ref` only);
 * annotations are per-translation (keyed by `verse_ref + translation`).
 * Cross-references are stored as a JSON array in `app_settings` (written by
 * the library bootstrap from the seeded `cross_references.json` asset).
 *
 * (design spec §6.3 — highlights, annotations, bookmarks, cross-refs)
 */

import { getDatabase } from '../database';
import type { Translation } from '../types/word';
import { highlightPalette } from '@resonance/theme';

// ── Types ───────────────────────────────────────────────────────────────────

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

export interface CrossReference {
  from_ref: string;
  to_ref: string;
}

/** A map of { verse_ref -> color } for fast verse-by-verse rendering. */
export type HighlightMap = Record<string, string>;

/** A map of { verse_ref -> annotation text } for a translation. */
export type AnnotationMap = Record<string, string>;

// ── ID generation (no crypto polyfill dependency) ────────────────────────────

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): number {
  return Date.now();
}

// ── Highlights ──────────────────────────────────────────────────────────────

/** Returns true if `color` is one of the curated highlight tones. */
export function isHighlightColor(color: string): boolean {
  return (highlightPalette as readonly string[]).includes(color);
}

/**
 * Save (or replace) the highlight color for a single verse reference.
 * Highlights are shared across translations (one per verse_ref), so we
 * delete-then-insert rather than rely on a unique constraint that the schema
 * does not provide (idx_highlights_ref is a plain index).
 */
export async function saveHighlight(
  verseRef: string,
  color: string
): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(`DELETE FROM highlights WHERE verse_ref = ?;`, [verseRef]);
  await db.runAsync(
    `INSERT INTO highlights (id, verse_ref, color, created_at)
     VALUES (?, ?, ?, ?);`,
    [makeId(), verseRef, color, now()]
  );
}

/** Remove the highlight for a single verse reference. */
export async function removeHighlight(verseRef: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(
    `DELETE FROM highlights WHERE verse_ref = ?;`,
    [verseRef]
  );
}

/** All highlights for a single verse reference. */
export async function getHighlights(
  verseRef: string
): Promise<Highlight[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    return await db.getAllAsync<Highlight>(
      `SELECT id, verse_ref, color, created_at
       FROM highlights
       WHERE verse_ref = ?
       ORDER BY created_at;`,
      [verseRef]
    );
  } catch {
    return [];
  }
}

/**
 * Highlights for many verse references at once, returned as a { ref -> color }
 * map. Used to render verse backgrounds for a whole chapter in one query.
 */
export async function getHighlightsForRefs(
  verseRefs: string[]
): Promise<HighlightMap> {
  const db = getDatabase();
  if (!db || verseRefs.length === 0) return {};
  const map: HighlightMap = {};
  // Batch in chunks to avoid SQLite variable limits.
  for (let i = 0; i < verseRefs.length; i += 400) {
    const chunk = verseRefs.slice(i, i + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    try {
      const rows = await db.getAllAsync<Highlight>(
        `SELECT id, verse_ref, color, created_at
         FROM highlights
         WHERE verse_ref IN (${placeholders});`,
        chunk
      );
      for (const r of rows) {
        map[r.verse_ref] = r.color;
      }
    } catch {
      // ignore chunk errors
    }
  }
  return map;
}

// ── Annotations ─────────────────────────────────────────────────────────────

/** Save (or replace) a margin note for a verse in a given translation. */
export async function saveAnnotation(
  verseRef: string,
  translation: Translation,
  text: string
): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(
    `DELETE FROM annotations WHERE verse_ref = ? AND translation = ?;`,
    [verseRef, translation]
  );
  if (text.trim().length === 0) return;
  await db.runAsync(
    `INSERT INTO annotations (id, verse_ref, translation, text, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    [makeId(), verseRef, translation, text, now()]
  );
}

/** All annotations for a verse+translation. */
export async function getAnnotations(
  verseRef: string,
  translation: Translation
): Promise<Annotation[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    return await db.getAllAsync<Annotation>(
      `SELECT id, verse_ref, translation, text, created_at
       FROM annotations
       WHERE verse_ref = ? AND translation = ?
       ORDER BY created_at;`,
      [verseRef, translation]
    );
  } catch {
    return [];
  }
}

/**
 * Annotations for many verse+translation refs at once, returned as a
 * { ref -> text } map. verse_refs must all be for the same translation.
 */
export async function getAnnotationsForRefs(
  verseRefs: string[],
  translation: Translation
): Promise<AnnotationMap> {
  const db = getDatabase();
  if (!db || verseRefs.length === 0) return {};
  const map: AnnotationMap = {};
  for (let i = 0; i < verseRefs.length; i += 400) {
    const chunk = verseRefs.slice(i, i + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    try {
      const rows = await db.getAllAsync<Annotation>(
        `SELECT id, verse_ref, translation, text, created_at
         FROM annotations
         WHERE translation = ? AND verse_ref IN (${placeholders});`,
        [translation, ...chunk]
      );
      for (const r of rows) {
        map[r.verse_ref] = r.text;
      }
    } catch {
      // ignore chunk errors
    }
  }
  return map;
}

// ── Bookmarks ────────────────────────────────────────────────────────────────

/** Create or update a bookmark for a passage/chapter reference. */
export async function saveBookmark(
  verseRef: string,
  label?: string
): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO bookmarks (id, verse_ref, created_at, label)
     VALUES (?, ?, ?, ?);`,
    [makeId(), verseRef, now(), label ?? null]
  );
}

/** Remove a bookmark by its passage reference (e.g. on toggle off). */
export async function removeBookmark(verseRef: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(`DELETE FROM bookmarks WHERE verse_ref = ?;`, [verseRef]);
}

/** All bookmarks, newest first. */
export async function getBookmarks(): Promise<Bookmark[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    return await db.getAllAsync<Bookmark>(
      `SELECT id, verse_ref, created_at, label
       FROM bookmarks
       ORDER BY created_at DESC;`
    );
  } catch {
    return [];
  }
}

/** Whether a bookmark exists for a given reference. */
export async function isBookmarked(verseRef: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  try {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM bookmarks WHERE verse_ref = ?;`,
      [verseRef]
    );
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Full Highlights (Migration v2: offsets + notes) ─────────────────────────

export interface FullHighlightRow {
  id: string;
  verse_ref: string;
  color: string;
  start_offset: number | null;
  end_offset: number | null;
  selected_text: string | null;
  note_text: string | null;
  note_updated_at: number | null;
  created_at: number;
  updated_at: number | null;
}

function toIso(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return new Date().toISOString();
  }
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}

export async function getFullHighlightsForRefs(
  verseRefs: string[]
): Promise<
  Array<{
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
  }>
> {
  const db = getDatabase();
  if (!db || verseRefs.length === 0) return [];
  const results: Array<{
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
  }> = [];

  for (let i = 0; i < verseRefs.length; i += 400) {
    const chunk = verseRefs.slice(i, i + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    try {
      const rows = await db.getAllAsync<FullHighlightRow>(
        `SELECT id, verse_ref, color, start_offset, end_offset, selected_text,
                note_text, note_updated_at, created_at, updated_at
         FROM highlights
         WHERE verse_ref IN (${placeholders})
         ORDER BY created_at ASC;`,
        chunk
      );
      for (const r of rows) {
        results.push({
          id: r.id,
          verse_ref: r.verse_ref,
          color: r.color,
          start_offset: r.start_offset ?? null,
          end_offset: r.end_offset ?? null,
          selected_text: r.selected_text ?? null,
          note_text: r.note_text ?? null,
          note_updated_at: r.note_updated_at != null ? toIso(r.note_updated_at) : null,
          created_at: toIso(r.created_at),
          updated_at: toIso(r.updated_at ?? r.created_at),
        });
      }
    } catch {
      // Fall back to legacy columns if migration v2 hasn't run
      const legacy = await getHighlightsForRefs(chunk);
      for (const [verse_ref, color] of Object.entries(legacy)) {
        const iso = new Date().toISOString();
        results.push({
          id: `legacy-${verse_ref}`,
          verse_ref,
          color,
          start_offset: null,
          end_offset: null,
          selected_text: null,
          note_text: null,
          note_updated_at: null,
          created_at: iso,
          updated_at: iso,
        });
      }
    }
  }
  return results;
}

export async function saveFullHighlight(input: {
  verseRef: string;
  color: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  noteText?: string | null;
}): Promise<{
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
}> {
  const db = getDatabase();
  const ts = now();
  const id = makeId();
  const cleanedNote =
    input.noteText && input.noteText.trim().length > 0 ? input.noteText.trim() : null;
  const noteTs = cleanedNote ? ts : null;

  if (db) {
    try {
      await db.runAsync(`DELETE FROM highlights WHERE verse_ref = ?;`, [input.verseRef]);
      await db.runAsync(
        `INSERT INTO highlights (
           id, verse_ref, color, start_offset, end_offset, selected_text,
           note_text, note_updated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          id,
          input.verseRef,
          input.color,
          input.startOffset,
          input.endOffset,
          input.selectedText,
          cleanedNote,
          noteTs,
          ts,
          ts,
        ]
      );
    } catch {
      await saveHighlight(input.verseRef, input.color);
    }
  }

  return {
    id,
    verse_ref: input.verseRef,
    color: input.color,
    start_offset: input.startOffset,
    end_offset: input.endOffset,
    selected_text: input.selectedText,
    note_text: cleanedNote,
    note_updated_at: noteTs ? toIso(noteTs) : null,
    created_at: toIso(ts),
    updated_at: toIso(ts),
  };
}

export async function updateFullHighlight(
  id: string,
  patch: {
    color?: string;
    startOffset?: number;
    endOffset?: number;
    selectedText?: string;
    noteText?: string | null;
  }
): Promise<{
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
}> {
  const db = getDatabase();
  const ts = now();

  if (db) {
    try {
      const existing = await db.getFirstAsync<FullHighlightRow>(
        `SELECT id, verse_ref, color, start_offset, end_offset, selected_text,
                note_text, note_updated_at, created_at, updated_at
         FROM highlights
         WHERE id = ?;`,
        [id]
      );
      if (existing) {
        const nextColor = patch.color ?? existing.color;
        const nextStart = patch.startOffset ?? existing.start_offset;
        const nextEnd = patch.endOffset ?? existing.end_offset;
        const nextText = patch.selectedText ?? existing.selected_text;
        const nextNote =
          patch.noteText !== undefined
            ? patch.noteText && patch.noteText.trim().length > 0
              ? patch.noteText.trim()
              : null
            : existing.note_text;
        const nextNoteTs =
          patch.noteText !== undefined
            ? nextNote
              ? ts
              : null
            : existing.note_updated_at;

        await db.runAsync(
          `UPDATE highlights
           SET color = ?, start_offset = ?, end_offset = ?, selected_text = ?,
               note_text = ?, note_updated_at = ?, updated_at = ?
           WHERE id = ?;`,
          [nextColor, nextStart, nextEnd, nextText, nextNote, nextNoteTs, ts, id]
        );

        return {
          id: existing.id,
          verse_ref: existing.verse_ref,
          color: nextColor,
          start_offset: nextStart,
          end_offset: nextEnd,
          selected_text: nextText,
          note_text: nextNote,
          note_updated_at: nextNoteTs != null ? toIso(nextNoteTs) : null,
          created_at: toIso(existing.created_at),
          updated_at: toIso(ts),
        };
      }
    } catch {
      // fall through to best-effort return
    }
  }

  const fallbackRef = id.replace(/^mobile-/, '').replace(/^legacy-/, '');
  if (patch.color) await saveHighlight(fallbackRef, patch.color);
  return {
    id,
    verse_ref: fallbackRef,
    color: patch.color ?? '#d4a574',
    start_offset: patch.startOffset ?? null,
    end_offset: patch.endOffset ?? null,
    selected_text: patch.selectedText ?? null,
    note_text: patch.noteText ?? null,
    note_updated_at: patch.noteText ? toIso(ts) : null,
    created_at: toIso(ts),
    updated_at: toIso(ts),
  };
}

export async function deleteFullHighlightById(id: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    await db.runAsync(`DELETE FROM highlights WHERE id = ?;`, [id]);
  } catch {
    const fallbackRef = id.replace(/^mobile-/, '').replace(/^legacy-/, '');
    await removeHighlight(fallbackRef);
  }
}

// ── Cross-references (cached O(1) in-memory Map index) ──────────────────────

let cachedCrossRefIndex: Map<string, string[]> | null = null;
let crossRefLoadPromise: Promise<Map<string, string[]>> | null = null;

function normRef(s: string): string {
  return s
    .replace(/^Exodus\b/i, 'Exod')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Loads and indexes the cross-reference map ONCE per app session. */
async function loadCrossRefIndex(): Promise<Map<string, string[]>> {
  if (cachedCrossRefIndex) return cachedCrossRefIndex;
  if (crossRefLoadPromise) return crossRefLoadPromise;

  crossRefLoadPromise = (async () => {
    const map = new Map<string, string[]>();
    const db = getDatabase();
    if (!db) return map;
    try {
      const row = await db.getFirstAsync<{ value: string | null }>(
        `SELECT value FROM app_settings WHERE key = 'cross_references';`
      );
      if (!row?.value) {
        cachedCrossRefIndex = map;
        return map;
      }
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) {
        cachedCrossRefIndex = map;
        return map;
      }
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i] as Partial<CrossReference> | null;
        if (!item || typeof item.from_ref !== 'string' || typeof item.to_ref !== 'string') {
          continue;
        }
        const key = normRef(item.from_ref);
        let arr = map.get(key);
        if (!arr) {
          arr = [item.to_ref];
          map.set(key, arr);
        } else if (!arr.includes(item.to_ref)) {
          arr.push(item.to_ref);
        }
      }
      cachedCrossRefIndex = map;
      return map;
    } catch {
      cachedCrossRefIndex = map;
      return map;
    } finally {
      crossRefLoadPromise = null;
    }
  })();

  return crossRefLoadPromise;
}

/** O(1) cross-reference targets for a single verse reference. */
export async function getCrossReferences(verseRef: string): Promise<string[]> {
  const index = await loadCrossRefIndex();
  return index.get(normRef(verseRef)) ?? [];
}

/** O(N) single-pass batched cross-reference lookup using the cached index. */
export async function getCrossReferencesBatch(
  verseRefs: string[]
): Promise<Record<string, string[]>> {
  if (verseRefs.length === 0) return {};
  const index = await loadCrossRefIndex();
  const result: Record<string, string[]> = {};
  for (const ref of verseRefs) {
    const targets = index.get(normRef(ref));
    if (targets && targets.length > 0) {
      result[ref] = targets;
    }
  }
  return result;
}

