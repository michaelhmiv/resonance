/**
 * GET /api/library/scripture/manifest — scripture bundle metadata.
 *
 * Returns the single scripture bundle (244,089 Bible passages across 66 books)
 * with sizes and sha256s. Mobile fetches on first launch.
 *
 * Response: {
 *   version, model, dim, dtype, passageCount,
 *   sizePassages, sizeVectors, sizeHnsw, sizeIdmap, totalBytes,
 *   sha256Passages, sha256Vectors, sha256Hnsw, sha256Idmap
 * }
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const VOLUME_PATH = '/data/seeded_library/scripture_bundle/manifest.json';
const BUNDLED_PATH = './data/seeded_library/scripture_bundle/manifest.json';

let cachedManifest: { manifest: unknown; path: string; mtimeMs: number } | null = null;

function loadManifest(): unknown {
  const p = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  if (!existsSync(p)) return null;
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
      { error: 'Scripture manifest not available' },
      { status: 503 }
    );
  }
  return NextResponse.json(manifest, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
