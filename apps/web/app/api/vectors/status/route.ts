/**
 * GET /api/vectors/status — check which vector models are loaded
 *
 * Returns:
 *   { models: [{ name, dim, passages, file_size_mb, loaded }],
 *     passage_metadata_loaded: boolean,
 *     total_passages: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const VECTORS_ROOT = '/data/vectors';

interface ModelStatus {
  name: string;
  dim: number;
  passages: number;
  dtype: string;
  file_size_mb: number;
  loaded: boolean;
}

interface BooksStatus {
  book_id: string;
  has_vectors: boolean;
  model_count: number;
}

export async function GET(req: NextRequest) {
  try {
    const models: ModelStatus[] = [];
    let passageCount = 0;

    if (existsSync(VECTORS_ROOT)) {
      const entries = await readdir(VECTORS_ROOT, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

        const modelDir = path.join(VECTORS_ROOT, entry.name);
        const manifestPath = path.join(modelDir, 'manifest.json');

        if (!existsSync(manifestPath)) continue;

        try {
          const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
          const vectorFile = manifest.shards?.[0]?.file || 'vectors.bin';
          const vectorPath = path.join(modelDir, vectorFile);

          let fileSizeMb = 0;
          if (existsSync(vectorPath)) {
            const s = await stat(vectorPath);
            fileSizeMb = Math.round(s.size / (1024 * 1024));
          }

          models.push({
            name: entry.name,
            dim: manifest.dim,
            passages: manifest.passage_count,
            dtype: manifest.dtype || 'unknown',
            file_size_mb: fileSizeMb,
            loaded: existsSync(vectorPath),
          });

          if (!passageCount && manifest.passage_count) {
            passageCount = manifest.passage_count;
          }
        } catch {
          // Skip broken manifests
        }
      }
    }

    // Check passage metadata
    const biblePath = path.join('/data', 'seeded_library', 'bible_passages.json');
    const voicePath = path.join('/data', 'seeded_library', 'voice_passages.json');
    const passageMetadataLoaded = existsSync(biblePath) || existsSync(voicePath);

    // Per-book status
    const books: BooksStatus[] = [];
    const bibleBooksPath = path.join('/data', 'seeded_library', 'bible_books.json');
    const voiceBooksPath = path.join('/data', 'seeded_library', 'voice_books.json');

    for (const bp of [bibleBooksPath, voiceBooksPath]) {
      if (existsSync(bp)) {
        try {
          const bookList = JSON.parse(await readFile(bp, 'utf-8'));
          for (const book of bookList) {
            books.push({
              book_id: book.id || book.book_id || 'unknown',
              has_vectors: models.length > 0,
              model_count: models.length,
            });
          }
        } catch {}
      }
    }

    return NextResponse.json({
      models,
      passage_metadata_loaded: passageMetadataLoaded,
      total_passages: passageCount,
      books: books.length > 0 ? books : undefined,
      vectors_path: VECTORS_ROOT,
      all_models_loaded: models.length > 0 && models.every((m) => m.loaded),
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
