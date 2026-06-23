/**
 * GET /api/bible/verse-of-day — return the verse assigned to the current day.
 *
 * verse_of_day.json contains 365 entries keyed by day_of_year (1-365), each
 * pointing to a scripture reference. The full verse text is recovered from
 * bible_passages.json (a single verse may be split across multiple text
 * chunks, which are reassembled in chunk order).
 *
 * Response:
 *   { book, chapter, verse, translation, text, ref: "Book Chapter:Verse" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';

const VERSE_OF_DAY = './data/seeded_library/verse_of_day.json';
const BIBLE_PASSAGES = './data/seeded_library/bible_passages.json';

interface VerseOfDay {
  day_of_year: number;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  [key: string]: unknown;
}

interface Passage {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  text: string;
  translation: string;
  chunk_id?: number;
  [key: string]: unknown;
}

// Module-level caches (lazy loaded on first request).
let cachedVerseOfDay: VerseOfDay[] | null = null;
let cachedPassages: Passage[] | null = null;

function loadVerseOfDay(): VerseOfDay[] {
  if (!cachedVerseOfDay) {
    cachedVerseOfDay = JSON.parse(readFileSync(VERSE_OF_DAY, 'utf-8'));
  }
  return cachedVerseOfDay as VerseOfDay[];
}

function loadPassages(): Passage[] {
  if (!cachedPassages) {
    cachedPassages = JSON.parse(readFileSync(BIBLE_PASSAGES, 'utf-8'));
  }
  return cachedPassages as Passage[];
}

function currentDayOfYear(): number {
  const now = Date.now();
  const yearStart = new Date(new Date().getFullYear(), 0, 0).getTime();
  return Math.floor((now - yearStart) / 86400000);
}

function resolveVerseText(entry: VerseOfDay): string {
  const passages = loadPassages();
  const matching = passages.filter(
    (p) =>
      p.translation === entry.translation &&
      p.book === entry.book &&
      p.chapter === entry.chapter &&
      p.verse_start <= entry.verse &&
      p.verse_end >= entry.verse,
  );
  if (matching.length === 0) return '';
  matching.sort((a, b) => (a.chunk_id ?? 0) - (b.chunk_id ?? 0));
  return matching.map((m) => m.text).join(' ');
}

export async function GET(_request: NextRequest) {
  try {
    const dayOfYear = currentDayOfYear();
    const entries = loadVerseOfDay();
    const entry = entries.find((e) => e.day_of_year === dayOfYear) || entries[0];

    if (!entry) {
      return NextResponse.json({ error: 'No verse of the day available' }, { status: 404 });
    }

    const text = resolveVerseText(entry);
    const ref = `${entry.book} ${entry.chapter}:${entry.verse}`;

    return NextResponse.json({
      book: entry.book,
      chapter: entry.chapter,
      verse: entry.verse,
      translation: entry.translation,
      text,
      ref,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
