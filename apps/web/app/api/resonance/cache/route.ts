import { NextRequest, NextResponse } from 'next/server';
import { getFreshResonanceCacheForSource } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const sourceId = req.nextUrl.searchParams.get('sourceId') || req.nextUrl.searchParams.get('entryId');
    if (!sourceId) {
      return NextResponse.json({ cached: false, result: null }, { status: 400 });
    }
    const result = await getFreshResonanceCacheForSource(sourceId);
    return NextResponse.json({ cached: Boolean(result), result });
  } catch (err) {
    return NextResponse.json(
      { cached: false, result: null, error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      { status: 500 },
    );
  }
}
