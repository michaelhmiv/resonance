/**
 * GET /api/vectors/status — verify the single online vector index is ready
 *
 * Returns a flat shape (no array) so smoke tests can assert on exact keys:
 *   {
 *     model: "pplx-embed-v1-4b",
 *     dim: 2560,
 *     dtype: "int8",
 *     passage_count: 261454,
 *     file_size_mb: 647,
 *     loaded: boolean,
 *     mtime: ISO 8601,
 *     passage_metadata_loaded: boolean,
 *     books: number,
 *     vectors_path: "/data/vectors"
 *   }
 *
 * If the index is missing, returns 200 with `loaded: false` — the embed &
 * resonance routes will still serve lexical fallback in that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stat, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const VECTORS_ROOT = '/data/vectors';
const ONLINE_MODEL = 'pplx-embed-v1-4b';

export async function GET(_req: NextRequest) {
  try {
    const modelDir = path.join(VECTORS_ROOT, ONLINE_MODEL);
    const manifestPath = path.join(modelDir, 'manifest.json');
    const manifestExists = existsSync(manifestPath);

    let passageCount = 0;
    let dim = 0;
    let dtype = 'unknown';
    let fileSizeMb = 0;
    let mtime: string | null = null;
    let loaded = false;
    let hasPassageIds = false;
    let hasPassageSources = false;
    let passageIdsCount = 0;
    let passageSourcesCount = 0;

    if (manifestExists) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      passageCount = manifest.passage_count ?? 0;
      dim = manifest.dim ?? 0;
      dtype = manifest.dtype ?? 'unknown';
      passageIdsCount = Array.isArray(manifest.passage_ids) ? manifest.passage_ids.length : 0;
      passageSourcesCount = Array.isArray(manifest.passage_sources) ? manifest.passage_sources.length : 0;
      hasPassageIds = passageIdsCount === passageCount;
      hasPassageSources = passageSourcesCount === passageCount;

      const vectorFile = manifest.shards?.[0]?.file || 'vectors.bin';
      const vectorPath = path.join(modelDir, vectorFile);
      if (existsSync(vectorPath)) {
        const s = await stat(vectorPath);
        fileSizeMb = Math.round(s.size / (1024 * 1024));
        mtime = s.mtime.toISOString();
        loaded = true;
      }
    }

    // Passage metadata (Bible + Voice JSON files on volume)
    const biblePath = path.join('/data', 'seeded_library', 'bible_passages.json');
    const voicePath = path.join('/data', 'seeded_library', 'voice_passages.json');
    const passageMetadataLoaded = existsSync(biblePath) || existsSync(voicePath);

    // Book count
    let books = 0;
    const bibleBooksPath = path.join('/data', 'seeded_library', 'bible_books.json');
    const voiceBooksPath = path.join('/data', 'seeded_library', 'voice_books.json');
    for (const bp of [bibleBooksPath, voiceBooksPath]) {
      if (existsSync(bp)) {
        try {
          const list = JSON.parse(await readFile(bp, 'utf-8'));
          books += list.length;
        } catch {
          // ignore
        }
      }
    }

    return NextResponse.json({
      model: ONLINE_MODEL,
      dim,
      dtype,
      passage_count: passageCount,
      file_size_mb: fileSizeMb,
      loaded,
      has_passage_ids: hasPassageIds,
      passage_ids_count: passageIdsCount,
      has_passage_sources: hasPassageSources,
      passage_sources_count: passageSourcesCount,
      mtime,
      passage_metadata_loaded: passageMetadataLoaded,
      books,
      vectors_path: VECTORS_ROOT,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to check vector status',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
