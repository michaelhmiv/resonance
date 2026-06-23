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

// ── Cross-references ────────────────────────────────────────────────────────

/** Reads the cross-reference array from app_settings (written at bootstrap). */
async function loadCrossRefs(): Promise<CrossReference[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    const row = await db.getFirstAsync<{ value: string | null }>(
      `SELECT value FROM app_settings WHERE key = 'cross_references';`
    );
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CrossReference =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CrossReference).from_ref === 'string' &&
        typeof (item as CrossReference).to_ref === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Cross-reference targets for a single verse reference, normalized so minor
 * formatting differences (e.g. "John 3:16" vs "Joh 3:16") still match.
 */
export async function getCrossReferences(
  verseRef: string
): Promise<string[]> {
  const refs = await loadCrossRefs();
  if (refs.length === 0) return [];
  const norm = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(verseRef);
  const out = refs
    .filter((r) => norm(r.from_ref) === target)
    .map((r) => r.to_ref);
  // Deduplicate while preserving order.
  return Array.from(new Set(out));
}
