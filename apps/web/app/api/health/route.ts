/**
 * GET /api/health — health check for Railway.
 */

import { NextResponse } from 'next/server';
import { existsSync } from 'fs';

const VECTORS_PATH = './data/seeded_library/vectors_gte-small.bin';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    model: process.env.RESONANCE_LLM_MODEL || 'deepseek/deepseek-v4-pro',
    vectorsLoaded: existsSync(VECTORS_PATH),
    resonanceFallback: existsSync(VECTORS_PATH) ? 'semantic-vector' : 'lexical-transparent-fallback',
    passageCount: 0,
  });
}
