/**
 * GET /api/bible/books — return the Bible book catalog for a translation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadBibleBooks, loadBibleIndex } from '../../../../lib/bible-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const translation = (searchParams.get('translation') || 'web').toLowerCase();

    const books = loadBibleBooks();
    const { chaptersByBook } = loadBibleIndex();

    const result = books
      .filter((b) => b.translation.toLowerCase() === translation)
      .map((b) => {
        const chapters = chaptersByBook.get(`${translation}_${b.title}`) || [];
        return {
          id: b.id,
          name: b.title,
          testament: b.testament,
          order: b.order,
          translation: b.translation,
          chapterCount: chapters.length,
          chapters,
        };
      });

    return NextResponse.json({ books: result });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
