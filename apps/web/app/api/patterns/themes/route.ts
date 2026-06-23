/**
 * GET /api/patterns/themes
 *
 * Returns TF-IDF keyword themes extracted from the 50 most recent journal
 * entries. Keyword extraction runs in-process via the shared core package.
 */

import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { extractKeywords } from '../../../../../../packages/core/src/tfidf';

type TextRow = { text: string };

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare<unknown[], TextRow>(
        'SELECT text FROM journal_entries ORDER BY created_at DESC LIMIT 50',
      )
      .all();

    const texts = rows.map((r) => r.text).filter((t) => t && t.trim().length > 0);
    const themes = extractKeywords(texts);

    return NextResponse.json({ themes });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
