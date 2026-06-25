/**
 * GET /api/health — health check for Railway.
 * Public shallow health, no auth required.
 *
 * Vector status: looks at /data/vectors/pplx-embed-v1-4b/manifest.json
 * (the single server-side model). The old gte-small index, if it still
 * exists, is ignored.
 */

import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';

const VECTORS_DIR = '/data/vectors/pplx-embed-v1-4b';
const MANIFEST_PATH = path.join(VECTORS_DIR, 'manifest.json');

export async function GET() {
  let vectorInfo = {
    loaded: false,
    model: 'pplx-embed-v1-4b',
    passageCount: 0,
    method: 'lexical-fallback',
  };

  if (existsSync(MANIFEST_PATH)) {
    try {
      const { readFileSync } = await import('fs');
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      vectorInfo = {
        loaded: true,
        model: manifest.model || 'pplx-embed-v1-4b',
        passageCount: manifest.passage_count || 0,
        method: 'semantic-vector',
      };
    } catch {
      // manifest corrupted or unreadable
    }
  }

  return NextResponse.json({
    status: 'ok',
    gitSha: '0a3ec15',
    model: process.env.RESONANCE_LLM_MODEL || 'deepseek/deepseek-v4-pro',
    vectors: vectorInfo,
  });
}
