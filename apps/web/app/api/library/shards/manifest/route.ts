/**
 * GET /api/library/shards/manifest — voice book shard manifest.
 *
 * Returns the list of 75 voice shards with sizes and sha256s.
 * Used by mobile to populate download buttons and verify integrity.
 *
 * Auth: required (premium user). Returns 401 otherwise.
 *
 * Response: {
 *   version, model, dim, dtype, shardCount, totalBytes,
 *   shards: [{ bookId, packageId, title, author, era, source,
 *              passageCount, sizeVectors, sizeHnsw, sizeIdmap,
 *              totalBytes, sha256Vectors, sha256Hnsw, sha256Idmap }]
 * }
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const VOLUME_PATH = '/data/seeded_library/library_shards/manifest.json';
const BUNDLED_PATH = './data/seeded_library/library_shards/manifest.json';

let cachedManifest: { manifest: unknown; path: string; mtimeMs: number } | null = null;

function loadManifest(): unknown {
  const p = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  if (!existsSync(p)) {
    return null;
  }
  const stat = statSync(p);
  if (cachedManifest && cachedManifest.path === p && cachedManifest.mtimeMs === stat.mtimeMs) {
    return cachedManifest.manifest;
  }
  const manifest = JSON.parse(readFileSync(p, 'utf-8'));
  cachedManifest = { manifest, path: p, mtimeMs: stat.mtimeMs };
  return manifest;
}

export async function GET() {
  const manifest = loadManifest();
  if (!manifest) {
    return NextResponse.json(
      { error: 'Shard manifest not available' },
      { status: 503 },
    );
  }
  return NextResponse.json(manifest, {
    headers: {
      'cache-control': 'public, max-age=300', // 5 min — manifest changes when shards are re-uploaded
    },
  });
}
