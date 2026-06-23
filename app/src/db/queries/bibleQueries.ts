/**
 * Bible (Scripture) data access — the Word tab's Scripture surface.
 *
 * The Bible canon is fixed (66 books, OT/NT) and the schema's `books` table
 * does not store testament or canonical ordering, so we keep a canonical list
 * here as the browse spine and merge it against the passages present in the
 * database for the selected translation. Chapters and verses are read straight
 * from the `passages` table.
 *
 * Bible passages are seeded with `book_id = "<TRANSLATION>_<BookName>"`
 * (spaces → underscores); voice/Library passages use the book's stable id and
 * carry `translation IS NULL`. Scripture/Library scope therefore separates
 * cleanly on the `translation` column.
 *
 * (design spec §6.1, §3.3)
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '../database';
import type { Translation } from '../types/word';

// ── Translations ────────────────────────────────────────────────────────────

export const TRANSLATIONS: readonly Translation[] = ['WEB', 'KJV'];

export const DEFAULT_TRANSLATION: Translation = 'WEB';

export type BookTestament = 'OT' | 'NT';

// ── Canonical 66-book spine ─────────────────────────────────────────────────

interface CanonicalBook {
  name: string;
  testament: BookTestament;
  order: number;
}

/** The 66 books of the Bible in canonical order, grouped by testament. */
export const BIBLE_BOOKS: readonly CanonicalBook[] = [
  { name: 'Genesis', testament: 'OT', order: 1 },
  { name: 'Exodus', testament: 'OT', order: 2 },
  { name: 'Leviticus', testament: 'OT', order: 3 },
  { name: 'Numbers', testament: 'OT', order: 4 },
  { name: 'Deuteronomy', testament: 'OT', order: 5 },
  { name: 'Joshua', testament: 'OT', order: 6 },
  { name: 'Judges', testament: 'OT', order: 7 },
  { name: 'Ruth', testament: 'OT', order: 8 },
  { name: '1 Samuel', testament: 'OT', order: 9 },
  { name: '2 Samuel', testament: 'OT', order: 10 },
  { name: '1 Kings', testament: 'OT', order: 11 },
  { name: '2 Kings', testament: 'OT', order: 12 },
  { name: '1 Chronicles', testament: 'OT', order: 13 },
  { name: '2 Chronicles', testament: 'OT', order: 14 },
  { name: 'Ezra', testament: 'OT', order: 15 },
  { name: 'Nehemiah', testament: 'OT', order: 16 },
  { name: 'Esther', testament: 'OT', order: 17 },
  { name: 'Job', testament: 'OT', order: 18 },
  { name: 'Psalms', testament: 'OT', order: 19 },
  { name: 'Proverbs', testament: 'OT', order: 20 },
  { name: 'Ecclesiastes', testament: 'OT', order: 21 },
  { name: 'Song of Solomon', testament: 'OT', order: 22 },
  { name: 'Isaiah', testament: 'OT', order: 23 },
  { name: 'Jeremiah', testament: 'OT', order: 24 },
  { name: 'Lamentations', testament: 'OT', order: 25 },
  { name: 'Ezekiel', testament: 'OT', order: 26 },
  { name: 'Daniel', testament: 'OT', order: 27 },
  { name: 'Hosea', testament: 'OT', order: 28 },
  { name: 'Joel', testament: 'OT', order: 29 },
  { name: 'Amos', testament: 'OT', order: 30 },
  { name: 'Obadiah', testament: 'OT', order: 31 },
  { name: 'Jonah', testament: 'OT', order: 32 },
  { name: 'Micah', testament: 'OT', order: 33 },
  { name: 'Nahum', testament: 'OT', order: 34 },
  { name: 'Habakkuk', testament: 'OT', order: 35 },
  { name: 'Zephaniah', testament: 'OT', order: 36 },
  { name: 'Haggai', testament: 'OT', order: 37 },
  { name: 'Zechariah', testament: 'OT', order: 38 },
  { name: 'Malachi', testament: 'OT', order: 39 },
  { name: 'Matthew', testament: 'NT', order: 40 },
  { name: 'Mark', testament: 'NT', order: 41 },
  { name: 'Luke', testament: 'NT', order: 42 },
  { name: 'John', testament: 'NT', order: 43 },
  { name: 'Acts', testament: 'NT', order: 44 },
  { name: 'Romans', testament: 'NT', order: 45 },
  { name: '1 Corinthians', testament: 'NT', order: 46 },
  { name: '2 Corinthians', testament: 'NT', order: 47 },
  { name: 'Galatians', testament: 'NT', order: 48 },
  { name: 'Ephesians', testament: 'NT', order: 49 },
  { name: 'Philippians', testament: 'NT', order: 50 },
  { name: 'Colossians', testament: 'NT', order: 51 },
  { name: '1 Thessalonians', testament: 'NT', order: 52 },
  { name: '2 Thessalonians', testament: 'NT', order: 53 },
  { name: '1 Timothy', testament: 'NT', order: 54 },
  { name: '2 Timothy', testament: 'NT', order: 55 },
  { name: 'Titus', testament: 'NT', order: 56 },
  { name: 'Philemon', testament: 'NT', order: 57 },
  { name: 'Hebrews', testament: 'NT', order: 58 },
  { name: 'James', testament: 'NT', order: 59 },
  { name: '1 Peter', testament: 'NT', order: 60 },
  { name: '2 Peter', testament: 'NT', order: 61 },
  { name: '1 John', testament: 'NT', order: 62 },
  { name: '2 John', testament: 'NT', order: 63 },
  { name: '3 John', testament: 'NT', order: 64 },
  { name: 'Jude', testament: 'NT', order: 65 },
  { name: 'Revelation', testament: 'NT', order: 66 },
];

// ── Row / result types ──────────────────────────────────────────────────────

export interface BookSummary {
  /** Canonical browse name, e.g. "Genesis". */
  name: string;
  testament: BookTestament;
  order: number;
  /** Whether any passages exist for this book in the selected translation. */
  available: boolean;
  /** Best-known passages.book_id for this book+translation. */
  bookId: string;
}

export interface VersePassage {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  chunk_id: number | null;
}

export interface PassageHit {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  /** Human-readable source line, e.g. "Genesis 1:1" or "Confessions — Book I". */
  source: string;
}

export type SearchScope = 'scripture' | 'library';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Lowercase, strip non-alphanumerics — used to match book names across data. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The canonical passages.book_id for a translation+book name. */
export function bibleBookId(bookName: string, translation: Translation): string {
  return `${translation}_${bookName.replace(/\s+/g, '_')}`;
}

/** Build a "Book Chapter:Verse" reference, tolerating nulls. */
export function scriptureRef(
  bookName: string,
  chapter: number | null,
  verseStart: number | null,
  verseEnd: number | null
): string {
  const ref = `${bookName} ${chapter ?? ''}:${verseStart ?? ''}`;
  if (verseEnd != null && verseEnd !== verseStart) {
    return `${ref}-${verseEnd}`;
  }
  return ref.trim();
}

/**
 * Returns the actual passages.book_id values in the DB that correspond to the
 * given book name for a translation. Bible passages store
 * `"<TRANSLATION>_<BookName>"`, so we match by normalized name (robust to minor
 * formatting/punctuation differences). Returns the constructed id as a fallback
 * so browsing still works against an empty or partially-seeded DB.
 */
async function resolveBookIds(
  db: SQLiteDatabase,
  bookName: string,
  translation: Translation
): Promise<string[]> {
  const constructed = bibleBookId(bookName, translation);
  try {
    const rows = await db.getAllAsync<{ book_id: string }>(
      `SELECT DISTINCT book_id FROM passages WHERE translation = ?;`,
      [translation]
    );
    const target = normalize(bookName);
    const matches = rows
      .map((r) => r.book_id)
      .filter((id) => {
        const stripped = id.startsWith(`${translation}_`)
          ? id.slice(translation.length + 1)
          : id;
        return normalize(stripped) === target;
      });
    return matches.length > 0 ? matches : [constructed];
  } catch {
    return [constructed];
  }
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Returns the canonical 66-book browse spine, annotated with which books
 * actually have passages in the DB for the translation. Always returns all 66
 * so browsing never breaks on an empty library.
 */
export async function getBooks(
  translation: Translation
): Promise<BookSummary[]> {
  const db = getDatabase();
  const availableIds = new Set<string>();
  if (db) {
    try {
      const rows = await db.getAllAsync<{ book_id: string }>(
        `SELECT DISTINCT book_id FROM passages WHERE translation = ?;`,
        [translation]
      );
      for (const r of rows) {
        availableIds.add(normalize(r.book_id));
      }
    } catch {
      // ignore — treat as nothing available
    }
  }

  return BIBLE_BOOKS.map((b) => {
    const candidates = [
      normalize(bibleBookId(b.name, translation)),
      normalize(b.name),
    ];
    const available = candidates.some((c) => availableIds.has(c));
    return {
      name: b.name,
      testament: b.testament,
      order: b.order,
      available,
      bookId: bibleBookId(b.name, translation),
    };
  });
}

/** Distinct chapters available for a book+translation, ascending. */
export async function getChapters(
  bookName: string,
  translation: Translation
): Promise<number[]> {
  const db = getDatabase();
  if (!db) return [];
  const ids = await resolveBookIds(db, bookName, translation);
  try {
    const rows = await db.getAllAsync<{ chapter: number | null }>(
      `SELECT DISTINCT chapter FROM passages
       WHERE translation = ? AND book_id IN (${placeholders(ids.length)})
       ORDER BY chapter;`,
      [translation, ...ids]
    );
    return rows
      .map((r) => r.chapter)
      .filter((c): c is number => typeof c === 'number');
  } catch {
    return [];
  }
}

/** All verses/passages for a book+chapter+translation, ordered. */
export async function getVerses(
  bookName: string,
  chapter: number,
  translation: Translation
): Promise<VersePassage[]> {
  const db = getDatabase();
  if (!db) return [];
  const ids = await resolveBookIds(db, bookName, translation);
  try {
    const rows = await db.getAllAsync<VersePassage>(
      `SELECT id, book_id, chapter, verse_start, verse_end, text, translation, chunk_id
       FROM passages
       WHERE translation = ? AND book_id IN (${placeholders(ids.length)}) AND chapter = ?
       ORDER BY COALESCE(verse_start, id), id;`,
      [translation, ...ids, chapter]
    );
    return rows;
  } catch {
    return [];
  }
}

interface SearchRow {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  book_title: string | null;
  book_author: string | null;
}

/** Full-text (LIKE) search across Scripture or Library passages. */
export async function searchPassages(
  query: string,
  scope: SearchScope
): Promise<PassageHit[]> {
  const db = getDatabase();
  if (!db) return [];
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const like = `%${trimmed}%`;

  const scopeClause =
    scope === 'scripture'
      ? 'p.translation IS NOT NULL'
      : 'p.translation IS NULL';

  try {
    const rows = await db.getAllAsync<SearchRow>(
      `SELECT p.id, p.book_id, p.chapter, p.verse_start, p.verse_end,
              p.text, p.translation, b.title AS book_title, b.author AS book_author
       FROM passages p
       LEFT JOIN books b ON b.id = p.book_id
       WHERE ${scopeClause} AND p.text LIKE ?
       ORDER BY p.id
       LIMIT 120;`,
      [like]
    );

    return rows.map((r): PassageHit => {
      let source: string;
      if (r.translation != null) {
        const bookName = r.book_id.replace(/^[A-Z]+_/, '').replace(/_/g, ' ');
        source = scriptureRef(bookName, r.chapter, r.verse_start, r.verse_end);
        if (r.translation) source = `${source} (${r.translation})`;
      } else {
        source = r.book_title ?? r.book_id;
        if (r.book_author) source = `${r.book_author} — ${source}`;
      }
      return {
        id: r.id,
        book_id: r.book_id,
        chapter: r.chapter,
        verse_start: r.verse_start,
        verse_end: r.verse_end,
        text: r.text,
        translation: r.translation,
        source,
      };
    });
  } catch {
    return [];
  }
}
