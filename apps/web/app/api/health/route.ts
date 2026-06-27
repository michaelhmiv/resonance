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
const VECTORS_BIN = path.join(VECTORS_DIR, 'vectors_pplx_embed_v1_4b.bin');

export async function GET() {
  let vectorInfo = {
    loaded: false,
    model: 'pplx-embed-v1-4b',
    passageCount: 0,
    method: 'lexical-fallback' as string,
    vectorsFileSize: 0,
  };

  if (existsSync(MANIFEST_PATH)) {
    try {
      const { readFileSync } = await import('fs');
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const hasBin = existsSync(VECTORS_BIN);
      let binSize = 0;
      if (hasBin) {
        try { binSize = statSync(VECTORS_BIN).size; } catch {}
      }
      vectorInfo = {
        loaded: hasBin,
        model: manifest.model || 'pplx-embed-v1-4b',
        passageCount: manifest.passage_count || 0,
        method: hasBin ? 'semantic-int8' : (existsSync(MANIFEST_PATH) ? 'manifest-only' : 'lexical-fallback'),
        vectorsFileSize: binSize,
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
