/**
 * Focus manager — single editable segment + cursor + boundary logic.
 *
 * The journal is one continuous flow, but only one text segment is editable at
 * any moment (the *active* one — a TextInput); every other segment is a static
 * rendered cell. Tapping a segment moves focus cleanly; typing, backspacing,
 * pasting, and pressing Return all flow through here so structural changes
 * (splits, merges, paste-split) stay consistent with the document store.
 *
 * Keystroke edits land in `journalStore` immediately (the in-memory list), and
 * the store's debounced auto-save persists them. So this module only decides
 * *what* changed, never *when* to write.
 *
 * (design spec §5.3 — single editable segment, focus transitions, boundaries)
 */

import { create } from 'zustand';
import { Keyboard, Platform } from 'react-native';

import { useJournalStore, markStructuralDirty } from './journalStore';
import {
  type JournalSegment,
  createSegment,
  isMediaSegment,
  isNonTextSegment,
  isTextSegment,
} from './segmentModel';

export interface FocusState {
  /** id of the segment currently rendered as a TextInput. Null = nothing editable. */
  activeSegmentId: string | null;
  /** Caret offset within the active segment's text. */
  cursorPosition: number;
  /** Current on-screen keyboard height (px); 0 when hidden. */
  keyboardHeight: number;

  // ── Focus transitions & cursor API ──────────────────────────────────────────
  /** Make `segmentId` the active segment at an optional caret offset. */
  focusSegment: (segmentId: string | null, cursorPos?: number) => void;
  /** Clear the active segment (the input blurs / becomes static). */
  blur: () => void;
  /** Imperative cursor read (for tests / eds). */
  getCursorPosition: () => number;
  /** Set the caret imperatively (e.g. after a merge so it lands at the join). */
  setCursorPosition: (pos: number) => void;

  // ── Keyboard avoidance ────────────────────────────────────────────────────────
  /** Attach keyboard listeners. Returns an unsubscribe function. */
  initKeyboardListeners: () => () => void;

  // ── Editing actions (called by the active TextInput's event handlers) ─────────
  /** Normal keystroke path — text of the input changed. */
  handleChangeText: (segmentId: string, nextText: string) => void;
  /** Backspace pressed while caret at offset 0 — attempt a boundary merge. */
  handleBackspace: (segmentId: string, cursorPos: number) => void;
  /** Paste of `pasted` at `cursorPos` — multi-paragraph text splits. */
  handlePaste: (segmentId: string, pasted: string, cursorPos: number) => void;
  /** Return key — inserts a line break within the same segment (no new segment). */
  handleReturn: (segmentId: string, cursorPos: number) => void;
}

// ── Helpers: locate a segment in the ordered document ───────────────────────────—

/** Snapshot of the current segments + position of the segment by id. */
interface SegmentContext {
  seg: JournalSegment;
  index: number;
  prev: JournalSegment | null;
  prevText: JournalSegment | null;
}

function segmentContext(
  segs: JournalSegment[],
  id: string
): SegmentContext | null {
  const index = segs.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const seg = segs[index];
  const prev = index > 0 ? segs[index - 1] : null;
  // The closest *text* sibling before this one (skipping non-text markers).
  let prevText: JournalSegment | null = null;
  for (let i = index - 1; i >= 0; i--) {
    if (isTextSegment(segs[i])) {
      prevText = segs[i];
      break;
    }
  }
  return { seg, index, prev, prevText };
}

export const useFocusStore = create<FocusState>((set, get) => ({
  activeSegmentId: null,
  cursorPosition: 0,
  keyboardHeight: 0,

  // ── Focus transitions ──────────────────────────────────────────────────────────
  focusSegment: (segmentId, cursorPos) => {
    if (segmentId === null) {
      set({ activeSegmentId: null });
      return;
    }
    // Move focus cleanly: the previously-active segment simply re-renders as a
    // static cell next pass (driven by `activeSegmentId` in the renderer).
    const segs = useJournalStore.getState().segments;
    const target = segs.find((s) => s.id === segmentId);
    const pos =
      cursorPos !== undefined
        ? cursorPos
        : // Default caret to the end of the segment's existing text.
          (target?.text?.length ?? 0);
    set({ activeSegmentId: segmentId, cursorPosition: pos });
  },

  blur: () => set({ activeSegmentId: null, cursorPosition: 0 }),

  getCursorPosition: () => get().cursorPosition,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),

  // ── Keyboard avoidance ─────────────────────────────────────────────────────────
  initKeyboardListeners: () => {
    // iOS fires `will` events; Android only `did`. Listen to both via a shared
    // handler so the active input is lifted above the keyboard on either OS.
    const onShow = (e: { endCoordinates?: { height?: number } }) => {
      const h = e.endCoordinates?.height ?? 0;
      set({ keyboardHeight: h });
    };
    const onHide = () => set({ keyboardHeight: 0 });
    const willShow = Keyboard.addListener('keyboardWillShow', onShow);
    const didShow = Keyboard.addListener('keyboardDidShow', onShow);
    const willHide = Keyboard.addListener('keyboardWillHide', onHide);
    const didHide = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      willShow.remove();
      didShow.remove();
      willHide.remove();
      didHide.remove();
    };
  },

  // ── Editing actions ────────────────────────────────────────────────────────────

  handleChangeText: (segmentId, nextText) => {
    // Plain typing: update the segment text in place. No split — line breaks
    // stay inside the segment (Return is also a line break, see handleReturn).
    useJournalStore.getState().updateSegmentText(segmentId, nextText);
  },

  handleBackspace: (segmentId, cursorPos) => {
    // Only act when the caret sits at the very start of the segment. The
    // TextInput itself handles in-segment deletions; this is the boundary case.
    if (cursorPos !== 0) return;

    const store = useJournalStore.getState();
    const segs = store.segments;
    const ctx = segmentContext(segs, segmentId);
    if (!ctx) return;
    const { seg, index } = ctx;

    const prev = index > 0 ? segs[index - 1] : null;

    if (!prev) return; // nothing before — at document start.

    if (isTextSegment(prev)) {
      // Merge two adjacent text segments: prepend prev's text to the current
      // segment, delete prev, drop the caret right at the join.
      const left = prev.text ?? '';
      const right = seg.text ?? '';
      const mergedText = left + right;
      const newSeg: JournalSegment = {
        ...seg,
        text: mergedText,
        updated_at: Date.now(),
      };
      // Replace prev+seg with the single merged segment, keep the rest.
      const next = [
        ...segs.slice(0, index - 1),
        newSeg,
        ...segs.slice(index + 1),
      ];
      store._replaceSegments(next); // reindex handled by store flush path
      // Mark dirty via the store so the merge persists.
      useJournalStore.setState({ segments: next });
      markStructuralDirty(next, [prev.id], [newSeg]);
      set({ activeSegmentId: seg.id, cursorPosition: left.length });
      return;
    }

    // Never let a stray Backspace silently delete a Voice, Photo, or Video
    // memory — media cards have an explicit delete confirmation button.
    if (isMediaSegment(prev)) {
      return;
    }

    // Prev is a non-text marker (date divider / card / footnote). Removing it
    // and merging the text segments that bracket it is the spec'd behaviour:
    // "backspacing through a non-text segment boundary removes the segment and
    // merges adjacent text segments."
    const prevText = ctx.prevText;
    if (prevText) {
      const left = prevText.text ?? '';
      const right = seg.text ?? '';
      const mergedText = left + right;
      const mergedSeg: JournalSegment = {
        ...prevText,
        text: mergedText,
        updated_at: Date.now(),
      };
      // Remove both `prevText` and `prev`; replace `seg` with the merged copy
      // living on prevText's id so the caret segment identity is prevText.
      const next = segs.filter(
        (s) => s.id !== prev.id && s.id !== prevText.id && s.id !== seg.id
      );
      const insertAt = Math.min(
        index - 2 < 0 ? 0 : index - 2,
        next.length
      );
      // Re-insert the merged segment where `prevText` originally was, and make
      // *that* the active id so the caret lives over the joined text.
      const reordered = [
        ...next.slice(0, insertAt),
        mergedSeg,
        ...next.slice(insertAt),
      ];
      useJournalStore.setState({ segments: reordered });
      markStructuralDirty(reordered, [prev.id, prevText.id, seg.id], [mergedSeg]);
      set({ activeSegmentId: mergedSeg.id, cursorPosition: left.length });
    } else {
      // No text to merge with before the marker — just remove the marker.
      const next = segs.filter((s) => s.id !== prev.id);
      useJournalStore.setState({ segments: next });
      markStructuralDirty(next, [prev.id], []);
      set({ activeSegmentId: seg.id, cursorPosition: 0 });
    }
  },

  handlePaste: (segmentId, pastedRaw, cursorPos) => {
    const pasted = pastedRaw.replace(/\r\n/g, '\n');
    const store = useJournalStore.getState();
    const segs = store.segments;
    const ctx = segmentContext(segs, segmentId);
    if (!ctx) {
      // Defensive: if the active id isn't found, just update nothing.
      return;
    }
    const { seg, index } = ctx;
    const full = seg.text ?? '';
    const before = full.slice(0, cursorPos);
    const after = full.slice(cursorPos);

    // Split pasted text at paragraph boundaries (blank lines). Single newlines
    // inside a piece stay as line breaks within that segment.
    const pieces = pasted.split(/\n{2,}/);

    if (pieces.length <= 1) {
      // Single paragraph (or empty): plain insertion into this segment.
      const merged = before + pasted + after;
      store.updateSegmentText(segmentId, merged);
      set({ activeSegmentId: segmentId, cursorPosition: before.length + pasted.length });
      return;
    }

    // Multi-paragraph: the first piece rejoins the active segment's leading
    // text; the last piece rejoins its trailing text; middle pieces become
    // fresh text segments of their own (in the same parent_date).
    const parentDate = seg.parent_date;
    const firstText = before + pieces[0];
    const lastText = pieces[pieces.length - 1] + after;
    const updatedFirst: JournalSegment = {
      ...seg,
      text: firstText,
      updated_at: Date.now(),
    };
    const middleSegs: JournalSegment[] = pieces.slice(1, -1).map((p, i) =>
      createSegment('text', p, /* re-stamped below */ i, parentDate)
    );
    const lastSeg: JournalSegment = createSegment(
      'text',
      lastText,
      /* re-stamped below */ 0,
      parentDate
    );
    const newRun = [updatedFirst, ...middleSegs, lastSeg];

    store.replaceRange(index, newRun);
    // Move focus to the last new segment, caret right at the end of the
    // pasted content (before any pre-existing trailing text).
    set({
      activeSegmentId: lastSeg.id,
      cursorPosition: pieces[pieces.length - 1].length,
    });
  },

  handleReturn: (segmentId, cursorPos) => {
    // Return is a line break *within* the same segment — explicitly not a new
    // segment. Insert "\n" at the caret and advance the caret past it.
    const segs = useJournalStore.getState().segments;
    const seg = segs.find((s) => s.id === segmentId);
    if (!seg) return;
    const full = seg.text ?? '';
    const next = full.slice(0, cursorPos) + '\n' + full.slice(cursorPos);
    useJournalStore.getState().updateSegmentText(segmentId, next);
    set({ activeSegmentId: segmentId, cursorPosition: cursorPos + 1 });
  },

  // `Platform` is imported for side-effect-free platform awareness; keep the
  // reference alive so tree-shaking doesn't warn in some build configs.
  _platform: Platform.OS,
}) as FocusState & { _platform: string });
