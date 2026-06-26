/**
 * POST /api/resonance — find the most resonant Library passages
 * for a given journal text vector.
 *
 * Single embedding model on the server: pplx-embed-v1-4b (2560d int8).
 * The client sends a 2560d vector; we score it against the on-volume index.
 *
 * POST body:
 *   { vector: number[] }  (or { text: string } for lexical fallback)
 *
 * Returns up to MAX_PER_CATEGORY scripture + voice passages sorted by cosine
 * similarity. Personalizes with a 1.12× boost for passages the user has
 * previously highlighted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { open, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { lexicalResonance } from '../../../lib/resonance-fallback';
import {
  getUserHighlightEmbeddings,
  getHighlights,
  resonanceContentHash,
  storeResonanceCache,
  replaceResonanceEdges,
} from '../../../lib/db';

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

async function scoreAllRows(loaded: LoadedModel, queryVecs: number[][]): Promise<Map<string, number>> {
  const simMap = new Map<string, number>();
  const rowsPerChunk = Math.max(1, Math.floor((4 * 1024 * 1024) / loaded.dim));
  const fd = await open(loaded.vectorPath, 'r');
  try {
    for (let startRow = 0; startRow < loaded.passageCount; startRow += rowsPerChunk) {
      const rowsThisChunk = Math.min(rowsPerChunk, loaded.passageCount - startRow);
      const bytesToRead = rowsThisChunk * loaded.dim;
      const chunk = Buffer.allocUnsafe(bytesToRead);
      await fd.read(chunk, 0, bytesToRead, startRow * loaded.dim);
      for (let r = 0; r < rowsThisChunk; r++) {
        const rowIndex = startRow + r;
        const rowKey = orderedPassageKeys[rowIndex];
        if (rowKey === undefined) continue;
        const base = r * loaded.dim;
        let bestSim = Number.NEGATIVE_INFINITY;
        for (const query of queryVecs) {
          let dot = 0;
          for (let d = 0; d < loaded.dim; d++) {
            const byte = chunk[base + d]!;
            const signed = byte > 127 ? byte - 256 : byte;
            dot += signed * query[d];
          }
          const sim = dot / loaded.rowNorms[rowIndex]!;
          if (sim > bestSim) bestSim = sim;
        }
        if (bestSim >= MIN_SIMILARITY) {
          const existing = simMap.get(rowKey) ?? Number.NEGATIVE_INFINITY;
          if (bestSim > existing) simMap.set(rowKey, bestSim);
        }
      }
    }
  } finally {
    await fd.close();
  }
  return simMap;
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { vector, text, sourceId, entryId, sourceNodeId } = (await req.json()) as {
      vector?: number[];
      text?: string;
      sourceId?: string;
      entryId?: string;
      sourceNodeId?: string;
    };
    const resolvedSourceId = sourceId ?? entryId;

    const persistResultIfSourced = async (result: Record<string, unknown>) => {
      if (!resolvedSourceId || !sourceNodeId || !text?.trim()) return;
      try {
        const contentHash = resonanceContentHash(text);
        await Promise.all([
          storeResonanceCache({
            sourceNodeId,
            sourceId: resolvedSourceId,
            contentHash,
            result,
            metadata: { route: '/api/resonance' },
          }),
          replaceResonanceEdges({ sourceNodeId, result }),
        ]);
      } catch (err) {
        console.warn('[resonance] sourced persistence failed:', err);
      }
    };

    // ── Semantic vector path ─────────────────────────────────────────
    if (vector && vector.length > 0) {
      const loaded = await loadModel(ONLINE_MODEL);

      if (loaded && loaded.passageCount > 0 && vector.length === loaded.dim) {
        await ensureMetadata();
        const meta = passageMetadata || [];

        // Quick sanity: check that the loaded vectors for the first passage_id
        // match the renormalized row in memory
        const firstKey = orderedPassageKeys[0];
        const firstMeta = meta.find(m => passageKey(m) === firstKey);
        console.log(`[resonance] first vector row corresponds to ${firstKey} (${firstMeta?.book_id ?? 'unknown'})`);

        // Fetch user highlights and their note embeddings
        let highlightNoteVecs: number[][] = [];
        let highlightRefs = new Set<string>();
        try {
          [highlightNoteVecs, highlightRefs] = await Promise.all([
            getUserHighlightEmbeddings().catch(() => [] as number[][]),
            getHighlights().then(
              (rows: { verse_ref: string }[]) =>
                new Set(rows.map((r) => normalizeVerseRef(r.verse_ref))),
            ).catch(() => new Set<string>()),
          ]);
        } catch {
          // personalization is additive, not critical
        }

        // Build id → meta-index lookup so we can resolve the correct
        // metadata for each vector row via its passage id.
        const keyToMeta = new Map<string, number>();
        for (let m = 0; m < meta.length; m++) {
          keyToMeta.set(passageKey(meta[m]), m);
        }

        // Score all query vectors in a single streamed pass over the int8 file.
        const queryVecs = [vector, ...highlightNoteVecs.filter((noteVec) => noteVec.length === loaded.dim)];
        const simMap = await scoreAllRows(loaded, queryVecs);

        // Apply highlight boost and sort
        const scored: { key: string; sim: number }[] = [];
        for (const [rowKey, sim] of simMap) {
          const m = keyToMeta.get(rowKey);
          if (m === undefined) continue; // passage not in current metadata
          let finalSim = sim;
          if (highlightRefs.has(normalizeVerseRef(verseRefFromMeta(meta[m])))) {
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

        const topVoices = scored
          .filter((s) => {
            const m = keyToMeta.get(s.key);
            return m !== undefined && meta[m].translation == null;
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
          method: highlightNoteVecs.length > 0 ? 'semantic-vector+highlight-notes' : 'semantic-vector',
          model: ONLINE_MODEL,
          dim: loaded.dim,
          passageCount: loaded.passageCount,
        };
        await persistResultIfSourced(result);
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
    return NextResponse.json(fallbackResult);
  } catch (err) {
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
