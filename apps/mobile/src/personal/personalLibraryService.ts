/**
 * Personal Library Service — user-owned device folder scanning, multi-format
 * extraction (EPUB, PDF, DOCX, HTML, MD, TXT), metadata editing, Library
 * persistence, and on-device 512d int8 embedding queue.
 *
 * Everything stays 100% on-device. User books enter the exact same chunking
 * pipeline (`chunking-spec.md` §7) and 512d `int8` vector space as the
 * built-in Library.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  base64ToBytes,
  bytesToBase64,
  computeContentFingerprint,
  detectPersonalFormat,
  extractDocumentFromBytes,
  processPersonalDocument,
  quantizeVectorInt8,
  type PersonalSourceFormat,
  type PersonalWorkMetadata,
  type PersonalWorkMetadataPatch,
  type ProcessedPersonalDocument,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  clearPersonalWorkVectors,
  deletePersonalWork,
  findPersonalWorkByHash,
  getLibraryPassages,
  getPersonalWork,
  getPersonalWorks,
  savePassageVectorInt8,
  savePersonalWork,
  updatePersonalEmbeddingState,
  updatePersonalWorkMetadata,
} from '../db/queries/libraryQueries';
import {
  embedPassage,
  initEmbeddingModel,
  isEmbeddingReady,
} from '../embedding/embeddingService';
import { clearLibraryVectors } from '../embedding/resonanceService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';

// ── Managed directories ─────────────────────────────────────────────────────

export const PERSONAL_LIBRARY_ROOT = `${FileSystem.documentDirectory ?? ''}personal_library/`;
export const PERSONAL_INBOX_DIR = `${PERSONAL_LIBRARY_ROOT}inbox/`;
export const PERSONAL_FILES_DIR = `${PERSONAL_LIBRARY_ROOT}files/`;

const KEY_FOLDER_URI = 'personal_library_folder_uri';
const KEY_FOLDER_LABEL = 'personal_library_folder_label';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiscoveredFolderFile {
  uri: string;
  filename: string;
  format: PersonalSourceFormat;
  source: 'device_folder' | 'inbox';
  sizeBytes: number;
  alreadyImportedBookId: string | null;
}

export interface InspectedDocument {
  file: DiscoveredFolderFile;
  rawBytes: Uint8Array;
  fileHash: string;
  processed: ProcessedPersonalDocument;
  duplicateWork: PersonalWorkMetadata | null;
}

export interface PersonalImportMetadataForm {
  title: string;
  author: string;
  era: string;
  collection: string;
  tags: string[];
  notes: string;
  includeInResonance: boolean;
}

export interface PersonalLibraryState {
  initialized: boolean;
  connectedFolderUri: string | null;
  connectedFolderLabel: string | null;
  discoveredFiles: DiscoveredFolderFile[];
  scanning: boolean;
  scanError: string | null;
  works: PersonalWorkMetadata[];
  embeddingActiveBookId: string | null;
  embeddingPaused: boolean;
  /** Monotonic revision bumped whenever books/metadata change so LibraryBrowser refreshes. */
  libraryRevision: number;

  initialize: () => Promise<void>;
  refreshWorks: () => Promise<void>;
  connectDeviceFolder: () => Promise<boolean>;
  disconnectDeviceFolder: () => Promise<void>;
  scanFolders: () => Promise<DiscoveredFolderFile[]>;
  inspectFile: (file: DiscoveredFolderFile) => Promise<InspectedDocument>;
  commitImport: (
    inspected: InspectedDocument,
    meta: PersonalImportMetadataForm,
    options?: { replaceExistingBookId?: string }
  ) => Promise<PersonalWorkMetadata>;
  importPastedText: (
    rawText: string,
    format: 'txt' | 'md',
    meta: PersonalImportMetadataForm
  ) => Promise<PersonalWorkMetadata>;
  updateMetadata: (
    bookId: string,
    patch: PersonalWorkMetadataPatch
  ) => Promise<PersonalWorkMetadata | null>;
  removeWork: (bookId: string) => Promise<boolean>;
  reembedWork: (bookId: string) => Promise<void>;
  processEmbeddingQueue: () => Promise<void>;
  pauseEmbeddingQueue: () => void;
}

// ── Internal helpers ────────────────────────────────────────────────────────

let embeddingLoopRunning = false;
let embeddingPauseFlag = false;

async function ensurePersonalDirs(): Promise<void> {
  for (const dir of [PERSONAL_LIBRARY_ROOT, PERSONAL_INBOX_DIR, PERSONAL_FILES_DIR]) {
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
    } catch {
      // ignore
    }
  }
}

async function readSetting(key: string): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?;`,
      [key]
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string | null): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    if (value === null) {
      await db.runAsync(`DELETE FROM app_settings WHERE key = ?;`, [key]);
    } else {
      await db.runAsync(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
        [key, value]
      );
    }
  } catch {
    // ignore
  }
}

function extractFilenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep raw
  }
  // Android SAF URIs often encode tree paths with `:` and `/`
  const tail = decoded.split('/').pop() ?? decoded;
  const afterColon = tail.includes(':') ? tail.split(':').pop() ?? tail : tail;
  return afterColon.trim() || 'document.txt';
}

function friendlyFolderLabel(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep raw
  }
  const idx = decoded.lastIndexOf(':');
  if (idx >= 0 && idx < decoded.length - 1) {
    return decoded.slice(idx + 1);
  }
  const parts = decoded.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || 'Device Folder';
}

function makePersonalBookId(titleOrFilename: string): string {
  const slug = titleOrFilename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  const suffix = Date.now().toString(36).slice(-5);
  return `personal_${slug || 'work'}_${suffix}`;
}

async function readUriBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(b64);
}

// ── Zustand Store ───────────────────────────────────────────────────────────

export const usePersonalLibraryStore = create<PersonalLibraryState>((set, get) => ({
  initialized: false,
  connectedFolderUri: null,
  connectedFolderLabel: null,
  discoveredFiles: [],
  scanning: false,
  scanError: null,
  works: [],
  embeddingActiveBookId: null,
  embeddingPaused: false,
  libraryRevision: 0,

  async initialize() {
    if (get().initialized) return;
    await ensurePersonalDirs();
    const [folderUri, folderLabel, works] = await Promise.all([
      readSetting(KEY_FOLDER_URI),
      readSetting(KEY_FOLDER_LABEL),
      getPersonalWorks(),
    ]);

    set({
      initialized: true,
      connectedFolderUri: folderUri,
      connectedFolderLabel: folderLabel ?? (folderUri ? friendlyFolderLabel(folderUri) : null),
      works,
    });

    // Automatically embed pending personal books once the Offline Engine finishes downloading
    useOfflineEngineStore.getState().registerOnReady(() => {
      void get().processEmbeddingQueue();
    });
  },

  async refreshWorks() {
    const works = await getPersonalWorks();
    set((s) => ({ works, libraryRevision: s.libraryRevision + 1 }));
  },

  async connectDeviceFolder() {
    if (Platform.OS !== 'android' || !FileSystem.StorageAccessFramework) {
      set({
        scanError:
          'Direct folder access uses Android Storage Access Framework. On other platforms, place files in the Resonance Inbox folder or paste text.',
      });
      return false;
    }

    try {
      const perms =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted || !perms.directoryUri) {
        return false;
      }
      const label = friendlyFolderLabel(perms.directoryUri);
      await writeSetting(KEY_FOLDER_URI, perms.directoryUri);
      await writeSetting(KEY_FOLDER_LABEL, label);
      set({
        connectedFolderUri: perms.directoryUri,
        connectedFolderLabel: label,
        scanError: null,
      });
      await get().scanFolders();
      return true;
    } catch (err) {
      set({
        scanError:
          err instanceof Error ? err.message : 'Could not open folder permissions.',
      });
      return false;
    }
  },

  async disconnectDeviceFolder() {
    await writeSetting(KEY_FOLDER_URI, null);
    await writeSetting(KEY_FOLDER_LABEL, null);
    set({
      connectedFolderUri: null,
      connectedFolderLabel: null,
      scanError: null,
    });
    await get().scanFolders();
  },

  async scanFolders() {
    set({ scanning: true, scanError: null });
    await ensurePersonalDirs();
    const works = await getPersonalWorks();
    const importedByName = new Map<string, string>();
    for (const w of works) {
      importedByName.set(w.sourceFilename.toLowerCase(), w.bookId);
    }

    const discovered: DiscoveredFolderFile[] = [];
    const seenUris = new Set<string>();

    // 1. Scan connected Android SAF device folder (if configured)
    const folderUri = get().connectedFolderUri;
    if (
      folderUri &&
      Platform.OS === 'android' &&
      FileSystem.StorageAccessFramework
    ) {
      try {
        const entries =
          await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
        for (const uri of entries) {
          if (seenUris.has(uri)) continue;
          const filename = extractFilenameFromUri(uri);
          const format = detectPersonalFormat(filename);
          if (!format) continue;
          seenUris.add(uri);
          let sizeBytes = 0;
          try {
            const info = await FileSystem.getInfoAsync(uri);
            const sz = (info as { size?: number }).size;
            if (typeof sz === 'number') sizeBytes = sz;
          } catch {
            // SAF content:// URIs may omit size until read
          }
          discovered.push({
            uri,
            filename,
            format,
            source: 'device_folder',
            sizeBytes,
            alreadyImportedBookId: importedByName.get(filename.toLowerCase()) ?? null,
          });
        }
      } catch (err) {
        set({
          scanError:
            err instanceof Error
              ? `Could not read connected folder: ${err.message}`
              : 'Could not read connected folder. Try reconnecting it.',
        });
      }
    }

    // 2. Scan managed Resonance Inbox folder
    try {
      const inboxFiles = await FileSystem.readDirectoryAsync(PERSONAL_INBOX_DIR);
      for (const name of inboxFiles) {
        const format = detectPersonalFormat(name);
        if (!format) continue;
        const uri = `${PERSONAL_INBOX_DIR}${name}`;
        if (seenUris.has(uri)) continue;
        seenUris.add(uri);
        let sizeBytes = 0;
        try {
          const info = await FileSystem.getInfoAsync(uri);
          const sz = (info as { size?: number }).size;
          if (typeof sz === 'number') sizeBytes = sz;
        } catch {
          // ignore
        }
        discovered.push({
          uri,
          filename: name,
          format,
          source: 'inbox',
          sizeBytes,
          alreadyImportedBookId: importedByName.get(name.toLowerCase()) ?? null,
        });
      }
    } catch {
      // non-fatal
    }

    // Sort: newly discovered first, then alphabetical
    discovered.sort((a, b) => {
      const aNew = a.alreadyImportedBookId === null ? 0 : 1;
      const bNew = b.alreadyImportedBookId === null ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return a.filename.localeCompare(b.filename);
    });

    set({ discoveredFiles: discovered, works, scanning: false });
    return discovered;
  },

  async inspectFile(file) {
    const rawBytes = await readUriBytes(file.uri);
    const fileHash = computeContentFingerprint(rawBytes);
    const duplicateWork = await findPersonalWorkByHash(fileHash);
    const extraction = extractDocumentFromBytes(rawBytes, file.filename, file.format);
    const processed = processPersonalDocument(extraction);
    return {
      file: { ...file, sizeBytes: rawBytes.byteLength },
      rawBytes,
      fileHash,
      processed,
      duplicateWork,
    };
  },

  async commitImport(inspected, meta, options = {}) {
    await ensurePersonalDirs();
    const bookId =
      options.replaceExistingBookId ??
      makePersonalBookId(meta.title || inspected.file.filename);
    const ext = inspected.file.format;
    const localFilePath = `${PERSONAL_FILES_DIR}${bookId}.${ext}`;

    // Save a local managed copy so the book never breaks if moved in external storage
    try {
      await FileSystem.writeAsStringAsync(
        localFilePath,
        bytesToBase64(inspected.rawBytes),
        { encoding: FileSystem.EncodingType.Base64 }
      );
    } catch {
      // Non-fatal: SQLite already holds the extracted passages
    }

    const saved = await savePersonalWork({
      bookId,
      title: meta.title.trim() || inspected.processed.suggestedTitle,
      author: meta.author.trim(),
      era: meta.era.trim() || 'Personal',
      collection: meta.collection.trim() || 'Personal Library',
      tags: meta.tags,
      notes: meta.notes.trim(),
      sourceFormat: inspected.file.format,
      sourceFilename: inspected.file.filename,
      localFilePath,
      fileSizeBytes: inspected.rawBytes.byteLength,
      fileHash: inspected.fileHash,
      includeInResonance: meta.includeInResonance,
      ocrRequired: inspected.processed.ocrRequired,
      warnings: inspected.processed.warnings,
      chunks: inspected.processed.chunks,
    });

    clearLibraryVectors();
    await get().refreshWorks();
    await get().scanFolders();

    // Kick off on-device embedding queue in background (gracefully stays pending if engine not ready)
    void get().processEmbeddingQueue();
    return saved;
  },

  async importPastedText(rawText, format, meta) {
    await ensurePersonalDirs();
    const safeName = `${(meta.title.trim() || 'personal-note').replace(/[^a-zA-Z0-9_-]+/g, '_')}.${format}`;
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const rawBytes = encoder
      ? encoder.encode(rawText)
      : Uint8Array.from(rawText.split('').map((c) => c.charCodeAt(0) & 0xff));
    const fileHash = computeContentFingerprint(rawBytes);
    const extraction = extractDocumentFromBytes(rawBytes, safeName, format);
    const processed = processPersonalDocument(extraction);

    const bookId = makePersonalBookId(meta.title || safeName);
    const localFilePath = `${PERSONAL_FILES_DIR}${bookId}.${format}`;
    try {
      await FileSystem.writeAsStringAsync(localFilePath, rawText, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } catch {
      // non-fatal
    }

    const saved = await savePersonalWork({
      bookId,
      title: meta.title.trim() || processed.suggestedTitle,
      author: meta.author.trim(),
      era: meta.era.trim() || 'Personal',
      collection: meta.collection.trim() || 'Personal Library',
      tags: meta.tags,
      notes: meta.notes.trim(),
      sourceFormat: format,
      sourceFilename: safeName,
      localFilePath,
      fileSizeBytes: rawBytes.byteLength,
      fileHash,
      includeInResonance: meta.includeInResonance,
      ocrRequired: false,
      warnings: processed.warnings,
      chunks: processed.chunks,
    });

    clearLibraryVectors();
    await get().refreshWorks();
    void get().processEmbeddingQueue();
    return saved;
  },

  async updateMetadata(bookId, patch) {
    const updated = await updatePersonalWorkMetadata(bookId, patch);
    if (updated) {
      clearLibraryVectors();
      await get().refreshWorks();
    }
    return updated;
  },

  async removeWork(bookId) {
    const ok = await deletePersonalWork(bookId);
    if (ok) {
      clearLibraryVectors();
      await get().refreshWorks();
      await get().scanFolders();
    }
    return ok;
  },

  async reembedWork(bookId) {
    await clearPersonalWorkVectors(bookId);
    clearLibraryVectors();
    await get().refreshWorks();
    void get().processEmbeddingQueue();
  },

  pauseEmbeddingQueue() {
    embeddingPauseFlag = true;
    set({ embeddingPaused: true });
  },

  async processEmbeddingQueue() {
    if (embeddingLoopRunning) return;
    embeddingLoopRunning = true;
    embeddingPauseFlag = false;
    set({ embeddingPaused: false });

    try {
      // Ensure Voyage-4-Nano ONNX session is ready (no-op if not downloaded yet)
      if (!isEmbeddingReady()) {
        const ok = await initEmbeddingModel(DEFAULT_LOCAL_EMBEDDING_MODEL);
        if (!ok) {
          return; // Keep works readable in Library as 'pending' until engine is downloaded
        }
      }

      const works = await getPersonalWorks();
      const pending = works.filter(
        (w) =>
          w.totalChunks > 0 &&
          (w.embeddingStatus === 'pending' || w.embeddingStatus === 'embedding')
      );

      for (const work of pending) {
        if (embeddingPauseFlag) break;

        set({ embeddingActiveBookId: work.bookId });
        const passages = await getLibraryPassages(work.bookId);
        await updatePersonalEmbeddingState(work.bookId, {
          status: 'embedding',
          embeddedChunks: work.embeddedChunks,
          totalChunks: passages.length,
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
          error: null,
        });

        let embedded = 0;
        let failed = false;

        for (let i = 0; i < passages.length; i++) {
          if (embeddingPauseFlag) break;
          const p = passages[i];
          const titleCtx = [work.title, work.author, p.division]
            .filter(Boolean)
            .join(' — ');
          const vec = await embedPassage(p.text, titleCtx);
          if (!vec) {
            failed = true;
            break;
          }
          const { quantized, scale } = quantizeVectorInt8(vec, EMBEDDING_DIM);
          await savePassageVectorInt8({
            passageId: p.id,
            bookId: work.bookId,
            modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
            dim: EMBEDDING_DIM,
            scale,
            quantized,
          });
          embedded = i + 1;

          // Throttle UI/SQLite progress updates every 5 chunks or at the end
          if (embedded % 5 === 0 || embedded === passages.length) {
            await updatePersonalEmbeddingState(work.bookId, {
              status: 'embedding',
              embeddedChunks: embedded,
              totalChunks: passages.length,
              modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
            });
            const latest = await getPersonalWork(work.bookId);
            if (latest) {
              set((s) => ({
                works: s.works.map((w) => (w.bookId === work.bookId ? latest : w)),
              }));
            }
          }
        }

        if (embeddingPauseFlag) {
          await updatePersonalEmbeddingState(work.bookId, {
            status: 'pending',
            embeddedChunks: embedded,
            totalChunks: passages.length,
            modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
          });
          break;
        }

        if (failed) {
          await updatePersonalEmbeddingState(work.bookId, {
            status: 'error',
            embeddedChunks: embedded,
            totalChunks: passages.length,
            modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
            error: 'On-device embedding paused before finishing. Tap Re-embed to retry.',
          });
        } else {
          await updatePersonalEmbeddingState(work.bookId, {
            status: 'ready',
            embeddedChunks: passages.length,
            totalChunks: passages.length,
            modelId: DEFAULT_LOCAL_EMBEDDING_MODEL,
            error: null,
          });
          clearLibraryVectors();
        }
        await get().refreshWorks();
      }
    } finally {
      embeddingLoopRunning = false;
      set({ embeddingActiveBookId: null });
    }
  },
}));
