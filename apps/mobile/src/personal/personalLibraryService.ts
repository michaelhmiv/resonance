/**
 * Personal Library Service — individual file picking, user-owned folder
 * scanning (device storage, Google Drive, iCloud Drive, etc.), multi-format
 * extraction (EPUB, PDF, DOCX, HTML, MD, TXT), metadata editing, Library
 * persistence, and on-device 512d int8 embedding queue.
 *
 * Everything stays 100% on-device. User books enter the exact same chunking
 * pipeline (`chunking-spec.md` §7) and 512d `int8` vector space as the
 * built-in Library.
 */

import {
  Directory as ExpoDirectory,
  File as ExpoFile,
  FileMode,
} from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  base64ToBytes,
  bytesToBase64,
  computeContentFingerprint,
  detectPersonalFormat,
  detectPersonalFormatFromBytes,
  detectPersonalFormatFromHeaderBytes,
  detectPersonalFormatFromMime,
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
  source: 'picked' | 'device_folder' | 'inbox';
  /** Relative subfolder path inside the connected folder (null if root, picked, or inbox). */
  subfolder: string | null;
  sizeBytes: number;
  alreadyImportedBookId: string | null;
}

export interface ScanProgress {
  foldersScanned: number;
  filesFound: number;
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
  pickedFiles: DiscoveredFolderFile[];
  discoveredFiles: DiscoveredFolderFile[];
  scanning: boolean;
  scanProgress: ScanProgress | null;
  scanNotice: string | null;
  scanError: string | null;
  works: PersonalWorkMetadata[];
  embeddingActiveBookId: string | null;
  embeddingPaused: boolean;
  /** Monotonic revision bumped whenever books/metadata change so LibraryBrowser refreshes. */
  libraryRevision: number;

  initialize: () => Promise<void>;
  refreshWorks: () => Promise<void>;
  pickFiles: () => Promise<DiscoveredFolderFile[]>;
  clearPickedFiles: () => void;
  connectDeviceFolder: () => Promise<boolean>;
  disconnectDeviceFolder: () => Promise<void>;
  scanFolders: () => Promise<DiscoveredFolderFile[]>;
  inspectFile: (
    file: DiscoveredFolderFile,
    options?: { onStage?: (stage: 'downloading' | 'extracting') => void }
  ) => Promise<InspectedDocument>;
  commitImport: (
    inspected: InspectedDocument,
    meta: PersonalImportMetadataForm,
    options?: { replaceExistingBookId?: string; deferEmbedding?: boolean }
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
let activeScanRunId = 0;

const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FOLDERS = 250;
const MAX_SCAN_FILES = 1000;

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

function isPickerCancelledError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

function isOpaqueProviderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/acc=\d+;doc=/i.test(trimmed) || /doc=encoded=/i.test(trimmed)) return true;
  if (/^encoded=/i.test(trimmed)) return true;
  // Pure opaque token without an extension (e.g. Drive / MediaStore IDs)
  if (!trimmed.includes('.') && /^[a-z0-9_-]{20,}$/i.test(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}

function isGenericPlaceholderName(name: string): boolean {
  return /^(Google Drive|Cloud|Selected) (EPUB|PDF|DOCX|HTML|MD|TXT)\b/i.test(name);
}

function providerLabelFromUri(uri: string): string | null {
  const lower = uri.toLowerCase();
  if (lower.includes('com.google.android.apps.docs.storage')) return 'Google Drive';
  if (lower.includes('com.microsoft.skydrive') || lower.includes('onedrive')) {
    return 'OneDrive';
  }
  if (lower.includes('com.dropbox')) return 'Dropbox';
  return null;
}

function extractFilenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep raw
  }
  const withoutTrailingSlash = decoded.replace(/\/+$/, '');
  const tail = withoutTrailingSlash.split('/').pop() ?? withoutTrailingSlash;
  // Android external storage SAF URIs encode paths like `primary:Documents/book.epub`
  const afterColon = tail.includes(':') ? tail.split(':').pop() ?? tail : tail;
  const leaf = afterColon.split('/').pop() ?? afterColon;
  return leaf.trim();
}

function friendlyFolderLabel(uri: string): string {
  const provider = providerLabelFromUri(uri);
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep raw
  }
  const withoutScheme = decoded.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
  const colonIdx = withoutScheme.lastIndexOf(':');
  if (colonIdx >= 0 && colonIdx < withoutScheme.length - 1) {
    const candidate = withoutScheme.slice(colonIdx + 1).replace(/^\/+/, '');
    if (candidate && !isOpaqueProviderName(candidate)) {
      return provider ? `${provider} · ${candidate}` : candidate;
    }
  }
  if (provider) {
    return `${provider} Folder`;
  }
  const parts = withoutScheme.split('/').filter((p) => p && !isOpaqueProviderName(p));
  const tail = parts.slice(-2).join('/');
  return tail || 'Connected Folder';
}

function makeFallbackFilename(
  uri: string,
  format: PersonalSourceFormat,
  index?: number
): string {
  const provider = providerLabelFromUri(uri) ?? 'Selected';
  const suffix = typeof index === 'number' ? ` #${index}` : '';
  return `${provider} ${format.toUpperCase()}${suffix}`;
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

const READ_TIMEOUT_MS = 45_000;
const MAX_HEADER_PEEKS_PER_SCAN = 80;

function normalizeSafDirUri(uri: string): string {
  // Android SAF `content://` tree/document URIs break if Expo appends a trailing `/`,
  // while iOS `file://` directories require their trailing `/`.
  if (uri.startsWith('content://')) {
    return uri.replace(/\/+$/, '');
  }
  return uri;
}

function isGenericBinaryMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return true;
  const clean = mimeType.toLowerCase().split(';')[0].trim();
  return (
    clean === '' ||
    clean === 'application/octet-stream' ||
    clean === 'application/zip' ||
    clean === 'application/x-zip-compressed' ||
    clean === 'binary/octet-stream'
  );
}

function peekHeaderFormat(entry: ExpoFile): PersonalSourceFormat | null {
  try {
    const handle = entry.open(FileMode.ReadOnly);
    try {
      const header = handle.readBytes(256);
      const bytes = header instanceof Uint8Array ? header : new Uint8Array(header);
      return detectPersonalFormatFromHeaderBytes(bytes);
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

async function readUriBytes(uri: string): Promise<Uint8Array> {
  const provider = providerLabelFromUri(uri);
  const timeoutErr = new Error(
    provider
      ? `Timed out downloading from ${provider}. Check your connection or try importing fewer files at once.`
      : 'Timed out reading file from storage.'
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutErr), READ_TIMEOUT_MS);
  });

  const readPromise = (async (): Promise<Uint8Array> => {
    try {
      const file = new ExpoFile(uri);
      const raw = await file.bytes();
      return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    } catch (modernErr) {
      // Fallback for any legacy file:// URI if ExpoFile fails
      try {
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return base64ToBytes(b64);
      } catch {
        throw modernErr;
      }
    }
  })();

  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sortDiscoveredFiles(files: DiscoveredFolderFile[]): DiscoveredFolderFile[] {
  return [...files].sort((a, b) => {
    const aPicked = a.source === 'picked' ? 0 : 1;
    const bPicked = b.source === 'picked' ? 0 : 1;
    if (aPicked !== bPicked) return aPicked - bPicked;
    const aNew = a.alreadyImportedBookId === null ? 0 : 1;
    const bNew = b.alreadyImportedBookId === null ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    return a.filename.localeCompare(b.filename);
  });
}

// ── Zustand Store ───────────────────────────────────────────────────────────

export const usePersonalLibraryStore = create<PersonalLibraryState>((set, get) => ({
  initialized: false,
  connectedFolderUri: null,
  connectedFolderLabel: null,
  pickedFiles: [],
  discoveredFiles: [],
  scanning: false,
  scanProgress: null,
  scanNotice: null,
  scanError: null,
  works: [],
  embeddingActiveBookId: null,
  embeddingPaused: false,
  libraryRevision: 0,

  async initialize() {
    if (get().initialized) return;
    await ensurePersonalDirs();
    const [folderUri, savedFolderLabel, works] = await Promise.all([
      readSetting(KEY_FOLDER_URI),
      readSetting(KEY_FOLDER_LABEL),
      getPersonalWorks(),
    ]);

    // Repair any ugly opaque label persisted by earlier versions (e.g. `//com.google...`)
    const folderLabel = folderUri
      ? savedFolderLabel && !savedFolderLabel.startsWith('//') && !isOpaqueProviderName(savedFolderLabel)
        ? savedFolderLabel
        : friendlyFolderLabel(folderUri)
      : null;

    if (folderUri && folderLabel && folderLabel !== savedFolderLabel) {
      void writeSetting(KEY_FOLDER_LABEL, folderLabel);
    }

    set({
      initialized: true,
      connectedFolderUri: folderUri,
      connectedFolderLabel: folderLabel,
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

  async pickFiles() {
    set({ scanError: null });
    try {
      const picked = await ExpoFile.pickFileAsync({ multipleFiles: true });
      if (picked.canceled || !picked.result || picked.result.length === 0) {
        return [];
      }

      const works = await getPersonalWorks();
      const importedByName = new Map<string, string>();
      for (const w of works) {
        importedByName.set(w.sourceFilename.toLowerCase(), w.bookId);
      }

      const added: DiscoveredFolderFile[] = [];
      const unsupported: string[] = [];
      let genericIdx = 1;

      for (const entry of picked.result) {
        const uri = entry.uri;
        const rawName = extractFilenameFromUri(uri);
        const opaque = isOpaqueProviderName(rawName);

        let mimeType: string | null = null;
        try {
          mimeType = entry.type ?? null;
        } catch {
          mimeType = null;
        }

        let format: PersonalSourceFormat | null =
          (!opaque ? detectPersonalFormat(rawName) : null) ??
          detectPersonalFormatFromMime(mimeType);

        let sizeBytes = 0;
        try {
          if (typeof entry.size === 'number' && entry.size > 0) {
            sizeBytes = entry.size;
          }
        } catch {
          // ignore
        }

        // Fallback: inspect file bytes when URI and MIME don't reveal format
        if (!format) {
          try {
            const bytes = await readUriBytes(uri);
            sizeBytes = bytes.byteLength;
            format = detectPersonalFormatFromBytes(bytes);
          } catch {
            // unreadable or unsupported
          }
        }

        if (!format) {
          unsupported.push(opaque ? 'selected file' : rawName);
          continue;
        }

        const filename = opaque
          ? makeFallbackFilename(uri, format, picked.result.length > 1 ? genericIdx++ : undefined)
          : rawName;

        added.push({
          uri,
          filename,
          format,
          source: 'picked',
          subfolder: null,
          sizeBytes,
          alreadyImportedBookId: opaque
            ? null
            : importedByName.get(filename.toLowerCase()) ?? null,
        });
      }

      if (added.length > 0) {
        const existingPicked = get().pickedFiles;
        const mergedPickedMap = new Map<string, DiscoveredFolderFile>();
        for (const f of existingPicked) mergedPickedMap.set(f.uri, f);
        for (const f of added) mergedPickedMap.set(f.uri, f);
        const nextPicked = Array.from(mergedPickedMap.values());

        const mergedDiscoveredMap = new Map<string, DiscoveredFolderFile>();
        for (const f of get().discoveredFiles) mergedDiscoveredMap.set(f.uri, f);
        for (const f of nextPicked) mergedDiscoveredMap.set(f.uri, f);

        set({
          pickedFiles: nextPicked,
          discoveredFiles: sortDiscoveredFiles(Array.from(mergedDiscoveredMap.values())),
        });
      }

      if (unsupported.length > 0) {
        set({
          scanError:
            unsupported.length === 1
              ? `Unsupported file (${unsupported[0]}). Choose EPUB, PDF, DOCX, HTML, Markdown, or TXT.`
              : `${unsupported.length} selected files are not supported. Choose EPUB, PDF, DOCX, HTML, Markdown, or TXT.`,
        });
      }

      return added;
    } catch (err) {
      if (isPickerCancelledError(err)) {
        return [];
      }
      set({
        scanError:
          err instanceof Error ? err.message : 'Could not open file picker.',
      });
      return [];
    }
  },

  clearPickedFiles() {
    set((s) => ({
      pickedFiles: [],
      discoveredFiles: s.discoveredFiles.filter((f) => f.source !== 'picked'),
    }));
  },

  async connectDeviceFolder() {
    set({ scanError: null });
    try {
      const directory = await ExpoDirectory.pickDirectoryAsync();
      if (!directory || !directory.uri) {
        return false;
      }
      const label = friendlyFolderLabel(directory.uri);
      await writeSetting(KEY_FOLDER_URI, directory.uri);
      await writeSetting(KEY_FOLDER_LABEL, label);
      set({
        connectedFolderUri: directory.uri,
        connectedFolderLabel: label,
        scanError: null,
      });
      await get().scanFolders();
      return true;
    } catch (err) {
      if (isPickerCancelledError(err)) {
        return false;
      }
      set({
        scanError:
          err instanceof Error ? err.message : 'Could not open folder picker.',
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
    const runId = ++activeScanRunId;
    set({
      scanning: true,
      scanProgress: { foldersScanned: 0, filesFound: 0 },
      scanNotice: null,
      scanError: null,
    });
    await ensurePersonalDirs();
    const works = await getPersonalWorks();
    const importedByName = new Map<string, string>();
    for (const w of works) {
      importedByName.set(w.sourceFilename.toLowerCase(), w.bookId);
    }

    const discovered: DiscoveredFolderFile[] = [];
    const seenUris = new Set<string>();

    // 0. Include any individually picked files from the current session
    for (const picked of get().pickedFiles) {
      if (seenUris.has(picked.uri)) continue;
      seenUris.add(picked.uri);
      discovered.push({
        ...picked,
        alreadyImportedBookId: isGenericPlaceholderName(picked.filename)
          ? picked.alreadyImportedBookId
          : importedByName.get(picked.filename.toLowerCase()) ?? picked.alreadyImportedBookId,
      });
    }

    // 1. Recursively scan connected folder & subfolders (device storage, Google Drive, iCloud, etc.)
    const folderUri = get().connectedFolderUri;
    let scanNotice: string | null = null;
    if (folderUri) {
      try {
        interface QueueItem {
          dir: ExpoDirectory;
          relativePath: string;
          depth: number;
        }
        const rootUri = normalizeSafDirUri(folderUri);
        const queue: QueueItem[] = [
          { dir: new ExpoDirectory(rootUri), relativePath: '', depth: 0 },
        ];
        const visitedDirUris = new Set<string>([rootUri]);
        let foldersScanned = 0;
        let folderFilesFound = 0;
        let fallbackFileIdx = 1;
        let fallbackFolderIdx = 1;
        let headerPeeksUsed = 0;
        let skippedGoogleDocs = 0;
        let hitLimit = false;
        let failedSubfolders = 0;

        while (queue.length > 0) {
          if (activeScanRunId !== runId) {
            return get().discoveredFiles;
          }
          if (foldersScanned >= MAX_SCAN_FOLDERS || folderFilesFound >= MAX_SCAN_FILES) {
            hitLimit = true;
            break;
          }

          const current = queue.shift()!;
          let entries: (ExpoDirectory | ExpoFile)[];
          try {
            entries = current.dir.list();
          } catch (dirErr) {
            // Root folder failure should surface clearly; unreadable subfolder is non-fatal
            if (current.depth === 0) {
              throw dirErr;
            }
            failedSubfolders++;
            continue;
          }

          foldersScanned++;
          const hasSubdirs = entries.some((e) => e instanceof ExpoDirectory);
          const hasOpaqueEntry = entries.some(
            (e) =>
              e instanceof ExpoFile &&
              isOpaqueProviderName(extractFilenameFromUri(e.uri))
          );

          // On cloud providers like Google Drive, entry URIs are opaque IDs, while
          // `dir.info().files` queries Android DocumentFile.name for real display names.
          // Calling it only on leaf folders (no subdirs) keeps it shallow & fast.
          let resolvedNames: string[] | null = null;
          if (hasOpaqueEntry && !hasSubdirs && entries.length > 0 && entries.length <= 150) {
            try {
              const info = current.dir.info();
              if (Array.isArray(info.files) && info.files.length === entries.length) {
                resolvedNames = info.files;
              }
            } catch {
              // Fall back to MIME/header detection + clean placeholder names
            }
          }

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            if (entry instanceof ExpoDirectory) {
              const cleanSubUri = normalizeSafDirUri(entry.uri);
              if (
                current.depth < MAX_SCAN_DEPTH &&
                !visitedDirUris.has(cleanSubUri) &&
                foldersScanned + queue.length < MAX_SCAN_FOLDERS
              ) {
                visitedDirUris.add(cleanSubUri);
                const resolvedDirName = resolvedNames?.[i]?.trim() || '';
                const uriLeaf = extractFilenameFromUri(cleanSubUri);
                const folderName =
                  resolvedDirName && !isOpaqueProviderName(resolvedDirName)
                    ? resolvedDirName
                    : uriLeaf && !isOpaqueProviderName(uriLeaf)
                      ? uriLeaf
                      : `Subfolder ${fallbackFolderIdx++}`;
                const nextRelative = current.relativePath
                  ? `${current.relativePath}/${folderName}`
                  : folderName;
                queue.push({
                  dir:
                    cleanSubUri === entry.uri ? entry : new ExpoDirectory(cleanSubUri),
                  relativePath: nextRelative,
                  depth: current.depth + 1,
                });
              }
              continue;
            }

            if (folderFilesFound >= MAX_SCAN_FILES) {
              hitLimit = true;
              break;
            }

            const uri = entry.uri;
            if (seenUris.has(uri)) continue;

            const resolvedName = resolvedNames?.[i]?.trim() || '';
            const uriLeaf = extractFilenameFromUri(uri);
            const candidateName =
              resolvedName && !isOpaqueProviderName(resolvedName)
                ? resolvedName
                : !isOpaqueProviderName(uriLeaf)
                  ? uriLeaf
                  : '';

            let mimeType: string | null = null;
            try {
              mimeType = entry.type ?? null;
            } catch {
              mimeType = null;
            }

            if (mimeType?.toLowerCase().startsWith('application/vnd.google-apps.')) {
              if (mimeType.toLowerCase() === 'application/vnd.google-apps.document') {
                skippedGoogleDocs++;
              }
              continue;
            }

            let format =
              (candidateName ? detectPersonalFormat(candidateName) : null) ??
              detectPersonalFormatFromMime(mimeType);

            // Google Drive frequently reports `.epub` and `.md` as `application/octet-stream`
            // or `application/zip`. Peek the first 256 bytes to catch them cleanly.
            if (
              !format &&
              !candidateName &&
              isGenericBinaryMime(mimeType) &&
              headerPeeksUsed < MAX_HEADER_PEEKS_PER_SCAN
            ) {
              headerPeeksUsed++;
              format = peekHeaderFormat(entry);
            }

            if (!format) continue;

            seenUris.add(uri);
            folderFilesFound++;
            const filename =
              candidateName || makeFallbackFilename(uri, format, fallbackFileIdx++);

            let sizeBytes = 0;
            try {
              if (typeof entry.size === 'number' && entry.size > 0) {
                sizeBytes = entry.size;
              }
            } catch {
              // Cloud SAF URIs may omit size until read
            }

            discovered.push({
              uri,
              filename,
              format,
              source: 'device_folder',
              subfolder: current.relativePath || null,
              sizeBytes,
              alreadyImportedBookId: candidateName
                ? importedByName.get(filename.toLowerCase()) ?? null
                : null,
            });
          }

          // Update live scan progress & yield to UI thread between folders
          set({
            scanProgress: {
              foldersScanned,
              filesFound: folderFilesFound,
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const notices: string[] = [];
        if (hitLimit) {
          notices.push(
            `Showing the first ${folderFilesFound} books across ${foldersScanned} folders. For massive cloud trees, link a more specific subfolder or use "Choose files".`
          );
        } else if (failedSubfolders > 0) {
          notices.push(
            `Scanned ${foldersScanned} folder${foldersScanned === 1 ? '' : 's'} (${failedSubfolders} subfolder${failedSubfolders === 1 ? '' : 's'} could not be opened).`
          );
        }
        if (skippedGoogleDocs > 0) {
          notices.push(
            `Skipped ${skippedGoogleDocs} native Google Doc${skippedGoogleDocs === 1 ? '' : 's'} (export as EPUB, PDF, or DOCX to import).`
          );
        }
        scanNotice = notices.length > 0 ? notices.join(' ') : null;
      } catch (err) {
        if (activeScanRunId !== runId) {
          return get().discoveredFiles;
        }
        const rawMsg = err instanceof Error ? err.message : '';
        const provider = providerLabelFromUri(folderUri);
        set({
          scanError: provider
            ? `Could not read ${provider} folder (${rawMsg || 'permission or connection error'}). Try tapping "Change folder" to re-link it, or use "Choose files" above to import books directly.`
            : rawMsg
              ? `Could not read connected folder: ${rawMsg}`
              : 'Could not read connected folder. Try reconnecting it.',
        });
      }
    }

    if (activeScanRunId !== runId) {
      return get().discoveredFiles;
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
          subfolder: null,
          sizeBytes,
          alreadyImportedBookId: importedByName.get(name.toLowerCase()) ?? null,
        });
      }
    } catch {
      // non-fatal
    }

    const sorted = sortDiscoveredFiles(discovered);
    set({
      discoveredFiles: sorted,
      works,
      scanning: false,
      scanProgress: null,
      scanNotice,
    });
    return sorted;
  },

  async inspectFile(file, options) {
    options?.onStage?.('downloading');
    const rawBytes = await readUriBytes(file.uri);
    options?.onStage?.('extracting');
    // Yield a frame so progress UI repaints before synchronous parsing runs
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileHash = computeContentFingerprint(rawBytes);
    const duplicateWork = await findPersonalWorkByHash(fileHash);
    const extraction = extractDocumentFromBytes(rawBytes, file.filename, file.format);
    const processed = processPersonalDocument(extraction);

    // If the source provider gave an opaque URI with a generic placeholder name,
    // upgrade the displayed/saved filename from extracted document metadata.
    let resolvedFilename = file.filename;
    if (
      isGenericPlaceholderName(file.filename) &&
      extraction.detectedMetadata.title?.trim()
    ) {
      resolvedFilename = `${extraction.detectedMetadata.title.trim()}.${extraction.format}`;
    }

    return {
      file: {
        ...file,
        filename: resolvedFilename,
        format: extraction.format,
        sizeBytes: rawBytes.byteLength,
      },
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

    // Save a local managed copy natively (fast Uint8Array write, no JS base64 loop)
    try {
      const destFile = new ExpoFile(localFilePath);
      destFile.write(inspected.rawBytes);
    } catch {
      try {
        await FileSystem.writeAsStringAsync(
          localFilePath,
          bytesToBase64(inspected.rawBytes),
          { encoding: FileSystem.EncodingType.Base64 }
        );
      } catch {
        // Non-fatal: SQLite already holds the extracted passages
      }
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

    // Mark the imported file in-memory so it flips from "New" to "In Library"
    // immediately without re-walking cloud subfolders on every book.
    set((s) => ({
      pickedFiles: s.pickedFiles.map((f) =>
        f.uri === inspected.file.uri
          ? {
              ...f,
              filename: inspected.file.filename,
              alreadyImportedBookId: saved.bookId,
            }
          : f
      ),
      discoveredFiles: s.discoveredFiles.map((f) =>
        f.uri === inspected.file.uri
          ? {
              ...f,
              filename: inspected.file.filename,
              alreadyImportedBookId: saved.bookId,
            }
          : f
      ),
    }));

    clearLibraryVectors();
    await get().refreshWorks();

    // Defer on-device embedding until a batch finishes so SQLite transactions and
    // ONNX inference never collide with active file downloads/parses.
    if (!options.deferEmbedding) {
      void get().processEmbeddingQueue();
    }
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
      set((s) => ({
        pickedFiles: s.pickedFiles.map((f) =>
          f.alreadyImportedBookId === bookId ? { ...f, alreadyImportedBookId: null } : f
        ),
        discoveredFiles: s.discoveredFiles.map((f) =>
          f.alreadyImportedBookId === bookId ? { ...f, alreadyImportedBookId: null } : f
        ),
      }));
      clearLibraryVectors();
      await get().refreshWorks();
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
