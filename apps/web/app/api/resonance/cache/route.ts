import { NextRequest, NextResponse } from 'next/server';
import { getFreshResonanceCacheForSource } from '../../../../lib/db';

const SOURCE_TYPES = new Set(['journal_entry', 'highlight', 'note', 'reading_event', 'corpus_passage', 'theme_snapshot']);

export async function GET(req: NextRequest) {
  try {
    const sourceId = req.nextUrl.searchParams.get('sourceId') || req.nextUrl.searchParams.get('entryId');
    const rawType = req.nextUrl.searchParams.get('sourceType') || undefined;
    const sourceType = rawType && SOURCE_TYPES.has(rawType) ? rawType as any : undefined;
    if (!sourceId) {
      return NextResponse.json({ cached: false, result: null }, { status: 400 });
    }
    const result = await getFreshResonanceCacheForSource(sourceId, sourceType);
    return NextResponse.json({ cached: Boolean(result), result });
  } catch (err) {
    return NextResponse.json(
      { cached: false, result: null, error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      { status: 500 },
    );
  }
}
