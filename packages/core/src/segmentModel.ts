/**
 * Journal segment model — typed domain layer over the `journal_segments` table.
 *
 * A journal document is an ordered list of segments. Most are editable `text`
 * blocks; a few are non-editable structural markers (date dividers, verse-of-day
 * cards, footnotes, resonance cards) that sit in the same flow. Ordering is
 * purely by `position_index` (oldest first, newest last) — the list reads top
 * to bottom like a continuous living document.
 *
 * (design spec §3.1, §5.2 — segment types & positioning)
 */

import type { JournalSegment, SegmentType } from './types';

/** Raw SQLite row — `segment_type` is a plain string until narrowed. */
export interface SegmentRow {
  id: string;
  created_at: number;
  updated_at: number;
  segment_type: string;
  text: string | null;
  position_index: number;
  parent_date: string | null;
}

/** Narrow a raw DB row into a typed segment (validates `segment_type`). */
export function rowToSegment(row: SegmentRow): JournalSegment {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    segment_type: row.segment_type as SegmentType,
    text: row.text,
    position_index: row.position_index,
    parent_date: row.parent_date,
  };
}

// ── Type guards / predicates ──────────────────────────────────────────────────

export function isTextSegment(s: JournalSegment): boolean {
  return s.segment_type === 'text';
}

export function isNonTextSegment(s: JournalSegment): boolean {
  return s.segment_type !== 'text';
}

// ── Ordering ──────────────────────────────────────────────────────────────────

/** Return a new array sorted ascending by `position_index` (oldest → newest). */
export function sortSegments(segments: JournalSegment[]): JournalSegment[] {
  return [...segments].sort((a, b) => a.position_index - b.position_index);
}

/**
 * Re-stamp `position_index` so the array is contiguous 0..n-1 in its current
 * order. Returns shallow copies; never mutates inputs.
 */
export function reindexPositions(segments: JournalSegment[]): JournalSegment[] {
  return segments.map((s, i) => ({ ...s, position_index: i }));
}

// ── Construction ──────────────────────────────────────────────────────────────

/**
 * Generate a locally-unique segment id. Combines time + randomness — good
 * enough for a single-device journal (no server coordination needed).
 */
export function generateSegmentId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/** Build a new segment object (not yet persisted). */
export function createSegment(
  type: SegmentType,
  text: string | null,
  position_index: number,
  parent_date: string | null,
  overrides?: Partial<JournalSegment>
): JournalSegment {
  const now = Date.now();
  return {
    id: overrides?.id ?? generateSegmentId(),
    created_at: overrides?.created_at ?? now,
    updated_at: overrides?.updated_at ?? now,
    segment_type: type,
    text,
    position_index,
    parent_date,
    ...overrides,
  };
}

// ── Date helpers (local calendar day, no UTC drift) ───────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for the local calendar day of `d` (defaults to now). */
export function toParentDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Derive the `YYYY-MM-DD` parent date from a unix-ms timestamp. */
export function parentDateFromTimestamp(ts: number): string {
  return toParentDate(new Date(ts));
}

/** Day-of-year (1..366) for the local calendar day, used to index verse data. */
export function dayOfYear(d: Date = new Date()): number {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start;
  return Math.floor(diff / 86_400_000);
}

/** Parse a `YYYY-MM-DD` string into a local Date at midnight. */
export function parentDateToDate(parentDate: string): Date {
  const [y, m, d] = parentDate.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Format a date for the soft inline divider, e.g. "Wednesday, June 24".
 * Uses `Intl` when available (Hermes ships it); falls back to manual names.
 */
export function formatDateLong(d: Date = new Date()): string {
  const weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  try {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    return `${weekday}, ${month} ${d.getDate()}`;
  } catch {
    return `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  }
}

/**
 * True when `ts` falls on a different local calendar day than `prevParentDate`.
 * Used to decide whether a new date divider should be auto-inserted.
 */
export function isNewDay(
  ts: number,
  prevParentDate: string | null
): boolean {
  if (!prevParentDate) return true;
  return parentDateFromTimestamp(ts) !== prevParentDate;
}
