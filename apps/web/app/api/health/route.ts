/**
 * GET /api/health — health check for Railway.
 * Public shallow health, no auth required.
 *
 * Vector status: checks manifest AND the actual vectors binary to
 * determine which search method will be used at runtime.
 */

import { NextResponse } from 'next/server';
import { existsSync, statSync } from 'fs';
import path from 'path';

const VECTORS_DIR = '/data/vectors/pplx-embed-v1-4b';
const MANIFEST_PATH = path.join(VECTORS_DIR, 'manifest.json');

/** Read shard filename from manifest, or fall back to vectors.bin */
function shardFileFromManifest(manifest: Record<string, unknown>): string {
  const shards = manifest.shards as Array<{ file: string }> | undefined;
  return shards?.[0]?.file || 'vectors.bin';
}

export async function GET() {
  let vectorInfo: {
    loaded: boolean;
    model: string;
    passageCount: number;
    method: string;
    vectorsFileSize: number;
    hnswAvailable?: boolean;
  } = {
    loaded: false,
    model: 'pplx-embed-v1-4b',
    passageCount: 0,
    method: 'lexical-fallback',
    vectorsFileSize: 0,
  };

  if (existsSync(MANIFEST_PATH)) {
    try {
      const { readFileSync } = await import('fs');
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const vectorsBinFile = shardFileFromManifest(manifest);
      const vectorsBinPath = path.join(VECTORS_DIR, vectorsBinFile);
      const hasBin = existsSync(vectorsBinPath);
      let binSize = 0;
      if (hasBin) {
        try { binSize = statSync(vectorsBinPath).size; } catch {}
      }
      // Check for HNSW index on the volume
      const hnswPath = path.join(VECTORS_DIR, 'corpus.hnsw');
      const idmapPath = path.join(VECTORS_DIR, 'corpus.idmap');
      const hasHnsw = existsSync(hnswPath) && existsSync(idmapPath);

      let method: string;
      if (hasHnsw) method = 'semantic-vector';
      else if (hasBin) method = 'semantic-int8';
      else if (existsSync(MANIFEST_PATH)) method = 'manifest-only';
      else method = 'lexical-fallback';

      vectorInfo = {
        loaded: hasBin,
        model: manifest.model || 'pplx-embed-v1-4b',
        passageCount: manifest.passage_count || 0,
        method,
        vectorsFileSize: binSize,
        hnswAvailable: hasHnsw,
      };
    } catch {
      // manifest corrupted or unreadable
    }
  }

  return NextResponse.json({
    status: 'ok',
    gitSha: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    model: process.env.RESONANCE_LLM_MODEL || 'deepseek/deepseek-v4-pro',
    vectors: vectorInfo,
  });
}
