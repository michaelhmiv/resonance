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
  VOYAGE4_SHARED_SPACE_MODELS,
  base64ToBytes,
  blobToVector,
  cosineSimilarity,
  dotProductFloat32Int8,
  isVoyage4SharedSpace,
  parseRvec,
  perLibraryZScoreFuse,
  quantizeVectorInt8,
  type FusionCandidate,
  type ResonanceCard,
  type ResonanceResult,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  embedQuery,
  ensureEmbeddingReady,
} from './embeddingService';
import { rerankCandidatePool } from './rerankerService';
import {
  getPackLocalPaths,
  getWorkLocalPaths,
  useOfflineEngineStore,
} from '../packages/offlineEngineManager';
import {
  getActiveEmbeddingModelId,
  getActiveVectorSpaceId,
} from '../openrouter/openrouterStore';

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
let loadedVectorSpaceId: string | null = null;

function getCompatibleModelIds(activeModel: string): string[] {
  if (isVoyage4SharedSpace(activeModel)) {
    return [...VOYAGE4_SHARED_SPACE_MODELS];
  }
  return [activeModel];
}

function packSqlPassageRows(
  library: 'scripture' | 'witness' | 'personal',
  rows: Array<{
    passage_id: number;
    book_id: string;
    dim: number;
    scale: number;
    vector_int8: Uint8Array;
    text: string;
    chapter: number | null;
    verse_start: number | null;
    translation: string | null;
    division: string | null;
    title: string | null;
    author: string | null;
  }>
): PackedVectorMatrix | null {
  if (rows.length === 0) return null;
  const dim = rows[0].dim;
  const compatible = rows.filter((r) => r.dim === dim && r.vector_int8 != null);
  if (compatible.length === 0) return null;

  const count = compatible.length;
  const scales = new Float32Array(count);
  const vectors = new Int8Array(count * dim);
  const meta: PackedVectorMatrix['meta'] = [];

  for (let i = 0; i < count; i++) {
    const r = compatible[i];
    scales[i] = r.scale;
    const raw =
      r.vector_int8 instanceof Uint8Array
        ? r.vector_int8
        : new Uint8Array(r.vector_int8 as unknown as ArrayBuffer);
    const signed = new Int8Array(
      raw.buffer,
      raw.byteOffset,
      Math.min(dim, raw.byteLength)
    );
    vectors.set(signed, i * dim);

    const source =
      library === 'personal'
        ? [r.title ?? r.book_id, r.author, r.division].filter(Boolean).join(' · ')
        : formatPassageSource(r);

    meta.push({
      passageId: r.passage_id,
      bookId: r.book_id,
      workId: library === 'scripture' ? 'web' : r.book_id,
      source,
      text: r.text,
      translation: library === 'scripture' ? r.translation : null,
    });
  }

  return { library, dim, count, scales, vectors, meta };
}

/**
 * Load all installed vector matrices for the active embedding vector space:
 *   - Voyage-4 shared space (`voyage-4-nano`, `voyage-4-lite`, `voyage-4`, `voyage-4-large`):
 *       shipped 512d `.rvec` packs (Bible + Church works) + SQLite `passage_vectors`
 *   - Any custom OpenRouter model (e.g. `qwen/qwen3-embedding-8b`, `cohere/embed-5-pro`):
 *       all re-embedded Bible, Church, and Personal Library rows from `passage_vectors`
 */
export async function loadLibraryVectors(): Promise<void> {
  const spaceId = getActiveVectorSpaceId();
  if (loadedMatrices !== null && loadedVectorSpaceId === spaceId) return;

  const db = getDatabase();
  if (!db) {
    loadedMatrices = [];
    loadedVectorSpaceId = spaceId;
    return;
  }

  const activeModel = getActiveEmbeddingModelId('search');
  const useVoyage4 = isVoyage4SharedSpace(activeModel);
  const matrices: PackedVectorMatrix[] = [];

  try {
    if (useVoyage4) {
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

      // 3. Load embedded Personal Library works (`include_in_resonance = 1`) in Voyage-4 512d space
      const compatIds = getCompatibleModelIds(activeModel);
      const placeholders = compatIds.map(() => '?').join(',');
      const personalRows = await db.getAllAsync<{
        passage_id: number;
        book_id: string;
        dim: number;
        scale: number;
        vector_int8: Uint8Array;
        text: string;
        chapter: number | null;
        verse_start: number | null;
        translation: string | null;
        division: string | null;
        title: string | null;
        author: string | null;
      }>(
        `SELECT pv.passage_id, pv.book_id, pv.dim, pv.scale, pv.vector_int8,
                p.text, p.chapter, p.verse_start, p.translation, p.division,
                b.title, b.author
         FROM passage_vectors pv
         JOIN passages p ON p.id = pv.passage_id
         JOIN books b ON b.id = pv.book_id
         JOIN personal_books pb ON pb.book_id = pv.book_id
         WHERE pb.include_in_resonance = 1
           AND pv.dim = ?
           AND pv.model_id IN (${placeholders})
         GROUP BY pv.passage_id
         ORDER BY pv.passage_id;`,
        [EMBEDDING_DIM, ...compatIds]
      );
      const personalMat = packSqlPassageRows('personal', personalRows);
      if (personalMat) matrices.push(personalMat);
    } else {
      // Custom OpenRouter model space — load re-embedded Bible, Church, and Personal vectors from SQLite
      const allCustomRows = await db.getAllAsync<{
        passage_id: number;
        book_id: string;
        dim: number;
        scale: number;
        vector_int8: Uint8Array;
        text: string;
        chapter: number | null;
        verse_start: number | null;
        translation: string | null;
        division: string | null;
        title: string | null;
        author: string | null;
        is_personal: number;
        include_in_resonance: number | null;
      }>(
        `SELECT pv.passage_id, pv.book_id, pv.dim, pv.scale, pv.vector_int8,
                p.text, p.chapter, p.verse_start, p.translation, p.division,
                b.title, b.author,
                CASE WHEN pb.book_id IS NOT NULL THEN 1 ELSE 0 END AS is_personal,
                pb.include_in_resonance
         FROM passage_vectors pv
         JOIN passages p ON p.id = pv.passage_id
         LEFT JOIN books b ON b.id = pv.book_id
         LEFT JOIN personal_books pb ON pb.book_id = pv.book_id
         WHERE pv.model_id = ?
         ORDER BY pv.passage_id;`,
        [activeModel]
      );

      const scriptureRows = allCustomRows.filter((r) => r.translation === 'WEB');
      const witnessRows = allCustomRows.filter(
        (r) => r.translation == null && r.is_personal === 0
      );
      const personalRows = allCustomRows.filter(
        (r) => r.is_personal === 1 && (r.include_in_resonance ?? 1) === 1
      );

      const sMat = packSqlPassageRows('scripture', scriptureRows);
      const wMat = packSqlPassageRows('witness', witnessRows);
      const pMat = packSqlPassageRows('personal', personalRows);
      if (sMat) matrices.push(sMat);
      if (wMat) matrices.push(wMat);
      if (pMat) matrices.push(pMat);
    }
  } catch {
    // Leave whatever loaded cleanly
  }

  loadedMatrices = matrices;
  loadedVectorSpaceId = spaceId;
}

// ── In-memory dynamic-dim int8 Highlight & Margin Note vector store ─────────

interface PackedHighlightMatrix {
  dim: number;
  count: number;
  scales: Float32Array;
  vectors: Int8Array;
  meta: Array<{
    highlightId: string;
    kind: 'highlight' | 'note';
    verseRef: string;
    bookId: string | null;
    selectedText: string;
    noteText: string | null;
    sourceLabel: string;
    color: string;
  }>;
}

let loadedHighlightMatrix: PackedHighlightMatrix | null = null;
let loadedHighlightedRefSet: Set<string> | null = null;
let loadedHighlightSpaceId: string | null = null;

function normAnchor(ref: string): string {
  return ref.toLowerCase().replace(/[^a-z0-9#]/g, '');
}

export async function loadHighlightVectors(): Promise<{
  matrix: PackedHighlightMatrix;
  highlightedRefs: Set<string>;
}> {
  const spaceId = getActiveVectorSpaceId();
  if (
    loadedHighlightMatrix !== null &&
    loadedHighlightedRefSet !== null &&
    loadedHighlightSpaceId === spaceId
  ) {
    return { matrix: loadedHighlightMatrix, highlightedRefs: loadedHighlightedRefSet };
  }

  const empty: PackedHighlightMatrix = {
    dim: EMBEDDING_DIM,
    count: 0,
    scales: new Float32Array(0),
    vectors: new Int8Array(0),
    meta: [],
  };
  const refSet = new Set<string>();

  const db = getDatabase();
  if (!db) {
    loadedHighlightMatrix = empty;
    loadedHighlightedRefSet = refSet;
    loadedHighlightSpaceId = spaceId;
    return { matrix: empty, highlightedRefs: refSet };
  }

  try {
    const allRefs = await db.getAllAsync<{ verse_ref: string }>(
      `SELECT DISTINCT verse_ref FROM highlights LIMIT 5000;`
    );
    for (const r of allRefs) {
      if (r.verse_ref) refSet.add(normAnchor(r.verse_ref));
    }

    const activeModel = getActiveEmbeddingModelId('search');
    const compatIds = getCompatibleModelIds(activeModel);
    const placeholders = compatIds.map(() => '?').join(',');

    const vecRows = await db.getAllAsync<{
      highlight_id: string;
      kind: 'highlight' | 'note';
      dim: number;
      scale: number;
      vector_int8: Uint8Array;
      source_label: string | null;
      verse_ref: string;
      book_id: string | null;
      selected_text: string | null;
      note_text: string | null;
      color: string;
    }>(
      `SELECT hv.highlight_id, hv.kind, hv.dim, hv.scale, hv.vector_int8, hv.source_label,
              h.verse_ref, h.book_id, h.selected_text, h.note_text, h.color
       FROM highlight_vectors hv
       JOIN highlights h ON h.id = hv.highlight_id
       WHERE hv.model_id IN (${placeholders})
       ORDER BY hv.updated_at DESC
       LIMIT 2000;`,
      compatIds
    );

    if (vecRows.length > 0) {
      const dim = vecRows[0].dim;
      const compatible = vecRows.filter((r) => r.dim === dim);
      const count = compatible.length;
      const scales = new Float32Array(count);
      const vectors = new Int8Array(count * dim);
      const meta: PackedHighlightMatrix['meta'] = [];

      for (let i = 0; i < count; i++) {
        const r = compatible[i];
        scales[i] = r.scale;
        const raw =
          r.vector_int8 instanceof Uint8Array
            ? r.vector_int8
            : new Uint8Array(r.vector_int8 as unknown as ArrayBuffer);
        const signed = new Int8Array(
          raw.buffer,
          raw.byteOffset,
          Math.min(dim, raw.byteLength)
        );
        vectors.set(signed, i * dim);
        meta.push({
          highlightId: r.highlight_id,
          kind: r.kind === 'note' ? 'note' : 'highlight',
          verseRef: r.verse_ref,
          bookId: r.book_id,
          selectedText: r.selected_text ?? r.verse_ref,
          noteText: r.note_text,
          sourceLabel: r.source_label ?? r.verse_ref,
          color: r.color,
        });
      }

      loadedHighlightMatrix = { dim, count, scales, vectors, meta };
      loadedHighlightedRefSet = refSet;
      loadedHighlightSpaceId = spaceId;
      return { matrix: loadedHighlightMatrix, highlightedRefs: refSet };
    }
  } catch {
    // Table may not exist pre-v4; return empty gracefully
  }

  loadedHighlightMatrix = empty;
  loadedHighlightedRefSet = refSet;
  loadedHighlightSpaceId = spaceId;
  return { matrix: empty, highlightedRefs: refSet };
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

/** Invalidate the in-memory vector store (e.g. after importing, re-embedding, or switching models). */
export function clearLibraryVectors(): void {
  loadedMatrices = null;
  loadedVectorSpaceId = null;
}

/** Invalidate the in-memory highlight & margin-note vector store. */
export function clearHighlightVectors(): void {
  loadedHighlightMatrix = null;
  loadedHighlightedRefSet = null;
  loadedHighlightSpaceId = null;
}

// ── Find resonant passages (Stratified Fetch + Qwen3-Reranker + Z-Fusion + Highlight Affinity) ──

const MIN_SIMILARITY = 0.15;
const STRATIFIED_SCRIPTURE_K = 20;
const STRATIFIED_WITNESS_K = 30;
const MAX_PER_CATEGORY = 3;
const MIN_TEXT_LENGTH = 12;

const HIGHLIGHT_AFFINITY_THRESHOLD = 0.24;
const HIGHLIGHT_AFFINITY_BOOST = 0.065;
const NOTE_ECHO_THRESHOLD = 0.34;
const HIGHLIGHT_ECHO_THRESHOLD = 0.40;
const READING_RECENCY_MAX_BOOST = 0.032;

interface RawHit {
  library: 'scripture' | 'witness' | 'personal';
  passageId: number;
  bookId: string;
  workId: string;
  source: string;
  text: string;
  translation: string | null;
  denseScore: number;
  provenance?: string | null;
}

async function loadRecentBookBoostMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const db = getDatabase();
  if (!db) return map;
  const nowMs = Date.now();
  const cutoff = nowMs - 7 * 86_400_000;
  try {
    const rows = await db.getAllAsync<{ book_id: string; updated_at: number }>(
      `SELECT book_id, updated_at FROM reading_progress WHERE updated_at >= ? LIMIT 25;`,
      [cutoff]
    );
    for (const r of rows) {
      const ageDays = Math.max(0, (nowMs - r.updated_at) / 86_400_000);
      const boost = READING_RECENCY_MAX_BOOST * Math.exp(-ageDays / 4);
      if (boost > 0.004) {
        map.set(r.book_id.toLowerCase(), boost);
      }
    }
  } catch {
    // Pre-v4 fallback: ignore
  }
  return map;
}

function searchHighlightMatrix(
  queryVec: Float32Array,
  matrix: PackedHighlightMatrix,
  excludeHighlightId?: string | null,
  maxResults = 3
): ResonanceCard[] {
  if (matrix.count === 0 || matrix.dim !== queryVec.length) return [];
  const bestByHl = new Map<
    string,
    { sim: number; meta: PackedHighlightMatrix['meta'][number] }
  >();

  for (let i = 0; i < matrix.count; i++) {
    const m = matrix.meta[i];
    if (excludeHighlightId && m.highlightId === excludeHighlightId) continue;
    const sim = dotProductFloat32Int8(
      queryVec,
      matrix.vectors,
      i * matrix.dim,
      matrix.scales[i],
      matrix.dim
    );
    const threshold = m.kind === 'note' ? NOTE_ECHO_THRESHOLD : HIGHLIGHT_ECHO_THRESHOLD;
    if (sim < threshold) continue;
    // Notes reflect the user's own interpretation, so give a slight edge over raw highlight text
    const effective = m.kind === 'note' ? sim + 0.04 : sim;
    const prev = bestByHl.get(m.highlightId);
    if (!prev || effective > prev.sim) {
      bestByHl.set(m.highlightId, { sim: effective, meta: m });
    }
  }

  return Array.from(bestByHl.values())
    .sort((a, b) => b.sim - a.sim)
    .slice(0, maxResults)
    .map(({ sim, meta }) => ({
      passageId: 0,
      bookId: meta.bookId ?? meta.verseRef,
      text: meta.selectedText,
      source: meta.sourceLabel,
      translation: null,
      similarity: Math.min(1, sim),
      kind: 'highlight' as const,
      provenance:
        meta.kind === 'note'
          ? 'Echoes a margin note you wrote'
          : 'A passage you highlighted',
      noteText: meta.noteText,
      highlightId: meta.highlightId,
    }));
}

export async function findResonance(
  journalText: string
): Promise<ResonanceResult | null> {
  if (journalText.trim().length < MIN_TEXT_LENGTH) return null;
  if (!(await ensureEmbeddingReady())) return null;

  const queryVec = await embedQuery(journalText);
  if (!queryVec) return null;

  if (loadedMatrices === null) {
    await loadLibraryVectors();
  }
  const matrices = loadedMatrices ?? [];
  const [{ matrix: hlMatrix, highlightedRefs }, recentBooks] = await Promise.all([
    loadHighlightVectors(),
    loadRecentBookBoostMap(),
  ]);

  const scriptureHits: RawHit[] = [];
  const nonScriptureHits: RawHit[] = [];

  // Stage 1: Stratified Per-Library Fetch in active int8 vector space
  // with Gated Highlight Affinity & Decaying Reading Context Boost
  for (const mat of matrices) {
    const dim = mat.dim;
    if (dim !== queryVec.length) continue;
    for (let i = 0; i < mat.count; i++) {
      const baseSim = dotProductFloat32Int8(
        queryVec,
        mat.vectors,
        i * dim,
        mat.scales[i],
        dim
      );
      if (baseSim < MIN_SIMILARITY) continue;

      const m = mat.meta[i];
      let adjustedSim = baseSim;
      let provenance: string | null = null;

      // Gated highlight affinity (only boosts genuinely relevant passages!)
      if (baseSim >= HIGHLIGHT_AFFINITY_THRESHOLD && highlightedRefs.size > 0) {
        const sourceBase = m.source.replace(/\s*\([A-Z]+\)\s*$/, '');
        if (
          highlightedRefs.has(normAnchor(String(m.passageId))) ||
          highlightedRefs.has(normAnchor(sourceBase))
        ) {
          adjustedSim += HIGHLIGHT_AFFINITY_BOOST;
          provenance = 'A passage you highlighted';
        }
      }

      // Soft decaying recency boost for books currently being read
      if (recentBooks.size > 0) {
        const bookKey = m.bookId.toLowerCase();
        const canonicalBook = m.bookId.replace(/^[A-Za-z]+_/, '').replace(/_/g, ' ').toLowerCase();
        const recBoost = recentBooks.get(bookKey) ?? recentBooks.get(canonicalBook) ?? 0;
        if (recBoost > 0 && baseSim >= 0.22) {
          adjustedSim += recBoost;
          if (!provenance) provenance = 'From your recent reading';
        }
      }

      const hit: RawHit = {
        library: mat.library,
        passageId: m.passageId,
        bookId: m.bookId,
        workId: m.workId,
        source: m.source,
        text: m.text,
        translation: m.translation,
        denseScore: adjustedSim,
        provenance,
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

  // Stage 2: Neural reranking — OpenRouter cloud (e.g. Qwen3-Reranker-8B) OR local Qwen3-0.6B
  const localRerankerInstalled = useOfflineEngineStore.getState().groups.reranker.ready;
  const hitById = new Map<string, RawHit>();
  const poolInputs = pool.map((hit) => {
    const id = `${hit.library}:${hit.passageId}`;
    hitById.set(id, hit);
    return { id, text: hit.text, source: hit.source };
  });

  const rerankScores = await rerankCandidatePool(
    journalText,
    poolInputs,
    localRerankerInstalled
  );

  const candidates: FusionCandidate[] = pool.map((hit) => {
    const id = `${hit.library}:${hit.passageId}`;
    const scored = rerankScores.get(id);
    return {
      id,
      workId: hit.workId,
      library: hit.library,
      denseScore: hit.denseScore,
      rerankProb: scored?.prob ?? null,
      rerankLogit: scored?.logit ?? null,
    };
  });

  // Stage 3: Per-Library Z-Score Fusion (α = 0.60) + Calibrated Silence (τ = 0.06)
  const fused = perLibraryZScoreFuse(candidates, {
    alpha: OFFLINE_ENGINE_MANIFEST.fusionAlpha,
    silenceThreshold: OFFLINE_ENGINE_MANIFEST.silenceThreshold,
    perWorkCap: OFFLINE_ENGINE_MANIFEST.perWorkCap,
    topK: 6,
  });

  // Stage 4: Past journal entries & User Highlight/Note echoes (4th retrieval lane!)
  const pastEntries = await findResonantPastEntries(queryVec);
  const highlightEchoes = searchHighlightMatrix(queryVec, hlMatrix, null, 2);

  if (fused.silent) {
    return { scripture: [], voices: [], pastEntries, highlights: highlightEchoes };
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
      provenance: hit.provenance ?? null,
    };
    if (card.kind === 'scripture' && scripture.length < MAX_PER_CATEGORY) {
      scripture.push(card);
    } else if (card.kind === 'voice' && voices.length < MAX_PER_CATEGORY) {
      voices.push(card);
    }
  }

  return { scripture, voices, pastEntries, highlights: highlightEchoes };
}

// ── Reader-Side Bidirectional Echoes ("Echoes While Reading") ───────────────

/**
 * Find resonant Scripture, Church Voices, Personal Library passages, Past
 * Journal entries, and Your Other Highlights/Notes for a passage currently
 * being read in ReadingView.
 */
export async function findPassageEchoes(
  passageText: string,
  _sourceRef: string,
  options?: { bookId?: string; excludePassageId?: number | null }
): Promise<ResonanceResult | null> {
  const cleaned = passageText.trim();
  if (cleaned.length < MIN_TEXT_LENGTH) return null;
  if (!(await ensureEmbeddingReady())) return null;

  const queryVec = await embedQuery(cleaned.slice(0, 600));
  if (!queryVec) return null;

  if (loadedMatrices === null) {
    await loadLibraryVectors();
  }
  const matrices = loadedMatrices ?? [];
  const { matrix: hlMatrix } = await loadHighlightVectors();

  const scriptureHits: RawHit[] = [];
  const voiceHits: RawHit[] = [];

  for (const mat of matrices) {
    const dim = mat.dim;
    if (dim !== queryVec.length) continue;
    for (let i = 0; i < mat.count; i++) {
      const m = mat.meta[i];
      // Exclude the exact passage we're querying from
      if (options?.excludePassageId != null && m.passageId === options.excludePassageId) {
        continue;
      }
      const sim = dotProductFloat32Int8(
        queryVec,
        mat.vectors,
        i * dim,
        mat.scales[i],
        dim
      );
      if (sim < 0.26) continue;
      // Avoid near-duplicate echoes from the exact same book unless very strong
      const sameBook = options?.bookId && m.bookId === options.bookId;
      if (sameBook && sim > 0.96) continue;

      const hit: RawHit = {
        library: mat.library,
        passageId: m.passageId,
        bookId: m.bookId,
        workId: m.workId,
        source: m.source,
        text: m.text,
        translation: m.translation,
        denseScore: sameBook ? sim - 0.04 : sim,
      };
      if (mat.library === 'scripture') scriptureHits.push(hit);
      else voiceHits.push(hit);
    }
  }

  scriptureHits.sort((a, b) => b.denseScore - a.denseScore);
  voiceHits.sort((a, b) => b.denseScore - a.denseScore);

  const scripture: ResonanceCard[] = scriptureHits.slice(0, 4).map((h) => ({
    passageId: h.passageId,
    bookId: h.bookId,
    text: h.text,
    source: h.source,
    translation: h.translation,
    similarity: h.denseScore,
    kind: 'scripture',
  }));

  // Diversity cap: at most 2 passages per work
  const voices: ResonanceCard[] = [];
  const workCounts = new Map<string, number>();
  for (const h of voiceHits) {
    const count = workCounts.get(h.workId) ?? 0;
    if (count >= 2) continue;
    workCounts.set(h.workId, count + 1);
    voices.push({
      passageId: h.passageId,
      bookId: h.bookId,
      text: h.text,
      source: h.source,
      translation: h.translation,
      similarity: h.denseScore,
      kind: 'voice',
    });
    if (voices.length >= 4) break;
  }

  const pastEntries = await findResonantPastEntries(queryVec);
  const highlights = searchHighlightMatrix(queryVec, hlMatrix, null, 3);

  return { scripture, voices, pastEntries, highlights };
}

// ── Semantic In-Book Search & Global Semantic Search ────────────────────────

export interface SemanticPassageMatch {
  passageId: number;
  bookId: string;
  source: string;
  text: string;
  translation: string | null;
  similarity: number;
  library: 'scripture' | 'witness' | 'personal' | 'highlight';
  highlightNote?: string | null;
  highlightColor?: string | null;
  highlightId?: string | null;
}

/** Semantic concept search scoped to a single book currently open in ReadingView. */
export async function searchInBookSemantic(
  bookId: string,
  query: string,
  limit = 30
): Promise<SemanticPassageMatch[]> {
  if (query.trim().length < 2 || !(await ensureEmbeddingReady())) return [];
  const queryVec = await embedQuery(query.trim());
  if (!queryVec) return [];

  if (loadedMatrices === null) {
    await loadLibraryVectors();
  }
  const matrices = loadedMatrices ?? [];
  const targetNorm = bookId.toLowerCase();
  const hits: SemanticPassageMatch[] = [];

  for (const mat of matrices) {
    const dim = mat.dim;
    if (dim !== queryVec.length) continue;
    for (let i = 0; i < mat.count; i++) {
      const m = mat.meta[i];
      const mBookNorm = m.bookId.toLowerCase();
      const matchesBook =
        mBookNorm === targetNorm ||
        mBookNorm.endsWith(`_${targetNorm.replace(/\s+/g, '_')}`);
      if (!matchesBook) continue;

      const sim = dotProductFloat32Int8(
        queryVec,
        mat.vectors,
        i * dim,
        mat.scales[i],
        dim
      );
      if (sim < 0.22) continue;
      hits.push({
        passageId: m.passageId,
        bookId: m.bookId,
        source: m.source,
        text: m.text,
        translation: m.translation,
        similarity: sim,
        library: mat.library,
      });
    }
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}

/** Global semantic search across Scripture, Library, and Highlights for Hybrid Search. */
export async function searchLibrarySemantic(
  query: string,
  scope: 'scripture' | 'library' | 'all' | 'highlights',
  limit = 40
): Promise<SemanticPassageMatch[]> {
  if (query.trim().length < 2 || !(await ensureEmbeddingReady())) return [];
  const queryVec = await embedQuery(query.trim());
  if (!queryVec) return [];

  const hits: SemanticPassageMatch[] = [];

  if (scope === 'highlights' || scope === 'all') {
    const { matrix: hlMatrix } = await loadHighlightVectors();
    if (hlMatrix.dim === queryVec.length) {
      for (let i = 0; i < hlMatrix.count; i++) {
        const sim = dotProductFloat32Int8(
          queryVec,
          hlMatrix.vectors,
          i * hlMatrix.dim,
          hlMatrix.scales[i],
          hlMatrix.dim
        );
        if (sim < 0.24) continue;
        const m = hlMatrix.meta[i];
        hits.push({
          passageId: 0,
          bookId: m.bookId ?? m.verseRef,
          source: m.sourceLabel,
          text: m.selectedText,
          translation: null,
          similarity: sim,
          library: 'highlight',
          highlightNote: m.noteText,
          highlightColor: m.color,
          highlightId: m.highlightId,
        });
      }
    }
  }

  if (scope !== 'highlights') {
    if (loadedMatrices === null) {
      await loadLibraryVectors();
    }
    const matrices = loadedMatrices ?? [];
    for (const mat of matrices) {
      if (scope === 'scripture' && mat.library !== 'scripture') continue;
      if (scope === 'library' && mat.library === 'scripture') continue;
      const dim = mat.dim;
      if (dim !== queryVec.length) continue;
      for (let i = 0; i < mat.count; i++) {
        const sim = dotProductFloat32Int8(
          queryVec,
          mat.vectors,
          i * dim,
          mat.scales[i],
          dim
        );
        if (sim < 0.24) continue;
        const m = mat.meta[i];
        hits.push({
          passageId: m.passageId,
          bookId: m.bookId,
          source: m.source,
          text: m.text,
          translation: m.translation,
          similarity: sim,
          library: mat.library,
        });
      }
    }
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}

// ── Search past journal & Life Diary entries ────────────────────────────────

function computeSegmentVectorSim(
  queryVec: Float32Array,
  row: {
    dim: number | null;
    scale: number | null;
    vector_int8: Uint8Array | null;
    vector_blob: Uint8Array | null;
  }
): number | null {
  if (row.vector_int8 != null && row.scale != null && row.dim === queryVec.length) {
    const raw =
      row.vector_int8 instanceof Uint8Array
        ? row.vector_int8
        : new Uint8Array(row.vector_int8 as unknown as ArrayBuffer);
    if (raw.byteLength >= queryVec.length) {
      const signed = new Int8Array(raw.buffer, raw.byteOffset, queryVec.length);
      return dotProductFloat32Int8(queryVec, signed, 0, row.scale, queryVec.length);
    }
  }
  if (row.vector_blob != null && row.vector_blob.byteLength > 0) {
    const vec = blobToVector(row.vector_blob);
    if (vec.length === queryVec.length) {
      return cosineSimilarity(queryVec, vec);
    }
  }
  return null;
}

async function findResonantPastEntries(
  queryVec: Float32Array,
  excludeSegmentId?: string | null
): Promise<ResonanceCard[]> {
  const db = getDatabase();
  if (!db) return [];

  try {
    const activeModel = getActiveEmbeddingModelId('search');
    const compatIds = getCompatibleModelIds(activeModel);
    const placeholders = compatIds.map(() => '?').join(',');

    const rows = await db.getAllAsync<{
      segment_id: string;
      segment_type: string;
      dim: number | null;
      scale: number | null;
      vector_int8: Uint8Array | null;
      vector_blob: Uint8Array | null;
      text: string | null;
      created_at: number;
      media_kind: string | null;
      media_caption: string | null;
      media_transcript: string | null;
      media_summary: string | null;
    }>(
      `SELECT jsv.segment_id, js.segment_type, jsv.dim, jsv.scale, jsv.vector_int8,
              jsv.vector_blob, js.text, js.created_at,
              dm.kind AS media_kind, dm.caption AS media_caption,
              dm.transcript AS media_transcript, dm.ai_summary AS media_summary
       FROM journal_segment_vectors jsv
       JOIN journal_segments js ON js.id = jsv.segment_id
       LEFT JOIN diary_media dm ON dm.segment_id = js.id
       WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
         AND jsv.model_id IN (${placeholders})
       ORDER BY js.created_at DESC
       LIMIT 600;`,
      compatIds
    );

    const bestBySeg = new Map<string, ResonanceCard>();
    for (const row of rows) {
      if (excludeSegmentId && row.segment_id === excludeSegmentId) continue;
      const sim = computeSegmentVectorSim(queryVec, row);
      if (sim == null || sim < MIN_SIMILARITY) continue;

      const date = new Date(row.created_at);
      const dateLabel = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const kindLabel =
        row.media_kind === 'voice'
          ? 'Voice note'
          : row.media_kind === 'photo'
            ? 'Photo memory'
            : row.media_kind === 'video'
              ? 'Video memory'
              : 'Your journal';
      const displayText =
        row.media_caption?.trim() ||
        row.media_transcript?.trim() ||
        row.media_summary?.trim() ||
        row.text?.trim() ||
        '';
      if (!displayText) continue;

      const prev = bestBySeg.get(row.segment_id);
      if (!prev || sim > prev.similarity) {
        bestBySeg.set(row.segment_id, {
          passageId: 0,
          bookId: `journal:${row.segment_id}`,
          text: displayText,
          source: `${kindLabel} — ${dateLabel}`,
          translation: null,
          similarity: sim,
          kind: 'past_entry',
        });
      }
    }

    return Array.from(bestBySeg.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_PER_CATEGORY);
  } catch {
    return [];
  }
}

/**
 * Semantic search across all Journal writings and Life Diary memories
 * (voice transcripts, photo captions/summaries/OCR, and videos).
 */
export async function searchDiarySemantic(
  query: string,
  limit = 25
): Promise<Array<{ segmentId: string; similarity: number }>> {
  if (query.trim().length < 2 || !(await ensureEmbeddingReady('journal'))) {
    return [];
  }
  const queryVec = await embedQuery(query.trim(), 'journal');
  if (!queryVec) return [];

  const db = getDatabase();
  if (!db) return [];

  try {
    const activeModel = getActiveEmbeddingModelId('search');
    const compatIds = getCompatibleModelIds(activeModel);
    const placeholders = compatIds.map(() => '?').join(',');

    const rows = await db.getAllAsync<{
      segment_id: string;
      dim: number | null;
      scale: number | null;
      vector_int8: Uint8Array | null;
      vector_blob: Uint8Array | null;
    }>(
      `SELECT jsv.segment_id, jsv.dim, jsv.scale, jsv.vector_int8, jsv.vector_blob
       FROM journal_segment_vectors jsv
       JOIN journal_segments js ON js.id = jsv.segment_id
       WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
         AND jsv.model_id IN (${placeholders})
       ORDER BY js.created_at DESC
       LIMIT 1000;`,
      compatIds
    );

    const best = new Map<string, number>();
    for (const row of rows) {
      const sim = computeSegmentVectorSim(queryVec, row);
      if (sim == null || sim < 0.22) continue;
      const prev = best.get(row.segment_id);
      if (prev == null || sim > prev) {
        best.set(row.segment_id, sim);
      }
    }

    return Array.from(best.entries())
      .map(([segmentId, similarity]) => ({ segmentId, similarity }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ── Store journal / diary memory vector (multi-model int8) ──────────────────

export async function storeSegmentVector(
  segmentId: string,
  text: string,
  precomputed?: { modelId: string; vector: Float32Array } | null
): Promise<void> {
  if (!precomputed && text.trim().length < MIN_TEXT_LENGTH) return;

  let vec: Float32Array | null = precomputed?.vector ?? null;
  let modelId = precomputed?.modelId ?? getActiveEmbeddingModelId('journal');

  if (!vec) {
    if (!(await ensureEmbeddingReady('journal'))) return;
    vec = await embedQuery(text, 'journal');
    if (!vec) return;
    modelId = getActiveEmbeddingModelId('journal');
  }

  const db = getDatabase();
  if (!db) return;

  try {
    const { quantized, scale } = quantizeVectorInt8(vec, vec.length);
    const qBlob = new Uint8Array(
      quantized.buffer,
      quantized.byteOffset,
      quantized.byteLength
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO journal_segment_vectors
         (segment_id, model_id, dim, scale, vector_int8, vector_blob, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?);`,
      [segmentId, modelId, vec.length, scale, qBlob, Date.now()]
    );
  } catch {
    // Non-fatal
  }
}


