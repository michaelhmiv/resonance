/**
 * Journal document store — the living document state.
 *
 * Single source of truth for the ordered segment list. Loads from SQLite on
 * mount (sorted by `position_index`), and persists edits through a debounced
 * auto-save (~1.2s after the last keystroke) so writing always feels local and
 * immediate while the database stays consistent.
 *
 * Structural edits (insert / delete / paste / merge) run entirely in memory and
 * re-stamp `position_index` to stay contiguous; only the affected + repositioned
 * rows are flushed, so saving is cheap even on a months-long document.
 *
 * (design spec §3.2, §5.4 — segments, auto-save, ordering)
 */

import { create } from 'zustand';

import type { DatabaseConnection } from '../db/database';
import type { SegmentRow } from './segmentModel';
import {
  type JournalSegment,
  rowToSegment,
  sortSegments,
  reindexPositions,
} from './segmentModel';

/** Debounce window after the last edit before flushing to SQLite. */
const SAVE_DEBOUNCE_MS = 1200;

export interface JournalStoreState {
  /** Ordered segments (oldest first). */
  segments: JournalSegment[];
  /** True while the initial load from SQLite is in flight. */
  loading: boolean;
  /** True while a debounced flush is writing to SQLite. */
  saving: boolean;
  /** Ms timestamp of the last successful flush (null until first save). */
  lastSavedAt: number | null;

  /** Load all segments from SQLite, sorted by position_index. */
  load: (db: DatabaseConnection) => Promise<void>;
  /** Insert one segment at `atIndex` (default: end). */
  insertSegment: (seg: JournalSegment, atIndex?: number) => void;
  /** Insert a run of segments (e.g. paste-split) starting at `atIndex`. */
  insertSegments: (segs: JournalSegment[], atIndex: number) => void;
  /** Replace the segment at `id`'s text (the normal keystroke path). */
  updateSegmentText: (id: string, text: string) => void;
  /** Delete a segment by id. */
  deleteSegment: (id: string) => void;
  /** Replace the run beginning at `startIndex` with `newSegs`. */
  replaceRange: (startIndex: number, newSegs: JournalSegment[]) => void;
  /** Re-stamp ordering so positions are contiguous (no-op for save otherwise). */
  reorderSegments: () => void;
  /** Flush any pending writes to SQLite now. */
  flush: () => Promise<void>;
  /** Test helper: replace the whole list without touching SQLite. */
  _replaceSegments: (segs: JournalSegment[]) => void;
}

// ── Module-level save plumbing ──────────────────────────────────────────────────
// Kept outside the store so the debounce timer + dirty sets survive renders
// without being copied into React state.

let dbRef: DatabaseConnection | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const pendingUpserts = new Map<string, JournalSegment>();
const pendingDeletes = new Set<string>();
let savingInFlight = false;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushPending();
  }, SAVE_DEBOUNCE_MS);
}

/** Upsert a single segment (and cancel any pending delete for it). */
function markDirty(seg: JournalSegment): void {
  pendingDeletes.delete(seg.id);
  pendingUpserts.set(seg.id, seg);
  scheduleSave();
}

/** Queue a segment for deletion (and drop any pending upsert). */
function markDeleted(id: string): void {
  pendingDeletes.add(id);
  pendingUpserts.delete(id);
  scheduleSave();
}

/**
 * Apply structural dirtiness: queue `deletedIds` for DB removal and
 * `upsertSegs` for DB write. The `segments` argument is the new full
 * list (also installed via setState by the caller, so only the dirty
 * tracking happens here).
 *
 * Also re-stamps position_index on any upsert whose position changed
 * relative to the pending state, so structural edits that shift indices
 * are persisted correctly.
 */
export function markStructuralDirty(
  _segments: JournalSegment[],
  deletedIds: string[],
  upsertSegs: JournalSegment[]
): void {
  for (const id of deletedIds) {
    markDeleted(id);
  }
  for (const seg of upsertSegs) {
    markDirty(seg);
  }
}

/** Write every queued upsert + delete in one transaction, then clear. */
export async function flushPending(): Promise<void> {
  if (savingInFlight) return;
  const db = dbRef;
  if (!db) return;
  // Nothing to do — keep `saving` false so the chrome never flashes.
  if (pendingUpserts.size === 0 && pendingDeletes.size === 0) return;

  savingInFlight = true;
  useJournalStore.setState({ saving: true });
  try {
    const toWrite = Array.from(pendingUpserts.values());
    const toDelete = Array.from(pendingDeletes);
    await db.withTransactionAsync(async () => {
      for (const seg of toWrite) {
        await db.runAsync(
          `INSERT OR REPLACE INTO journal_segments
            (id, created_at, updated_at, segment_type, text, position_index, parent_date)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          seg.id,
          seg.created_at,
          seg.updated_at,
          seg.segment_type,
          seg.text,
          seg.position_index,
          seg.parent_date
        );
      }
      for (const id of toDelete) {
        await db.runAsync(`DELETE FROM journal_segments WHERE id = ?;`, id);
      }
    });
    pendingUpserts.clear();
    pendingDeletes.clear();
    useJournalStore.setState({ saving: false, lastSavedAt: Date.now() });
  } catch (err) {
    useJournalStore.setState({ saving: false });
    // eslint-disable-next-line no-console
    console.error('[journalStore] flush failed:', err);
    throw err;
  } finally {
    savingInFlight = false;
  }
}

/**
 * Apply a structural edit (insert/delete/replace), reindex positions, and mark
 * dirty every row whose identity or position changed relative to before.
 */
function applyStructure(
  newSegments: JournalSegment[],
  touchedIds: string[]
): void {
  const prev = useJournalStore.getState().segments;
  const prevPos = new Map(prev.map((s) => [s.id, s.position_index]));
  const reindexed = reindexPositions(newSegments);

  for (const s of reindexed) {
    const before = prevPos.get(s.id);
    if (touchedIds.includes(s.id) || before !== s.position_index) {
      markDirty(s);
    }
  }

  useJournalStore.setState({ segments: reindexed });
}

export const useJournalStore = create<JournalStoreState>((set, get) => ({
  segments: [],
  loading: false,
  saving: false,
  lastSavedAt: null,

  load: async (db) => {
    dbRef = db;
    set({ loading: true });
    try {
      const rows = await db.getAllAsync<SegmentRow>(
        `SELECT id, created_at, updated_at, segment_type, text, position_index, parent_date
         FROM journal_segments ORDER BY position_index ASC;`
      );
      const segments = sortSegments(rows.map(rowToSegment));
      set({ segments, loading: false, lastSavedAt: Date.now() });
    } catch (err) {
      set({ loading: false });
      // eslint-disable-next-line no-console
      console.error('[journalStore] load failed:', err);
      throw err;
    }
  },

  insertSegment: (seg, atIndex) => {
    const segs = get().segments;
    const idx = atIndex ?? segs.length;
    applyStructure([...segs.slice(0, idx), seg, ...segs.slice(idx)], [seg.id]);
  },

  insertSegments: (newSegs, atIndex) => {
    const segs = get().segments;
    const next = [
      ...segs.slice(0, atIndex),
      ...newSegs,
      ...segs.slice(atIndex),
    ];
    applyStructure(next, newSegs.map((s) => s.id));
  },

  updateSegmentText: (id, text) => {
    const segs = get().segments;
    let changed: JournalSegment | null = null;
    set({
      segments: segs.map((s) => {
        if (s.id !== id) return s;
        changed = { ...s, text, updated_at: Date.now() };
        return changed;
      }),
    });
    if (changed) {
      markDirty(changed);
    }
  },

  deleteSegment: (id) => {
    const segs = get().segments;
    applyStructure(
      segs.filter((s) => s.id !== id),
      []
    );
    markDeleted(id);
  },

  replaceRange: (startIndex, newSegs) => {
    const segs = get().segments;
    const safeStart = Math.max(0, Math.min(startIndex, segs.length));
    const next = [...segs.slice(0, safeStart), ...newSegs, ...segs.slice(safeStart + 1)];
    // The segment previously at safeStart is gone; everything from safeStart on
    // may have shifted ids — diffuse dirtiness to the new run + the tail.
    const touched = newSegs.map((s) => s.id);
    applyStructure(next, touched);
  },

  reorderSegments: () => {
    const segs = get().segments;
    applyStructure(segs, segs.map((s) => s.id));
  },

  flush: flushPending,

  _replaceSegments: (segs) => set({ segments: sortSegments(segs) }),
}));
