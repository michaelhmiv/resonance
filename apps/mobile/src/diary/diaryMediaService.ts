/**
 * Multimodal Life Diary Service & Store — local-first capture, offline-resilient
 * OpenRouter processing queue (Voice STT, Photo Vision/OCR + multimodal embed,
 * Smart Two-Tier Video analysis), and user-confirmed People directory.
 *
 * Every audio clip, photo, video, transcript, caption, and person link stays
 * stored locally in `FileSystem.documentDirectory/diary_media/` and SQLite.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  OPENROUTER_DIRECT_VIDEO_MAX_BYTES,
  createSegment,
  modelSupportsDirectVideoInput,
  toParentDate,
  type DiaryMediaItem,
  type DiaryMediaKind,
  type DiaryPerson,
  type DiaryProcessingStatus,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import { useJournalStore } from '../journal/journalStore';
import {
  OpenRouterApiError,
  analyzePhotoViaOpenRouter,
  analyzeVideoViaOpenRouter,
  transcribeAudioViaOpenRouter,
} from '../openrouter/openrouterClient';
import {
  isOpenRouterEnabledForFeature,
  useOpenRouterStore,
} from '../openrouter/openrouterStore';
import { embedMultimodalMemory } from '../embedding/embeddingService';
import { storeSegmentVector } from '../embedding/resonanceService';

const DIARY_MEDIA_ROOT = `${FileSystem.documentDirectory ?? ''}diary_media`;

async function ensureMediaDirs(): Promise<void> {
  for (const sub of ['', '/voice', '/photos', '/videos', '/thumbs']) {
    const dir = `${DIARY_MEDIA_ROOT}${sub}`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function guessAudioFormat(
  uri: string,
  mimeType: string
): 'm4a' | 'mp3' | 'wav' | 'mp4' | 'webm' | 'ogg' | 'flac' {
  const lower = `${uri} ${mimeType}`.toLowerCase();
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mp3') || lower.includes('mpeg')) return 'mp3';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('flac')) return 'flac';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mp4')) return 'mp4';
  return 'm4a';
}

/** Build the rich searchable & embeddable text for a multimodal diary item. */
export function buildDiarySearchableText(item: {
  kind: DiaryMediaKind;
  caption?: string | null;
  transcript?: string | null;
  aiSummary?: string | null;
  ocrText?: string | null;
  locationLabel?: string | null;
  people?: Array<{ name: string }>;
}): string {
  const parts: string[] = [];
  if (item.caption?.trim()) parts.push(item.caption.trim());
  if (item.people && item.people.length > 0) {
    parts.push(`With ${item.people.map((p) => p.name).join(', ')}`);
  }
  if (item.locationLabel?.trim()) parts.push(`At ${item.locationLabel.trim()}`);
  if (item.transcript?.trim()) parts.push(item.transcript.trim());
  if (item.aiSummary?.trim()) parts.push(item.aiSummary.trim());
  if (item.ocrText?.trim()) parts.push(item.ocrText.trim());
  return parts.join('\n').trim();
}

export interface DiaryStorageStats {
  totalFiles: number;
  voiceCount: number;
  photoCount: number;
  videoCount: number;
  totalBytes: number;
}

interface DiaryMediaStoreState {
  loaded: boolean;
  mediaBySegmentId: Record<string, DiaryMediaItem>;
  allMedia: DiaryMediaItem[];
  people: DiaryPerson[];
  processingQueueRunning: boolean;

  loadAll: () => Promise<void>;
  addVoiceNote: (params: {
    sourceUri: string;
    durationMs: number;
    mimeType?: string;
    parentDate?: string;
  }) => Promise<DiaryMediaItem | null>;
  addPhotos: (params: {
    assets: Array<{
      uri: string;
      width?: number;
      height?: number;
      mimeType?: string | null;
      fileSize?: number;
    }>;
    parentDate?: string;
  }) => Promise<DiaryMediaItem[]>;
  addVideo: (params: {
    sourceUri: string;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    fileSize?: number | null;
    parentDate?: string;
  }) => Promise<DiaryMediaItem | null>;
  updateMediaFields: (
    mediaId: string,
    patch: {
      caption?: string | null;
      transcript?: string | null;
      aiSummary?: string | null;
      ocrText?: string | null;
      locationLabel?: string | null;
    }
  ) => Promise<void>;
  addPersonToMedia: (
    mediaId: string,
    name: string,
    relationship?: string | null
  ) => Promise<DiaryPerson | null>;
  removePersonFromMedia: (mediaId: string, personId: string) => Promise<void>;
  deleteMediaMemory: (mediaId: string) => Promise<void>;
  retryMediaProcessing: (mediaId: string) => Promise<void>;
  processPendingMediaQueue: (options?: { retryErrors?: boolean }) => Promise<void>;
}

let queueInFlight = false;

async function queryAllDiaryMediaAndPeople(): Promise<{
  items: DiaryMediaItem[];
  bySeg: Record<string, DiaryMediaItem>;
  people: DiaryPerson[];
}> {
  const db = getDatabase();
  if (!db) return { items: [], bySeg: {}, people: [] };

  try {
    const [mediaRows, peopleRows, linkRows] = await Promise.all([
      db.getAllAsync<{
        id: string;
        segment_id: string;
        kind: DiaryMediaKind;
        local_uri: string;
        thumb_uri: string | null;
        mime_type: string;
        byte_size: number;
        duration_ms: number | null;
        width: number | null;
        height: number | null;
        caption: string | null;
        transcript: string | null;
        ai_summary: string | null;
        ocr_text: string | null;
        moment_type: string | null;
        location_label: string | null;
        captured_at: number;
        processing_status: DiaryProcessingStatus;
        processing_error: string | null;
        ai_model_used: string | null;
        created_at: number;
        updated_at: number;
      }>(`SELECT * FROM diary_media ORDER BY captured_at DESC;`),
      db.getAllAsync<{
        id: string;
        name: string;
        relationship: string | null;
        created_at: number;
        memory_count: number;
      }>(
        `SELECT dp.id, dp.name, dp.relationship, dp.created_at,
                (SELECT COUNT(*) FROM diary_media_people dmp WHERE dmp.person_id = dp.id) +
                (SELECT COUNT(*) FROM journal_segment_people jsp WHERE jsp.person_id = dp.id)
                  AS memory_count
         FROM diary_people dp
         ORDER BY memory_count DESC, dp.name ASC;`
      ),
      db.getAllAsync<{ media_id: string; person_id: string }>(
        `SELECT media_id, person_id FROM diary_media_people;`
      ),
    ]);

    const people: DiaryPerson[] = peopleRows.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      createdAt: p.created_at,
      memoryCount: p.memory_count,
    }));
    const personById = new Map(people.map((p) => [p.id, p]));
    const peopleByMedia = new Map<string, DiaryPerson[]>();
    for (const link of linkRows) {
      const person = personById.get(link.person_id);
      if (!person) continue;
      const list = peopleByMedia.get(link.media_id) ?? [];
      list.push(person);
      peopleByMedia.set(link.media_id, list);
    }

    const items: DiaryMediaItem[] = [];
    const bySeg: Record<string, DiaryMediaItem> = {};
    for (const r of mediaRows) {
      const item: DiaryMediaItem = {
        id: r.id,
        segmentId: r.segment_id,
        kind: r.kind,
        localUri: r.local_uri,
        thumbUri: r.thumb_uri,
        mimeType: r.mime_type,
        byteSize: r.byte_size,
        durationMs: r.duration_ms,
        width: r.width,
        height: r.height,
        caption: r.caption,
        transcript: r.transcript,
        aiSummary: r.ai_summary,
        ocrText: r.ocr_text,
        momentType: r.moment_type,
        locationLabel: r.location_label,
        capturedAt: r.captured_at,
        processingStatus: r.processing_status,
        processingError: r.processing_error,
        aiModelUsed: r.ai_model_used,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        people: peopleByMedia.get(r.id) ?? [],
      };
      items.push(item);
      bySeg[item.segmentId] = item;
    }

    return { items, bySeg, people };
  } catch {
    return { items: [], bySeg: {}, people: [] };
  }
}

async function createWorkingPhotoDataUri(
  localUri: string,
  maxWidth = 1280
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: maxWidth } }],
    {
      compress: 0.78,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );
  if (!result.base64) {
    throw new Error('Could not encode photo for OpenRouter Vision.');
  }
  return `data:image/jpeg;base64,${result.base64}`;
}

async function extractVideoKeyframeDataUris(
  localUri: string,
  durationMs: number | null
): Promise<string[]> {
  const totalMs = Math.max(3000, durationMs ?? 15000);
  const frameCount = totalMs > 30000 ? 6 : 4;
  const uris: string[] = [];

  for (let i = 0; i < frameCount; i++) {
    const ratio = i / (frameCount - 1);
    const time = Math.min(Math.max(200, Math.round(totalMs * ratio * 0.92)), totalMs);
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(localUri, {
        time,
        quality: 0.7,
      });
      const dataUri = await createWorkingPhotoDataUri(thumb.uri, 768);
      uris.push(dataUri);
    } catch {
      // Skip unreadable frame
    }
  }
  return uris;
}

export async function getDiaryStorageStats(): Promise<DiaryStorageStats> {
  const db = getDatabase();
  if (!db) {
    return { totalFiles: 0, voiceCount: 0, photoCount: 0, videoCount: 0, totalBytes: 0 };
  }
  try {
    const rows = await db.getAllAsync<{
      kind: DiaryMediaKind;
      cnt: number;
      bytes: number | null;
    }>(
      `SELECT kind, COUNT(*) AS cnt, SUM(byte_size) AS bytes
       FROM diary_media GROUP BY kind;`
    );
    let voiceCount = 0;
    let photoCount = 0;
    let videoCount = 0;
    let totalBytes = 0;
    for (const r of rows) {
      if (r.kind === 'voice') voiceCount = r.cnt;
      else if (r.kind === 'photo') photoCount = r.cnt;
      else if (r.kind === 'video') videoCount = r.cnt;
      totalBytes += r.bytes ?? 0;
    }
    return {
      totalFiles: voiceCount + photoCount + videoCount,
      voiceCount,
      photoCount,
      videoCount,
      totalBytes,
    };
  } catch {
    return { totalFiles: 0, voiceCount: 0, photoCount: 0, videoCount: 0, totalBytes: 0 };
  }
}

async function persistSegmentRowImmediately(seg: {
  id: string;
  created_at: number;
  updated_at: number;
  segment_type: string;
  text: string | null;
  position_index: number;
  parent_date: string | null;
}): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO journal_segments
       (id, created_at, updated_at, segment_type, text, position_index, parent_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       segment_type = excluded.segment_type,
       text = excluded.text,
       position_index = excluded.position_index,
       parent_date = excluded.parent_date;`,
    [
      seg.id,
      seg.created_at,
      seg.updated_at,
      seg.segment_type,
      seg.text,
      seg.position_index,
      seg.parent_date,
    ]
  );
}

export const useDiaryMediaStore = create<DiaryMediaStoreState>((set, get) => ({
  loaded: false,
  mediaBySegmentId: {},
  allMedia: [],
  people: [],
  processingQueueRunning: false,

  async loadAll() {
    const { items, bySeg, people } = await queryAllDiaryMediaAndPeople();
    set({
      loaded: true,
      allMedia: items,
      mediaBySegmentId: bySeg,
      people,
    });
  },

  async addVoiceNote({ sourceUri, durationMs, mimeType = 'audio/m4a', parentDate }) {
    const db = getDatabase();
    if (!db) return null;
    await ensureMediaDirs();

    const mediaId = generateId('dm');
    const ext = guessAudioFormat(sourceUri, mimeType);
    const destUri = `${DIARY_MEDIA_ROOT}/voice/${mediaId}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    const info = await FileSystem.getInfoAsync(destUri);
    const byteSize = 'size' in info && typeof info.size === 'number' ? info.size : 0;

    const now = Date.now();
    const dateStr = parentDate ?? toParentDate(new Date(now));
    const journalState = useJournalStore.getState();
    const nextPos = journalState.segments.length;
    const seg = createSegment('voice', '', nextPos, dateStr);
    journalState.insertSegment(seg);
    // Flush segment row immediately so diary_media FK constraint succeeds under PRAGMA foreign_keys = ON
    await persistSegmentRowImmediately(seg);

    await db.runAsync(
      `INSERT INTO diary_media (
         id, segment_id, kind, local_uri, thumb_uri, mime_type, byte_size,
         duration_ms, captured_at, processing_status, created_at, updated_at
       ) VALUES (?, ?, 'voice', ?, NULL, ?, ?, ?, ?, 'queued', ?, ?);`,
      [mediaId, seg.id, destUri, mimeType, byteSize, Math.round(durationMs), now, now, now]
    );

    await get().loadAll();
    void get().processPendingMediaQueue();
    return get().mediaBySegmentId[seg.id] ?? null;
  },

  async addPhotos({ assets, parentDate }) {
    const db = getDatabase();
    if (!db || assets.length === 0) return [];
    await ensureMediaDirs();

    const created: DiaryMediaItem[] = [];
    for (const asset of assets) {
      const mediaId = generateId('dm');
      const extMatch = asset.uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
      const destUri = `${DIARY_MEDIA_ROOT}/photos/${mediaId}.${ext}`;
      await FileSystem.copyAsync({ from: asset.uri, to: destUri });
      const info = await FileSystem.getInfoAsync(destUri);
      const byteSize =
        'size' in info && typeof info.size === 'number'
          ? info.size
          : (asset.fileSize ?? 0);

      const now = Date.now();
      const dateStr = parentDate ?? toParentDate(new Date(now));
      const journalState = useJournalStore.getState();
      const seg = createSegment('photo', '', journalState.segments.length, dateStr);
      journalState.insertSegment(seg);
      await persistSegmentRowImmediately(seg);

      await db.runAsync(
        `INSERT INTO diary_media (
           id, segment_id, kind, local_uri, thumb_uri, mime_type, byte_size,
           width, height, captured_at, processing_status, created_at, updated_at
         ) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?);`,
        [
          mediaId,
          seg.id,
          destUri,
          destUri,
          asset.mimeType ?? 'image/jpeg',
          byteSize,
          asset.width ?? null,
          asset.height ?? null,
          now,
          now,
          now,
        ]
      );
      await get().loadAll();
      const item = get().mediaBySegmentId[seg.id];
      if (item) created.push(item);
    }

    void get().processPendingMediaQueue();
    return created;
  },

  async addVideo({
    sourceUri,
    durationMs = null,
    width = null,
    height = null,
    mimeType = 'video/mp4',
    fileSize = null,
    parentDate,
  }) {
    const db = getDatabase();
    if (!db) return null;
    await ensureMediaDirs();

    const mediaId = generateId('dm');
    const extMatch = sourceUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    const ext = (extMatch?.[1] ?? 'mp4').toLowerCase();
    const destUri = `${DIARY_MEDIA_ROOT}/videos/${mediaId}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    const info = await FileSystem.getInfoAsync(destUri);
    const byteSize =
      'size' in info && typeof info.size === 'number'
        ? info.size
        : (fileSize ?? 0);

    let thumbUri: string | null = null;
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(destUri, {
        time: 500,
        quality: 0.75,
      });
      const destThumb = `${DIARY_MEDIA_ROOT}/thumbs/${mediaId}.jpg`;
      await FileSystem.copyAsync({ from: thumb.uri, to: destThumb });
      thumbUri = destThumb;
    } catch {
      thumbUri = null;
    }

    const now = Date.now();
    const dateStr = parentDate ?? toParentDate(new Date(now));
    const journalState = useJournalStore.getState();
    const seg = createSegment('video', '', journalState.segments.length, dateStr);
    journalState.insertSegment(seg);
    await persistSegmentRowImmediately(seg);

    await db.runAsync(
      `INSERT INTO diary_media (
         id, segment_id, kind, local_uri, thumb_uri, mime_type, byte_size,
         duration_ms, width, height, captured_at, processing_status, created_at, updated_at
       ) VALUES (?, ?, 'video', ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?);`,
      [
        mediaId,
        seg.id,
        destUri,
        thumbUri,
        mimeType ?? 'video/mp4',
        byteSize,
        durationMs != null ? Math.round(durationMs) : null,
        width,
        height,
        now,
        now,
        now,
      ]
    );

    await get().loadAll();
    void get().processPendingMediaQueue();
    return get().mediaBySegmentId[seg.id] ?? null;
  },

  async updateMediaFields(mediaId, patch) {
    const db = getDatabase();
    if (!db) return;
    const current = get().allMedia.find((m) => m.id === mediaId);
    if (!current) return;

    const next = {
      caption: patch.caption !== undefined ? patch.caption : current.caption,
      transcript: patch.transcript !== undefined ? patch.transcript : current.transcript,
      aiSummary: patch.aiSummary !== undefined ? patch.aiSummary : current.aiSummary,
      ocrText: patch.ocrText !== undefined ? patch.ocrText : current.ocrText,
      locationLabel:
        patch.locationLabel !== undefined ? patch.locationLabel : current.locationLabel,
    };

    const now = Date.now();
    await db.runAsync(
      `UPDATE diary_media
       SET caption = ?, transcript = ?, ai_summary = ?, ocr_text = ?,
           location_label = ?, updated_at = ?
       WHERE id = ?;`,
      [
        next.caption,
        next.transcript,
        next.aiSummary,
        next.ocrText,
        next.locationLabel,
        now,
        mediaId,
      ]
    );

    const searchable = buildDiarySearchableText({
      kind: current.kind,
      ...next,
      people: current.people,
    });
    useJournalStore.getState().updateSegmentText(current.segmentId, searchable);
    await get().loadAll();

    if (searchable.length >= 12) {
      void storeSegmentVector(current.segmentId, searchable);
    }
  },

  async addPersonToMedia(mediaId, name, relationship = null) {
    const db = getDatabase();
    if (!db) return null;
    const cleaned = name.trim();
    if (!cleaned) return null;

    const current = get().allMedia.find((m) => m.id === mediaId);
    if (!current) return null;

    let person = await db.getFirstAsync<{
      id: string;
      name: string;
      relationship: string | null;
      created_at: number;
    }>(`SELECT * FROM diary_people WHERE LOWER(name) = LOWER(?);`, [cleaned]);

    if (!person) {
      const id = generateId('per');
      const now = Date.now();
      await db.runAsync(
        `INSERT INTO diary_people (id, name, relationship, created_at)
         VALUES (?, ?, ?, ?);`,
        [id, cleaned, relationship?.trim() || null, now]
      );
      person = {
        id,
        name: cleaned,
        relationship: relationship?.trim() || null,
        created_at: now,
      };
    }

    await db.runAsync(
      `INSERT OR IGNORE INTO diary_media_people (media_id, person_id) VALUES (?, ?);`,
      [mediaId, person.id]
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO journal_segment_people (segment_id, person_id) VALUES (?, ?);`,
      [current.segmentId, person.id]
    );

    await get().loadAll();
    const updated = get().allMedia.find((m) => m.id === mediaId);
    if (updated) {
      const searchable = buildDiarySearchableText(updated);
      useJournalStore.getState().updateSegmentText(updated.segmentId, searchable);
      if (searchable.length >= 12) {
        void storeSegmentVector(updated.segmentId, searchable);
      }
    }

    return {
      id: person.id,
      name: person.name,
      relationship: person.relationship,
      createdAt: person.created_at,
    };
  },

  async removePersonFromMedia(mediaId, personId) {
    const db = getDatabase();
    if (!db) return;
    const current = get().allMedia.find((m) => m.id === mediaId);
    if (!current) return;

    await db.runAsync(
      `DELETE FROM diary_media_people WHERE media_id = ? AND person_id = ?;`,
      [mediaId, personId]
    );
    await db.runAsync(
      `DELETE FROM journal_segment_people WHERE segment_id = ? AND person_id = ?;`,
      [current.segmentId, personId]
    );
    await get().loadAll();

    const updated = get().allMedia.find((m) => m.id === mediaId);
    if (updated) {
      const searchable = buildDiarySearchableText(updated);
      useJournalStore.getState().updateSegmentText(updated.segmentId, searchable);
    }
  },

  async deleteMediaMemory(mediaId) {
    const db = getDatabase();
    if (!db) return;
    const current = get().allMedia.find((m) => m.id === mediaId);
    if (!current) return;

    // Clean local files
    await FileSystem.deleteAsync(current.localUri, { idempotent: true }).catch(() => {});
    if (current.thumbUri && current.thumbUri !== current.localUri) {
      await FileSystem.deleteAsync(current.thumbUri, { idempotent: true }).catch(() => {});
    }

    await db.runAsync(`DELETE FROM diary_media WHERE id = ?;`, [mediaId]);
    useJournalStore.getState().deleteSegment(current.segmentId);
    await get().loadAll();
  },

  async retryMediaProcessing(mediaId) {
    const db = getDatabase();
    if (!db) return;
    await db.runAsync(
      `UPDATE diary_media
       SET processing_status = 'queued', processing_error = NULL, updated_at = ?
       WHERE id = ?;`,
      [Date.now(), mediaId]
    );
    await get().loadAll();
    void get().processPendingMediaQueue({ retryErrors: true });
  },

  async processPendingMediaQueue(options) {
    if (queueInFlight) return;
    const db = getDatabase();
    if (!db) return;

    const orState = useOpenRouterStore.getState();
    if (!orState.hasKey || orState.routingMode !== 'cloud_with_fallback' || orState.creditsExhausted) {
      return;
    }

    queueInFlight = true;
    set({ processingQueueRunning: true });

    try {
      const { items } = await queryAllDiaryMediaAndPeople();
      const pending = items.filter((m) => {
        if (m.processingStatus === 'queued' || m.processingStatus === 'processing') {
          return true;
        }
        return Boolean(options?.retryErrors && m.processingStatus === 'error');
      });

      for (const item of pending) {
        // Respect per-feature OpenRouter toggles
        if (item.kind === 'voice' && !isOpenRouterEnabledForFeature('voice', 'journal')) {
          continue;
        }
        if (
          (item.kind === 'photo' || item.kind === 'video') &&
          !isOpenRouterEnabledForFeature('photosAndVideos', 'journal')
        ) {
          continue;
        }

        await db.runAsync(
          `UPDATE diary_media
           SET processing_status = 'processing', processing_error = NULL, updated_at = ?
           WHERE id = ?;`,
          [Date.now(), item.id]
        );
        await get().loadAll();

        try {
          if (item.kind === 'voice') {
            const base64Audio = await FileSystem.readAsStringAsync(item.localUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const format = guessAudioFormat(item.localUri, item.mimeType);
            const { text, modelUsed } = await transcribeAudioViaOpenRouter({
              base64Audio,
              format,
            });
            const now = Date.now();
            await db.runAsync(
              `UPDATE diary_media
               SET transcript = ?, ai_model_used = ?, processing_status = 'ready',
                   processing_error = NULL, updated_at = ?
               WHERE id = ?;`,
              [text, modelUsed, now, item.id]
            );
            const searchable = buildDiarySearchableText({
              ...item,
              transcript: text,
            });
            useJournalStore.getState().updateSegmentText(item.segmentId, searchable);
            if (searchable.length >= 12) {
              await storeSegmentVector(item.segmentId, searchable);
            }
          } else if (item.kind === 'photo') {
            const imageDataUri = await createWorkingPhotoDataUri(item.localUri, 1280);
            const analysis = await analyzePhotoViaOpenRouter({
              imageDataUri,
              userCaption: item.caption,
              peopleNames: item.people.map((p) => p.name),
            });
            const now = Date.now();
            await db.runAsync(
              `UPDATE diary_media
               SET ai_summary = ?, ocr_text = ?, moment_type = ?, ai_model_used = ?,
                   processing_status = 'ready', processing_error = NULL, updated_at = ?
               WHERE id = ?;`,
              [
                analysis.sceneSummary || null,
                analysis.visibleTextOcr || null,
                analysis.momentType || null,
                analysis.modelUsed,
                now,
                item.id,
              ]
            );
            const searchable = buildDiarySearchableText({
              ...item,
              aiSummary: analysis.sceneSummary,
              ocrText: analysis.visibleTextOcr,
            });
            useJournalStore.getState().updateSegmentText(item.segmentId, searchable);
            if (searchable.length >= 4) {
              const { modelId, vector } = await embedMultimodalMemory({
                text: searchable,
                imageDataUri,
              });
              if (vector) {
                await storeSegmentVector(item.segmentId, searchable, {
                  modelId,
                  vector,
                });
              }
            }
          } else if (item.kind === 'video') {
            const visionModel = useOpenRouterStore.getState().visionModel;
            const useDirectVideo =
              item.byteSize > 0 &&
              item.byteSize <= OPENROUTER_DIRECT_VIDEO_MAX_BYTES &&
              modelSupportsDirectVideoInput(visionModel);

            let analysis;
            if (useDirectVideo) {
              try {
                const videoB64 = await FileSystem.readAsStringAsync(item.localUri, {
                  encoding: FileSystem.EncodingType.Base64,
                });
                const mime = item.mimeType || 'video/mp4';
                analysis = await analyzeVideoViaOpenRouter({
                  videoDataUri: `data:${mime};base64,${videoB64}`,
                  userCaption: item.caption,
                  peopleNames: item.people.map((p) => p.name),
                });
              } catch {
                // Automatic fallback to local keyframes if provider rejects direct video
                const frames = await extractVideoKeyframeDataUris(
                  item.localUri,
                  item.durationMs
                );
                analysis = await analyzeVideoViaOpenRouter({
                  frameDataUris: frames,
                  userCaption: item.caption,
                  peopleNames: item.people.map((p) => p.name),
                });
              }
            } else {
              const frames = await extractVideoKeyframeDataUris(
                item.localUri,
                item.durationMs
              );
              analysis = await analyzeVideoViaOpenRouter({
                frameDataUris: frames,
                userCaption: item.caption,
                peopleNames: item.people.map((p) => p.name),
              });
            }

            const now = Date.now();
            await db.runAsync(
              `UPDATE diary_media
               SET ai_summary = ?, transcript = ?, ocr_text = ?, moment_type = ?,
                   ai_model_used = ?, processing_status = 'ready',
                   processing_error = NULL, updated_at = ?
               WHERE id = ?;`,
              [
                analysis.sceneSummary || null,
                analysis.spokenTranscript || null,
                analysis.visibleTextOcr || null,
                analysis.momentType || null,
                analysis.modelUsed,
                now,
                item.id,
              ]
            );
            const searchable = buildDiarySearchableText({
              ...item,
              aiSummary: analysis.sceneSummary,
              transcript: analysis.spokenTranscript,
              ocrText: analysis.visibleTextOcr,
            });
            useJournalStore.getState().updateSegmentText(item.segmentId, searchable);
            if (searchable.length >= 12) {
              await storeSegmentVector(item.segmentId, searchable);
            }
          }
        } catch (err) {
          if (err instanceof OpenRouterApiError && err.code === 'network') {
            // Stay queued offline so we auto-process seamlessly on reconnect!
            await db.runAsync(
              `UPDATE diary_media
               SET processing_status = 'queued',
                   processing_error = 'Waiting for connection…',
                   updated_at = ?
               WHERE id = ?;`,
              [Date.now(), item.id]
            );
            break;
          }
          if (err instanceof OpenRouterApiError && err.code === 'insufficient_credits') {
            await db.runAsync(
              `UPDATE diary_media
               SET processing_status = 'queued',
                   processing_error = 'Paused — OpenRouter credits exhausted.',
                   updated_at = ?
               WHERE id = ?;`,
              [Date.now(), item.id]
            );
            break;
          }
          const msg = err instanceof Error ? err.message : 'Processing failed.';
          await db.runAsync(
            `UPDATE diary_media
             SET processing_status = 'error', processing_error = ?, updated_at = ?
             WHERE id = ?;`,
            [msg, Date.now(), item.id]
          );
        }

        await get().loadAll();
      }
    } finally {
      queueInFlight = false;
      set({ processingQueueRunning: false });
    }
  },
}));
