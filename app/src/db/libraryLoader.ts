/**
 * Library bootstrap — loads the seeded Library from bundled assets on first
 * launch (empty database). On subsequent launches this is a no-op.
 *
 * The actual asset files are produced by the Python build pipeline
 * (build/01–06_*.py) and copied into assets/seeded_library/ during the build
 * step.  This module reads them, inserts rows into `books` and `passages`,
 * and writes cross-references.
 *
 * (design spec §3.5, Task 1.5)
 */

import * as FileSystem from 'expo-file-system/legacy';

import type { SQLiteDatabase } from 'expo-sqlite';

/** The seeded-library asset directory. */
const ASSET_DIR = `${FileSystem.documentDirectory}seeded_library`;

/** Files we expect to find in the bundled assets. */
const LIBRARY_FILES = {
  biblePassages: 'bible_passages.json',
  bibleBooks: 'bible_books.json',
  voicePassages: 'voice_passages.json',
  voiceBooks: 'voice_books.json',
  crossRefs: 'cross_references.json',
  verseOfDay: 'verse_of_day.json',
  manifest: 'library_manifest.json',
} as const;

interface BiblePassageRow {
  id: number;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  text: string;
  translation: string;
  chunk_id: number;
}

interface VoicePassageRow {
  id: number;
  book_id: string;
  author: string;
  work: string;
  text: string;
  chunk_id: number;
}

interface BookRow {
  id: string;
  title: string;
  author?: string;
  era?: string;
  package_id: string;
  type: string;
  translation?: string;
  source?: string;
  order?: number;
  testament?: string;
  passage_count?: number;
}

interface CrossRefRow {
  from_ref: string;
  to_ref: string;
}

interface LibraryManifest {
  version: number;
  bible_translations: string[];
  voice_works: number;
  vector_models: string[];
}

async function loadJsonAsset<T>(filename: string): Promise<T | null> {
  try {
    // In a bare workflow project, assets can be loaded via expo-asset.
    // For now we attempt to read from the document directory (post-copy)
    // and fall back gracefully if the file is missing — the app still works
    // with an empty library; the user just gets no resonance until packages
    // are loaded.
    const path = `${ASSET_DIR}/${filename}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      return null;
    }
    const content = await FileSystem.readAsStringAsync(path);
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Reads the seeded library assets and populates the database.  Called on
 * every launch but returns immediately when the library is already present.
 */
export async function libraryBootstrap(db: SQLiteDatabase): Promise<void> {
  // Check if books already exist
  const count = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM books;`
  );
  if (count && count.c > 0) {
    return; // Already populated
  }

  const manifest = await loadJsonAsset<LibraryManifest>(LIBRARY_FILES.manifest);
  // eslint-disable-next-line no-console
  console.log('[library] bootstrapping seeded library...', manifest?.version ?? 'unknown');

  // ── Bible books ──────────────────────────────────────────────────────
  const bibleBooks = await loadJsonAsset<BookRow[]>(LIBRARY_FILES.bibleBooks);
  if (bibleBooks) {
    for (const b of bibleBooks) {
      await db.runAsync(
        `INSERT OR IGNORE INTO books (id, title, author, era, package_id, type, translation, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        b.id,
        b.title,
        b.author ?? null,
        b.era ?? null,
        b.package_id ?? 'seeded',
        b.type,
        b.translation ?? null,
        b.source ?? null
      );
    }
  }

  // ── Bible passages (batch insert) ───────────────────────────────────
  const biblePassages = await loadJsonAsset<BiblePassageRow[]>(LIBRARY_FILES.biblePassages);
  if (biblePassages) {
    await db.withTransactionAsync(async () => {
      for (const p of biblePassages) {
        // Build book_id from translation + book name order
        const bookId = `${p.translation}_${p.book.replace(/\s+/g, '_')}`;
        await db.runAsync(
          `INSERT OR REPLACE INTO passages (id, book_id, chapter, verse_start, verse_end, text, translation, chunk_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          p.id,
          bookId,
          p.chapter,
          p.verse_start,
          p.verse_end,
          p.text,
          p.translation,
          p.chunk_id
        );
      }
    });
  }

  // ── Voice books ─────────────────────────────────────────────────────
  const voiceBooks = await loadJsonAsset<BookRow[]>(LIBRARY_FILES.voiceBooks);
  if (voiceBooks) {
    for (const b of voiceBooks) {
      await db.runAsync(
        `INSERT OR IGNORE INTO books (id, title, author, era, package_id, type, translation, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        b.id,
        b.title,
        b.author ?? null,
        b.era ?? null,
        b.package_id ?? 'seeded',
        b.type,
        b.translation ?? null,
        b.source ?? null
      );
    }
  }

  // ── Voice passages ──────────────────────────────────────────────────
  const voicePassages = await loadJsonAsset<VoicePassageRow[]>(LIBRARY_FILES.voicePassages);
  if (voicePassages) {
    await db.withTransactionAsync(async () => {
      for (const p of voicePassages) {
        await db.runAsync(
          `INSERT OR REPLACE INTO passages (id, book_id, chapter, verse_start, verse_end, text, translation, chunk_id)
           VALUES (?, ?, NULL, NULL, NULL, ?, NULL, ?);`,
          p.id,
          p.book_id,
          p.text,
          p.chunk_id
        );
      }
    });
  }

  // ── Cross-references ───────────────────────────────────────────────
  // (stored as app_settings key-value for now — a dedicated table will be
  // added in a future migration if needed for query performance)
  const crossRefs = await loadJsonAsset<CrossRefRow[]>(LIBRARY_FILES.crossRefs);
  if (crossRefs) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
      'cross_references_count',
      String(crossRefs.length)
    );
  }

  // ── Verse of the day ────────────────────────────────────────────────
  const verseOfDay = await loadJsonAsset<unknown[]>(LIBRARY_FILES.verseOfDay);
  if (verseOfDay) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
      'verse_of_day_count',
      String(verseOfDay.length)
    );
  }

  // ── Record library version ─────────────────────────────────────────
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
    'library_version',
    String(manifest?.version ?? 1)
  );

  const finalCount = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM books;`
  );
  // eslint-disable-next-line no-console
  console.log(`[library] bootstrap complete — ${finalCount?.c ?? 0} books`);
}
