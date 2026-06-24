/**
 * JSON file-based store — no native dependencies, works everywhere.
 * Stand-in for Supabase. Persists to /tmp on Railway (volatile) or 
 * RAILWAY_VOLUME_MOUNT_PATH (persistent volume) if available.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : '/tmp';
const DB_FILE = path.join(DB_DIR, 'resonance-db.json');

interface DBState {
  journal_entries: { id: string; text: string; created_at: number; updated_at: number }[];
  bookmarks: { id: string; verse_ref: string; label: string | null; created_at: number }[];
  highlights: { id: string; verse_ref: string; color: string; created_at: number }[];
  annotations: { id: string; verse_ref: string; translation: string; text: string; created_at: number }[];
  settings: Record<string, string>;
}

const DEFAULT_STATE: DBState = {
  journal_entries: [],
  bookmarks: [],
  highlights: [],
  annotations: [],
  settings: {},
};

let state: DBState | null = null;

function ensureLoaded(): DBState {
  if (state) return state;
  try {
    if (existsSync(DB_FILE)) {
      state = JSON.parse(readFileSync(DB_FILE, 'utf-8'));
    } else {
      state = { ...DEFAULT_STATE };
      save();
    }
  } catch {
    state = { ...DEFAULT_STATE };
  }
  return state!;
}

function save() {
  if (!state) return;
  try {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Best effort persistence
  }
}

function genId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Journal entries ────────────────────────────────────────────────────────

export function getJournalEntries() {
  return ensureLoaded().journal_entries.sort((a, b) => b.created_at - a.created_at);
}

export function createJournalEntry(text: string) {
  const s = ensureLoaded();
  const entry = { id: genId(), text, created_at: now(), updated_at: now() };
  s.journal_entries.push(entry);
  save();
  return entry;
}

export function updateJournalEntry(id: string, text: string) {
  const s = ensureLoaded();
  const entry = s.journal_entries.find(e => e.id === id);
  if (entry) {
    entry.text = text;
    entry.updated_at = now();
    save();
  }
  return { ok: true };
}

export function deleteJournalEntry(id: string) {
  const s = ensureLoaded();
  s.journal_entries = s.journal_entries.filter(e => e.id !== id);
  save();
  return { ok: true };
}

// ── Bookmarks ─────────────────────────────────────────────────────────────

export function getBookmarks() {
  return ensureLoaded().bookmarks.sort((a, b) => b.created_at - a.created_at);
}

export function createBookmark(verseRef: string, label: string | null) {
  const s = ensureLoaded();
  const bookmark = { id: genId(), verse_ref: verseRef, label, created_at: now() };
  s.bookmarks.push(bookmark);
  save();
  return bookmark;
}

export function deleteBookmark(id: string) {
  const s = ensureLoaded();
  s.bookmarks = s.bookmarks.filter(b => b.id !== id);
  save();
  return { ok: true };
}

// ── Highlights ────────────────────────────────────────────────────────────

export function getHighlights(verseRefPrefix?: string) {
  const hls = ensureLoaded().highlights;
  if (verseRefPrefix) {
    return hls.filter(h => h.verse_ref.startsWith(verseRefPrefix));
  }
  return hls;
}

export function createHighlight(verseRef: string, color: string) {
  const s = ensureLoaded();
  // Remove existing highlight for this verse_ref
  s.highlights = s.highlights.filter(h => h.verse_ref !== verseRef);
  const highlight = { id: genId(), verse_ref: verseRef, color, created_at: now() };
  s.highlights.push(highlight);
  save();
  return highlight;
}

export function deleteHighlight(id: string) {
  const s = ensureLoaded();
  s.highlights = s.highlights.filter(h => h.id !== id);
  save();
  return { ok: true };
}

// ── Annotations ───────────────────────────────────────────────────────────

export function getAnnotations(verseRefPrefix?: string, translation?: string) {
  let rows = ensureLoaded().annotations;
  if (verseRefPrefix) {
    rows = rows.filter(a => a.verse_ref.startsWith(verseRefPrefix));
  }
  if (translation) {
    rows = rows.filter(a => a.translation.toLowerCase() === translation.toLowerCase());
  }
  return rows.sort((a, b) => b.created_at - a.created_at);
}

export function createAnnotation(verseRef: string, translation: string, text: string) {
  const s = ensureLoaded();
  s.annotations = s.annotations.filter(a => !(a.verse_ref === verseRef && a.translation.toLowerCase() === translation.toLowerCase()));
  if (text.trim().length === 0) {
    save();
    return { ok: true };
  }
  const annotation = { id: genId(), verse_ref: verseRef, translation, text: text.trim(), created_at: now() };
  s.annotations.push(annotation);
  save();
  return annotation;
}

export function deleteAnnotation(id: string) {
  const s = ensureLoaded();
  s.annotations = s.annotations.filter(a => a.id !== id);
  save();
  return { ok: true };
}

// ── Settings ──────────────────────────────────────────────────────────────

export function getSettings(): Record<string, string> {
  return { ...ensureLoaded().settings };
}

export function setSetting(key: string, value: string) {
  const s = ensureLoaded();
  s.settings[key] = value;
  save();
  return { ok: true };
}
