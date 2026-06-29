import { NextRequest, NextResponse } from 'next/server';
import { buildPatternsSummary, normalizeWindow } from '../../../../lib/patterns-summary';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const { start, end } = normalizeWindow(searchParams.get('start'), searchParams.get('end'));
    const summary = await buildPatternsSummary(start, end);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load patterns summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
