/**
 * GET /api/bible/search — case-insensitive full-text search across scripture
 * and/or the library of voice works.
 *
 * Query params:
 *   q     = light            (search term)
 *   scope = scripture | library   (default: scripture)
 *
 * Scripture searches bible_passages.json (max 50 results).
 * Library  searches voice_passages.json (max 100 results).
 *
 * Response:
 *   {
 *     results: [{ id, book, chapter, verseStart, verseEnd, text,
 *                 translation, type, source }],
 *     count
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';

const BIBLE_PASSAGES = './data/seeded_library/bible_passages.json';
const VOICE_PASSAGES = './data/seeded_library/voice_passages.json';

const MAX_SCRIPTURE = 50;
const MAX_LIBRARY = 100;

interface BiblePassage {
  id: number;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  text: string;
  translation: string;
  [key: string]: unknown;
}

interface VoicePassage {
  id: number;
  book_id: string;
  author: string;
  work: string;
  text: string;
  [key: string]: unknown;
}

interface SearchHit {
  id: number;
  book: string | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  text: string;
  translation: string | null;
  type: 'scripture' | 'library';
  source: string | null;
}

// Module-level caches (lazy loaded on first request).
let cachedBiblePassages: BiblePassage[] | null = null;
let cachedVoicePassages: VoicePassage[] | null = null;

function loadBiblePassages(): BiblePassage[] {
  if (!cachedBiblePassages) {
    cachedBiblePassages = JSON.parse(readFileSync(BIBLE_PASSAGES, 'utf-8'));
  }
  return cachedBiblePassages as BiblePassage[];
}

function loadVoicePassages(): VoicePassage[] {
  if (!cachedVoicePassages) {
    cachedVoicePassages = JSON.parse(readFileSync(VOICE_PASSAGES, 'utf-8'));
  }
  return cachedVoicePassages as VoicePassage[];
}

function searchScripture(qLower: string): SearchHit[] {
  const passages = loadBiblePassages();
  const hits: SearchHit[] = [];
  for (const p of passages) {
    if (typeof p.text === 'string' && p.text.toLowerCase().includes(qLower)) {
      hits.push({
        id: p.id,
        book: p.book,
        chapter: p.chapter,
        verseStart: p.verse_start,
        verseEnd: p.verse_end,
        text: p.text,
        translation: p.translation,
        type: 'scripture',
        // Provenance of scripture text is its translation.
        source: p.translation,
      });
      if (hits.length >= MAX_SCRIPTURE) break;
    }
  }
  return hits;
}

function searchLibrary(qLower: string): SearchHit[] {
  const passages = loadVoicePassages();
  const hits: SearchHit[] = [];
  for (const p of passages) {
    if (typeof p.text === 'string' && p.text.toLowerCase().includes(qLower)) {
      hits.push({
        id: p.id,
        // No "book" field on voice passages; the work title is the closest
        // analog to a scripture book name.
        book: p.work,
        chapter: null,
        verseStart: null,
        verseEnd: null,
        text: p.text,
        translation: null,
        type: 'library',
        // Voice passages carry no explicit source field; use the author as the
        // provenance identifier.
        source: p.author,
      });
      if (hits.length >= MAX_LIBRARY) break;
    }
  }
  return hits;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const scope = searchParams.get('scope') || 'scripture';

    if (!q) {
      return NextResponse.json({ results: [], count: 0 });
    }

    const qLower = q.toLowerCase();
    const results = scope === 'library' ? searchLibrary(qLower) : searchScripture(qLower);

    return NextResponse.json({ results, count: results.length });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
