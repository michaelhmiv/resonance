import { NextRequest, NextResponse } from 'next/server';
import { buildPatternDayDetail, normalizeWindow } from '../../../../lib/patterns-summary';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const { start } = normalizeWindow(searchParams.get('date'), searchParams.get('date'));
    const detail = await buildPatternDayDetail(start);
    return NextResponse.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load pattern day detail';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
