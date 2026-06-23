/**
 * GET /api/health — health check for Railway.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    model: process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct',
    vectorsLoaded: false, // updated by resonance route after first load
  });
}
