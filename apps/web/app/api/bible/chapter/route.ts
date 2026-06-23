/**
 * GET /api/bible/chapter — return the verses of a single Bible chapter.
 *
 * Query params:
 *   book        = Genesis            (default: Genesis)
 *   chapter     = 1                  (default: 1)
 *   translation = web | kjv | asv    (default: web)
 *
 * Response:
 *   { book, chapter, translation, verses: [{ id, verseStart, verseEnd, text }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';

const BIBLE_PASSAGES = '/data/resonance/build/output/seeded_library/bible_passages.json';

interface Passage {
  id: number;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  text: string;
  translation: string;
  chunk_id?: number;
  [key: string]: unknown;
}

// Module-level cache (lazy loaded on first request).
let cachedPassages: Passage[] | null = null;

function loadPassages(): Passage[] {
  if (!cachedPassages) {
    cachedPassages = JSON.parse(readFileSync(BIBLE_PASSAGES, 'utf-8'));
  }
  return cachedPassages as Passage[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const book = searchParams.get('book') || 'Genesis';
    const chapter = Number(searchParams.get('chapter') || 1);
    const translation = searchParams.get('translation') || 'web';

    const passages = loadPassages();

    const verses = passages
      .filter(
        (p) =>
          p.translation === translation &&
          p.book === book &&
          p.chapter === chapter,
      )
      .sort((a, b) => {
        if (a.verse_start !== b.verse_start) return a.verse_start - b.verse_start;
        return (a.chunk_id ?? 0) - (b.chunk_id ?? 0);
      })
      .map((p) => ({
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
