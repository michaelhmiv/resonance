/**
 * GET /api/bible/chapter — O(1) lookup of verses for a single Bible chapter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBibleChapterVerses } from '../../../../lib/bible-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const book = searchParams.get('book') || 'Genesis';
    const chapter = Number(searchParams.get('chapter') || 1);
    const translation = (searchParams.get('translation') || 'web').toLowerCase();

    const verses = getBibleChapterVerses(translation, book, chapter).map((p) => ({
      id: p.id,
      verseStart: p.verse_start,
      verseEnd: p.verse_end,
      text: p.text,
    }));

    return NextResponse.json({ book, chapter, translation, verses });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
