/**
 * Bible lookup queries.
 *
 * Thin helpers over the seeded `passages` / `verse_of_day.json` data for the
 * Journal's "verse of the day" card. All access is local; nothing leaves the
 * device. When the seeded library isn't present yet, these resolve gracefully
 * to `null` rather than throwing — the card simply renders the reference line.
 *
 * (design spec §5.6 — verse of the day at new-day dividers)
 */

import * as FileSystem from 'expo-file-system/legacy';

import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseConnection } from './database';

/** Mirror of an entry in build/output/verse_of_day.json. */
export interface VerseOfDayEntry {
  day_of_year: number;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
}

/** Resolved verse-of-day payload returned to the UI. */
export interface VerseOfDay {
  day_of_year: number;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  /** Verse text, or `null` when the translation isn't installed. */
  text: string | null;
}

/** Folder where the build pipeline copies seeded-library JSON. */
const SEEDED_DIR = `${FileSystem.documentDirectory}seeded_library`;
const VERSE_OF_DAY_FILE = `${SEEDED_DIR}/verse_of_day.json`;

let verseOfDayCache: VerseOfDayEntry[] | null = null;

/** Read & cache the 365-entry verse-of-day list from the seeded assets. */
async function readVerseOfDayList(): Promise<VerseOfDayEntry[] | null> {
  if (verseOfDayCache) return verseOfDayCache;
  try {
    const info = await FileSystem.getInfoAsync(VERSE_OF_DAY_FILE);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(VERSE_OF_DAY_FILE);
    verseOfDayCache = JSON.parse(content) as VerseOfDayEntry[];
    return verseOfDayCache;
  } catch {
    return null;
  }
}

/** Human-readable reference, e.g. "Psalms 96:3". */
export function formatVerseReference(v: {
  book: string;
  chapter: number;
  verse: number;
}): string {
  return `${v.book} ${v.chapter}:${v.verse}`;
}

/**
 * Look up the verse-of-day entry for a given day-of-year. Returns `null` when
 * the day is out of range or the seeded file is missing.
 */
export async function getVerseOfDayEntry(
  dayOfYear: number
): Promise<VerseOfDayEntry | null> {
  const list = await readVerseOfDayList();
  if (!list) return null;
  // 1-based day_of_year; wrap for years that exceed 365 entries.
  const idx = ((dayOfYear - 1) % list.length + list.length) % list.length;
  return list[idx] ?? null;
}

/**
 * Resolve the full verse-of-day — reference + verse text — for a day.
 *
 * The verse text query mirrors how `libraryLoader` builds `book_id`:
 * `<translation>_<book with spaces → underscores>`. If no passage matches,
 * `text` is `null` (the library/package simply isn't installed).
 */
export async function getVerseOfDay(
  db: DatabaseConnection | SQLiteDatabase,
  dayOfYear: number
): Promise<VerseOfDay | null> {
  const entry = await getVerseOfDayEntry(dayOfYear);
  if (!entry) return null;

  const bookId = `${entry.translation}_${entry.book.replace(/\s+/g, '_')}`;
  let text: string | null = null;
  try {
    const row = await db.getFirstAsync<{ text: string }>(
      `SELECT text FROM passages
        WHERE book_id = ? AND chapter = ? AND verse_start = ?
        ORDER BY id ASC LIMIT 1;`,
      bookId,
      entry.chapter,
      entry.verse
    );
    text = row?.text ?? null;
  } catch {
    text = null;
  }

  return {
    day_of_year: entry.day_of_year,
    book: entry.book,
    chapter: entry.chapter,
    verse: entry.verse,
    translation: entry.translation,
    text,
  };
}
