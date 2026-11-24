/**
 * Resonance service — matches journal text to Scripture, Voices of the Church,
 * user-imported Personal Library works, and past journal entries.
 *
 * Locked shipping pipeline (bake-off v2 confirmed 512d):
 *   1. Embed journal entry via Voyage-4-Nano INT8 -> 512d L2-normalized query
 *   2. Stratified Per-Library Fetch against 512d int8 vectors:
 *        - Top 20 Scripture passages (.rvec)
 *        - Top 30 Witness + Personal Library passages (.rvec + SQLite passage_vectors)
 *   3. Pointwise Yes/No reranking via Qwen3-Reranker-0.6B INT8 (when ready)
 *   4. Per-Library Z-Score Fusion (α = 0.60) + Calibrated Silence (τ = 0.06) +
 *      Per-Work Cap (2)
 *   5. Past-self echoes from SQLite `journal_segment_vectors`
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  EMBEDDING_DIM,
  OFFLINE_ENGINE_MANIFEST,
  base64ToBytes,
  blobToVector,
  cosineSimilarity,
  dotProductFloat32Int8,
  parseRvec,
  perLibraryZScoreFuse,
  type FusionCandidate,
  type ResonanceCard,
  type ResonanceResult,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  embedQuery,
  isEmbeddingReady,
} from './embeddingService';
import {
  isRerankerReady,
  scoreCandidatePair,
} from './rerankerService';
import {
  getPackLocalPaths,
  getWorkLocalPaths,
  useOfflineEngineStore,
} from '../packages/offlineEngineManager';

export type { ResonanceCard, ResonanceResult };

// ── Unified in-memory 512d int8 vector store ────────────────────────────────

interface PackedVectorMatrix {
  library: 'scripture' | 'witness' | 'personal';
  dim: number;
  count: number;
  scales: Float32Array;
  vectors: Int8Array;
  meta: Array<{
    passageId: number;
    bookId: string;
    workId: string;
    source: string;
    text: string;
    translation: string | null;
  }>;
}

let loadedMatrices: PackedVectorMatrix[] | null = null;

/**
 * Load all installed 512d int8 `.rvec` files (core Bible pack + individually
 * downloaded Church Library works) AND embedded Personal Library works
 * (`include_in_resonance = 1`) from SQLite into memory.
 */
export async function loadLibraryVectors(): Promise<void> {
  if (loadedMatrices !== null) return;

  const db = getDatabase();
  if (!db) {
    loadedMatrices = [];
    return;
  }

  const matrices: PackedVectorMatrix[] = [];

  try {
    const manifest = useOfflineEngineStore.getState().corpusManifest;

    // 1. Load core Bible `.rvec` pack (if downloaded)
    for (const pack of manifest.packs) {
      if (pack.kind !== 'bible') continue;
      const { vectorsPath } = getPackLocalPaths(pack.id);
      const info = await FileSystem.getInfoAsync(vectorsPath);
      if (!info.exists) continue;
      try {
        const b64 = await FileSystem.readAsStringAsync(vectorsPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const rvec = parseRvec(base64ToBytes(b64));
        const rows = await db.getAllAsync<{
          id: number;
          book_id: string;
          chapter: number | null;
          verse_start: number | null;
          text: string;
          translation: string | null;
          title: string | null;
          author: string | null;
        }>(
          `SELECT p.id, p.book_id, p.chapter, p.verse_start, p.text, p.translation,
                  b.title, b.author
           FROM passages p
           LEFT JOIN books b ON b.id = p.book_id
           WHERE p.translation = 'WEB'
           ORDER BY p.id
           LIMIT ?;`,
          [rvec.count]
        );
        const usable = Math.min(rvec.count, rows.length);
        if (usable > 0) {
          matrices.push({
            library: 'scripture',
            dim: rvec.dim,
            count: usable,
            scales: rvec.scales.subarray(0, usable),
            vectors: rvec.vectors.subarray(0, usable * rvec.dim),
            meta: rows.slice(0, usable).map((r) => ({
              passageId: r.id,
              bookId: r.book_id,
              workId: 'web',
              source: formatPassageSource(r),
              text: r.text,
              translation: r.translation,
            })),
          });
        }
      } catch {
        // Skip corrupt/incomplete pack gracefully
      }
    }

    // 2. Load individually installed Church Library works (`offline_engine/works/<slug>.vectors.rvec`)
    for (const work of manifest.works ?? []) {
      const { vectorsPath } = getWorkLocalPaths(work.slug);
      const info = await FileSystem.getInfoAsync(vectorsPath);
      if (!info.exists) continue;
      try {
        const b64 = await FileSystem.readAsStringAsync(vectorsPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const rvec = parseRvec(base64ToBytes(b64));
        const rows = await db.getAllAsync<{
          id: number;
          book_id: string;
          chapter: number | null;
          verse_start: number | null;
          text: string;
          translation: string | null;
          title: string | null;
          author: string | null;
        }>(
          `SELECT p.id, p.book_id, p.chapter, p.verse_start, p.text, p.translation,
                  b.title, b.author
           FROM passages p
           JOIN books b ON b.id = p.book_id
           WHERE p.book_id = ?
           ORDER BY p.id
           LIMIT ?;`,
          [work.id, rvec.count]
        );
        const usable = Math.min(rvec.count, rows.length);
        if (usable > 0) {
          matrices.push({
            library: 'witness',
            dim: rvec.dim,
            count: usable,
            scales: rvec.scales.subarray(0, usable),
            vectors: rvec.vectors.subarray(0, usable * rvec.dim),
            meta: rows.slice(0, usable).map((r) => ({
              passageId: r.id,
              bookId: r.book_id,
              workId: r.book_id,
              source: formatPassageSource(r),
              text: r.text,
              translation: null,
            })),
          });
        }
      } catch {
        // Skip corrupt work file gracefully
      }
    }

    // 2. Load embedded Personal Library works (`include_in_resonance = 1`)
    const personalRows = await db.getAllAsync<{
      passage_id: number;
      book_id: string;
      dim: number;
      scale: number;
      vector_int8: Uint8Array;
      text: string;
      division: string | null;
      title: string | null;
      author: string | null;
    }>(
      `SELECT pv.passage_id, pv.book_id, pv.dim, pv.scale, pv.vector_int8,
              p.text, p.division, b.title, b.author
       FROM passage_vectors pv
       JOIN passages p ON p.id = pv.passage_id
       JOIN books b ON b.id = pv.book_id
       JOIN personal_books pb ON pb.book_id = pv.book_id
       WHERE pb.include_in_resonance = 1 AND pv.dim = ?
       ORDER BY pv.passage_id;`,
      [EMBEDDING_DIM]
    );

    if (personalRows.length > 0) {
      const count = personalRows.length;
      const scales = new Float32Array(count);
      const vectors = new Int8Array(count * EMBEDDING_DIM);
      const meta: PackedVectorMatrix['meta'] = [];

      for (let i = 0; i < count; i++) {
        const r = personalRows[i];
        scales[i] = r.scale;
        const raw =
          r.vector_int8 instanceof Uint8Array
            ? r.vector_int8
            : new Uint8Array(r.vector_int8 as unknown as ArrayBuffer);
        const signed = new Int8Array(
          raw.buffer,
          raw.byteOffset,
          Math.min(EMBEDDING_DIM, raw.byteLength)
        );
        vectors.set(signed, i * EMBEDDING_DIM);

        const labelParts = [r.title ?? r.book_id];
        if (r.author) labelParts.push(r.author);
        if (r.division) labelParts.push(r.division);
        meta.push({
          passageId: r.passage_id,
          bookId: r.book_id,
          workId: r.book_id,
          source: labelParts.join(' · '),
          text: r.text,
          translation: null,
        });
      }

      matrices.push({
        library: 'personal',
        dim: EMBEDDING_DIM,
        count,
        scales,
        vectors,
        meta,
      });
    }
  } catch {
    // Leave whatever loaded cleanly
  }

  loadedMatrices = matrices;
}

function formatPassageSource(r: {
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  translation: string | null;
  title: string | null;
  author: string | null;
}): string {
  if (r.translation != null) {
    const bookName = r.book_id.replace(/^[A-Z]+_/, '').replace(/_/g, ' ');
    const ref =
      r.verse_start != null
        ? `${bookName} ${r.chapter ?? ''}:${r.verse_start}`
        : `${bookName} ${r.chapter ?? ''}`;
    return r.translation ? `${ref} (${r.translation})` : ref;
  }
  if (r.title && r.author) return `${r.author} · ${r.title}`;
  return r.title ?? r.book_id;
}

/** Invalidate the in-memory vector store (e.g. after importing or embedding a personal book). */
export function clearLibraryVectors(): void {
  loadedMatrices = null;
}

// ── Find resonant passages (Stratified Fetch + Qwen3-Reranker + Z-Fusion) ──

const MIN_SIMILARITY = 0.15;
const STRATIFIED_SCRIPTURE_K = 20;
const STRATIFIED_WITNESS_K = 30;
const MAX_PER_CATEGORY = 3;
const MIN_TEXT_LENGTH = 12;

interface RawHit {
  library: 'scripture' | 'witness' | 'personal';
  passageId: number;
  bookId: string;
  workId: string;
  source: string;
  text: string;
  translation: string | null;
  denseScore: number;
}

export async function findResonance(
  journalText: string
): Promise<ResonanceResult | null> {
  if (!isEmbeddingReady()) return null;
  if (journalText.trim().length < MIN_TEXT_LENGTH) return null;

  const queryVec = await embedQuery(journalText);
  if (!queryVec) return null;

  if (loadedMatrices === null) {
    await loadLibraryVectors();
  }
  const matrices = loadedMatrices ?? [];

  const scriptureHits: RawHit[] = [];
  const nonScriptureHits: RawHit[] = [];

  // Stage 1: Stratified Per-Library Fetch in unified 512d int8 vector space
  for (const mat of matrices) {
    const dim = mat.dim;
    for (let i = 0; i < mat.count; i++) {
      const sim = dotProductFloat32Int8(
        queryVec,
        mat.vectors,
        i * dim,
        mat.scales[i],
        dim
      );
      if (sim < MIN_SIMILARITY) continue;
      const m = mat.meta[i];
      const hit: RawHit = {
        library: mat.library,
        passageId: m.passageId,
        bookId: m.bookId,
        workId: m.workId,
        source: m.source,
        text: m.text,
        translation: m.translation,
        denseScore: sim,
      };
      if (mat.library === 'scripture') scriptureHits.push(hit);
      else nonScriptureHits.push(hit);
    }
  }

  scriptureHits.sort((a, b) => b.denseScore - a.denseScore);
  nonScriptureHits.sort((a, b) => b.denseScore - a.denseScore);

  const pool: RawHit[] = [
    ...scriptureHits.slice(0, STRATIFIED_SCRIPTURE_K),
    ...nonScriptureHits.slice(0, STRATIFIED_WITNESS_K),
  ];

  // Stage 2: Qwen3-Reranker-0.6B pointwise scoring (when loaded)
  const useReranker = isRerankerReady();
  const candidates: FusionCandidate[] = [];
  const hitById = new Map<string, RawHit>();

  for (const hit of pool) {
    const id = `${hit.library}:${hit.passageId}`;
    hitById.set(id, hit);
    let rerankProb: number | null = null;
    let rerankLogit: number | null = null;
    if (useReranker) {
      const scored = await scoreCandidatePair(journalText, hit.text, hit.source);
      if (scored) {
        rerankProb = scored.prob;
        rerankLogit = scored.logit;
      }
    }
    candidates.push({
      id,
      workId: hit.workId,
      library: hit.library,
      denseScore: hit.denseScore,
      rerankProb,
      rerankLogit,
    });
  }

  // Stage 3: Per-Library Z-Score Fusion (α = 0.60) + Calibrated Silence (τ = 0.06)
  const fused = perLibraryZScoreFuse(candidates, {
    alpha: OFFLINE_ENGINE_MANIFEST.fusionAlpha,
    silenceThreshold: OFFLINE_ENGINE_MANIFEST.silenceThreshold,
    perWorkCap: OFFLINE_ENGINE_MANIFEST.perWorkCap,
    topK: 6,
  });

  const pastEntries = await findResonantPastEntries(queryVec);

  if (fused.silent) {
    return { scripture: [], voices: [], pastEntries };
  }

  const scripture: ResonanceCard[] = [];
  const voices: ResonanceCard[] = [];

  for (const item of fused.results) {
    const hit = hitById.get(item.id);
    if (!hit) continue;
    const card: ResonanceCard = {
      passageId: hit.passageId,
      bookId: hit.bookId,
      text: hit.text,
      source: hit.source,
      translation: hit.translation,
      similarity: item.rerankProb ?? hit.denseScore,
      kind: hit.library === 'scripture' ? 'scripture' : 'voice',
    };
    if (card.kind === 'scripture' && scripture.length < MAX_PER_CATEGORY) {
      scripture.push(card);
    } else if (card.kind === 'voice' && voices.length < MAX_PER_CATEGORY) {
      voices.push(card);
    }
  }

  return { scripture, voices, pastEntries };
}

// ── Search past journal entries ─────────────────────────────────────────────

async function findResonantPastEntries(
  queryVec: Float32Array
): Promise<ResonanceCard[]> {
  const db = getDatabase();
  if (!db) return [];

  try {
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
      if (vec.length !== queryVec.length) continue;
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
          bookId: `journal:${row.segment_id}`,
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

// ── Store journal entry vector ──────────────────────────────────────────────

export async function storeSegmentVector(
  segmentId: string,
  text: string
): Promise<void> {
  if (!isEmbeddingReady()) return;
  if (text.trim().length < MIN_TEXT_LENGTH) return;

  const vec = await embedQuery(text);
  if (!vec) return;

  const db = getDatabase();
  if (!db) return;

  try {
    const blob = new Uint8Array(
      vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength) as ArrayBuffer
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO journal_segment_vectors (segment_id, vector_blob)
       VALUES (?, ?);`,
      [segmentId, blob]
    );
  } catch {
    // Non-fatal
  }
}
