/**
 * Shared server-side indexed Bible catalog & passage cache.
 *
 * Parses the 43 MB `bible_passages.json` ONCE per server process (instead of
 * 3 separate copies across /books, /chapter, and /search) and pre-indexes by
 * `${translation}_${book}` and `${translation}_${book}_${chapter}` for O(1)
 * chapter and catalog lookups.
 */

import { readFileSync, existsSync, statSync } from 'fs';

const BIBLE_BOOKS_VOLUME = '/data/seeded_library/bible_books.json';
const BIBLE_BOOKS_BUNDLED = './data/seeded_library/bible_books.json';
const BIBLE_PASSAGES_VOLUME = '/data/seeded_library/bible_passages.json';
const BIBLE_PASSAGES_BUNDLED = './data/seeded_library/bible_passages.json';

function pickPath(volumePath: string, bundledPath: string): string {
  return existsSync(volumePath) ? volumePath : bundledPath;
}

export interface SeededBibleBook {
  id: string;
  title: string;
  testament: string;
  order: number;
  translation: string;
  [key: string]: unknown;
}

export interface SeededBiblePassage {
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

interface BibleIndex {
  passages: SeededBiblePassage[];
  chaptersByBook: Map<string, number[]>;
  versesByChapter: Map<string, SeededBiblePassage[]>;
}

let cachedBooks: SeededBibleBook[] | null = null;
let cachedBooksPath = '';
let cachedBooksMtime = 0;

let cachedIndex: BibleIndex | null = null;
let cachedPassagesPath = '';
let cachedPassagesMtime = 0;

export function loadBibleBooks(): SeededBibleBook[] {
  const path = pickPath(BIBLE_BOOKS_VOLUME, BIBLE_BOOKS_BUNDLED);
  const mtimeMs = statSync(path).mtimeMs;
  if (cachedBooks && path === cachedBooksPath && mtimeMs === cachedBooksMtime) {
    return cachedBooks;
  }
  cachedBooks = JSON.parse(readFileSync(path, 'utf-8')) as SeededBibleBook[];
  cachedBooksPath = path;
  cachedBooksMtime = mtimeMs;
  return cachedBooks;
}

export function loadBibleIndex(): BibleIndex {
  const path = pickPath(BIBLE_PASSAGES_VOLUME, BIBLE_PASSAGES_BUNDLED);
  const mtimeMs = statSync(path).mtimeMs;
  if (cachedIndex && path === cachedPassagesPath && mtimeMs === cachedPassagesMtime) {
    return cachedIndex;
  }

  const passages = JSON.parse(readFileSync(path, 'utf-8')) as SeededBiblePassage[];
  const chapterSets = new Map<string, Set<number>>();
  const versesByChapter = new Map<string, SeededBiblePassage[]>();

  for (const p of passages) {
    const tr = (p.translation || 'web').toLowerCase();
    const bookKey = `${tr}_${p.book}`;
    let chSet = chapterSets.get(bookKey);
    if (!chSet) {
      chSet = new Set<number>();
      chapterSets.set(bookKey, chSet);
    }
    chSet.add(p.chapter);

    const chKey = `${bookKey}_${p.chapter}`;
    let chList = versesByChapter.get(chKey);
    if (!chList) {
      chList = [];
      versesByChapter.set(chKey, chList);
    }
    chList.push(p);
  }

  const chaptersByBook = new Map<string, number[]>();
  for (const [key, set] of chapterSets) {
    chaptersByBook.set(key, Array.from(set).sort((a, b) => a - b));
  }

  for (const list of versesByChapter.values()) {
    list.sort((a, b) => {
      if (a.verse_start !== b.verse_start) return a.verse_start - b.verse_start;
      return (a.chunk_id ?? 0) - (b.chunk_id ?? 0);
    });
  }

  cachedIndex = { passages, chaptersByBook, versesByChapter };
  cachedPassagesPath = path;
  cachedPassagesMtime = mtimeMs;
  return cachedIndex;
}

export function getBibleChapterVerses(
  translation: string,
  book: string,
  chapter: number
): SeededBiblePassage[] {
  const { versesByChapter } = loadBibleIndex();
  return versesByChapter.get(`${translation.toLowerCase()}_${book}_${chapter}`) ?? [];
}
