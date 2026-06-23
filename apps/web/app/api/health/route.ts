/**
 * GET /api/health — health check for Railway.
 * Reports real vector loading state.
 */

import { NextResponse } from 'next/server';
import { isVectorsLoaded, getPassageCount } from '../resonance/route';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    model: process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct',
    vectorsLoaded: isVectorsLoaded(),
    passageCount: getPassageCount(),
  });
}
