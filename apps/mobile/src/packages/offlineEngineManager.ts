/**
 * Offline Engine & Library Catalog Manager — resumable post-install downloader
 * for Resonance's locked local stack:
 *
 *   Initial Core Engine (~998 MB, one-time):
 *     1. Voyage-4-Nano INT8 ONNX (411 MB, pinned HF commit SHA + SHA-256)
 *     2. Qwen3-Reranker-0.6B INT8 Yes/No ONNX (583 MB, pinned HF commit SHA + SHA-256)
 *     3. World English Bible 512d int8 vectors (~4.2 MB, GitHub Releases)
 *
 *   Optional Church Library Catalog (browsable & downloadable per-book or per-collection):
 *     - Individual per-work `.passages.jsonl.gz` + `.vectors.rvec` files (50 KB–2 MB each)
 *       grouped into curated collections (`church-fathers`, `medieval-mystics`,
 *       `reformation-puritans`, `modern-witnesses`) in `packs-manifest.json`.
 *     - Uses batched 400-row SQLite inserts so each book installs in ~100 ms.
 *     - Editing or adding books on the `corpus-packs-latest` GitHub Release
 *       appears immediately via `syncCorpusManifest()` without shipping a new APK.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import {
  base64ToBytes,
  CORPUS_PACKS_MANIFEST_URL,
  FALLBACK_CORPUS_MANIFEST,
  gunzipBytes,
  decodeUtf8,
  OFFLINE_ENGINE_MANIFEST,
  type CatalogCollectionId,
  type CatalogWorkEntry,
  type CorpusPackManifestEntry,
  type CorpusPacksManifest,
  type DownloadArtifactSpec,
} from '@resonance/core';
import { getDatabase } from '../db/database';

// ── Paths ───────────────────────────────────────────────────────────────────

export const OFFLINE_ENGINE_ROOT = `${FileSystem.documentDirectory ?? ''}offline_engine/`;

export function localPathForArtifact(relativePath: string): string {
  return `${OFFLINE_ENGINE_ROOT}${relativePath.replace(/^\/+/, '')}`;
}

export function getEmbedderModelPaths() {
  return {
    onnxPath: localPathForArtifact('models/voyage-4-nano/model_quantized.onnx'),
    dataPath: localPathForArtifact('models/voyage-4-nano/model_quantized.onnx_data'),
    tokenizerPath: localPathForArtifact('models/voyage-4-nano/tokenizer.json'),
    tokenizerConfigPath: localPathForArtifact('models/voyage-4-nano/tokenizer_config.json'),
  };
}

export function getRerankerModelPaths() {
  return {
    onnxPath: localPathForArtifact('models/qwen3-reranker-0.6b/model_yesno_quantized.onnx'),
    tokenizerPath: localPathForArtifact('models/qwen3-reranker-0.6b/tokenizer.json'),
    tokenizerConfigPath: localPathForArtifact('models/qwen3-reranker-0.6b/tokenizer_config.json'),
  };
}

export function getPackLocalPaths(packId: string) {
  return {
    passagesPath: localPathForArtifact(`packs/${packId}.passages.jsonl.gz`),
    vectorsPath: localPathForArtifact(`packs/${packId}.vectors.rvec`),
  };
}

export function getWorkLocalPaths(slug: string) {
  return {
    passagesPath: localPathForArtifact(`works/${slug}.passages.jsonl.gz`),
    vectorsPath: localPathForArtifact(`works/${slug}.vectors.rvec`),
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export type EnginePhase =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'error';

export interface GroupProgress {
  downloadedBytes: number;
  totalBytes: number;
  ready: boolean;
}

export interface ActiveCatalogDownload {
  label: string;
  workId: string;
  currentIndex: number;
  totalWorks: number;
  bytesWritten: number;
  totalBytes: number;
  stage?: 'downloading' | 'indexing';
}

export interface OfflineEngineState {
  initialized: boolean;
  phase: EnginePhase;
  promptDismissed: boolean;
  sheetVisible: boolean;
  wifiOnly: boolean;
  corpusManifest: CorpusPacksManifest;
  manifestSyncedAt: number | null;
  manifestSyncing: boolean;
  activeArtifactLabel: string | null;
  downloadedBytes: number;
  totalBytes: number;
  groups: {
    embedder: GroupProgress;
    reranker: GroupProgress;
    corpus: GroupProgress;
  };
  installedPackIds: string[];
  installedWorkIds: string[];
  activeCatalogDownload: ActiveCatalogDownload | null;
  /** Remaining queued catalog work IDs (persisted so backgrounding/closing never loses them). */
  catalogQueueIds: string[];
  catalogError: string | null;
  /** Monotonic revision bumped whenever catalog works are installed/removed. */
  catalogRevision: number;
  errorMessage: string | null;
  onReadyListeners: Array<() => void>;

  initialize: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  syncCorpusManifest: (force?: boolean) => Promise<CorpusPacksManifest>;
  setSheetVisible: (visible: boolean) => void;
  dismissFirstLaunchPrompt: () => Promise<void>;
  setWifiOnly: (wifiOnly: boolean) => Promise<void>;
  /** Downloads core models + lightweight Bible vectors ONLY (not the 80-work Library). */
  startDownload: () => Promise<boolean>;
  pauseDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  downloadCatalogWork: (workId: string) => Promise<boolean>;
  downloadCatalogCollection: (collectionId: CatalogCollectionId) => Promise<boolean>;
  cancelCatalogDownload: () => Promise<void>;
  resumePendingDownloads: () => Promise<void>;
  handleAppStateChange: (nextState: string) => void;
  removeCatalogWork: (workId: string) => Promise<boolean>;
  removeCatalogCollection: (collectionId: CatalogCollectionId) => Promise<void>;
  removeOfflineEngine: () => Promise<void>;
  registerOnReady: (cb: () => void) => () => void;
}

// ── Internal helpers ────────────────────────────────────────────────────────

const KEY_ENGINE_AUTO_RESUME = 'offline_engine_auto_resume';
const KEY_CATALOG_QUEUE = 'catalog_download_queue_v1';
const MANIFEST_TTL_MS = 5 * 60_000;
const PROGRESS_THROTTLE_MS = 200;

let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
let pauseRequested = false;
let cancelRequested = false;
let backgroundCheckpointRequested = false;

let activeCatalogResumable: FileSystem.DownloadResumable | null = null;
let catalogWorkerRunning = false;
let catalogCancelRequested = false;
let catalogBackgroundPaused = false;

function yieldToUi(ms = 16): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureParentDir(filePath: string): Promise<void> {
  const idx = filePath.lastIndexOf('/');
  if (idx <= 0) return;
  const dir = filePath.slice(0, idx);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function getSetting(key: string): Promise<string | null> {
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

async function setSetting(key: string, value: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    await db.runAsync(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value]
    );
  } catch {
    // non-fatal
  }
}

async function upsertDownloadRow(row: {
  artifactId: string;
  groupName: string;
  url: string;
  localPath: string;
  expectedBytes: number;
  downloadedBytes: number;
  expectedSha256: string | null;
  status: string;
  resumeData?: string | null;
  error?: string | null;
}): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO offline_downloads (
         artifact_id, group_name, url, local_path, expected_bytes,
         downloaded_bytes, expected_sha256, status, resume_data, error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        row.artifactId,
        row.groupName,
        row.url,
        row.localPath,
        row.expectedBytes,
        row.downloadedBytes,
        row.expectedSha256,
        row.status,
        row.resumeData ?? null,
        row.error ?? null,
        Date.now(),
      ]
    );
  } catch {
    // non-fatal
  }
}

async function getSavedResumeData(artifactId: string): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<{ resume_data: string | null }>(
      `SELECT resume_data FROM offline_downloads WHERE artifact_id = ?;`,
      [artifactId]
    );
    return row?.resume_data ?? null;
  } catch {
    return null;
  }
}

function getCoreBiblePack(manifest: CorpusPacksManifest): CorpusPackManifestEntry | null {
  return manifest.packs.find((p) => p.kind === 'bible' || p.id === 'bible-web') ?? null;
}

function buildBibleCoreArtifacts(manifest: CorpusPacksManifest): DownloadArtifactSpec[] {
  const bible = getCoreBiblePack(manifest);
  if (!bible) return [];
  return [
    {
      id: `pack-${bible.id}-vectors`,
      group: 'corpus',
      label: 'World English Bible (512d vectors)',
      url: bible.vectorsUrl,
      relativePath: `packs/${bible.id}.vectors.rvec`,
      sizeBytes: bible.vectorsBytes,
      sha256: bible.vectorsSha256,
    },
  ];
}

async function getFileSize(path: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return 0;
    const size = (info as { size?: number }).size;
    return typeof size === 'number' ? size : 0;
  } catch {
    return 0;
  }
}

/**
 * Fast batched SQLite ingestion for a single downloaded catalog work.
 * Uses 400-row multi-value INSERTs with cooperative UI-thread yields so
 * decompression, JSONL parsing, and SQLite writes never stall taps or closing modals.
 */
async function ingestCatalogWorkIntoSqlite(work: CatalogWorkEntry): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  const { passagesPath } = getWorkLocalPaths(work.slug);
  const info = await FileSystem.getInfoAsync(passagesPath);
  if (!info.exists) return false;

  try {
    const b64 = await FileSystem.readAsStringAsync(passagesPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await yieldToUi();
    const compressed = base64ToBytes(b64);
    await yieldToUi();
    const jsonl = decodeUtf8(gunzipBytes(compressed));
    await yieldToUi();
    const lines = jsonl.split('\n');

    interface WorkPassageLine {
      division?: string | null;
      chapter?: number | null;
      chunk_index?: number;
      text: string;
    }

    const parsedRows: WorkPassageLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        parsedRows.push(JSON.parse(trimmed) as WorkPassageLine);
      } catch {
        // skip malformed line
      }
      if (i > 0 && i % 400 === 0) {
        await yieldToUi();
      }
    }

    if (parsedRows.length === 0) return false;

    const BATCH = 400;
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT OR REPLACE INTO books (id, title, author, era, package_id, type, translation, source)
         VALUES (?, ?, ?, ?, ?, 'voice', NULL, 'release_pack');`,
        [
          work.id,
          work.title,
          work.author || null,
          work.era || null,
          work.collectionId,
        ]
      );

      await db.runAsync(`DELETE FROM passages WHERE book_id = ?;`, [work.id]);

      const bookIdSql = sqlString(work.id);
      for (let start = 0; start < parsedRows.length; start += BATCH) {
        const slice = parsedRows.slice(start, start + BATCH);
        const values = slice
          .map((r, offset) => {
            const chapter = r.chapter ?? 1;
            const chunkIdx = r.chunk_index ?? start + offset;
            const divSql = r.division ? sqlString(r.division) : 'NULL';
            return `(${bookIdSql}, ${chapter}, NULL, NULL, ${sqlString(r.text)}, NULL, ${chunkIdx}, ${divSql})`;
          })
          .join(', ');
        await db.execAsync(
          `INSERT INTO passages (book_id, chapter, verse_start, verse_end, text, translation, chunk_id, division) VALUES ${values};`
        );
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO installed_packages (package_id, version, model_id, installed_at)
         VALUES (?, ?, ?, ?);`,
        [`work:${work.id}`, '1.0.0', 'voyage-4-nano', Date.now()]
      );
    });
    await yieldToUi();

    return true;
  } catch {
    return false;
  }
}

async function deleteCatalogWorkFromSqliteAndDisk(work: CatalogWorkEntry): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM passages WHERE book_id = ?;`, [work.id]);
      await db.runAsync(`DELETE FROM books WHERE id = ?;`, [work.id]);
      await db.runAsync(`DELETE FROM installed_packages WHERE package_id = ?;`, [
        `work:${work.id}`,
      ]);
    });
    const { passagesPath, vectorsPath } = getWorkLocalPaths(work.slug);
    for (const p of [passagesPath, vectorsPath]) {
      try {
        const info = await FileSystem.getInfoAsync(p);
        if (info.exists) await FileSystem.deleteAsync(p, { idempotent: true });
      } catch {
        // non-fatal
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ── Zustand Store ───────────────────────────────────────────────────────────

function computeCoreGroups(manifest: CorpusPacksManifest) {
  const embedderTotal = OFFLINE_ENGINE_MANIFEST.modelArtifacts
    .filter((a) => a.group === 'embedder')
    .reduce((acc, a) => acc + a.sizeBytes, 0);
  const rerankerTotal = OFFLINE_ENGINE_MANIFEST.modelArtifacts
    .filter((a) => a.group === 'reranker')
    .reduce((acc, a) => acc + a.sizeBytes, 0);
  const corpusTotal = buildBibleCoreArtifacts(manifest).reduce(
    (acc, a) => acc + a.sizeBytes,
    0
  );
  return {
    embedder: { downloadedBytes: 0, totalBytes: embedderTotal, ready: false },
    reranker: { downloadedBytes: 0, totalBytes: rerankerTotal, ready: false },
    corpus: { downloadedBytes: 0, totalBytes: corpusTotal, ready: false },
  };
}

export const useOfflineEngineStore = create<OfflineEngineState>((set, get) => {
  const initialGroups = computeCoreGroups(FALLBACK_CORPUS_MANIFEST);
  const initialTotal =
    initialGroups.embedder.totalBytes +
    initialGroups.reranker.totalBytes +
    initialGroups.corpus.totalBytes;

  return {
    initialized: false,
    phase: 'not_installed',
    promptDismissed: false,
    sheetVisible: false,
    wifiOnly: true,
    corpusManifest: FALLBACK_CORPUS_MANIFEST,
    manifestSyncedAt: null,
    manifestSyncing: false,
    activeArtifactLabel: null,
    downloadedBytes: 0,
    totalBytes: initialTotal,
    groups: initialGroups,
    installedPackIds: [],
    installedWorkIds: [],
    activeCatalogDownload: null,
    catalogQueueIds: [],
    catalogError: null,
    catalogRevision: 0,
    errorMessage: null,
    onReadyListeners: [],

    registerOnReady(cb) {
      set((s) => ({ onReadyListeners: [...s.onReadyListeners, cb] }));
      const st = get();
      if (st.phase === 'ready' || st.groups.embedder.ready) {
        void Promise.resolve().then(() => {
          try {
            cb();
          } catch {
            // isolate listener errors
          }
        });
      }
      return () => {
        set((s) => ({
          onReadyListeners: s.onReadyListeners.filter((fn) => fn !== cb),
        }));
      };
    },

    setSheetVisible(visible) {
      set({ sheetVisible: visible });
    },

    async dismissFirstLaunchPrompt() {
      set({ promptDismissed: true, sheetVisible: false });
      await setSetting('offline_engine_prompt_dismissed', 'true');
    },

    async setWifiOnly(wifiOnly) {
      set({ wifiOnly });
      await setSetting('offline_engine_wifi_only', wifiOnly ? 'true' : 'false');
    },

    async initialize() {
      if (get().initialized) return;
      const [dismissedVal, wifiVal, cachedManifestRaw, savedQueueRaw] = await Promise.all([
        getSetting('offline_engine_prompt_dismissed'),
        getSetting('offline_engine_wifi_only'),
        getSetting('corpus_manifest_cache'),
        getSetting(KEY_CATALOG_QUEUE),
      ]);

      let corpusManifest = FALLBACK_CORPUS_MANIFEST;
      if (cachedManifestRaw) {
        try {
          const parsed = JSON.parse(cachedManifestRaw) as CorpusPacksManifest;
          if (parsed && Array.isArray(parsed.packs)) {
            corpusManifest = parsed;
          }
        } catch {
          // keep fallback
        }
      }

      let savedQueueIds: string[] = [];
      if (savedQueueRaw) {
        try {
          const parsed = JSON.parse(savedQueueRaw) as unknown;
          if (Array.isArray(parsed)) {
            savedQueueIds = parsed.filter((x): x is string => typeof x === 'string');
          }
        } catch {
          // ignore malformed queue
        }
      }

      set({
        promptDismissed: dismissedVal === 'true',
        wifiOnly: wifiVal === null ? true : wifiVal === 'true',
        corpusManifest,
        catalogQueueIds: savedQueueIds,
        initialized: true,
      });

      await get().refreshStatus();

      // Non-blocking first-launch sheet: invites core engine download once
      const state = get();
      if (state.phase === 'not_installed' && !state.promptDismissed) {
        set({ sheetVisible: true });
      }

      // Automatically resume any interrupted engine or catalog downloads in background
      void get().resumePendingDownloads();
    },

    async syncCorpusManifest(force = false) {
      const state = get();
      if (state.manifestSyncing) return state.corpusManifest;
      // Avoid redundant network + 85-file disk scans when modal is reopened quickly
      if (
        !force &&
        state.manifestSyncedAt !== null &&
        Date.now() - state.manifestSyncedAt < MANIFEST_TTL_MS &&
        (state.corpusManifest.works?.length ?? 0) > 0
      ) {
        return state.corpusManifest;
      }

      set({ manifestSyncing: true, catalogError: null });
      try {
        const res = await fetch(CORPUS_PACKS_MANIFEST_URL, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          if (res.status === 404) {
            set({
              catalogError:
                'Library packs are still publishing on GitHub Releases — check back in a few minutes and tap Refresh.',
            });
          }
          return get().corpusManifest;
        }
        const remote = (await res.json()) as CorpusPacksManifest;
        if (remote && Array.isArray(remote.packs)) {
          set({
            corpusManifest: remote,
            manifestSyncedAt: Date.now(),
            catalogError: null,
          });
          await setSetting('corpus_manifest_cache', JSON.stringify(remote));
          // Avoid 85-file disk scan while a catalog download is actively streaming
          if (!catalogWorkerRunning) {
            await get().refreshStatus();
          }
          return remote;
        }
      } catch {
        set({
          catalogError:
            'Could not reach GitHub Releases right now. Showing last known catalog.',
        });
      } finally {
        set({ manifestSyncing: false });
      }
      return get().corpusManifest;
    },

    async refreshStatus() {
      const manifest = get().corpusManifest;
      const modelArtifacts = OFFLINE_ENGINE_MANIFEST.modelArtifacts;
      const bibleArtifacts = buildBibleCoreArtifacts(manifest);

      const groupStats = {
        embedder: { downloadedBytes: 0, totalBytes: 0, ready: true },
        reranker: { downloadedBytes: 0, totalBytes: 0, ready: true },
        corpus: { downloadedBytes: 0, totalBytes: 0, ready: bibleArtifacts.length === 0 },
      };

      for (const art of [...modelArtifacts, ...bibleArtifacts]) {
        const localPath = localPathForArtifact(art.relativePath);
        const size = await getFileSize(localPath);
        const g = groupStats[art.group];
        g.totalBytes += art.sizeBytes;
        const clamped = art.sizeBytes > 0 ? Math.min(size, art.sizeBytes) : size;
        g.downloadedBytes += clamped;
        const complete = art.sizeBytes > 0 ? size >= art.sizeBytes * 0.99 : size > 0;
        if (!complete) g.ready = false;
      }

      const installedPackIds: string[] = [];
      for (const pack of manifest.packs) {
        const { vectorsPath } = getPackLocalPaths(pack.id);
        const vSize = await getFileSize(vectorsPath);
        if (vSize > 0) installedPackIds.push(pack.id);
      }

      const installedWorkIds: string[] = [];
      for (const work of manifest.works ?? []) {
        const { vectorsPath } = getWorkLocalPaths(work.slug);
        const vSize = await getFileSize(vectorsPath);
        if (vSize > 0) installedWorkIds.push(work.id);
      }

      // Also check SQLite `books` for installed release_pack works
      const db = getDatabase();
      if (db) {
        try {
          const rows = await db.getAllAsync<{ id: string }>(
            `SELECT id FROM books WHERE source = 'release_pack';`
          );
          for (const r of rows) {
            if (!installedWorkIds.includes(r.id)) installedWorkIds.push(r.id);
          }
        } catch {
          // ignore
        }
      }

      const downloadedBytes =
        groupStats.embedder.downloadedBytes +
        groupStats.reranker.downloadedBytes +
        groupStats.corpus.downloadedBytes;
      const totalBytes =
        groupStats.embedder.totalBytes +
        groupStats.reranker.totalBytes +
        groupStats.corpus.totalBytes;

      const prevEmbedderReady = get().groups.embedder.ready;
      const modelsReady = groupStats.embedder.ready && groupStats.reranker.ready;
      const curPhase = get().phase;
      const nextPhase: EnginePhase =
        curPhase === 'downloading'
          ? curPhase
          : modelsReady
            ? 'ready'
            : downloadedBytes > 0
              ? 'paused'
              : 'not_installed';

      set({
        groups: groupStats,
        downloadedBytes,
        totalBytes,
        installedPackIds,
        installedWorkIds,
        phase: nextPhase,
      });

      if (
        (groupStats.embedder.ready && !prevEmbedderReady) ||
        (nextPhase === 'ready' && curPhase !== 'ready')
      ) {
        for (const cb of get().onReadyListeners) {
          try {
            cb();
          } catch {
            // isolate listener errors
          }
        }
      }
    },

    /**
     * Core Offline Engine download: downloads ONLY Voyage-4-Nano (411 MB) +
     * Qwen3-Reranker-0.6B (583 MB) + lightweight Bible vectors (~4.2 MB).
     * Persists auto-resume intent so closing the sheet or backgrounding the app
     * seamlessly continues / resumes until complete.
     */
    async startDownload() {
      if (get().phase === 'downloading') return true;

      pauseRequested = false;
      cancelRequested = false;
      backgroundCheckpointRequested = false;
      set({ phase: 'downloading', errorMessage: null });
      await setSetting(KEY_ENGINE_AUTO_RESUME, 'true');

      // Best-effort refresh so bible-web URL/SHA is current if published
      await get().syncCorpusManifest();

      const manifest = get().corpusManifest;
      const artifacts: DownloadArtifactSpec[] = [
        ...OFFLINE_ENGINE_MANIFEST.modelArtifacts,
        ...buildBibleCoreArtifacts(manifest),
      ];

      const perArtifactBytes = new Map<string, number>();
      for (const art of artifacts) {
        const localPath = localPathForArtifact(art.relativePath);
        const existing = await getFileSize(localPath);
        perArtifactBytes.set(
          art.id,
          art.sizeBytes > 0 ? Math.min(existing, art.sizeBytes) : existing
        );
      }

      let embedderReadyNotified = get().groups.embedder.ready;
      let lastEmitAt = 0;
      const emitProgress = (activeLabel: string | null, force = false) => {
        const now = Date.now();
        if (!force && now - lastEmitAt < PROGRESS_THROTTLE_MS) return;
        lastEmitAt = now;
        const groups = {
          embedder: { downloadedBytes: 0, totalBytes: 0, ready: true },
          reranker: { downloadedBytes: 0, totalBytes: 0, ready: true },
          corpus: { downloadedBytes: 0, totalBytes: 0, ready: true },
        };
        for (const art of artifacts) {
          const dl = perArtifactBytes.get(art.id) ?? 0;
          const g = groups[art.group];
          g.downloadedBytes += dl;
          g.totalBytes += art.sizeBytes;
          if (art.sizeBytes > 0 && dl < art.sizeBytes * 0.99) g.ready = false;
        }
        set({
          activeArtifactLabel: activeLabel,
          groups,
          downloadedBytes:
            groups.embedder.downloadedBytes +
            groups.reranker.downloadedBytes +
            groups.corpus.downloadedBytes,
          totalBytes:
            groups.embedder.totalBytes +
            groups.reranker.totalBytes +
            groups.corpus.totalBytes,
        });
        if (!embedderReadyNotified && groups.embedder.ready) {
          embedderReadyNotified = true;
          for (const cb of get().onReadyListeners) {
            try {
              cb();
            } catch {
              // isolate listener errors
            }
          }
        }
      };

      emitProgress('Checking existing files…', true);

      for (const art of artifacts) {
        if (pauseRequested || cancelRequested || backgroundCheckpointRequested) break;

        const localPath = localPathForArtifact(art.relativePath);
        const existingSize = await getFileSize(localPath);
        if (art.sizeBytes > 0 && existingSize >= art.sizeBytes * 0.99) {
          perArtifactBytes.set(art.id, art.sizeBytes);
          emitProgress(art.label, true);
          continue;
        }

        await ensureParentDir(localPath);
        emitProgress(art.label, true);

        const savedResume = await getSavedResumeData(art.id);
        await upsertDownloadRow({
          artifactId: art.id,
          groupName: art.group,
          url: art.url,
          localPath,
          expectedBytes: art.sizeBytes,
          downloadedBytes: existingSize,
          expectedSha256: art.sha256,
          status: 'downloading',
          resumeData: savedResume,
        });

        try {
          const resumable = FileSystem.createDownloadResumable(
            art.url,
            localPath,
            {},
            (progress) => {
              const written = progress.totalBytesWritten;
              perArtifactBytes.set(
                art.id,
                art.sizeBytes > 0 ? Math.min(written, art.sizeBytes) : written
              );
              emitProgress(art.label);
            },
            savedResume ?? undefined
          );
          activeDownloadResumable = resumable;

          const result = savedResume
            ? await resumable.resumeAsync()
            : await resumable.downloadAsync();
          activeDownloadResumable = null;

          if (pauseRequested || cancelRequested || backgroundCheckpointRequested) break;

          if (!result || (result.status !== 200 && result.status !== 206)) {
            if (art.group === 'corpus') {
              await upsertDownloadRow({
                artifactId: art.id,
                groupName: art.group,
                url: art.url,
                localPath,
                expectedBytes: art.sizeBytes,
                downloadedBytes: 0,
                expectedSha256: art.sha256,
                status: 'unavailable',
                error: `HTTP ${result?.status ?? 'network error'}`,
              });
              continue;
            }
            throw new Error(`Failed downloading ${art.label} (HTTP ${result?.status ?? 'error'})`);
          }

          const finalSize = await getFileSize(localPath);
          perArtifactBytes.set(
            art.id,
            art.sizeBytes > 0 ? Math.min(finalSize, art.sizeBytes) : finalSize
          );
          await upsertDownloadRow({
            artifactId: art.id,
            groupName: art.group,
            url: art.url,
            localPath,
            expectedBytes: art.sizeBytes,
            downloadedBytes: finalSize,
            expectedSha256: art.sha256,
            status: 'complete',
            resumeData: null,
          });
          emitProgress(art.label, true);
        } catch (err) {
          activeDownloadResumable = null;
          if (backgroundCheckpointRequested) {
            // Keep KEY_ENGINE_AUTO_RESUME='true' so returning to foreground resumes automatically
            set({ phase: 'paused', activeArtifactLabel: null });
            return false;
          }
          if (pauseRequested) {
            set({ phase: 'paused', activeArtifactLabel: null });
            return false;
          }
          if (cancelRequested) {
            set({ phase: 'not_installed', activeArtifactLabel: null });
            return false;
          }
          const msg = err instanceof Error ? err.message : 'Download interrupted';
          await upsertDownloadRow({
            artifactId: art.id,
            groupName: art.group,
            url: art.url,
            localPath,
            expectedBytes: art.sizeBytes,
            downloadedBytes: perArtifactBytes.get(art.id) ?? 0,
            expectedSha256: art.sha256,
            status: 'paused',
            error: msg,
          });
          // Keep auto-resume enabled so transient background socket drops recover on foreground
          set({ phase: 'paused', errorMessage: msg, activeArtifactLabel: null });
          return false;
        }
      }

      if (backgroundCheckpointRequested) {
        set({ phase: 'paused', activeArtifactLabel: null });
        return false;
      }
      if (pauseRequested) {
        set({ phase: 'paused', activeArtifactLabel: null });
        return false;
      }
      if (cancelRequested) {
        set({ phase: 'not_installed', activeArtifactLabel: null });
        return false;
      }

      await setSetting(KEY_ENGINE_AUTO_RESUME, 'false');
      set({ phase: 'ready', activeArtifactLabel: null, promptDismissed: true });
      await get().refreshStatus();
      await setSetting('offline_engine_prompt_dismissed', 'true');

      if (get().phase === 'ready') {
        for (const cb of get().onReadyListeners) {
          try {
            cb();
          } catch {
            // isolate listener errors
          }
        }
        return true;
      }
      return false;
    },

    async pauseDownload() {
      pauseRequested = true;
      await setSetting(KEY_ENGINE_AUTO_RESUME, 'false');
      if (activeDownloadResumable) {
        try {
          const savable = await activeDownloadResumable.pauseAsync();
          const resumeJson = JSON.stringify(savable);
          const db = getDatabase();
          if (db) {
            await db.runAsync(
              `UPDATE offline_downloads SET status = 'paused', resume_data = ?, updated_at = ?
               WHERE status = 'downloading';`,
              [resumeJson, Date.now()]
            );
          }
        } catch {
          // ignore
        }
        activeDownloadResumable = null;
      }
      set({ phase: 'paused', activeArtifactLabel: null });
    },

    async cancelDownload() {
      cancelRequested = true;
      await setSetting(KEY_ENGINE_AUTO_RESUME, 'false');
      if (activeDownloadResumable) {
        try {
          await activeDownloadResumable.pauseAsync();
        } catch {
          // ignore
        }
        activeDownloadResumable = null;
      }
      set({ phase: 'not_installed', activeArtifactLabel: null });
    },

    // ── Optional Per-Book & Per-Collection Catalog Downloads (Persisted Queue) ──

    async downloadCatalogWork(workId: string) {
      const works = get().corpusManifest.works ?? [];
      const work = works.find((w) => w.id === workId);
      if (!work) {
        set({ catalogError: 'Book not found in catalog. Tap Refresh to sync.' });
        return false;
      }
      const existing = get().catalogQueueIds;
      const nextQueue = existing.includes(workId) ? existing : [...existing, workId];
      set({ catalogQueueIds: nextQueue, catalogError: null });
      await setSetting(KEY_CATALOG_QUEUE, JSON.stringify(nextQueue));
      return drainCatalogQueue(get, set);
    },

    async downloadCatalogCollection(collectionId: CatalogCollectionId) {
      const works = (get().corpusManifest.works ?? []).filter(
        (w) => w.collectionId === collectionId
      );
      const installed = new Set(get().installedWorkIds);
      const remainingIds = works
        .filter((w) => !installed.has(w.id))
        .map((w) => w.id);
      if (remainingIds.length === 0) return true;

      const existingSet = new Set(get().catalogQueueIds);
      const nextQueue = [...get().catalogQueueIds];
      for (const id of remainingIds) {
        if (!existingSet.has(id)) {
          existingSet.add(id);
          nextQueue.push(id);
        }
      }

      set({ catalogQueueIds: nextQueue, catalogError: null });
      await setSetting(KEY_CATALOG_QUEUE, JSON.stringify(nextQueue));
      return drainCatalogQueue(get, set);
    },

    async cancelCatalogDownload() {
      catalogCancelRequested = true;
      catalogBackgroundPaused = false;
      if (activeCatalogResumable) {
        try {
          await activeCatalogResumable.pauseAsync();
        } catch {
          // ignore
        }
        activeCatalogResumable = null;
      }
      set({ activeCatalogDownload: null, catalogQueueIds: [] });
      await setSetting(KEY_CATALOG_QUEUE, '[]');
    },

    async resumePendingDownloads() {
      const state = get();
      // 1. Resume core engine download if it was active before background/restart
      const engineAutoResume = await getSetting(KEY_ENGINE_AUTO_RESUME);
      if (
        engineAutoResume === 'true' &&
        state.phase !== 'ready' &&
        state.phase !== 'downloading'
      ) {
        void get().startDownload();
      }

      // 2. Resume persisted catalog book/collection download queue
      const queue = get().catalogQueueIds;
      if (queue.length > 0 && !catalogWorkerRunning) {
        if ((get().corpusManifest.works?.length ?? 0) === 0) {
          await get().syncCorpusManifest();
        }
        void drainCatalogQueue(get, set);
      }
    },

    handleAppStateChange(nextState: string) {
      if (nextState === 'background') {
        // Checkpoint active engine resumable without disabling auto-resume
        if (activeDownloadResumable) {
          backgroundCheckpointRequested = true;
          const res = activeDownloadResumable;
          void res
            .pauseAsync()
            .then(async (savable) => {
              const db = getDatabase();
              if (db) {
                await db.runAsync(
                  `UPDATE offline_downloads SET status = 'paused', resume_data = ?, updated_at = ?
                   WHERE status = 'downloading';`,
                  [JSON.stringify(savable), Date.now()]
                );
              }
            })
            .catch(() => {});
        }
        // Let catalog downloads know background interruption should preserve queue
        if (catalogWorkerRunning) {
          catalogBackgroundPaused = true;
        }
      } else if (nextState === 'active') {
        backgroundCheckpointRequested = false;
        catalogBackgroundPaused = false;
        void get().resumePendingDownloads();
      }
    },

    async removeCatalogWork(workId: string) {
      const work = (get().corpusManifest.works ?? []).find((w) => w.id === workId);
      if (!work) return false;
      const ok = await deleteCatalogWorkFromSqliteAndDisk(work);
      set((s) => ({
        installedWorkIds: s.installedWorkIds.filter((id) => id !== workId),
        catalogRevision: s.catalogRevision + 1,
      }));
      return ok;
    },

    async removeCatalogCollection(collectionId: CatalogCollectionId) {
      const works = (get().corpusManifest.works ?? []).filter(
        (w) => w.collectionId === collectionId
      );
      const removedIds = new Set<string>();
      for (const w of works) {
        await deleteCatalogWorkFromSqliteAndDisk(w);
        removedIds.add(w.id);
        await yieldToUi();
      }
      set((s) => ({
        installedWorkIds: s.installedWorkIds.filter((id) => !removedIds.has(id)),
        catalogRevision: s.catalogRevision + 1,
      }));
    },

    async removeOfflineEngine() {
      await get().cancelDownload();
      await get().cancelCatalogDownload();
      try {
        const info = await FileSystem.getInfoAsync(OFFLINE_ENGINE_ROOT);
        if (info.exists) {
          await FileSystem.deleteAsync(OFFLINE_ENGINE_ROOT, { idempotent: true });
        }
      } catch {
        // non-fatal
      }
      const db = getDatabase();
      if (db) {
        try {
          await db.runAsync(`DELETE FROM offline_downloads;`);
          await db.runAsync(
            `DELETE FROM passages WHERE book_id IN (SELECT id FROM books WHERE source = 'release_pack');`
          );
          await db.runAsync(`DELETE FROM books WHERE source = 'release_pack';`);
        } catch {
          // ignore
        }
      }
      await get().refreshStatus();
      set((s) => ({ catalogRevision: s.catalogRevision + 1 }));
    },
  };
});

async function drainCatalogQueue(
  get: () => OfflineEngineState,
  set: (
    partial:
      | Partial<OfflineEngineState>
      | ((s: OfflineEngineState) => Partial<OfflineEngineState>)
  ) => void
): Promise<boolean> {
  if (catalogWorkerRunning) return true;
  catalogWorkerRunning = true;
  catalogCancelRequested = false;

  let anyInstalled = false;
  let completedCount = 0;

  try {
    while (true) {
      if (catalogCancelRequested) break;
      const queue = get().catalogQueueIds;
      if (queue.length === 0) break;

      const workId = queue[0];
      const totalWorks = completedCount + queue.length;
      const currentIndex = completedCount + 1;

      const works = get().corpusManifest.works ?? [];
      const work = works.find((w) => w.id === workId);

      // Skip unknown or already-installed works
      if (!work || get().installedWorkIds.includes(workId)) {
        const rest = get().catalogQueueIds.filter((id) => id !== workId);
        set({ catalogQueueIds: rest });
        await setSetting(KEY_CATALOG_QUEUE, JSON.stringify(rest));
        continue;
      }

      const result = await downloadSingleWorkInternal(
        work,
        currentIndex,
        totalWorks,
        set
      );

      if (catalogCancelRequested) break;

      if (result === 'ok') {
        anyInstalled = true;
        completedCount += 1;
        const rest = get().catalogQueueIds.filter((id) => id !== workId);
        set((s) => ({
          catalogQueueIds: rest,
          installedWorkIds: s.installedWorkIds.includes(workId)
            ? s.installedWorkIds
            : [...s.installedWorkIds, workId],
          catalogRevision: s.catalogRevision + 1,
        }));
        await setSetting(KEY_CATALOG_QUEUE, JSON.stringify(rest));
        await yieldToUi();
      } else if (result === 'interrupted') {
        // Network/background socket drop — keep queue persisted so foreground resumes it!
        break;
      } else {
        // Permanent error (e.g. 404 or corrupt) — pop this work and continue queue
        const rest = get().catalogQueueIds.filter((id) => id !== workId);
        set({ catalogQueueIds: rest });
        await setSetting(KEY_CATALOG_QUEUE, JSON.stringify(rest));
      }
    }
  } finally {
    catalogWorkerRunning = false;
    set({ activeCatalogDownload: null });
  }

  return anyInstalled;
}

async function downloadSingleWorkInternal(
  work: CatalogWorkEntry,
  currentIndex: number,
  totalWorks: number,
  set: (partial: Partial<OfflineEngineState>) => void
): Promise<'ok' | 'interrupted' | 'failed'> {
  const { passagesPath, vectorsPath } = getWorkLocalPaths(work.slug);
  const totalBytes = work.passagesBytes + work.vectorsBytes;
  let baseBytes = 0;

  const files: Array<{ url: string; dest: string; size: number }> = [
    { url: work.passagesUrl, dest: passagesPath, size: work.passagesBytes },
    { url: work.vectorsUrl, dest: vectorsPath, size: work.vectorsBytes },
  ];

  set({
    activeCatalogDownload: {
      label: work.title,
      workId: work.id,
      currentIndex,
      totalWorks,
      bytesWritten: 0,
      totalBytes,
      stage: 'downloading',
    },
  });

  let lastEmitAt = 0;

  for (const f of files) {
    if (catalogCancelRequested) return 'interrupted';

    // Reuse file already on disk if complete (e.g. passages downloaded before backgrounding)
    const existingSize = await getFileSize(f.dest);
    if (f.size > 0 && existingSize >= f.size * 0.99) {
      baseBytes += f.size;
      continue;
    }

    await ensureParentDir(f.dest);
    try {
      const dl = FileSystem.createDownloadResumable(
        f.url,
        f.dest,
        {},
        (p) => {
          const now = Date.now();
          if (now - lastEmitAt < PROGRESS_THROTTLE_MS) return;
          lastEmitAt = now;
          set({
            activeCatalogDownload: {
              label: work.title,
              workId: work.id,
              currentIndex,
              totalWorks,
              bytesWritten: Math.min(totalBytes, baseBytes + p.totalBytesWritten),
              totalBytes,
              stage: 'downloading',
            },
          });
        }
      );
      activeCatalogResumable = dl;
      const res = await dl.downloadAsync();
      activeCatalogResumable = null;

      if (catalogCancelRequested) return 'interrupted';
      if (!res || (res.status !== 200 && res.status !== 206)) {
        const hint =
          res?.status === 404
            ? `"${work.title}" is still publishing on GitHub Releases — tap Refresh in a few minutes.`
            : `Could not download "${work.title}" (HTTP ${res?.status ?? 'network error'}).`;
        set({ catalogError: hint });
        return res?.status === 404 ? 'failed' : 'interrupted';
      }
      baseBytes += f.size;
    } catch (err) {
      activeCatalogResumable = null;
      if (catalogCancelRequested || catalogBackgroundPaused) {
        return 'interrupted';
      }
      set({
        catalogError:
          err instanceof Error
            ? err.message
            : `Download paused for "${work.title}" — will resume when back online.`,
      });
      return 'interrupted';
    }
  }

  set({
    activeCatalogDownload: {
      label: work.title,
      workId: work.id,
      currentIndex,
      totalWorks,
      bytesWritten: totalBytes,
      totalBytes,
      stage: 'indexing',
    },
  });
  await yieldToUi();

  const ok = await ingestCatalogWorkIntoSqlite(work);
  if (!ok) {
    set({
      catalogError: `Downloaded "${work.title}" but could not index its passages.`,
    });
    return 'failed';
  }
  return 'ok';
}

