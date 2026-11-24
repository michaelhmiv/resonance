import { NextRequest, NextResponse } from 'next/server';
import {
  buildPatternBookBridge,
  normalizeTimeframe,
} from '../../../../lib/patterns-summary';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kindRaw = searchParams.get('kind');
    const kind = kindRaw === 'voice' ? 'voice' : 'bible';
    const id = searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }
    const bookId = searchParams.get('bookId');
    const timeframe = normalizeTimeframe(searchParams.get('timeframe'));

    const bridge = await buildPatternBookBridge({
      kind,
      id,
      timeframe,
      bookId,
    });
    return NextResponse.json(bridge);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load book bridges';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
