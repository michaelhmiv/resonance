/**
 * Non-Destructive Re-Embed Library Engine & Multi-Model Vector Storage Manager.
 *
 * When a user switches to a non-Voyage-4 OpenRouter embedding model (e.g.
 * `qwen/qwen3-embedding-8b`, `cohere/embed-5-pro`, `perplexity/pplx-embed-v2-context-9b`,
 * `google/gemini-embedding-2-preview`, `openai/text-embedding-3-large`), this
 * service:
 *   1. Inspects all locally stored text in SQLite (Bible, downloaded Church
 *      Library works, Personal Library, Journal & Diary Media, Highlights)
 *   2. Computes exact remaining chunk counts, estimated tokens, and USD cost
 *      before spending a cent
 *   3. Runs batched (64 chunks/call), resumable embedding into `(id, model_id)`
 *      rows — leaving default `.rvec` files and other models' vectors untouched
 *   4. Pauses cleanly on HTTP 402 (credits exhausted) or user Pause, resuming
 *      only unembedded items next time
 */

import { create } from 'zustand';
import {
  buildHighlightEmbedText,
  buildNoteEmbedText,
  estimateTokenCostUsd,
  isVoyage4SharedSpace,
  modelSupportsContextualEmbeddings,
  quantizeVectorInt8,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  OpenRouterApiError,
  embedTextsViaOpenRouter,
  getKnownModelPricing,
} from './openrouterClient';
import { clearHighlightVectors, clearLibraryVectors } from '../embedding/resonanceService';

export type ReembedScopeKey =
  | 'bible'
  | 'church'
  | 'personal'
  | 'journal'
  | 'highlights';

export interface ReembedScopeEstimate {
  scope: ReembedScopeKey;
  label: string;
  totalItems: number;
  alreadyEmbedded: number;
  remainingItems: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface ReembedPlanEstimate {
  modelId: string;
  isVoyage4ZeroReembed: boolean;
  pricePerMillion: number;
  scopes: ReembedScopeEstimate[];
  totalRemainingItems: number;
  totalEstimatedTokens: number;
  totalEstimatedCostUsd: number;
}

export interface StoredVectorModelStats {
  modelId: string;
  passageVectors: number;
  journalVectors: number;
  highlightVectors: number;
  estimatedBytes: number;
}

interface ReembedStoreState {
  running: boolean;
  paused: boolean;
  targetModelId: string | null;
  currentScopeLabel: string | null;
  completed: number;
  total: number;
  error: string | null;
  startReembed: (
    modelId: string,
    selectedScopes: ReembedScopeKey[]
  ) => Promise<void>;
  pauseReembed: () => void;
  clearError: () => void;
}

const BATCH_SIZE = 64;
const CHARS_PER_TOKEN = 4;

let pauseRequested = false;

export async function estimateReembedPlan(
  modelId: string
): Promise<ReembedPlanEstimate> {
  const pricing = getKnownModelPricing(modelId);
  const isVoyage4 = isVoyage4SharedSpace(modelId);
  const db = getDatabase();
  if (!db) {
    return {
      modelId,
      isVoyage4ZeroReembed: isVoyage4,
      pricePerMillion: pricing.prompt,
      scopes: [],
      totalRemainingItems: 0,
      totalEstimatedTokens: 0,
      totalEstimatedCostUsd: 0,
    };
  }

  const scopes: ReembedScopeEstimate[] = [];

  // 1. Bible (WEB passages)
  const bibleStats = await db
    .getFirstAsync<{ total: number; chars: number | null; done: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(LENGTH(p.text)) AS chars,
         SUM(CASE WHEN pv.passage_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM passages p
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id = ?
       WHERE p.translation = 'WEB';`,
      [modelId]
    )
    .catch(() => null);
  const bibleTotal = bibleStats?.total ?? 0;
  const bibleDone = bibleStats?.done ?? 0;
  const bibleRem = Math.max(0, bibleTotal - bibleDone);
  const bibleAvgChars = bibleTotal > 0 ? (bibleStats?.chars ?? bibleTotal * 120) / bibleTotal : 120;
  const bibleTokens = Math.round((bibleRem * bibleAvgChars) / CHARS_PER_TOKEN);
  scopes.push({
    scope: 'bible',
    label: 'Scripture (WEB Bible)',
    totalItems: bibleTotal,
    alreadyEmbedded: bibleDone,
    remainingItems: bibleRem,
    estimatedTokens: bibleTokens,
    estimatedCostUsd: estimateTokenCostUsd(bibleTokens, pricing.prompt),
  });

  // 2. Downloaded Church Library works (non-Bible, non-Personal)
  const churchStats = await db
    .getFirstAsync<{ total: number; chars: number | null; done: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(LENGTH(p.text)) AS chars,
         SUM(CASE WHEN pv.passage_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM passages p
       LEFT JOIN personal_books pb ON pb.book_id = p.book_id
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id = ?
       WHERE p.translation IS NULL AND pb.book_id IS NULL;`,
      [modelId]
    )
    .catch(() => null);
  const churchTotal = churchStats?.total ?? 0;
  const churchDone = churchStats?.done ?? 0;
  const churchRem = Math.max(0, churchTotal - churchDone);
  const churchAvgChars = churchTotal > 0 ? (churchStats?.chars ?? churchTotal * 350) / churchTotal : 350;
  const churchTokens = Math.round((churchRem * churchAvgChars) / CHARS_PER_TOKEN);
  scopes.push({
    scope: 'church',
    label: 'Downloaded Church Library',
    totalItems: churchTotal,
    alreadyEmbedded: churchDone,
    remainingItems: churchRem,
    estimatedTokens: churchTokens,
    estimatedCostUsd: estimateTokenCostUsd(churchTokens, pricing.prompt),
  });

  // 3. Personal Library books
  const personalStats = await db
    .getFirstAsync<{ total: number; chars: number | null; done: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(LENGTH(p.text)) AS chars,
         SUM(CASE WHEN pv.passage_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM passages p
       JOIN personal_books pb ON pb.book_id = p.book_id
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id = ?
       WHERE pb.ocr_required = 0;`,
      [modelId]
    )
    .catch(() => null);
  const persTotal = personalStats?.total ?? 0;
  const persDone = personalStats?.done ?? 0;
  const persRem = Math.max(0, persTotal - persDone);
  const persAvgChars = persTotal > 0 ? (personalStats?.chars ?? persTotal * 400) / persTotal : 400;
  const persTokens = Math.round((persRem * persAvgChars) / CHARS_PER_TOKEN);
  scopes.push({
    scope: 'personal',
    label: 'Personal Library',
    totalItems: persTotal,
    alreadyEmbedded: persDone,
    remainingItems: persRem,
    estimatedTokens: persTokens,
    estimatedCostUsd: estimateTokenCostUsd(persTokens, pricing.prompt),
  });

  // 4. Journal & Life Diary segments
  const journalStats = await db
    .getFirstAsync<{ total: number; chars: number | null; done: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(LENGTH(COALESCE(js.text, ''))) AS chars,
         SUM(CASE WHEN jsv.segment_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM journal_segments js
       LEFT JOIN journal_segment_vectors jsv
         ON jsv.segment_id = js.id AND jsv.model_id = ?
       WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
         AND LENGTH(TRIM(COALESCE(js.text, ''))) >= 12;`,
      [modelId]
    )
    .catch(() => null);
  const jTotal = journalStats?.total ?? 0;
  const jDone = journalStats?.done ?? 0;
  const jRem = Math.max(0, jTotal - jDone);
  const jAvgChars = jTotal > 0 ? (journalStats?.chars ?? jTotal * 220) / jTotal : 220;
  const jTokens = Math.round((jRem * jAvgChars) / CHARS_PER_TOKEN);
  scopes.push({
    scope: 'journal',
    label: 'Journal & Diary Memories',
    totalItems: jTotal,
    alreadyEmbedded: jDone,
    remainingItems: jRem,
    estimatedTokens: jTokens,
    estimatedCostUsd: estimateTokenCostUsd(jTokens, pricing.prompt),
  });

  // 5. Highlights & margin notes
  const hlStats = await db
    .getFirstAsync<{ total: number; done: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN hv.highlight_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM highlights h
       LEFT JOIN highlight_vectors hv
         ON hv.highlight_id = h.id AND hv.kind = 'highlight' AND hv.model_id = ?
       WHERE LENGTH(TRIM(COALESCE(h.selected_text, ''))) >= 4;`,
      [modelId]
    )
    .catch(() => null);
  const hlTotal = hlStats?.total ?? 0;
  const hlDone = hlStats?.done ?? 0;
  const hlRem = Math.max(0, hlTotal - hlDone);
  const hlTokens = hlRem * 60;
  scopes.push({
    scope: 'highlights',
    label: 'Highlights & Notes',
    totalItems: hlTotal,
    alreadyEmbedded: hlDone,
    remainingItems: hlRem,
    estimatedTokens: hlTokens,
    estimatedCostUsd: estimateTokenCostUsd(hlTokens, pricing.prompt),
  });

  const totalRemainingItems = scopes.reduce((s, x) => s + x.remainingItems, 0);
  const totalEstimatedTokens = scopes.reduce((s, x) => s + x.estimatedTokens, 0);
  const totalEstimatedCostUsd = estimateTokenCostUsd(
    totalEstimatedTokens,
    pricing.prompt
  );

  return {
    modelId,
    isVoyage4ZeroReembed: isVoyage4,
    pricePerMillion: pricing.prompt,
    scopes,
    totalRemainingItems,
    totalEstimatedTokens,
    totalEstimatedCostUsd,
  };
}

/**
 * Re-embed a single book (e.g. a newly downloaded Church Library work or
 * newly imported Personal Library book) into a specific OpenRouter model.
 */
export async function embedBookPassagesWithOpenRouter(
  bookId: string,
  modelId: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDatabase();
  if (!db) return 0;

  const rows = await db.getAllAsync<{
    id: number;
    text: string;
    division: string | null;
    title: string | null;
    author: string | null;
  }>(
    `SELECT p.id, p.text, p.division, b.title, b.author
     FROM passages p
     LEFT JOIN books b ON b.id = p.book_id
     LEFT JOIN passage_vectors pv
       ON pv.passage_id = p.id AND pv.model_id = ?
     WHERE p.book_id = ? AND pv.passage_id IS NULL
     ORDER BY p.id;`,
    [modelId, bookId]
  );

  if (rows.length === 0) return 0;

  const contextual = modelSupportsContextualEmbeddings(modelId);
  let embedded = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => {
      const ctx = [r.title, r.author, r.division].filter(Boolean).join(' · ');
      return ctx ? `[${ctx}]\n${r.text}` : r.text;
    });
    const vecs = await embedTextsViaOpenRouter(texts, {
      modelId,
      inputType: 'document',
      contextualDocumentChunks: contextual,
    });
    const ts = Date.now();
    for (let j = 0; j < Math.min(batch.length, vecs.length); j++) {
      const vec = vecs[j];
      if (!vec || vec.length === 0) continue;
      const { quantized, scale } = quantizeVectorInt8(vec);
      const blob = new Uint8Array(
        quantized.buffer,
        quantized.byteOffset,
        quantized.byteLength
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO passage_vectors
           (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [batch[j].id, bookId, modelId, vec.length, scale, blob, ts]
      );
      embedded++;
    }
    onProgress?.(embedded, rows.length);
  }

  if (embedded > 0) {
    clearLibraryVectors();
  }
  return embedded;
}

export const useReembedStore = create<ReembedStoreState>((set, get) => ({
  running: false,
  paused: false,
  targetModelId: null,
  currentScopeLabel: null,
  completed: 0,
  total: 0,
  error: null,

  pauseReembed() {
    pauseRequested = true;
    set({ paused: true });
  },

  clearError() {
    set({ error: null });
  },

  async startReembed(modelId: string, selectedScopes: ReembedScopeKey[]) {
    if (get().running) return;
    const db = getDatabase();
    if (!db) return;

    pauseRequested = false;
    const plan = await estimateReembedPlan(modelId);
    const chosen = plan.scopes.filter(
      (s) => selectedScopes.includes(s.scope) && s.remainingItems > 0
    );
    const grandTotal = chosen.reduce((sum, s) => sum + s.remainingItems, 0);

    if (grandTotal === 0) {
      set({
        running: false,
        paused: false,
        targetModelId: modelId,
        currentScopeLabel: null,
        completed: 0,
        total: 0,
        error: null,
      });
      return;
    }

    set({
      running: true,
      paused: false,
      targetModelId: modelId,
      currentScopeLabel: chosen[0]?.label ?? null,
      completed: 0,
      total: grandTotal,
      error: null,
    });

    let completed = 0;

    try {
      const contextual = modelSupportsContextualEmbeddings(modelId);

      // Helper for passage-backed scopes (bible, church, personal)
      const runPassageScope = async (
        label: string,
        whereSql: string
      ): Promise<void> => {
        set({ currentScopeLabel: label });
        while (!pauseRequested) {
          const rows = await db.getAllAsync<{
            id: number;
            book_id: string;
            text: string;
            division: string | null;
            title: string | null;
            author: string | null;
          }>(
            `SELECT p.id, p.book_id, p.text, p.division, b.title, b.author
             FROM passages p
             LEFT JOIN books b ON b.id = p.book_id
             LEFT JOIN personal_books pb ON pb.book_id = p.book_id
             LEFT JOIN passage_vectors pv
               ON pv.passage_id = p.id AND pv.model_id = ?
             WHERE ${whereSql} AND pv.passage_id IS NULL
             ORDER BY p.book_id, p.id
             LIMIT ?;`,
            [modelId, BATCH_SIZE]
          );
          if (rows.length === 0) break;

          const texts = rows.map((r) => {
            const ctx = [r.title, r.author, r.division].filter(Boolean).join(' · ');
            return ctx ? `[${ctx}]\n${r.text}` : r.text;
          });
          const vecs = await embedTextsViaOpenRouter(texts, {
            modelId,
            inputType: 'document',
            contextualDocumentChunks: contextual,
          });
          const ts = Date.now();
          for (let j = 0; j < Math.min(rows.length, vecs.length); j++) {
            const vec = vecs[j];
            if (!vec || vec.length === 0) continue;
            const { quantized, scale } = quantizeVectorInt8(vec);
            const blob = new Uint8Array(
              quantized.buffer,
              quantized.byteOffset,
              quantized.byteLength
            );
            await db.runAsync(
              `INSERT OR REPLACE INTO passage_vectors
                 (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?);`,
              [rows[j].id, rows[j].book_id, modelId, vec.length, scale, blob, ts]
            );
            completed++;
          }
          set({ completed: Math.min(completed, grandTotal) });
        }
      };

      if (selectedScopes.includes('bible') && !pauseRequested) {
        await runPassageScope('Scripture (WEB Bible)', `p.translation = 'WEB'`);
      }

      if (selectedScopes.includes('church') && !pauseRequested) {
        await runPassageScope(
          'Downloaded Church Library',
          `p.translation IS NULL AND pb.book_id IS NULL`
        );
      }

      if (selectedScopes.includes('personal') && !pauseRequested) {
        await runPassageScope(
          'Personal Library',
          `pb.book_id IS NOT NULL AND pb.ocr_required = 0`
        );
      }

      if (selectedScopes.includes('journal') && !pauseRequested) {
        set({ currentScopeLabel: 'Journal & Diary Memories' });
        while (!pauseRequested) {
          const rows = await db.getAllAsync<{
            id: string;
            text: string;
          }>(
            `SELECT js.id, js.text
             FROM journal_segments js
             LEFT JOIN journal_segment_vectors jsv
               ON jsv.segment_id = js.id AND jsv.model_id = ?
             WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
               AND LENGTH(TRIM(COALESCE(js.text, ''))) >= 12
               AND jsv.segment_id IS NULL
             ORDER BY js.created_at DESC
             LIMIT ?;`,
            [modelId, BATCH_SIZE]
          );
          if (rows.length === 0) break;

          const vecs = await embedTextsViaOpenRouter(
            rows.map((r) => r.text),
            { modelId, inputType: 'query' }
          );
          const ts = Date.now();
          for (let j = 0; j < Math.min(rows.length, vecs.length); j++) {
            const vec = vecs[j];
            if (!vec || vec.length === 0) continue;
            const { quantized, scale } = quantizeVectorInt8(vec);
            const qBlob = new Uint8Array(
              quantized.buffer,
              quantized.byteOffset,
              quantized.byteLength
            );
            await db.runAsync(
              `INSERT OR REPLACE INTO journal_segment_vectors
                 (segment_id, model_id, dim, scale, vector_int8, vector_blob, updated_at)
               VALUES (?, ?, ?, ?, ?, NULL, ?);`,
              [rows[j].id, modelId, vec.length, scale, qBlob, ts]
            );
            completed++;
          }
          set({ completed: Math.min(completed, grandTotal) });
        }
      }

      if (selectedScopes.includes('highlights') && !pauseRequested) {
        set({ currentScopeLabel: 'Highlights & Notes' });
        while (!pauseRequested) {
          const rows = await db.getAllAsync<{
            id: string;
            verse_ref: string;
            selected_text: string | null;
            note_text: string | null;
            tags_json: string | null;
          }>(
            `SELECT h.id, h.verse_ref, h.selected_text, h.note_text, h.tags_json
             FROM highlights h
             LEFT JOIN highlight_vectors hv
               ON hv.highlight_id = h.id AND hv.kind = 'highlight' AND hv.model_id = ?
             WHERE LENGTH(TRIM(COALESCE(h.selected_text, ''))) >= 4
               AND hv.highlight_id IS NULL
             LIMIT ?;`,
            [modelId, BATCH_SIZE]
          );
          if (rows.length === 0) break;

          const prompts = rows.map((r) => {
            let tags: string[] = [];
            try {
              tags = r.tags_json ? (JSON.parse(r.tags_json) as string[]) : [];
            } catch {
              tags = [];
            }
            return buildHighlightEmbedText({
              sourceLabel: r.verse_ref,
              verseRef: r.verse_ref,
              selectedText: r.selected_text ?? r.verse_ref,
              tags,
            });
          });
          const vecs = await embedTextsViaOpenRouter(prompts, {
            modelId,
            inputType: 'document',
          });
          const ts = Date.now();
          for (let j = 0; j < Math.min(rows.length, vecs.length); j++) {
            const vec = vecs[j];
            if (!vec || vec.length === 0) continue;
            const { quantized, scale } = quantizeVectorInt8(vec);
            const blob = new Uint8Array(
              quantized.buffer,
              quantized.byteOffset,
              quantized.byteLength
            );
            const vecId = `${rows[j].id}:highlight:${modelId}`;
            await db.runAsync(
              `INSERT OR REPLACE INTO highlight_vectors
                 (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
               VALUES (?, ?, 'highlight', ?, ?, ?, ?, ?, ?);`,
              [vecId, rows[j].id, modelId, vec.length, scale, blob, rows[j].verse_ref, ts]
            );
            // Also embed note if present
            if (rows[j].note_text && rows[j].note_text!.trim().length >= 3) {
              const notePrompt = buildNoteEmbedText({
                sourceLabel: rows[j].verse_ref,
                verseRef: rows[j].verse_ref,
                selectedText: rows[j].selected_text ?? '',
                noteText: rows[j].note_text!,
              });
              const [noteVec] = await embedTextsViaOpenRouter([notePrompt], {
                modelId,
                inputType: 'document',
              });
              if (noteVec && noteVec.length > 0) {
                const nq = quantizeVectorInt8(noteVec);
                const nBlob = new Uint8Array(
                  nq.quantized.buffer,
                  nq.quantized.byteOffset,
                  nq.quantized.byteLength
                );
                await db.runAsync(
                  `INSERT OR REPLACE INTO highlight_vectors
                     (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
                   VALUES (?, ?, 'note', ?, ?, ?, ?, ?, ?);`,
                  [
                    `${rows[j].id}:note:${modelId}`,
                    rows[j].id,
                    modelId,
                    noteVec.length,
                    nq.scale,
                    nBlob,
                    rows[j].verse_ref,
                    ts,
                  ]
                );
              }
            }
            completed++;
          }
          set({ completed: Math.min(completed, grandTotal) });
        }
      }

      clearLibraryVectors();
      clearHighlightVectors();

      set({
        running: false,
        paused: pauseRequested,
        currentScopeLabel: null,
        completed: Math.min(completed, grandTotal),
      });
    } catch (err) {
      clearLibraryVectors();
      clearHighlightVectors();
      const msg =
        err instanceof OpenRouterApiError && err.code === 'insufficient_credits'
          ? 'Paused — OpenRouter credits exhausted. Top up credits and resume.'
          : err instanceof Error
            ? err.message
            : 'Re-embedding failed.';
      set({
        running: false,
        paused: true,
        error: msg,
      });
    }
  },
}));

// ── Multi-Model Vector Storage Manager ──────────────────────────────────────

export async function listStoredVectorModels(): Promise<StoredVectorModelStats[]> {
  const db = getDatabase();
  if (!db) return [];

  const map = new Map<string, StoredVectorModelStats>();
  const ensure = (id: string): StoredVectorModelStats => {
    let entry = map.get(id);
    if (!entry) {
      entry = {
        modelId: id,
        passageVectors: 0,
        journalVectors: 0,
        highlightVectors: 0,
        estimatedBytes: 0,
      };
      map.set(id, entry);
    }
    return entry;
  };

  try {
    const pvRows = await db.getAllAsync<{
      model_id: string;
      cnt: number;
      bytes: number | null;
    }>(
      `SELECT model_id, COUNT(*) AS cnt, SUM(LENGTH(vector_int8)) AS bytes
       FROM passage_vectors GROUP BY model_id;`
    );
    for (const r of pvRows) {
      const e = ensure(r.model_id);
      e.passageVectors = r.cnt;
      e.estimatedBytes += r.bytes ?? 0;
    }

    const jvRows = await db.getAllAsync<{
      model_id: string;
      cnt: number;
      bytes: number | null;
    }>(
      `SELECT model_id, COUNT(*) AS cnt,
              SUM(COALESCE(LENGTH(vector_int8), LENGTH(vector_blob), 0)) AS bytes
       FROM journal_segment_vectors GROUP BY model_id;`
    );
    for (const r of jvRows) {
      const e = ensure(r.model_id);
      e.journalVectors = r.cnt;
      e.estimatedBytes += r.bytes ?? 0;
    }

    const hvRows = await db.getAllAsync<{
      model_id: string;
      cnt: number;
      bytes: number | null;
    }>(
      `SELECT model_id, COUNT(*) AS cnt, SUM(LENGTH(vector_int8)) AS bytes
       FROM highlight_vectors GROUP BY model_id;`
    );
    for (const r of hvRows) {
      const e = ensure(r.model_id);
      e.highlightVectors = r.cnt;
      e.estimatedBytes += r.bytes ?? 0;
    }
  } catch {
    // ignore pre-migration
  }

  return Array.from(map.values()).sort(
    (a, b) => b.estimatedBytes - a.estimatedBytes
  );
}

export async function deleteVectorsForModel(modelId: string): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  await db.runAsync(`DELETE FROM passage_vectors WHERE model_id = ?;`, [modelId]);
  await db.runAsync(`DELETE FROM journal_segment_vectors WHERE model_id = ?;`, [modelId]);
  await db.runAsync(`DELETE FROM highlight_vectors WHERE model_id = ?;`, [modelId]);
  clearLibraryVectors();
  clearHighlightVectors();
}
