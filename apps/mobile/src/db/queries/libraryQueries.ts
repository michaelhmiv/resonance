/**
 * Library (voice-of-the-Church + Personal Library) data access — the Word
 * tab's Library surface.
 *
 * Library works are stored in `books` with `type = 'voice'`, grouped under a
 * `package_id` (a Book Package or a Personal Library collection shelf).
 * User-imported works carry `source = 'personal'` and rich editable metadata
 * in `personal_books`. Passages carry `translation IS NULL` and an optional
 * `division` chapter/section heading.
 *
 * (design spec §6.2, §3.3; chunking-spec.md §7)
 */

import * as FileSystem from 'expo-file-system/legacy';
import type {
  ChunkedPassage,
  LibraryBook,
  LibraryPackage,
  LibraryPassage,
  PersonalEmbeddingStatus,
  PersonalSourceFormat,
  PersonalWorkMetadata,
  PersonalWorkMetadataPatch,
} from '@resonance/core';
import { getDatabase } from '../database';

export type { LibraryBook, LibraryPackage, LibraryPassage };

interface BookJoinedRow {
  id: string;
  title: string | null;
  author: string | null;
  era: string | null;
  package_id: string | null;
  source: string | null;
  source_format: string | null;
  collection: string | null;
  tags_json: string | null;
  notes: string | null;
  include_in_resonance: number | null;
  embedding_status: string | null;
  embedded_chunks: number | null;
  total_chunks: number | null;
  ocr_required: number | null;
}

interface PersonalBookFullRow extends BookJoinedRow {
  source_filename: string;
  local_file_path: string | null;
  file_size_bytes: number;
  file_hash: string;
  embedding_model: string | null;
  last_error: string | null;
  warnings_json: string | null;
  imported_at: number;
  updated_at: number;
}

function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function personalPackageIdForCollection(collection: string): string {
  const slug = collection
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `personal_${slug || 'library'}`;
}

/** A friendly label for a package id, falling back to the raw id. */
function packageLabel(packageId: string, collectionName?: string | null): string {
  if (collectionName && collectionName.trim().length > 0) {
    return collectionName.trim();
  }
  const map: Record<string, string> = {
    seeded: 'Seed Library',
    fathers: 'The Fathers',
    medieval: 'Medieval Voices',
    reformation: 'Reformation',
    modern: 'Modern Voices',
    'witnesses-all': 'Voices of the Church',
    personal_library: 'Personal Library',
  };
  if (map[packageId]) return map[packageId];
  if (packageId.startsWith('personal_')) {
    return packageId
      .slice('personal_'.length)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return packageId.replace(/[_-]+/g, ' ');
}

function rowToLibraryBook(r: BookJoinedRow): LibraryBook {
  const isPersonal = r.source === 'personal' || r.source_format !== null;
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    era: r.era,
    package_id: r.package_id,
    source: r.source,
    isPersonal,
    sourceFormat: (r.source_format as PersonalSourceFormat | null) ?? null,
    collection: r.collection,
    tags: safeParseStringArray(r.tags_json),
    notes: r.notes,
    includeInResonance:
      r.include_in_resonance === null ? true : r.include_in_resonance !== 0,
    embeddingStatus: (r.embedding_status as PersonalEmbeddingStatus | null) ?? null,
    embeddedChunks: r.embedded_chunks ?? 0,
    totalChunks: r.total_chunks ?? 0,
    ocrRequired: r.ocr_required === 1,
  };
}

function rowToPersonalMeta(r: PersonalBookFullRow): PersonalWorkMetadata {
  return {
    bookId: r.id,
    title: r.title ?? r.source_filename,
    author: r.author ?? '',
    era: r.era ?? 'Personal',
    collection: r.collection ?? 'Personal Library',
    tags: safeParseStringArray(r.tags_json),
    notes: r.notes ?? '',
    sourceFormat: (r.source_format as PersonalSourceFormat) ?? 'txt',
    sourceFilename: r.source_filename,
    localFilePath: r.local_file_path,
    fileSizeBytes: r.file_size_bytes ?? 0,
    fileHash: r.file_hash,
    includeInResonance: r.include_in_resonance !== 0,
    embeddingStatus: (r.embedding_status as PersonalEmbeddingStatus) ?? 'pending',
    embeddedChunks: r.embedded_chunks ?? 0,
    totalChunks: r.total_chunks ?? 0,
    embeddingModel: r.embedding_model,
    lastError: r.last_error,
    ocrRequired: r.ocr_required === 1,
    warnings: safeParseStringArray(r.warnings_json),
    importedAt: r.imported_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Returns all installed Library (voice + personal) works, grouped by package
 * or personal collection shelf. Personal shelves are listed first so newly
 * imported user works are immediately discoverable.
 */
export async function getLibraryPackages(): Promise<LibraryPackage[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    const rows = await db.getAllAsync<BookJoinedRow>(
      `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source,
              pb.source_format, pb.collection, pb.tags_json, pb.notes,
              pb.include_in_resonance, pb.embedding_status,
              pb.embedded_chunks, pb.total_chunks, pb.ocr_required
       FROM books b
       LEFT JOIN personal_books pb ON pb.book_id = b.id
       WHERE b.type = 'voice'
       ORDER BY COALESCE(b.package_id, 'zzz'), COALESCE(b.title, b.id);`
    );
    const groups = new Map<string, { label: string; isPersonal: boolean; books: LibraryBook[] }>();
    for (const r of rows) {
      const key = r.package_id ?? 'ungrouped';
      const isPersonal = r.source === 'personal' || key.startsWith('personal_');
      const existing = groups.get(key) ?? {
        label: packageLabel(key, r.collection),
        isPersonal,
        books: [],
      };
      existing.books.push(rowToLibraryBook(r));
      groups.set(key, existing);
    }
    return Array.from(groups.entries())
      .sort(([aKey, aVal], [bKey, bVal]) => {
        if (aVal.isPersonal !== bVal.isPersonal) return aVal.isPersonal ? -1 : 1;
        return aKey.localeCompare(bKey);
      })
      .map(([packageId, entry]) => ({
        package_id: packageId,
        label: entry.label,
        books: entry.books,
      }));
  } catch {
    return [];
  }
}

/** A single Library work by id, or null. */
export async function getLibraryBook(bookId: string): Promise<LibraryBook | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<BookJoinedRow>(
      `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source,
              pb.source_format, pb.collection, pb.tags_json, pb.notes,
              pb.include_in_resonance, pb.embedding_status,
              pb.embedded_chunks, pb.total_chunks, pb.ocr_required
       FROM books b
       LEFT JOIN personal_books pb ON pb.book_id = b.id
       WHERE b.id = ? AND b.type = 'voice';`,
      [bookId]
    );
    return row ? rowToLibraryBook(row) : null;
  } catch {
    return null;
  }
}

/** All passages for a Library work, ordered by their stable id/chunk. */
export async function getLibraryPassages(bookId: string): Promise<LibraryPassage[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    return await db.getAllAsync<LibraryPassage>(
      `SELECT id, book_id, chapter, verse_start, verse_end, text, translation, chunk_id, division
       FROM passages
       WHERE book_id = ?
       ORDER BY id;`,
      [bookId]
    );
  } catch {
    return [];
  }
}

// ── Personal Library CRUD & Vector Storage ──────────────────────────────────

export async function getPersonalWorks(): Promise<PersonalWorkMetadata[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    const rows = await db.getAllAsync<PersonalBookFullRow>(
      `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source,
              pb.source_format, pb.source_filename, pb.local_file_path,
              pb.file_size_bytes, pb.file_hash, pb.collection, pb.tags_json,
              pb.notes, pb.include_in_resonance, pb.embedding_status,
              pb.embedded_chunks, pb.total_chunks, pb.embedding_model,
              pb.last_error, pb.ocr_required, pb.warnings_json,
              pb.imported_at, pb.updated_at
       FROM personal_books pb
       JOIN books b ON b.id = pb.book_id
       ORDER BY pb.updated_at DESC;`
    );
    return rows.map(rowToPersonalMeta);
  } catch {
    return [];
  }
}

export async function getPersonalWork(bookId: string): Promise<PersonalWorkMetadata | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<PersonalBookFullRow>(
      `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source,
              pb.source_format, pb.source_filename, pb.local_file_path,
              pb.file_size_bytes, pb.file_hash, pb.collection, pb.tags_json,
              pb.notes, pb.include_in_resonance, pb.embedding_status,
              pb.embedded_chunks, pb.total_chunks, pb.embedding_model,
              pb.last_error, pb.ocr_required, pb.warnings_json,
              pb.imported_at, pb.updated_at
       FROM personal_books pb
       JOIN books b ON b.id = pb.book_id
       WHERE pb.book_id = ?;`,
      [bookId]
    );
    return row ? rowToPersonalMeta(row) : null;
  } catch {
    return null;
  }
}

export async function findPersonalWorkByHash(
  fileHash: string
): Promise<PersonalWorkMetadata | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<PersonalBookFullRow>(
      `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source,
              pb.source_format, pb.source_filename, pb.local_file_path,
              pb.file_size_bytes, pb.file_hash, pb.collection, pb.tags_json,
              pb.notes, pb.include_in_resonance, pb.embedding_status,
              pb.embedded_chunks, pb.total_chunks, pb.embedding_model,
              pb.last_error, pb.ocr_required, pb.warnings_json,
              pb.imported_at, pb.updated_at
       FROM personal_books pb
       JOIN books b ON b.id = pb.book_id
       WHERE pb.file_hash = ?
       LIMIT 1;`,
      [fileHash]
    );
    return row ? rowToPersonalMeta(row) : null;
  } catch {
    return null;
  }
}

export interface SavePersonalWorkInput {
  bookId: string;
  title: string;
  author: string;
  era: string;
  collection: string;
  tags: string[];
  notes: string;
  sourceFormat: PersonalSourceFormat;
  sourceFilename: string;
  localFilePath: string | null;
  fileSizeBytes: number;
  fileHash: string;
  includeInResonance: boolean;
  ocrRequired: boolean;
  warnings: string[];
  chunks: ChunkedPassage[];
}

/**
 * Persist a newly imported personal work and all its chunks into `books`,
 * `passages`, and `personal_books` inside a single SQLite transaction.
 */
export async function savePersonalWork(
  input: SavePersonalWorkInput
): Promise<PersonalWorkMetadata> {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const now = Date.now();
  const packageId = personalPackageIdForCollection(input.collection);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO books (id, title, author, era, package_id, type, translation, source)
       VALUES (?, ?, ?, ?, ?, 'voice', NULL, 'personal');`,
      [
        input.bookId,
        input.title.trim() || input.sourceFilename,
        input.author.trim() || null,
        input.era.trim() || 'Personal',
        packageId,
      ]
    );

    // Clear old passages/vectors if replacing an existing personal work ID
    await db.runAsync(`DELETE FROM passage_vectors WHERE book_id = ?;`, [input.bookId]);
    await db.runAsync(`DELETE FROM passages WHERE book_id = ?;`, [input.bookId]);

    for (const chunk of input.chunks) {
      await db.runAsync(
        `INSERT INTO passages (book_id, chapter, verse_start, verse_end, text, translation, chunk_id, division)
         VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?);`,
        [
          input.bookId,
          chunk.chapter,
          chunk.text,
          chunk.chunkIndex,
          chunk.division,
        ]
      );
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO personal_books (
         book_id, source_format, source_filename, local_file_path,
         file_size_bytes, file_hash, collection, tags_json, notes,
         include_in_resonance, embedding_status, embedded_chunks,
         total_chunks, embedding_model, last_error, ocr_required,
         warnings_json, imported_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?, ?, ?);`,
      [
        input.bookId,
        input.sourceFormat,
        input.sourceFilename,
        input.localFilePath,
        input.fileSizeBytes,
        input.fileHash,
        input.collection.trim() || 'Personal Library',
        JSON.stringify(input.tags),
        input.notes.trim(),
        input.includeInResonance ? 1 : 0,
        input.chunks.length,
        input.ocrRequired ? 1 : 0,
        JSON.stringify(input.warnings),
        now,
        now,
      ]
    );
  });

  const saved = await getPersonalWork(input.bookId);
  if (!saved) throw new Error('Failed to load saved personal work');
  return saved;
}

/** Update user-editable metadata for an imported personal work. */
export async function updatePersonalWorkMetadata(
  bookId: string,
  patch: PersonalWorkMetadataPatch
): Promise<PersonalWorkMetadata | null> {
  const db = getDatabase();
  if (!db) return null;
  const existing = await getPersonalWork(bookId);
  if (!existing) return null;

  const nextTitle = patch.title !== undefined ? patch.title.trim() || existing.title : existing.title;
  const nextAuthor = patch.author !== undefined ? patch.author.trim() : existing.author;
  const nextEra = patch.era !== undefined ? patch.era.trim() || 'Personal' : existing.era;
  const nextCollection =
    patch.collection !== undefined
      ? patch.collection.trim() || 'Personal Library'
      : existing.collection;
  const nextTags = patch.tags !== undefined ? patch.tags : existing.tags;
  const nextNotes = patch.notes !== undefined ? patch.notes.trim() : existing.notes;
  const nextInclude =
    patch.includeInResonance !== undefined
      ? patch.includeInResonance
      : existing.includeInResonance;
  const nextPackageId = personalPackageIdForCollection(nextCollection);
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE books
       SET title = ?, author = ?, era = ?, package_id = ?
       WHERE id = ?;`,
      [nextTitle, nextAuthor || null, nextEra, nextPackageId, bookId]
    );
    await db.runAsync(
      `UPDATE personal_books
       SET collection = ?, tags_json = ?, notes = ?, include_in_resonance = ?, updated_at = ?
       WHERE book_id = ?;`,
      [
        nextCollection,
        JSON.stringify(nextTags),
        nextNotes,
        nextInclude ? 1 : 0,
        now,
        bookId,
      ]
    );
  });

  return getPersonalWork(bookId);
}

/** Delete a personal work, its passages, vectors, and managed local file copy. */
export async function deletePersonalWork(bookId: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  const existing = await getPersonalWork(bookId);

  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM passage_vectors WHERE book_id = ?;`, [bookId]);
      await db.runAsync(`DELETE FROM passages WHERE book_id = ?;`, [bookId]);
      await db.runAsync(`DELETE FROM personal_books WHERE book_id = ?;`, [bookId]);
      await db.runAsync(`DELETE FROM books WHERE id = ?;`, [bookId]);
    });

    if (existing?.localFilePath) {
      try {
        const info = await FileSystem.getInfoAsync(existing.localFilePath);
        if (info.exists) {
          await FileSystem.deleteAsync(existing.localFilePath, { idempotent: true });
        }
      } catch {
        // non-fatal file cleanup
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function updatePersonalEmbeddingState(
  bookId: string,
  state: {
    status: PersonalEmbeddingStatus;
    embeddedChunks: number;
    totalChunks?: number;
    modelId?: string | null;
    error?: string | null;
  }
): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(
    `UPDATE personal_books
     SET embedding_status = ?,
         embedded_chunks = ?,
         total_chunks = COALESCE(?, total_chunks),
         embedding_model = COALESCE(?, embedding_model),
         last_error = ?,
         updated_at = ?
     WHERE book_id = ?;`,
    [
      state.status,
      state.embeddedChunks,
      state.totalChunks ?? null,
      state.modelId ?? null,
      state.error ?? null,
      Date.now(),
      bookId,
    ]
  );
}

export async function savePassageVectorInt8(params: {
  passageId: number;
  bookId: string;
  modelId: string;
  dim: number;
  scale: number;
  quantized: Int8Array;
}): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  const blob = new Uint8Array(
    params.quantized.buffer,
    params.quantized.byteOffset,
    params.quantized.byteLength
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO passage_vectors (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      params.passageId,
      params.bookId,
      params.modelId,
      params.dim,
      params.scale,
      blob,
      Date.now(),
    ]
  );
}

export async function clearPersonalWorkVectors(bookId: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM passage_vectors WHERE book_id = ?;`, [bookId]);
    await db.runAsync(
      `UPDATE personal_books
       SET embedding_status = 'pending', embedded_chunks = 0, last_error = NULL, updated_at = ?
       WHERE book_id = ?;`,
      [Date.now(), bookId]
    );
  });
}
