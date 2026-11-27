/**
 * Highlight & Margin Note Embedding Service (Mobile, 100% on-device).
 *
 * Closes the loop between reading annotations and Resonance's semantic vector
 * space:
 *   1. Upserts durable `resonance_nodes` & `resonance_events` (`highlight` / `note`)
 *   2. Embeds contextualized highlight phrases & user margin notes via
 *      Voyage-4-Nano INT8 (512d)
 *   3. Quantizes to int8 and persists in `highlight_vectors`
 *   4. Refreshes the in-memory highlight vector matrix in `resonanceService.ts`
 *   5. Lazily backfills any unembedded highlights once the offline engine is ready
 */

import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  buildHighlightEmbedText,
  buildNoteEmbedText,
  quantizeVectorInt8,
  type Highlight,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  deleteHighlightVectorKind,
  getAllFullHighlights,
  saveHighlightVectorInt8,
} from '../db/queries/readingQueries';
import {
  appendOfflineEvent,
  markOfflineNodeDeleted,
  upsertOfflineSourceNode,
} from './offlineAdaptiveStore';
import { embedPassage, ensureEmbeddingReady, isEmbeddingReady } from './embeddingService';
import { clearHighlightVectors } from './resonanceService';

let backfillRunning = false;

export interface EmbedHighlightContext {
  contextText?: string | null;
  sourceLabel?: string | null;
}

/**
 * Index a newly created or updated highlight (and optional margin note) into
 * both the adaptive node/event log and the 512d int8 `highlight_vectors` store.
 * Runs asynchronously without blocking the reader UI.
 */
export async function syncHighlightToResonance(
  highlight: Highlight,
  eventKind: 'created' | 'updated',
  extra?: EmbedHighlightContext
): Promise<void> {
  const sourceLabel = extra?.sourceLabel?.trim() || highlight.verse_ref;
  const selectedText = (highlight.selected_text ?? '').trim();
  const noteText = (highlight.note_text ?? '').trim();

  // 1. Always record durable adaptive nodes & events (even before models download)
  try {
    const hlBody = buildHighlightEmbedText({
      sourceLabel,
      verseRef: highlight.verse_ref,
      selectedText: selectedText || highlight.verse_ref,
      contextText: extra?.contextText,
      tags: highlight.tags,
    });
    const hlNode = await upsertOfflineSourceNode({
      nodeType: 'highlight',
      sourceTable: 'highlights',
      sourceId: highlight.id,
      title: sourceLabel,
      bodyText: hlBody,
      metadata: {
        verse_ref: highlight.verse_ref,
        book_id: highlight.book_id ?? null,
        chapter_id: highlight.chapter_id ?? null,
        color: highlight.color,
        tags: highlight.tags ?? [],
      },
    });
    await appendOfflineEvent({
      eventType: eventKind === 'created' ? 'highlight.created' : 'highlight.updated',
      sourceNodeId: hlNode?.id ?? null,
      sourceType: 'highlight',
      sourceId: highlight.id,
      payload: {
        verseRef: highlight.verse_ref,
        bookId: highlight.book_id ?? null,
        hasNote: noteText.length > 0,
        tags: highlight.tags ?? [],
      },
    });

    if (noteText.length >= 3) {
      const noteBody = buildNoteEmbedText({
        sourceLabel,
        verseRef: highlight.verse_ref,
        selectedText,
        noteText,
        tags: highlight.tags,
      });
      const noteNode = await upsertOfflineSourceNode({
        nodeType: 'note',
        sourceTable: 'highlights',
        sourceId: `${highlight.id}:note`,
        title: `Note on ${sourceLabel}`,
        bodyText: noteBody,
        metadata: {
          highlight_id: highlight.id,
          verse_ref: highlight.verse_ref,
          book_id: highlight.book_id ?? null,
        },
      });
      await appendOfflineEvent({
        eventType: 'note.updated',
        sourceNodeId: noteNode?.id ?? null,
        sourceType: 'note',
        sourceId: `${highlight.id}:note`,
        payload: { highlightId: highlight.id, verseRef: highlight.verse_ref },
      });
    } else {
      await markOfflineNodeDeleted('note', `${highlight.id}:note`).catch(() => {});
      await deleteHighlightVectorKind(highlight.id, 'note');
    }
  } catch {
    // Non-fatal: never interrupt the reader UX
  }

  // 2. Embed immediately via OpenRouter (if active) or on-device Voyage-4-Nano
  if (!(await ensureEmbeddingReady('journal'))) return;

  try {
    const { getActiveEmbeddingModelId } = await import('../openrouter/openrouterStore');
    const activeModel = getActiveEmbeddingModelId('journal');
    let changed = false;

    if (selectedText.length >= 4) {
      const hlPrompt = buildHighlightEmbedText({
        sourceLabel,
        verseRef: highlight.verse_ref,
        selectedText,
        contextText: extra?.contextText,
        tags: highlight.tags,
      });
      const vec = await embedPassage(hlPrompt, null, 'journal');
      if (vec && vec.length > 0) {
        const { quantized, scale } = quantizeVectorInt8(vec, vec.length);
        await saveHighlightVectorInt8({
          highlightId: highlight.id,
          kind: 'highlight',
          modelId: activeModel,
          dim: vec.length,
          scale,
          quantized,
          sourceLabel,
        });
        changed = true;
      }
    }

    if (noteText.length >= 3) {
      const notePrompt = buildNoteEmbedText({
        sourceLabel,
        verseRef: highlight.verse_ref,
        selectedText,
        noteText,
        tags: highlight.tags,
      });
      const noteVec = await embedPassage(notePrompt, null, 'journal');
      if (noteVec && noteVec.length > 0) {
        const { quantized, scale } = quantizeVectorInt8(noteVec, noteVec.length);
        await saveHighlightVectorInt8({
          highlightId: highlight.id,
          kind: 'note',
          modelId: activeModel,
          dim: noteVec.length,
          scale,
          quantized,
          sourceLabel,
        });
        changed = true;
      }
    }

    if (changed) {
      clearHighlightVectors();
    }
  } catch {
    // Non-fatal; backfill will retry when model is idle
  }
}

/** Remove highlight & note nodes + vectors from Resonance when deleted. */
export async function removeHighlightFromResonance(highlightId: string): Promise<void> {
  try {
    await deleteHighlightVectorKind(highlightId);
    const hlNode = await markOfflineNodeDeleted('highlight', highlightId).catch(() => null);
    await markOfflineNodeDeleted('note', `${highlightId}:note`).catch(() => null);
    await appendOfflineEvent({
      eventType: 'highlight.deleted',
      sourceNodeId: hlNode?.id ?? null,
      sourceType: 'highlight',
      sourceId: highlightId,
      payload: {},
    });
    clearHighlightVectors();
  } catch {
    // non-fatal
  }
}

/**
 * Lazily embed any highlights or margin notes that were saved before the
 * offline embedding model finished downloading. Safe to call repeatedly.
 */
export async function backfillUnembeddedHighlights(limit = 40): Promise<number> {
  if (backfillRunning) return 0;
  const db = getDatabase();
  if (!db) return 0;

  backfillRunning = true;
  let embedded = 0;
  try {
    const all = await getAllFullHighlights();
    const pending = all.filter(
      (h) =>
        h.embedded_at == null &&
        ((h.selected_text && h.selected_text.trim().length >= 4) ||
          (h.note_text && h.note_text.trim().length >= 3))
    );
    if (pending.length === 0) return 0;
    if (!(await ensureEmbeddingReady('journal'))) return 0;

    const { isOpenRouterEnabledForFeature } = await import('../openrouter/openrouterStore');
    for (const hl of pending.slice(0, limit)) {
      if (!isEmbeddingReady() && !isOpenRouterEnabledForFeature('embeddings', 'journal')) {
        break;
      }
      await syncHighlightToResonance(hl, 'updated');
      embedded++;
    }
  } catch {
    // non-fatal
  } finally {
    backfillRunning = false;
  }
  return embedded;
}
