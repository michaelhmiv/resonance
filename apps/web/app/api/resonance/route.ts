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
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { lexicalResonance } from '../../../lib/resonance-fallback';
import {
  getUserHighlightEmbeddings,
  getHighlights,
  ensureHighlightVectorsTable,
} from '../../../lib/db';

// Migration on first import (safe to re-run)
ensureHighlightVectorsTable().catch(() => {});

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
  vectors: Float32Array;
  dim: number;
  passageCount: number;
  dtype: string;
}

// ── Module-level caches ───────────────────────────────────────────────────

let passageMetadata: PassageMeta[] | null = null;
let metadataPromise: Promise<void> | null = null;
const modelCache = new Map<string, LoadedModel>(); // by model id
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

async function loadModel(modelId: string): Promise<LoadedModel | null> {
  const cached = modelCache.get(modelId);
  if (cached) return cached;

  const modelDir = `${VECTORS_BASE}/${modelId}`;
  const manifestPath = `${modelDir}/manifest.json`;

  if (!existsSync(manifestPath)) return null;

  try {
    const manifest: VectorManifest = JSON.parse(
      await readFile(manifestPath, 'utf-8'),
    );

    let alignmentIds = manifest.passage_ids;
    let alignmentSources = manifest.passage_sources;
    if (!(Array.isArray(alignmentIds) && alignmentIds.length === manifest.passage_count && Array.isArray(alignmentSources) && alignmentSources.length === manifest.passage_count)) {
      const sidecarPath = '/data/seeded_library/vectors_gte-small_manifest.json';
      if (existsSync(sidecarPath)) {
        try {
          const sidecar: AlignmentManifest = JSON.parse(await readFile(sidecarPath, 'utf-8'));
          if (
            Array.isArray(sidecar.passage_ids) &&
            sidecar.passage_ids.length === manifest.passage_count &&
            Array.isArray(sidecar.passage_sources) &&
            sidecar.passage_sources.length === manifest.passage_count
          ) {
            alignmentIds = sidecar.passage_ids;
            alignmentSources = sidecar.passage_sources;
            console.log(`[resonance] using sidecar alignment manifest ${sidecarPath}`);
          }
        } catch (err) {
          console.warn('[resonance] failed to read sidecar alignment manifest:', err);
        }
      }
    }

    const totalFloats = manifest.passage_count * manifest.dim;
    const buffer = new Float32Array(totalFloats);
    const isQuantized = manifest.quantization === 'linear' && manifest.range != null;

    for (const shard of manifest.shards) {
      const shardPath = `${modelDir}/${shard.file}`;
      if (!existsSync(shardPath)) continue;
      const raw = await readFile(shardPath);
      const offset = shard.start * manifest.dim;

      if (isQuantized && manifest.global_min != null) {
        const gmin = manifest.global_min;
        const range = manifest.range!;
        for (let i = 0; i < raw.length; i++) {
          buffer[offset + i] = gmin + (raw[i] / 255.0) * range;
        }
      } else if (manifest.dtype === 'int8') {
        // Perplexity native int8: signed -128..127, normalize to ~[-1, 1].
        // Each row is L2-normalized in OpenRouter's float32 output; the
        // int8 quantization scales by 127. We undo the scale here.
        // CRITICAL: raw is a Node Buffer (Uint8Array, 0..255). We must read
        // it as signed Int8Array or negative values become positive
        // (e.g. -59 becomes 197, /127 = 1.55 instead of -0.46).
        const signed = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let i = 0; i < signed.length; i++) {
          buffer[offset + i] = signed[i] / 127.0;
        }
      } else {
        // float32 (default for non-Perplexity models)
        const byteLen = raw.byteLength - (raw.byteLength % 4);
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + byteLen);
        const floats = new Float32Array(ab);
        buffer.set(floats, offset);
      }
    }

    // Re-L2-normalize each row in-place. After /127.0 dequantization, the
    // per-row norm is no longer 1.0 (it was the norm of the float32 vector
    // scaled by 127). For correct cosine similarity — and bounded
    // similarities in [-1, 1] — we renormalize once at load time. This is
    // O(N*dim) but happens once per model load, not per request.
    let totalNorm = 0;
    for (let row = 0; row < manifest.passage_count; row++) {
      const base = row * manifest.dim;
      let norm = 0;
      for (let d = 0; d < manifest.dim; d++) {
        norm += buffer[base + d] * buffer[base + d];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        const inv = 1 / norm;
        for (let d = 0; d < manifest.dim; d++) {
          buffer[base + d] *= inv;
        }
        totalNorm += norm;
      }
    }
    console.log(`[resonance] loadModel: renormalized ${manifest.passage_count} rows, avg input norm ${(totalNorm / manifest.passage_count).toFixed(4)}`);

    const loaded: LoadedModel = {
      vectors: buffer,
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

function cosineSim(a: Float32Array, aOffset: number, b: number[], dim: number): number {
  // Both sides are L2-normalized (document rows are renormalized at load time;
  // the query vector is L2-normalized by OpenRouter), so this is a true dot
  // product in [-1, 1].
  let dot = 0;
  for (let i = 0; i < dim; i++) {
    dot += a[aOffset + i] * b[i];
  }
  return dot;
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { vector, text } = (await req.json()) as {
      vector?: number[];
      text?: string;
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

        // Build accumulated similarity map keyed by composite row key
        // (source_type:id), not bare numeric id.
        const simMap = new Map<string, number>();

        const scoreAgainst = (queryVec: number[], boost = 1.0) => {
          for (let i = 0; i < loaded.passageCount; i++) {
            // We need the passage id for this vector row to look up metadata.
            // Get the id from idToVectorIndex (reverse lookup) — but we built
            // the map in the other direction. Walk passage_ids once if needed.
            // To stay O(1) here, we use a parallel id array maintained by
            // loadModel.
            const rowKey = orderedPassageKeys[i];
            if (rowKey === undefined) continue;
            const sim = cosineSim(loaded.vectors, i * loaded.dim, queryVec, loaded.dim) * boost;
            if (sim >= MIN_SIMILARITY) {
              const existing = simMap.get(rowKey) ?? 0;
              if (sim > existing) simMap.set(rowKey, sim);
            }
          }
        };

        // 1. Score with the main journal query vector
        scoreAgainst(vector, 1.0);

        // 2. Score with each highlight-note embedding (same weight as main query)
        for (const noteVec of highlightNoteVecs) {
          if (noteVec.length === loaded.dim) {
            scoreAgainst(noteVec, 1.0);
          }
        }

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

        return NextResponse.json({
          scripture: topScripture,
          voices: topVoices,
          pastEntries: [],
          method: highlightNoteVecs.length > 0 ? 'semantic-vector+highlight-notes' : 'semantic-vector',
          model: ONLINE_MODEL,
          dim: loaded.dim,
          passageCount: loaded.passageCount,
        });
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

    return NextResponse.json({
      ...fallback,
      pastEntries: [],
      method: 'lexical-fallback',
      note: `No semantic vectors available. Using transparent lexical fallback.`,
    });
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
