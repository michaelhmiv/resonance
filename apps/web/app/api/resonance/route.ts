/**
 * POST /api/resonance — find the most resonant Library passages
 * for a given journal text vector.
 *
 * Loads pre-computed library vectors (388MB binary) + passage metadata
 * asynchronously at module level, then serves cosine similarity queries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { lexicalResonance } from '../../../lib/resonance-fallback';

const VECTORS_PATH = './data/seeded_library/vectors_gte-small.bin';
const BIBLE_PASSAGES_PATH = './data/seeded_library/bible_passages.json';
const VOICE_PASSAGES_PATH = './data/seeded_library/voice_passages.json';

const DIM = 384;
const MAX_PER_CATEGORY = 3;
const MIN_SIMILARITY = 0.1;

interface PassageMeta {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
}

// ── Async module-level loading ─────────────────────────────────────────────

let vectorsLoaded = false;
let loadPromise: Promise<void> | null = null;
let passageVectors: Float32Array | null = null;
let passageCount = 0;
let passageMetadata: PassageMeta[] = [];

function isVectorsLoaded(): boolean {
  return vectorsLoaded;
}

function getPassageCount(): number {
  return passageCount;
}

function startLoading() {
  if (loadPromise) return loadPromise;
  loadPromise = loadVectors();
  return loadPromise;
}

async function loadVectors() {
  try {
    if (existsSync(VECTORS_PATH)) {
      const buffer = await readFile(VECTORS_PATH);
      passageVectors = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      passageCount = passageVectors.length / DIM;
    }

    if (existsSync(BIBLE_PASSAGES_PATH)) {
      const bibleData = JSON.parse(await readFile(BIBLE_PASSAGES_PATH, 'utf-8'));
      for (const p of bibleData) {
        passageMetadata.push({
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
      const voiceData = JSON.parse(await readFile(VOICE_PASSAGES_PATH, 'utf-8'));
      for (const p of voiceData) {
        passageMetadata.push({
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

    vectorsLoaded = true;
  } catch {
    // Graceful — resonance returns empty results
  }
}

// Start loading immediately at module level (non-blocking)
startLoading();

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

export async function POST(req: NextRequest) {
  try {
    // Ensure loading has started
    const load = startLoading();
    // Wait up to 10 seconds for vectors to load
    await Promise.race([
      load,
      new Promise<void>((resolve) => setTimeout(resolve, 10000)),
    ]);

    const { vector, text, limit = 10 } = (await req.json()) as { vector?: number[]; text?: string; limit?: number };

    if ((!vector || vector.length !== DIM) && (!text || text.trim().length < 12)) {
      return NextResponse.json({ error: `Provide either a ${DIM}-dimension vector or journal text` }, { status: 400 });
    }

    if (!vectorsLoaded || !passageVectors || passageMetadata.length === 0 || !vector || vector.length !== DIM) {
      const fallback = lexicalResonance(
        text?.trim() ?? '',
        passageMetadata.filter((p) => p.translation != null),
        passageMetadata.filter((p) => p.translation == null),
        MAX_PER_CATEGORY,
      );
      return NextResponse.json({
        ...fallback,
        pastEntries: [],
        method: 'lexical-fallback',
        note: 'Semantic vector index unavailable; using transparent lexical fallback until vector shards are deployed.',
      });
    }

    const scored: { idx: number; sim: number }[] = [];
    for (let i = 0; i < passageCount; i++) {
      const sim = cosineSim(passageVectors!, i * DIM, vector, DIM);
      if (sim >= MIN_SIMILARITY) {
        scored.push({ idx: i, sim });
      }
    }

    scored.sort((a, b) => b.sim - a.sim);

    const topScripture = scored
      .filter((s) => passageMetadata[s.idx]?.translation != null)
      .slice(0, MAX_PER_CATEGORY)
      .map((s) => toCard(passageMetadata[s.idx], s.sim, 'scripture'));

    const topVoices = scored
      .filter((s) => passageMetadata[s.idx]?.translation == null)
      .slice(0, MAX_PER_CATEGORY)
      .map((s) => toCard(passageMetadata[s.idx], s.sim, 'voice'));

    return NextResponse.json({
      scripture: topScripture,
      voices: topVoices,
      pastEntries: [],
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

function toCard(meta: PassageMeta, similarity: number, kind: 'scripture' | 'voice') {
  let source: string;
  if (meta.translation) {
    const bookName = meta.book_id.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
    const ref = meta.verse_start != null
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
