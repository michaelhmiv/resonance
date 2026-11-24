/**
 * Offline Engine Manager — resumable post-install downloader & verifier for
 * Resonance's locked local stack:
 *   1. Voyage-4-Nano INT8 ONNX (411 MB, pinned HF commit SHA + SHA-256)
 *   2. Qwen3-Reranker-0.6B INT8 Yes/No ONNX (583 MB, pinned HF commit SHA + SHA-256)
 *   3. Editable GitHub Releases Corpus Packs (~82 MB, 512d int8 .rvec + .jsonl.gz)
 *
 * Downloads run via `expo-file-system/legacy` `createDownloadResumable` with
 * resume state persisted in SQLite `offline_downloads`. The user can pause,
 * resume, or keep journaling while downloads run in the background.
 *
 * Editable Releases:
 *   `syncCorpusManifest()` fetches `packs-manifest.json` from the editable
 *   `corpus-packs-latest` GitHub Release. Updating or adding packs on GitHub
 *   Releases surfaces immediately in Settings without shipping a new APK.
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

// ── Types ───────────────────────────────────────────────────────────────────

export type EnginePhase =
  | 'not_installed'
  | 'downloading'
  | 'paused'
  | 'installing_packs'
  | 'ready'
  | 'error';

export interface GroupProgress {
  downloadedBytes: number;
  totalBytes: number;
  ready: boolean;
}

export interface OfflineEngineState {
  initialized: boolean;
  phase: EnginePhase;
  promptDismissed: boolean;
  sheetVisible: boolean;
  wifiOnly: boolean;
  corpusManifest: CorpusPacksManifest;
  manifestSyncedAt: number | null;
  activeArtifactLabel: string | null;
  downloadedBytes: number;
  totalBytes: number;
  groups: {
    embedder: GroupProgress;
    reranker: GroupProgress;
    corpus: GroupProgress;
  };
  installedPackIds: string[];
  errorMessage: string | null;
  onReadyListeners: Array<() => void>;

  initialize: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  syncCorpusManifest: () => Promise<CorpusPacksManifest>;
  setSheetVisible: (visible: boolean) => void;
  dismissFirstLaunchPrompt: () => Promise<void>;
  setWifiOnly: (wifiOnly: boolean) => Promise<void>;
  startDownload: (options?: { includeCorpusPacks?: boolean }) => Promise<boolean>;
  pauseDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  downloadCorpusPack: (packId: string) => Promise<boolean>;
  removeOfflineEngine: () => Promise<void>;
  registerOnReady: (cb: () => void) => () => void;
}

// ── Internal helpers ────────────────────────────────────────────────────────

let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
let pauseRequested = false;
let cancelRequested = false;

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

function buildPackArtifacts(pack: CorpusPackManifestEntry): DownloadArtifactSpec[] {
  return [
    {
      id: `pack-${pack.id}-passages`,
      group: 'corpus',
      label: `${pack.label} (text)`,
      url: pack.passagesUrl,
      relativePath: `packs/${pack.id}.passages.jsonl.gz`,
      sizeBytes: pack.passagesBytes,
      sha256: pack.passagesSha256,
    },
    {
      id: `pack-${pack.id}-vectors`,
      group: 'corpus',
      label: `${pack.label} (512d vectors)`,
      url: pack.vectorsUrl,
      relativePath: `packs/${pack.id}.vectors.rvec`,
      sizeBytes: pack.vectorsBytes,
      sha256: pack.vectorsSha256,
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
 * Ingest a downloaded `.passages.jsonl.gz` corpus pack into SQLite `books` +
 * `passages` + `installed_packages` so the texts are immediately browsable in
 * the Library and mapped to their `.vectors.rvec` rows.
 */
async function ingestDownloadedPackIntoSqlite(
  pack: CorpusPackManifestEntry
): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;
  const { passagesPath } = getPackLocalPaths(pack.id);
  const info = await FileSystem.getInfoAsync(passagesPath);
  if (!info.exists) return false;

  try {
    const b64 = await FileSystem.readAsStringAsync(passagesPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const compressed = base64ToBytes(b64);
    const jsonl = decodeUtf8(gunzipBytes(compressed));
    const lines = jsonl.split('\n');

    interface PackPassageLine {
      work_id: string;
      title?: string;
      author?: string;
      era?: string;
      package_id?: string;
      division?: string | null;
      chapter?: number | null;
      chunk_index?: number;
      text: string;
      source?: string;
    }

    const seenBooks = new Set<string>();
    const parsedRows: PackPassageLine[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsedRows.push(JSON.parse(trimmed) as PackPassageLine);
      } catch {
        // skip malformed line
      }
    }

    // Only write non-Bible voice works to SQLite `books`/`passages` (Bible is
    // already bundled in `seedBundledScripture`; its `.rvec` stays on disk).
    if (pack.kind !== 'bible' && parsedRows.length > 0) {
      await db.withTransactionAsync(async () => {
        for (const r of parsedRows) {
          if (!seenBooks.has(r.work_id)) {
            seenBooks.add(r.work_id);
            await db.runAsync(
              `INSERT OR IGNORE INTO books (id, title, author, era, package_id, type, translation, source)
               VALUES (?, ?, ?, ?, ?, 'voice', NULL, ?);`,
              [
                r.work_id,
                r.title ?? r.work_id.replace(/[_-]+/g, ' '),
                r.author ?? null,
                r.era ?? null,
                r.package_id ?? pack.id,
                r.source ?? 'release_pack',
              ]
            );
          }
          await db.runAsync(
            `INSERT INTO passages (book_id, chapter, verse_start, verse_end, text, translation, chunk_id, division)
             VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?);`,
            [
              r.work_id,
              r.chapter ?? 1,
              r.text,
              r.chunk_index ?? 0,
              r.division ?? null,
            ]
          );
        }
      });
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO installed_packages (package_id, version, model_id, installed_at)
       VALUES (?, ?, ?, ?);`,
      [pack.id, pack.version, pack.modelId, Date.now()]
    );
    return true;
  } catch {
    return false;
  }
}

// ── Zustand Store ───────────────────────────────────────────────────────────

function computeEmptyGroups() {
  const embedderTotal = OFFLINE_ENGINE_MANIFEST.modelArtifacts
    .filter((a) => a.group === 'embedder')
    .reduce((acc, a) => acc + a.sizeBytes, 0);
  const rerankerTotal = OFFLINE_ENGINE_MANIFEST.modelArtifacts
    .filter((a) => a.group === 'reranker')
    .reduce((acc, a) => acc + a.sizeBytes, 0);
  const corpusTotal = FALLBACK_CORPUS_MANIFEST.packs.reduce(
    (acc, p) => acc + p.passagesBytes + p.vectorsBytes,
    0
  );
  return {
    embedder: { downloadedBytes: 0, totalBytes: embedderTotal, ready: false },
    reranker: { downloadedBytes: 0, totalBytes: rerankerTotal, ready: false },
    corpus: { downloadedBytes: 0, totalBytes: corpusTotal, ready: false },
  };
}

export const useOfflineEngineStore = create<OfflineEngineState>((set, get) => {
  const initialGroups = computeEmptyGroups();
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
    activeArtifactLabel: null,
    downloadedBytes: 0,
    totalBytes: initialTotal,
    groups: initialGroups,
    installedPackIds: [],
    errorMessage: null,
    onReadyListeners: [],

    registerOnReady(cb) {
      set((s) => ({ onReadyListeners: [...s.onReadyListeners, cb] }));
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
      const [dismissedVal, wifiVal, cachedManifestRaw] = await Promise.all([
        getSetting('offline_engine_prompt_dismissed'),
        getSetting('offline_engine_wifi_only'),
        getSetting('corpus_manifest_cache'),
      ]);

      let corpusManifest = FALLBACK_CORPUS_MANIFEST;
      if (cachedManifestRaw) {
        try {
          const parsed = JSON.parse(cachedManifestRaw) as CorpusPacksManifest;
          if (parsed && Array.isArray(parsed.packs) && parsed.packs.length > 0) {
            corpusManifest = parsed;
          }
        } catch {
          // keep fallback
        }
      }

      set({
        promptDismissed: dismissedVal === 'true',
        wifiOnly: wifiVal === null ? true : wifiVal === 'true',
        corpusManifest,
        initialized: true,
      });

      await get().refreshStatus();

      // Non-blocking first-launch sheet: show once if models aren't downloaded yet
      const state = get();
      if (state.phase === 'not_installed' && !state.promptDismissed) {
        set({ sheetVisible: true });
      }
    },

    async syncCorpusManifest() {
      try {
        const res = await fetch(CORPUS_PACKS_MANIFEST_URL, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return get().corpusManifest;
        const remote = (await res.json()) as CorpusPacksManifest;
        if (remote && Array.isArray(remote.packs) && remote.packs.length > 0) {
          set({ corpusManifest: remote, manifestSyncedAt: Date.now() });
          await setSetting('corpus_manifest_cache', JSON.stringify(remote));
          await get().refreshStatus();
          return remote;
        }
      } catch {
        // Offline or release not published yet — fallback manifest remains active
      }
      return get().corpusManifest;
    },

    async refreshStatus() {
      const manifest = get().corpusManifest;
      const modelArtifacts = OFFLINE_ENGINE_MANIFEST.modelArtifacts;
      const corpusArtifacts = manifest.packs.flatMap(buildPackArtifacts);

      const groupStats = {
        embedder: { downloadedBytes: 0, totalBytes: 0, ready: true },
        reranker: { downloadedBytes: 0, totalBytes: 0, ready: true },
        corpus: { downloadedBytes: 0, totalBytes: 0, ready: true },
      };

      for (const art of [...modelArtifacts, ...corpusArtifacts]) {
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
        const { passagesPath, vectorsPath } = getPackLocalPaths(pack.id);
        const [pSize, vSize] = await Promise.all([
          getFileSize(passagesPath),
          getFileSize(vectorsPath),
        ]);
        if (pSize > 0 && vSize > 0) {
          installedPackIds.push(pack.id);
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

      const modelsReady = groupStats.embedder.ready && groupStats.reranker.ready;
      const curPhase = get().phase;
      const nextPhase: EnginePhase =
        curPhase === 'downloading' || curPhase === 'installing_packs'
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
        phase: nextPhase,
      });
    },

    async startDownload(options = {}) {
      const includeCorpusPacks = options.includeCorpusPacks ?? true;
      if (get().phase === 'downloading') return true;

      pauseRequested = false;
      cancelRequested = false;
      set({ phase: 'downloading', errorMessage: null });

      // Best-effort refresh of the editable GitHub Releases corpus manifest
      if (includeCorpusPacks) {
        await get().syncCorpusManifest();
      }

      const manifest = get().corpusManifest;
      const artifacts: DownloadArtifactSpec[] = [
        ...OFFLINE_ENGINE_MANIFEST.modelArtifacts,
        ...(includeCorpusPacks ? manifest.packs.flatMap(buildPackArtifacts) : []),
      ];

      // Pre-compute baseline downloaded bytes across artifacts
      const perArtifactBytes = new Map<string, number>();
      for (const art of artifacts) {
        const localPath = localPathForArtifact(art.relativePath);
        const existing = await getFileSize(localPath);
        perArtifactBytes.set(art.id, art.sizeBytes > 0 ? Math.min(existing, art.sizeBytes) : existing);
      }

      const emitProgress = (activeLabel: string | null) => {
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
      };

      emitProgress('Checking existing files…');

      for (const art of artifacts) {
        if (pauseRequested || cancelRequested) break;

        const localPath = localPathForArtifact(art.relativePath);
        const existingSize = await getFileSize(localPath);
        if (art.sizeBytes > 0 && existingSize >= art.sizeBytes * 0.99) {
          perArtifactBytes.set(art.id, art.sizeBytes);
          emitProgress(art.label);
          continue;
        }

        await ensureParentDir(localPath);
        emitProgress(art.label);

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

          if (pauseRequested || cancelRequested) {
            break;
          }

          if (!result || (result.status !== 200 && result.status !== 206)) {
            // Corpus packs might not be published to GitHub Releases yet on a
            // fresh branch — keep model download succeeding and record note.
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
          perArtifactBytes.set(art.id, art.sizeBytes > 0 ? Math.min(finalSize, art.sizeBytes) : finalSize);
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
          emitProgress(art.label);
        } catch (err) {
          activeDownloadResumable = null;
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
            status: 'error',
            error: msg,
          });
          set({ phase: 'error', errorMessage: msg, activeArtifactLabel: null });
          return false;
        }
      }

      if (pauseRequested) {
        set({ phase: 'paused', activeArtifactLabel: null });
        return false;
      }
      if (cancelRequested) {
        set({ phase: 'not_installed', activeArtifactLabel: null });
        return false;
      }

      // Ingest any downloaded corpus packs into SQLite
      if (includeCorpusPacks) {
        set({ phase: 'installing_packs', activeArtifactLabel: 'Indexing Library passages…' });
        for (const pack of manifest.packs) {
          await ingestDownloadedPackIntoSqlite(pack);
        }
      }

      await get().refreshStatus();
      set({ activeArtifactLabel: null, promptDismissed: true });
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
          // ignore pause errors
        }
        activeDownloadResumable = null;
      }
      set({ phase: 'paused', activeArtifactLabel: null });
    },

    async cancelDownload() {
      cancelRequested = true;
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

    async downloadCorpusPack(packId: string) {
      const manifest = await get().syncCorpusManifest();
      const pack = manifest.packs.find((p) => p.id === packId);
      if (!pack) return false;
      set({ phase: 'downloading', errorMessage: null, activeArtifactLabel: pack.label });
      for (const art of buildPackArtifacts(pack)) {
        const localPath = localPathForArtifact(art.relativePath);
        await ensureParentDir(localPath);
        const dl = FileSystem.createDownloadResumable(art.url, localPath, {});
        const res = await dl.downloadAsync();
        if (!res || (res.status !== 200 && res.status !== 206)) {
          set({
            phase: 'error',
            errorMessage: `Could not download ${pack.label} (HTTP ${res?.status ?? 'error'}).`,
            activeArtifactLabel: null,
          });
          return false;
        }
      }
      set({ phase: 'installing_packs', activeArtifactLabel: `Installing ${pack.label}…` });
      await ingestDownloadedPackIntoSqlite(pack);
      await get().refreshStatus();
      set({ activeArtifactLabel: null });
      return true;
    },

    async removeOfflineEngine() {
      await get().cancelDownload();
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
        } catch {
          // ignore
        }
      }
      await get().refreshStatus();
    },
  };
});
