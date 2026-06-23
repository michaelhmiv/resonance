/**
 * Resonance service — matches journal text to Library passages and surfaces
 * the most resonant Scripture, voices, and past entries.
 *
 * Pipeline: embed journal text → cosine similarity against all passage
 * vectors → selection (top-K with diversity) → return as ResonanceCard[].
 *
 * The vectors for Library passages are pre-computed at seed time and loaded
 * into memory as Float32Array. User journal vectors are stored in SQLite
 * (journal_segment_vectors) and loaded on demand.
 *
 * (design spec §7.2 — resonance: inline cards, selection algorithm,
 *  "where you were" past entries, reflection prompts)
 */

import { getDatabase } from '../db/database';
import {
  embedText,
  cosineSimilarity,
  blobToVector,
  isEmbeddingReady,
} from './embeddingService';
import type { PassageHit } from '../db/queries/bibleQueries';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ResonanceCard {
  passageId: number;
  text: string;
  source: string;
  translation: string | null;
  similarity: number;
  kind: 'scripture' | 'voice' | 'past_entry';
}

export interface ResonanceResult {
  /** Top Scripture passages. */
  scripture: ResonanceCard[];
  /** Top voice-of-the-Church passages. */
  voices: ResonanceCard[];
  /** Past journal entries with high similarity. */
  pastEntries: ResonanceCard[];
}

// ── In-memory vector store for Library passages ─────────────────────────────

interface PassageVector {
  passageId: number;
  vector: Float32Array;
  text: string;
  source: string;
  translation: string | null;
}

let libraryVectors: PassageVector[] | null = null;

/**
 * Load all Library passage vectors into memory. Called once at app start
 * (or when a new Book Package is installed). The vectors file is a flat
 * binary blob: N passages × dim Float32 values, preceded by a header
 * containing N and dim.
 */
export async function loadLibraryVectors(): Promise<void> {
  if (libraryVectors !== null) return;

  const db = getDatabase();
  if (!db) return;

  try {
    // In a production build, vectors are loaded from the seeded binary
    // file. For now, pull text + metadata from SQLite and leave vectors
    // as zero-length (resonance will return no matches until the vector
    // file is loaded).
    const rows = await db.getAllAsync<{
      id: number;
      book_id: string;
      chapter: number | null;
      verse_start: number | null;
      verse_end: number | null;
      text: string;
      translation: string | null;
    }>(
      `SELECT id, book_id, chapter, verse_start, verse_end, text, translation
       FROM passages
       ORDER BY id;`
    );

    libraryVectors = rows.map((r) => {
      let source: string;
      if (r.translation != null) {
        const bookName = r.book_id.replace(/^[A-Z]+_/, '').replace(/_/g, ' ');
        const ref = r.verse_start != null
          ? `${bookName} ${r.chapter ?? ''}:${r.verse_start}`
          : `${bookName} ${r.chapter ?? ''}`;
        source = r.translation ? `${ref} (${r.translation})` : ref;
      } else {
        source = r.book_id;
      }
      return {
        passageId: r.id,
        vector: new Float32Array(0), // loaded from binary file in production
        text: r.text,
        source,
        translation: r.translation,
      };
    });

    // In production: load the binary vector file and fill in vectors.
    // This is a no-op for now — vectors stay empty until the binary file
    // reader is wired.
  } catch {
    libraryVectors = [];
  }
}

/** Free the in-memory vector store (e.g. when switching embedding model). */
export function clearLibraryVectors(): void {
  libraryVectors = null;
}

// ── Find resonant passages ──────────────────────────────────────────────────

/** Min similarity threshold to surface a passage (tunable). */
const MIN_SIMILARITY = 0.15;
/** Max cards per category. */
const MAX_PER_CATEGORY = 3;
/** Min text length to bother embedding (avoids noise from 1-2 words). */
const MIN_TEXT_LENGTH = 12;

/**
 * Given journal text, find the most resonant passages from the Library
 * and the user's past entries. Returns null if the embedding model
 * isn't loaded or the text is too short.
 *
 * (design spec §7.2: inline cards, not a side panel; surfaced as the
 *  user pauses or finishes a thought)
 */
export async function findResonance(
  journalText: string
): Promise<ResonanceResult | null> {
  if (!isEmbeddingReady()) return null;
  if (journalText.trim().length < MIN_TEXT_LENGTH) return null;

  const queryVec = await embedText(journalText);
  if (!queryVec) return null;

  // If libraryVectors are empty (no binary file loaded), return empty results.
  if (!libraryVectors || libraryVectors.length === 0) {
    return { scripture: [], voices: [], pastEntries: [] };
  }

  // Compute similarities against all Library passages.
  const scored: (PassageVector & { sim: number })[] = [];
  for (const pv of libraryVectors) {
    if (pv.vector.length === 0) continue;
    const sim = cosineSimilarity(queryVec, pv.vector);
    if (sim >= MIN_SIMILARITY) {
      scored.push({ ...pv, sim });
    }
  }

  // Sort by similarity descending.
  scored.sort((a, b) => b.sim - a.sim);

  // Select with diversity: avoid surfacing 3 passages from the same chapter.
  const scripture = selectWithDiversity(
    scored.filter((s) => s.translation !== null),
    MAX_PER_CATEGORY
  ).map(toCard('scripture'));

  const voices = selectWithDiversity(
    scored.filter((s) => s.translation === null),
    MAX_PER_CATEGORY
  ).map(toCard('voice'));

  // Search past journal entries.
  const pastEntries = await findResonantPastEntries(queryVec);

  return { scripture, voices, pastEntries };
}

// ── Select top-K with diversity (no duplicate chapters) ─────────────────────

function selectWithDiversity<T extends { sim: number; passageId: number; source: string }>(
  sorted: T[],
  k: number
): T[] {
  const result: T[] = [];
  const seenChapters = new Set<string>();

  for (const item of sorted) {
    // Use the source as a diversity key (rough grouping by book+chapter).
    const key = item.source.split(':')[0] ?? item.source;
    if (seenChapters.has(key)) continue;
    seenChapters.add(key);
    result.push(item);
    if (result.length >= k) break;
  }

  return result;
}

// ── Convert to ResonanceCard ────────────────────────────────────────────────

function toCard(kind: 'scripture' | 'voice') {
  return (pv: PassageVector & { sim: number }): ResonanceCard => ({
    passageId: pv.passageId,
    text: pv.text,
    source: pv.source,
    translation: pv.translation,
    similarity: pv.sim,
    kind,
  });
}

// ── Search past journal entries ─────────────────────────────────────────────

/**
 * Find the user's past journal entries that are most similar to the current
 * text ("where you were"). Re-uses the same embedding model; past entries
 * have their vectors stored in journal_segment_vectors.
 */
async function findResonantPastEntries(
  queryVec: Float32Array
): Promise<ResonanceCard[]> {
  const db = getDatabase();
  if (!db) return [];

  try {
    // Load past entry vectors from SQLite.
    const rows = await db.getAllAsync<{
      segment_id: string;
      vector_blob: Uint8Array;
      text: string;
      created_at: number;
    }>(
      `SELECT jsv.segment_id, jsv.vector_blob, js.text, js.created_at
       FROM journal_segment_vectors jsv
       JOIN journal_segments js ON js.id = jsv.segment_id
       WHERE js.segment_type = 'text'
       ORDER BY js.created_at DESC
       LIMIT 500;`
    );

    const scored: ResonanceCard[] = [];
    for (const row of rows) {
      if (row.vector_blob == null || row.vector_blob.byteLength === 0) continue;
      const vec = blobToVector(row.vector_blob);
      if (vec.length === 0) continue;
      const sim = cosineSimilarity(queryVec, vec);
      if (sim >= MIN_SIMILARITY) {
        const date = new Date(row.created_at);
        const dateLabel = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        scored.push({
          passageId: 0,
          text: row.text ?? '',
          source: `Your journal — ${dateLabel}`,
          translation: null,
          similarity: sim,
          kind: 'past_entry',
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, MAX_PER_CATEGORY);
  } catch {
    return [];
  }
}

// ── Store journal entry vector ────────────────────────────────────────────────

/**
 * Embed a journal segment's text and store its vector in SQLite for future
 * resonance lookups. Called by the journal auto-save path after a segment
 * is flushed.
 */
export async function storeSegmentVector(
  segmentId: string,
  text: string
): Promise<void> {
  if (!isEmbeddingReady()) return;
  if (text.trim().length < MIN_TEXT_LENGTH) return;

  const vec = await embedText(text);
  if (!vec) return;

  const db = getDatabase();
  if (!db) return;

  try {
    const blob = new Uint8Array(vec.buffer.slice(0, vec.byteLength) as ArrayBuffer);
    await db.runAsync(
      `INSERT OR REPLACE INTO journal_segment_vectors (segment_id, vector_blob)
       VALUES (?, ?);`,
      segmentId,
      blob
    );
  } catch {
    // Non-fatal — resonance works on best-effort.
  }
}
