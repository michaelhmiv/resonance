/**
 * GET /api/health — health check for Railway.
 */

import { NextResponse } from 'next/server';
import { existsSync } from 'fs';

const VECTORS_PATH = './data/seeded_library/vectors_gte-small.bin';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    model: process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct',
    vectorsLoaded: existsSync(VECTORS_PATH),
    passageCount: 0,
  });
}
