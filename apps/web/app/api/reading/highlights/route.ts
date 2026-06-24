import { NextRequest, NextResponse } from 'next/server';
import { getHighlights, createHighlight } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef');
    return NextResponse.json({ highlights: await getHighlights(verseRef || undefined) });
  } catch {
    return NextResponse.json({ highlights: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, color } = await req.json();
    if (!verseRef || !color) {
      return NextResponse.json({ error: 'verseRef and color required' }, { status: 400 });
    }
    return NextResponse.json(await createHighlight(verseRef, color), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
