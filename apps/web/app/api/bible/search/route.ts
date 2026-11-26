/**
 * GET /api/bible/search — case-insensitive full-text search across scripture
 * and/or the library of voice works.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { loadBibleIndex } from '../../../../lib/bible-store';

const VOICE_PASSAGES_VOLUME = '/data/seeded_library/voice_passages.json';
const VOICE_PASSAGES_BUNDLED = './data/seeded_library/voice_passages.json';

function pickPath(volumePath: string, bundledPath: string): string {
  return existsSync(volumePath) ? volumePath : bundledPath;
}

const MAX_SCRIPTURE = 50;
const MAX_LIBRARY = 100;

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
  bookId: string | null;
  book: string | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  text: string;
  translation: string | null;
  type: 'scripture' | 'library';
  source: string | null;
}

let cachedVoicePassages: VoicePassage[] | null = null;
let cachedVoiceMtime = 0;
let cachedVoicePath = '';

function loadVoicePassages(): VoicePassage[] {
  const path = pickPath(VOICE_PASSAGES_VOLUME, VOICE_PASSAGES_BUNDLED);
  const mtimeMs = statSync(path).mtimeMs;
  if (cachedVoicePassages && path === cachedVoicePath && mtimeMs === cachedVoiceMtime) {
    return cachedVoicePassages;
  }
  cachedVoicePassages = JSON.parse(readFileSync(path, 'utf-8')) as VoicePassage[];
  cachedVoiceMtime = mtimeMs;
  cachedVoicePath = path;
  return cachedVoicePassages;
}

function searchScripture(qLower: string): SearchHit[] {
  const { passages } = loadBibleIndex();
  const hits: SearchHit[] = [];
  for (const p of passages) {
    if (typeof p.text === 'string' && p.text.toLowerCase().includes(qLower)) {
      hits.push({
        id: p.id,
        bookId: null,
        book: p.book,
        chapter: p.chapter,
        verseStart: p.verse_start,
        verseEnd: p.verse_end,
        text: p.text,
        translation: p.translation,
        type: 'scripture',
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
        bookId: p.book_id,
        book: p.work,
        chapter: null,
        verseStart: null,
        verseEnd: null,
        text: p.text,
        translation: null,
        type: 'library',
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
