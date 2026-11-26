/**
 * POST /api/resonance — find the most resonant Library passages
 * for a given journal text (or vector).
 *
 * Single embedding model on the server: pplx-embed-v1-4b (2560d int8).
 * The client sends either:
 *   { text: string }           → server embeds + HNSW search (single request)
 *   { vector: number[], text }  → skip server embed, use provided vector
 *
 * Returns up to MAX_PER_CATEGORY scripture + voice passages sorted by cosine
 * similarity. Personalizes with a 1.12× boost for passages the user has
 * previously highlighted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { open, readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync, statSync } from 'fs';
import { lexicalResonance } from '../../../lib/resonance-fallback';
import {
  getDevUserId,
  getHighlights,
  resonanceContentHash,
  storeResonanceCache,
  replaceResonanceEdges,
  getFreshResonanceCacheForSource,
  getOrCreateResonanceNodeForSource,
} from '../../../lib/db';
import { ensureCorpusIndex } from '../../../lib/corpus-index';
import { getCachedUserEmbeddings, invalidateUser } from '../../../lib/user-vector-store';
import { getEnabledVoiceBooks } from '../../../lib/library-prefs';
import { observeLatencyMs, incCounter, recordEvent, setGauge } from '../../../lib/resonance-metrics';

const VECTORS_BASE = process.env.VECTORS_PATH || '/data/vectors';
const ONLINE_MODEL = 'pplx-embed-v1-4b'; // the only server-side model
const MIN_SIMILARITY = 0.1;
const MAX_PER_CATEGORY = 3;
const HIGHLIGHT_BOOST = 1.12;

interface PassageMeta {
  id: number;
  source_type: 'bible' | 'voice';
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  author: string | null;
  work: string | null;
}

interface VectorManifest {
  model: string;
  dim: number;
  dtype: string;
  passage_count: number;
  global_min?: number;
  global_max?: number;
  range?: number;
  quantization?: string;
  shards: { file: string; start: number; count: number }[];
  passage_order?: string;
  /**
   * Ordered list of passage IDs in the same order as the vectors.bin rows.
   * i.e. vectors[i*dim : (i+1)*dim] corresponds to passage_ids[i].
   * Required for correct mapping from vector index to passage metadata.
   * If absent, the route falls back to a per-book start_offset (legacy).
   */
  passage_ids?: number[];
  passage_sources?: ('bible' | 'voice')[];
}

interface AlignmentManifest {
  passage_ids?: number[];
  passage_sources?: ('bible' | 'voice')[];
}

interface LoadedModel {
  vectorPath: string;
  rowNorms: Float32Array;
  dim: number;
  passageCount: number;
  dtype: string;
  /** Cached float32 vectors — built lazily from int8 on first search. ~2.5 GB for 265K×2560. */
  float32Vectors?: Float32Array;
}

// ── Module-level caches ───────────────────────────────────────────────────

let passageMetadata: PassageMeta[] | null = null;
let metadataPromise: Promise<void> | null = null;
const modelCache = new Map<string, LoadedModel>(); // by model id
const modelLoadPromises = new Map<string, Promise<LoadedModel | null>>(); // de-dupe cold concurrent loads
/**
 * Map: passage id → index in the loaded vectors array (i.e. row in vectors.bin).
 * Built from the manifest's passage_ids array. Without this, vector-row N
 * could refer to a different passage than metadata[N] — the previous behavior
 * (which surfaced random unrelated passages).
 */
const rowKeyToVectorIndex = new Map<string, number>();
/**
 * Parallel array to rowKeyToVectorIndex: orderedPassageKeys[i] identifies the
 * metadata row whose vector lives at row i in vectors.bin.
 */
let orderedPassageKeys: string[] = [];

const BIBLE_PASSAGES_PATH = existsSync('/data/seeded_library/bible_passages.json')
  ? '/data/seeded_library/bible_passages.json'
  : './data/seeded_library/bible_passages.json';
const VOICE_PASSAGES_PATH = existsSync('/data/seeded_library/voice_passages.json')
  ? '/data/seeded_library/voice_passages.json'
  : './data/seeded_library/voice_passages.json';
const SIDECAR_ALIGNMENT_PATH = '/data/seeded_library/vectors_gte-small_manifest.json';
const VOICE_BOOKS_PATH = existsSync('/data/seeded_library/voice_books.json')
  ? '/data/seeded_library/voice_books.json'
  : './data/seeded_library/voice_books.json';

// Cached book_id → package_id map. Invalidated on volume file mtime change,
// so a re-upload picks up the new catalog on the next request.
let cachedBookIdToPackage: Map<string, string> | null = null;
let cachedVoiceBooksMtimeMs = 0;

function loadBookIdToPackage(): Map<string, string> {
  const stat = statSync(VOICE_BOOKS_PATH);
  if (cachedBookIdToPackage && stat.mtimeMs === cachedVoiceBooksMtimeMs) {
    return cachedBookIdToPackage;
  }
  const books = JSON.parse(readFileSync(VOICE_BOOKS_PATH, 'utf-8')) as Array<{ id: string; package_id: string }>;
  const map = new Map<string, string>();
  for (const b of books) {
    map.set(b.id, b.package_id);
  }
  cachedBookIdToPackage = map;
  cachedVoiceBooksMtimeMs = stat.mtimeMs;
  return map;
}

/**
 * Returns true if the user has enabled this voice book. Voice passages
 * whose book_id is not in the catalog (shouldn't happen, but defensive)
 * are treated as "in an unknown book" — we let them through rather than
 * silently hiding them.
 */
function isVoiceBookEnabled(bookId: string, enabledBooks: Set<string>): boolean {
  if (enabledBooks.has(bookId)) return true;
  // Unknown book — don't filter (defensive)
  return !loadBookIdToPackage().has(bookId);
}

async function ensureMetadata(): Promise<void> {
  if (passageMetadata) return;
  if (metadataPromise) return metadataPromise;

  metadataPromise = (async () => {
    const meta: PassageMeta[] = [];
    // Stable insertion order: Bible first (sorted by id), then Voices (sorted by id).
    // The vectors.bin is built from the same voice library but in a different
    // (book-by-book) order — passage_ids[] in the manifest maps vector rows
    // back to passage IDs, which is how we resolve alignment.
    if (existsSync(BIBLE_PASSAGES_PATH)) {
      const data = JSON.parse(await readFile(BIBLE_PASSAGES_PATH, 'utf-8'));
      data.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
      for (const p of data) {
        meta.push({
          id: p.id,
          source_type: 'bible',
          book_id: `${p.translation}_${p.book.replace(/\s+/g, '_')}`,
          chapter: p.chapter,
          verse_start: p.verse_start,
          verse_end: p.verse_end,
          text: p.text,
          translation: p.translation,
          author: null,
          work: null,
        });
      }
    }

    if (existsSync(VOICE_PASSAGES_PATH)) {
      const data = JSON.parse(await readFile(VOICE_PASSAGES_PATH, 'utf-8'));
      data.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
      for (const p of data) {
        meta.push({
          id: p.id,
          source_type: 'voice',
          book_id: p.book_id,
          chapter: null,
          verse_start: null,
          verse_end: null,
          text: p.text,
          translation: null,
          author: p.author ?? null,
          work: p.work ?? null,
        });
      }
    }

    passageMetadata = meta;
  })();

  return metadataPromise;
}

function hasCompleteAlignment(
  manifest: Pick<VectorManifest, 'passage_count' | 'passage_ids' | 'passage_sources'>,
): manifest is Pick<VectorManifest, 'passage_count'> & {
  passage_ids: number[];
  passage_sources: ('bible' | 'voice')[];
} {
  return (
    Array.isArray(manifest.passage_ids) &&
    manifest.passage_ids.length === manifest.passage_count &&
    Array.isArray(manifest.passage_sources) &&
    manifest.passage_sources.length === manifest.passage_count
  );
}

async function repairManifestAlignment(
  manifestPath: string,
  manifest: VectorManifest,
  alignmentIds: number[],
  alignmentSources: ('bible' | 'voice')[],
): Promise<void> {
  try {
    const repaired: VectorManifest & {
      manifest_repaired_at: string;
      manifest_repair_source: string;
    } = {
      ...manifest,
      passage_ids: alignmentIds,
      passage_sources: alignmentSources,
      manifest_repaired_at: new Date().toISOString(),
      manifest_repair_source: SIDECAR_ALIGNMENT_PATH,
    };
    await writeFile(manifestPath, JSON.stringify(repaired, null, 2));
    console.log(
      `[resonance] repaired ${manifestPath} with ${alignmentIds.length} passage_ids + passage_sources`,
    );
  } catch (err) {
    // Repair is an operational hardening step. Retrieval can still use the
    // sidecar alignment for this request, so never fail resonance because the
    // volume is temporarily read-only or the write races with another worker.
    console.warn('[resonance] failed to repair manifest alignment:', err);
  }
}

async function loadModel(modelId: string): Promise<LoadedModel | null> {
  const cached = modelCache.get(modelId);
  if (cached) return cached;

  const pending = modelLoadPromises.get(modelId);
  if (pending) return pending;

  const loadPromise = loadModelUncached(modelId).finally(() => {
    modelLoadPromises.delete(modelId);
  });
  modelLoadPromises.set(modelId, loadPromise);
  return loadPromise;
}

async function loadModelUncached(modelId: string): Promise<LoadedModel | null> {
  const modelDir = `${VECTORS_BASE}/${modelId}`;
  const manifestPath = `${modelDir}/manifest.json`;

  if (!existsSync(manifestPath)) return null;

  try {
    const manifest: VectorManifest = JSON.parse(
      await readFile(manifestPath, 'utf-8'),
    );

    let alignmentIds = manifest.passage_ids;
    let alignmentSources = manifest.passage_sources;
    if (!hasCompleteAlignment(manifest)) {
      if (existsSync(SIDECAR_ALIGNMENT_PATH)) {
        try {
          const sidecar: AlignmentManifest = JSON.parse(await readFile(SIDECAR_ALIGNMENT_PATH, 'utf-8'));
          if (
            Array.isArray(sidecar.passage_ids) &&
            sidecar.passage_ids.length === manifest.passage_count &&
            Array.isArray(sidecar.passage_sources) &&
            sidecar.passage_sources.length === manifest.passage_count
          ) {
            alignmentIds = sidecar.passage_ids;
            alignmentSources = sidecar.passage_sources;
            console.log(`[resonance] using sidecar alignment manifest ${SIDECAR_ALIGNMENT_PATH}`);
            await repairManifestAlignment(manifestPath, manifest, alignmentIds, alignmentSources);
          }
        } catch (err) {
          console.warn('[resonance] failed to read sidecar alignment manifest:', err);
        }
      }
    }

    if (manifest.dtype !== 'int8') {
      console.warn(`[resonance] unsupported dtype for online model: ${manifest.dtype}`);
      return null;
    }

    if (manifest.shards.length !== 1) {
      console.warn(`[resonance] unsupported shard count for online model: ${manifest.shards.length}`);
      return null;
    }
    const vectorPath = `${modelDir}/${manifest.shards[0].file}`;
    if (!existsSync(vectorPath)) return null;

    // Memory-safe path for large int8 corpora: stream the file to precompute one
    // norm per row, then stream it again per request for scoring.
    const rowNorms = new Float32Array(manifest.passage_count);
    const rowsPerChunk = Math.max(1, Math.floor((4 * 1024 * 1024) / manifest.dim));
    const fd = await open(vectorPath, 'r');
    let totalNorm = 0;
    try {
      for (let startRow = 0; startRow < manifest.passage_count; startRow += rowsPerChunk) {
        const rowsThisChunk = Math.min(rowsPerChunk, manifest.passage_count - startRow);
        const bytesToRead = rowsThisChunk * manifest.dim;
        const chunk = Buffer.allocUnsafe(bytesToRead);
        await fd.read(chunk, 0, bytesToRead, startRow * manifest.dim);
        for (let r = 0; r < rowsThisChunk; r++) {
          const base = r * manifest.dim;
          let sumSquares = 0;
          for (let d = 0; d < manifest.dim; d++) {
            const byte = chunk[base + d]!;
            const signed = byte > 127 ? byte - 256 : byte;
            sumSquares += signed * signed;
          }
          const norm = Math.sqrt(sumSquares);
          rowNorms[startRow + r] = norm > 0 ? norm : 1;
          totalNorm += norm;
        }
      }
    } finally {
      await fd.close();
    }
    console.log(`[resonance] loadModel: cached streamed int8 norms for ${manifest.passage_count} rows, avg row norm ${(totalNorm / manifest.passage_count).toFixed(4)}`);

    const loaded: LoadedModel = {
      vectorPath,
      rowNorms,
      dim: manifest.dim,
      passageCount: manifest.passage_count,
      dtype: manifest.dtype,
    };

    // Build passage id → vector index map from manifest.
    // Vectors were written in the order script processed books; passage_ids[]
    // preserves that exact order. Without this map we can't correctly look up
    // the passage metadata for a given vector row.
    if (
      Array.isArray(alignmentIds) && alignmentIds.length === manifest.passage_count &&
      Array.isArray(alignmentSources) && alignmentSources.length === manifest.passage_count
    ) {
      rowKeyToVectorIndex.clear();
      orderedPassageKeys = alignmentIds.map((id, i) => `${alignmentSources![i]}:${id}`);
      for (let i = 0; i < orderedPassageKeys.length; i++) {
        rowKeyToVectorIndex.set(orderedPassageKeys[i], i);
      }
    } else {
      console.warn(
        `[resonance] manifest missing aligned passage_ids[] + passage_sources[]; ` +
        `semantic results unavailable.`
      );
      rowKeyToVectorIndex.clear();
      orderedPassageKeys = [];
    }

    modelCache.set(modelId, loaded);
    return loaded;
  } catch (err) {
    console.error(`[resonance] failed to load model ${modelId}:`, err);
    return null;
  }
}

/**
 * Convert int8 Buffer to Float32Array (signed int8 → float32).
 * This costs ~2.5 GB for 265K×2560 but eliminates the per-byte branch
 * `byte > 127 ? byte - 256 : byte` on every request.
 */
function int8BufferToFloat32(buf: Buffer, dim: number, passageCount: number): Float32Array {
  const out = new Float32Array(passageCount * dim);
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    out[i] = byte > 127 ? byte - 256 : byte;
  }
  return out;
}

/**
 * Ensure the loaded model has cached float32 vectors.
 * Reads the int8 file once, converts to Float32Array, frees the Buffer.
 * On Railway (ephemeral), this survives for the container's lifetime.
 */
async function ensureFloat32Vectors(loaded: LoadedModel): Promise<Float32Array> {
  if (loaded.float32Vectors) return loaded.float32Vectors;

  console.log(`[resonance] converting int8 → float32 for ${loaded.passageCount} × ${loaded.dim} vectors…`);
  const t0 = Date.now();
  const fd = await open(loaded.vectorPath, 'r');
  try {
    // Read the entire file at once — it's ~678 MB for 265K×2560 int8
    const totalBytes = loaded.passageCount * loaded.dim;
    const buf = Buffer.allocUnsafe(totalBytes);
    await fd.read(buf, 0, totalBytes, 0);
    const vecs = int8BufferToFloat32(buf, loaded.dim, loaded.passageCount);
    loaded.float32Vectors = vecs;
    console.log(`[resonance] int8→float32 conversion done in ${Date.now() - t0} ms (${(vecs.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    return vecs;
  } finally {
    await fd.close();
  }
}

async function scoreAllRows(loaded: LoadedModel, queryVecs: number[][]): Promise<Map<string, number>> {
  const simMap = new Map<string, number>();
  const vecs = await ensureFloat32Vectors(loaded);

  // L2-normalize query vectors once so we can do just a dot product
  // instead of dot / rowNorm per row.
  const normedQueries: Float32Array[] = [];
  for (const q of queryVecs) {
    let norm = 0;
    for (let d = 0; d < loaded.dim; d++) norm += q[d]! * q[d]!;
    norm = Math.sqrt(norm) || 1;
    const nq = new Float32Array(loaded.dim);
    for (let d = 0; d < loaded.dim; d++) nq[d] = q[d]! / norm;
    normedQueries.push(nq);
  }

  const dim = loaded.dim;
  const rowNorms = loaded.rowNorms;

  for (let row = 0; row < loaded.passageCount; row++) {
    const rowKey = orderedPassageKeys[row];
    if (rowKey === undefined) continue;
    const base = row * dim;
    const rowNorm = rowNorms[row]! || 1;
    let bestSim = Number.NEGATIVE_INFINITY;

    for (let qi = 0; qi < normedQueries.length; qi++) {
      const nq = normedQueries[qi]!;
      let dot = 0;
      const vBase = base;
      // Unrolled inner loop — V8 JIT loves simple Float32Array access
      for (let d = 0; d < dim; d++) {
        dot += vecs[vBase + d] * nq[d];
      }
      const sim = dot / rowNorm;
      if (sim > bestSim) bestSim = sim;
    }
    if (bestSim >= MIN_SIMILARITY) {
      const existing = simMap.get(rowKey) ?? Number.NEGATIVE_INFINITY;
      if (bestSim > existing) simMap.set(rowKey, bestSim);
    }
  }
  return simMap;
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  incCounter('resonance.requests_total');
  try {
    let { vector, text, sourceId, entryId, sourceNodeId, sourceType } = (await req.json()) as {
      vector?: number[];
      text?: string;
      sourceId?: string;
      entryId?: string;
      sourceNodeId?: string;
      sourceType?: 'journal_entry' | 'highlight' | 'note' | 'reading_event' | 'corpus_passage' | 'theme_snapshot';
    };
    const resolvedSourceId = sourceId ?? entryId;
    let resolvedSourceNodeId = sourceNodeId;

    if (resolvedSourceId && text?.trim() && !resolvedSourceNodeId) {
      try {
        const node = await getOrCreateResonanceNodeForSource({
          sourceId: resolvedSourceId,
          bodyText: text,
          sourceType: sourceType ?? 'journal_entry',
        });
        resolvedSourceNodeId = node?.id ?? resolvedSourceNodeId;
      } catch (err) {
        console.warn('[resonance] source node resolution failed, continuing without persistence:', err instanceof Error ? err.message : err);
      }
    }

    // ── Server-side cache: if sourced, check Supabase cache before embed+search ──
    // This eliminates the client needing a separate GET /api/resonance/cache call.
    // Fresh cache hit → instant return (no embed API call, no HNSW search).
    if (resolvedSourceId) {
      try {
        const cached = await getFreshResonanceCacheForSource(resolvedSourceId, sourceType);
        if (cached) {
          incCounter('resonance.cache_hits');
          observeLatencyMs('resonance.total_ms', Date.now() - t0);
          console.log('[resonance] cache hit for', resolvedSourceId);
          return NextResponse.json({ ...cached, _fromCache: true });
        }
        incCounter('resonance.cache_misses');
      } catch (err) {
        console.warn('[resonance] cache lookup failed, computing fresh:', err instanceof Error ? err.message : err);
      }
    }

    const persistResultIfSourced = async (result: Record<string, unknown>) => {
      if (!resolvedSourceId || !resolvedSourceNodeId || !text?.trim()) return;
      try {
        const contentHash = resonanceContentHash(text);
        await Promise.all([
          storeResonanceCache({
            sourceNodeId: resolvedSourceNodeId,
            sourceId: resolvedSourceId,
            sourceType: sourceType ?? 'journal_entry',
            contentHash,
            result,
            metadata: { route: '/api/resonance' },
          }),
          replaceResonanceEdges({ sourceNodeId: resolvedSourceNodeId, result }),
        ]);
      } catch (err) {
        console.warn('[resonance] sourced persistence failed:', err);
      }
    };

    // ── Server-side embed: when client sends text without a vector, ──
    // embed on the server to eliminate the client→embed→resonance waterfall.
    if ((!vector || vector.length === 0) && text && text.trim().length >= 3) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (apiKey) {
        try {
          const { embedText } = await import('../../../lib/embed-text');
          const t1 = Date.now();
          const embedResult = await embedText(text, apiKey);
          observeLatencyMs('resonance.embed_ms', Date.now() - t1);
          vector = embedResult.vector;
          console.log(`[resonance] Server-side embed: ${embedResult.dim}d, cost=$${embedResult.cost_usd.toFixed(6)}`);
        } catch (err) {
          incCounter('resonance.embed_errors');
          console.warn('[resonance] Server-side embed failed, using lexical fallback:', err instanceof Error ? err.message : err);
        }
      } else {
        console.warn('[resonance] OPENROUTER_API_KEY not set, skipping server-side embed');
      }
    }

    // ── Semantic vector path (HNSW Zone A + brute-force Zone B) ────
    if (vector && vector.length > 0) {
      const corpus = await ensureCorpusIndex(ONLINE_MODEL);

      if (corpus && corpus.passageCount > 0 && vector.length === corpus.dim) {
        await ensureMetadata();
        const meta = passageMetadata || [];

        // Fetch user highlights and their note embeddings (Zone B: in-memory cache)
        let highlightNoteVecs: number[][] = [];
        let highlightRefs = new Set<string>();
        const devUserId = await getDevUserId();
        try {
          [highlightNoteVecs, highlightRefs] = await Promise.all([
            getCachedUserEmbeddings(devUserId).catch(() => [] as number[][]),
            getHighlights().then(
              (rows: { verse_ref: string }[]) =>
                new Set(rows.map((r) => normalizeVerseRef(r.verse_ref))),
            ).catch(() => new Set<string>()),
          ]);
        } catch {
          // personalization is additive, not critical
        }

        // Build id → meta-index lookup
        const keyToMeta = new Map<string, number>();
        for (let m = 0; m < meta.length; m++) {
          keyToMeta.set(passageKey(meta[m]), m);
        }

        // ── Zone A: HNSW search over static corpus ────────────────────
        // Search the primary journal query vector, plus ONLY highlight-note
        // vectors that actually sit near this entry (gated affinity >= 0.45)
        // so unrelated past notes never hijack future entries.
        const SEARCH_K = Math.max(200, MAX_PER_CATEGORY * 100);
        const vecCosine = (a: number[], b: number[]): number => {
          let dot = 0;
          let na = 0;
          let nb = 0;
          const n = Math.min(a.length, b.length);
          for (let i = 0; i < n; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
          }
          const denom = Math.sqrt(na) * Math.sqrt(nb);
          return denom > 0 ? dot / denom : 0;
        };

        const bestSim = new Map<string, number>();
        for (const hit of corpus.search(vector, SEARCH_K, 200)) {
          bestSim.set(hit.key, hit.similarity);
        }

        let usedRelevantNotes = 0;
        for (const noteVec of highlightNoteVecs) {
          if (noteVec.length !== corpus.dim) continue;
          const relevance = vecCosine(vector, noteVec);
          if (relevance < 0.45) continue;
          usedRelevantNotes++;
          for (const hit of corpus.search(noteVec, 40, 120)) {
            const weighted = hit.similarity * relevance * 0.92;
            const existing = bestSim.get(hit.key) ?? Number.NEGATIVE_INFINITY;
            if (weighted > existing) {
              bestSim.set(hit.key, weighted);
            }
          }
        }

        // Apply gated highlight boost (for BOTH Scripture refs and Library passage IDs)
        const scored: { key: string; sim: number }[] = [];
        for (const [rowKey, sim] of Array.from(bestSim)) {
          const m = keyToMeta.get(rowKey);
          if (m === undefined) continue;
          let finalSim = sim;
          if (
            sim >= 0.25 &&
            (highlightRefs.has(normalizeVerseRef(verseRefFromMeta(meta[m]))) ||
              highlightRefs.has(normalizeVerseRef(String(meta[m].id))))
          ) {
            finalSim = sim * HIGHLIGHT_BOOST;
          }
          scored.push({ key: rowKey, sim: finalSim });
        }
        scored.sort((a, b) => b.sim - a.sim);

        const topScripture = scored
          .filter((s) => {
            const m = keyToMeta.get(s.key);
            return m !== undefined && meta[m].translation != null;
          })
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => {
            const m = keyToMeta.get(s.key)!;
            return toCard(meta[m], s.sim, 'scripture');
          });

        // Resolve user's enabled voice books (intersected with installed set)
        const bookIdToPackage = loadBookIdToPackage();
        const installedBookIds = [...bookIdToPackage.keys()].sort();
        const { enabled: enabledBookList } = await getEnabledVoiceBooks(installedBookIds, bookIdToPackage);
        const enabledBooks = new Set(enabledBookList);

        const topVoices = scored
          .filter((s) => {
            const m = keyToMeta.get(s.key);
            if (m === undefined || meta[m].translation != null) return false;
            return isVoiceBookEnabled(meta[m].book_id, enabledBooks);
          })
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => {
            const m = keyToMeta.get(s.key)!;
            return toCard(meta[m], s.sim, 'voice');
          });

        const result = {
          scripture: topScripture,
          voices: topVoices,
          pastEntries: [],
          method: usedRelevantNotes > 0 ? 'semantic-vector+highlight-notes' : 'semantic-vector',
          model: ONLINE_MODEL,
          dim: corpus.dim,
          passageCount: corpus.passageCount,
        };
        await persistResultIfSourced(result);
        observeLatencyMs('resonance.total_ms', Date.now() - t0);
        incCounter('resonance.requests_semantic');
        return NextResponse.json(result);
      }
    }

    // ── Brute-force int8 fallback (HNSW index unavailable) ───────────
    // If HNSW didn't load, fall back to streaming int8 vectors from disk.
    // This is slower (O(N)) but uses only ~678 MB int8 on disk vs 2.8 GB HNSW.
    if (vector && vector.length > 0) {
      const loaded = await loadModel(ONLINE_MODEL);

      if (loaded && loaded.passageCount > 0 && vector.length === loaded.dim) {
        await ensureMetadata();
        const meta = passageMetadata || [];

        let highlightRefs = new Set<string>();
        try {
          highlightRefs = await getHighlights()
            .then(
              (rows: { verse_ref: string }[]) =>
                new Set(rows.map((r) => normalizeVerseRef(r.verse_ref))),
            )
            .catch(() => new Set<string>());
        } catch {
          // personalization is additive, not critical
        }

        const keyToMeta = new Map<string, number>();
        for (let m = 0; m < meta.length; m++) {
          keyToMeta.set(passageKey(meta[m]), m);
        }

        const simMap = await scoreAllRows(loaded, [vector]);

        const scored: { key: string; sim: number }[] = [];
        for (const [rowKey, sim] of Array.from(simMap.entries())) {
          const m = keyToMeta.get(rowKey);
          if (m === undefined) continue;
          let finalSim = sim;
          if (
            sim >= 0.25 &&
            (highlightRefs.has(normalizeVerseRef(verseRefFromMeta(meta[m]))) ||
              highlightRefs.has(normalizeVerseRef(String(meta[m].id))))
          ) {
            finalSim = sim * HIGHLIGHT_BOOST;
          }
          scored.push({ key: rowKey, sim: finalSim });
        }
        scored.sort((a, b) => b.sim - a.sim);

        const topScripture = scored
          .filter((s) => {
            const m = keyToMeta.get(s.key);
            return m !== undefined && meta[m].translation != null;
          })
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => {
            const m = keyToMeta.get(s.key)!;
            return toCard(meta[m], s.sim, 'scripture');
          });

        // Resolve user's enabled voice books (intersected with installed set)
        const bookIdToPackage = loadBookIdToPackage();
        const installedBookIds = [...bookIdToPackage.keys()].sort();
        const { enabled: enabledBookList } = await getEnabledVoiceBooks(installedBookIds, bookIdToPackage);
        const enabledBooks = new Set(enabledBookList);

        const topVoices = scored
          .filter((s) => {
            const m = keyToMeta.get(s.key);
            if (m === undefined || meta[m].translation != null) return false;
            return isVoiceBookEnabled(meta[m].book_id, enabledBooks);
          })
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => {
            const m = keyToMeta.get(s.key)!;
            return toCard(meta[m], s.sim, 'voice');
          });

        const result = {
          scripture: topScripture,
          voices: topVoices,
          pastEntries: [],
          method: 'semantic-int8',
          model: ONLINE_MODEL,
          dim: loaded.dim,
          passageCount: loaded.passageCount,
        };
        await persistResultIfSourced(result);
        observeLatencyMs('resonance.total_ms', Date.now() - t0);
        incCounter('resonance.requests_int8_fallback');
        return NextResponse.json(result);
      }
    }

    // ── Lexical fallback (no vector or model unavailable) ────────────
    await ensureMetadata();
    const meta = passageMetadata || [];
    const scriptureMeta = meta.filter((p) => p.translation != null);
    const voiceMeta = meta.filter((p) => p.translation == null);

    if (scriptureMeta.length === 0 && voiceMeta.length === 0) {
      return NextResponse.json({
        scripture: [],
        voices: [],
        pastEntries: [],
        method: 'metadata-missing',
        note: 'Passage metadata not yet loaded.',
      });
    }

    const fallback = lexicalResonance(
      text?.trim() ?? '',
      scriptureMeta,
      voiceMeta,
      MAX_PER_CATEGORY,
    );

    const fallbackResult = {
      ...fallback,
      pastEntries: [],
      method: 'lexical-fallback',
      note: `No semantic vectors available. Using transparent lexical fallback.`,
    };
    await persistResultIfSourced(fallbackResult);
    observeLatencyMs('resonance.total_ms', Date.now() - t0);
    incCounter('resonance.requests_fallback');
    return NextResponse.json(fallbackResult);
  } catch (err) {
    incCounter('resonance.errors');
    console.error('[resonance] route error:', err);
    return NextResponse.json(
      {
        error: 'Internal error',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 500 },
    );
  }
}

function toCard(
  meta: PassageMeta,
  similarity: number,
  kind: 'scripture' | 'voice',
) {
  let source: string;
  let bookId: string;
  if (meta.translation) {
    const bookName = meta.book_id.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
    const ref =
      meta.verse_start != null
        ? `${bookName} ${meta.chapter ?? ''}:${meta.verse_start}`
        : `${bookName} ${meta.chapter ?? ''}`;
    source = `${ref} (${meta.translation.toUpperCase()})`;
    bookId = meta.book_id;
  } else {
    const parts = [meta.author, meta.work].filter(Boolean);
    source = parts.length > 0 ? parts.join(' — ') : meta.book_id;
    bookId = meta.book_id;
  }

  return {
    passageId: meta.id,
    text: meta.text,
    source,
    bookId,
    translation: meta.translation,
    similarity,
    kind,
  };
}

function normalizeVerseRef(ref: string): string {
  return ref.replace(/\s+/g, ' ').trim();
}

function passageKey(meta: PassageMeta): string {
  return `${meta.source_type}:${meta.id}`;
}

function verseRefFromMeta(meta: PassageMeta): string {
  if (!meta.translation) return '';
  const bookName = meta.book_id.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
  if (meta.verse_start != null) {
    return `${bookName} ${meta.chapter ?? ''}:${meta.verse_start}`;
  }
  return `${bookName} ${meta.chapter ?? ''}`;
}
