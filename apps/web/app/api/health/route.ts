/**
 * GET /api/health — health check for Railway.
 * Public shallow health, no auth required.
 */

import { NextResponse } from 'next/server';
import { existsSync } from 'fs';

const MANIFEST_PATH = './data/seeded_library/vectors/manifest.json';

export async function GET() {
  let vectorInfo = { loaded: false, model: 'gte-small', passageCount: 0, method: 'lexical-fallback' };

  if (existsSync(MANIFEST_PATH)) {
    try {
      const { readFileSync } = await import('fs');
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      vectorInfo = {
        loaded: true,
        model: manifest.model || 'gte-small',
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
