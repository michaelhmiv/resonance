/**
 * POST /api/resonance — find the most resonant Library passages
 * for a given journal text vector.
 *
 * Supports multiple embedding models. The client provides a `model`
 * parameter to select which vector set to search.
 *
 * POST body:
 *   { vector: number[], model?: string }
 *
 * Available models are auto-detected from ./data/seeded_library/vectors/<model>/
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { lexicalResonance } from '../../../lib/resonance-fallback';

const VECTORS_BASE =
  process.env.VECTORS_PATH || '/data/vectors';

const MIN_SIMILARITY = 0.1;
const MAX_PER_CATEGORY = 3;

interface PassageMeta {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
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
const modelCache = new Map<string, LoadedModel>();

const BIBLE_PASSAGES_PATH = './data/seeded_library/bible_passages.json';
const VOICE_PASSAGES_PATH = './data/seeded_library/voice_passages.json';

async function ensureMetadata(): Promise<void> {
  if (passageMetadata) return;
  if (metadataPromise) return metadataPromise;

  metadataPromise = (async () => {
    const meta: PassageMeta[] = [];

    if (existsSync(BIBLE_PASSAGES_PATH)) {
      const data = JSON.parse(await readFile(BIBLE_PASSAGES_PATH, 'utf-8'));
      data.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
      for (const p of data) {
        meta.push({
          id: p.id,
          book_id: `${p.translation}_${p.book.replace(/\s+/g, '_')}`,
          chapter: p.chapter,
          verse_start: p.verse_start,
          verse_end: p.verse_end,
          text: p.text,
          translation: p.translation,
        });
      }
    }

    if (existsSync(VOICE_PASSAGES_PATH)) {
      const data = JSON.parse(await readFile(VOICE_PASSAGES_PATH, 'utf-8'));
      data.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
      for (const p of data) {
        meta.push({
          id: p.id,
          book_id: p.book_id,
          chapter: null,
          verse_start: null,
          verse_end: null,
          text: p.text,
          translation: null,
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
        // Native int8: de-quantize by dividing by 127 (Perplexity native format)
        for (let i = 0; i < raw.length; i++) {
          buffer[offset + i] = raw[i] / 127.0;
        }
      } else {
        // float32 (default, e.g. GTE-small): read buffer directly as Float32Array
        const floats = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
        buffer.set(floats, offset);
      }
    }

    const loaded: LoadedModel = {
      vectors: buffer,
      dim: manifest.dim,
      passageCount: manifest.passage_count,
      dtype: manifest.dtype,
    };

    modelCache.set(modelId, loaded);
    return loaded;
  } catch (err) {
    console.error(`[resonance] failed to load model ${modelId}:`, err);
    return null;
  }
}

function availableModels(): string[] {
  try {
    return readdirSync(VECTORS_BASE, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function cosineSim(a: Float32Array, aOffset: number, b: number[], dim: number): number {
  let dot = 0;
  let normB = 0;
  for (let i = 0; i < dim; i++) {
    dot += a[aOffset + i] * b[i];
    normB += b[i] * b[i];
  }
  if (normB === 0) return 0;
  return dot / Math.sqrt(normB);
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { vector, text, model } = (await req.json()) as {
      vector?: number[];
      text?: string;
      model?: string;
    };

    // Determine which model to use
    const models = availableModels();
    const modelId =
      model ||
      (models.includes('pplx-embed-v1-4b') ? 'pplx-embed-v1-4b' : models[0]) ||
      'gte-small';

    // ── Semantic vector path ─────────────────────────────────────────
    if (vector && vector.length > 0) {
      const loaded = await loadModel(modelId);

      if (loaded && loaded.passageCount > 0 && vector.length === loaded.dim) {
        await ensureMetadata();
        const meta = passageMetadata || [];

        const scored: { idx: number; sim: number }[] = [];
        for (let i = 0; i < loaded.passageCount; i++) {
          const sim = cosineSim(loaded.vectors, i * loaded.dim, vector, loaded.dim);
          if (sim >= MIN_SIMILARITY) {
            scored.push({ idx: i, sim });
          }
        }
        scored.sort((a, b) => b.sim - a.sim);

        const topScripture = scored
          .filter((s) => meta[s.idx]?.translation != null)
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => toCard(meta[s.idx], s.sim, 'scripture'));

        const topVoices = scored
          .filter((s) => meta[s.idx]?.translation == null)
          .slice(0, MAX_PER_CATEGORY)
          .map((s) => toCard(meta[s.idx], s.sim, 'voice'));

        return NextResponse.json({
          scripture: topScripture,
          voices: topVoices,
          pastEntries: [],
          method: 'semantic-vector',
          model: modelId,
          dim: loaded.dim,
          passageCount: loaded.passageCount,
        });
      }
    }

    // ── Lexical fallback ─────────────────────────────────────────────
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
      note: `No semantic vectors available for model "${modelId}". Using transparent lexical fallback.`,
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
  if (meta.translation) {
    const bookName = meta.book_id.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
    const ref =
      meta.verse_start != null
        ? `${bookName} ${meta.chapter ?? ''}:${meta.verse_start}`
        : `${bookName} ${meta.chapter ?? ''}`;
    source = `${ref} (${meta.translation.toUpperCase()})`;
  } else {
    source = meta.book_id;
  }

  return {
    passageId: meta.id,
    text: meta.text,
    source,
    translation: meta.translation,
    similarity,
    kind,
  };
}
