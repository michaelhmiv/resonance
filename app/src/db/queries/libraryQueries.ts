/**
 * Library (voice-of-the-Church) data access — the Word tab's Library surface.
 *
 * Library works are stored in `books` with `type = 'voice'`, grouped under a
 * `package_id` (a Book Package). Passages for a voice work are keyed by the
 * book's stable id and carry `translation IS NULL`, which lets Scripture and
 * Library search scopes separate cleanly.
 *
 * (design spec §6.2, §3.3)
 */

import { getDatabase } from '../database';

export interface LibraryBook {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  package_id: string | null;
}

export interface LibraryPackage {
  package_id: string;
  label: string;
  books: LibraryBook[];
}

export interface LibraryPassage {
  id: number;
  book_id: string;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  text: string;
  translation: string | null;
  chunk_id: number | null;
}

interface BookRow {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  package_id: string | null;
}

/** A friendly label for a package id, falling back to the raw id. */
function packageLabel(packageId: string): string {
  const map: Record<string, string> = {
    seeded: 'Seed Library',
    fathers: 'The Fathers',
    medieval: 'Medieval Voices',
    reformation: 'Reformation',
    modern: 'Modern Voices',
  };
  return map[packageId] ?? packageId.replace(/_/g, ' ');
}

/**
 * Returns all installed Library (voice) works, grouped by Book Package.
 * Each package's works are sorted by title; packages are sorted by id.
 */
export async function getLibraryPackages(): Promise<LibraryPackage[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    const rows = await db.getAllAsync<BookRow>(
      `SELECT id, title, author, era, package_id
       FROM books
       WHERE type = 'voice'
       ORDER BY COALESCE(package_id, 'zzz'), COALESCE(title, id);`
    );
    const groups = new Map<string, LibraryBook[]>();
    for (const r of rows) {
      const key = r.package_id ?? 'ungrouped';
      const list = groups.get(key) ?? [];
      list.push({
        id: r.id,
        title: r.title,
        author: r.author,
        era: r.era,
        package_id: r.package_id,
      });
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([packageId, books]) => ({
        package_id: packageId,
        label: packageLabel(packageId),
        books,
      }));
  } catch {
    return [];
  }
}

/** A single Library work by id, or null. */
export async function getLibraryBook(
  bookId: string
): Promise<LibraryBook | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<BookRow>(
      `SELECT id, title, author, era, package_id
       FROM books
       WHERE id = ? AND type = 'voice';`,
      [bookId]
    );
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      era: row.era,
      package_id: row.package_id,
    };
  } catch {
    return null;
  }
}

/** All passages for a Library work, ordered by their stable id/chunk. */
export async function getLibraryPassages(
  bookId: string
): Promise<LibraryPassage[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    const rows = await db.getAllAsync<LibraryPassage>(
      `SELECT id, book_id, chapter, verse_start, verse_end, text, translation, chunk_id
       FROM passages
       WHERE book_id = ?
       ORDER BY id;`,
      [bookId]
    );
    return rows;
  } catch {
    return [];
  }
}
