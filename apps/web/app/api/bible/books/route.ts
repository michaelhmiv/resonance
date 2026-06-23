/**
 * GET /api/bible/books — return the Bible book catalog for a translation.
 *
 * Query params:
 *   translation = web | kjv | asv   (default: web)
 *
 * Response:
 *   { books: [{ id, name, testament, order, translation, chapterCount, chapters: number[] }] }
 *
 * Chapter lists are derived by scanning bible_passages.json once (cached):
 * passages are grouped by `${translation}_${book}` and the unique chapter
 * numbers are collected and sorted numerically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';

const BIBLE_BOOKS = './data/seeded_library/bible_books.json';
const BIBLE_PASSAGES = './data/seeded_library/bible_passages.json';

interface BibleBook {
  id: string;
  title: string;
  testament: string;
  order: number;
  translation: string;
  [key: string]: unknown;
}

interface Passage {
  book: string;
  chapter: number;
  translation: string;
  [key: string]: unknown;
}

// Module-level caches (lazy loaded on first request).
let cachedBooks: BibleBook[] | null = null;
let cachedChaptersByBook: Map<string, number[]> | null = null;

function loadBooks(): BibleBook[] {
  if (!cachedBooks) {
    cachedBooks = JSON.parse(readFileSync(BIBLE_BOOKS, 'utf-8'));
  }
  return cachedBooks as BibleBook[];
}

function loadChaptersByBook(): Map<string, number[]> {
  if (!cachedChaptersByBook) {
    const passages: Passage[] = JSON.parse(readFileSync(BIBLE_PASSAGES, 'utf-8'));
    const sets = new Map<string, Set<number>>();
    for (const p of passages) {
      const key = `${p.translation}_${p.book}`;
      let set = sets.get(key);
      if (!set) {
        set = new Set<number>();
        sets.set(key, set);
      }
      set.add(p.chapter);
    }
    const result = new Map<string, number[]>();
    for (const [key, set] of sets) {
      result.set(key, Array.from(set).sort((a, b) => a - b));
    }
    cachedChaptersByBook = result;
  }
  return cachedChaptersByBook as Map<string, number[]>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const translation = searchParams.get('translation') || 'web';

    const books = loadBooks();
    const chaptersByBook = loadChaptersByBook();

    const result = books
      .filter((b) => b.translation === translation)
      .map((b) => {
        const chapters = chaptersByBook.get(`${b.translation}_${b.title}`) || [];
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
