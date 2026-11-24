/**
 * Settings data access — storage accounting, export, and the destructive
 * "clear" actions used by the Privacy & Data section.
 *
 * Everything here reads or writes the single local SQLite database. No data
 * leaves the device.
 *
 * (design spec §8.2 — Storage / Privacy)
 */

import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase, DATABASE_NAME } from '../database';
import { EMBEDDING_DIM } from '@resonance/core';

// ── Storage accounting ────────────────────────────────────────────────────

export interface PackageStorage {
  /** Human label, e.g. "Journal", "World English Bible". */
  label: string;
  /** Number of rows / units backing this figure. */
  count: number;
  /** Estimated bytes occupied by this package's content. */
  bytes: number;
}

export interface StorageInfo {
  /** On-disk size of the SQLite database file, if known. */
  dbFileSizeBytes: number;
  /** Sum of the per-package estimates (used when file size is unknown). */
  estimatedTotalBytes: number;
  packages: PackageStorage[];
}

interface CountRow {
  n: number;
  chars: number | null;
}

interface TranslationRow {
  translation: string | null;
  n: number;
  chars: number | null;
}

/** Friendly name for a translation / package slug, or the raw slug. */
function translationLabel(slug: string): string {
  const map: Record<string, string> = {
    WEB: 'World English Bible',
    KJV: 'King James Version',
    ASV: 'American Standard Version',
  };
  return map[slug] ?? slug;
}

/**
 * Compute storage usage. Tries the on-disk SQLite file size for the headline
 * figure; the package breakdown is always estimated from row counts + text
 * length + vector byte size.
 */
export async function getStorageInfo(): Promise<StorageInfo> {
  const db = getDatabase();
  const packages: PackageStorage[] = [];
  let estimatedTotal = 0;

  if (db) {
    try {
      // ── Journal ──────────────────────────────────────────────────────
      const j = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(text)), 0) AS chars
         FROM journal_segments WHERE segment_type = 'text';`
      );
      const jBytes = j?.chars ?? 0;
      packages.push({ label: 'Journal', count: j?.n ?? 0, bytes: jBytes });
      estimatedTotal += jBytes;

      // ── Per-translation Scripture ────────────────────────────────────
      const trans = await db.getAllAsync<TranslationRow>(
        `SELECT translation, COUNT(*) AS n, COALESCE(SUM(LENGTH(text)), 0) AS chars
         FROM passages
         WHERE translation IS NOT NULL
         GROUP BY translation
         ORDER BY translation;`
      );
      for (const t of trans) {
        const bytes = t.chars ?? 0;
        packages.push({
          label: translationLabel(t.translation ?? '?'),
          count: t.n,
          bytes,
        });
        estimatedTotal += bytes;
      }

      // ── Voices of the Church (translation IS NULL inside voice books) ─
      const v = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(p.text)), 0) AS chars
         FROM passages p
         LEFT JOIN books b ON b.id = p.book_id
         WHERE p.translation IS NULL OR b.type = 'voice';`
      );
      const vBytes = v?.chars ?? 0;
      packages.push({
        label: 'Voices of the Church',
        count: v?.n ?? 0,
        bytes: vBytes,
      });
      estimatedTotal += vBytes;

      // ── Resonance vectors (journal + personal library 512d int8) ─────
      const vec = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS n, 0 AS chars FROM journal_segment_vectors;`
      );
      const vecCount = vec?.n ?? 0;
      const vecBytes = vecCount * EMBEDDING_DIM * 4;
      packages.push({
        label: 'Journal vectors',
        count: vecCount,
        bytes: vecBytes,
      });
      estimatedTotal += vecBytes;

      const pv = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(vector_int8)), 0) AS chars
         FROM passage_vectors;`
      );
      if (pv && pv.n > 0) {
        const pvBytes = (pv.chars ?? pv.n * EMBEDDING_DIM) + pv.n * 4;
        packages.push({
          label: 'Personal Library vectors (512d int8)',
          count: pv.n,
          bytes: pvBytes,
        });
        estimatedTotal += pvBytes;
      }

      const dl = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(downloaded_bytes), 0) AS chars
         FROM offline_downloads
         WHERE status = 'complete';`
      );
      if (dl && (dl.chars ?? 0) > 0) {
        const dlBytes = dl.chars ?? 0;
        packages.push({
          label: 'Offline Resonance Engine & packs',
          count: dl.n,
          bytes: dlBytes,
        });
        estimatedTotal += dlBytes;
      }
    } catch {
      // ignore — fall through with whatever we gathered
    }
  }

  // ── On-disk database file size (the headline figure) ───────────────────
  let dbFileSizeBytes = 0;
  try {
    const dbPath = `${FileSystem.documentDirectory}SQLite/${DATABASE_NAME}`;
    const info = await FileSystem.getInfoAsync(dbPath);
    // `size` exists on native getInfoAsync results.
    const size = (info as { size?: number }).size;
    if (typeof size === 'number') {
      dbFileSizeBytes = size;
    }
  } catch {
    dbFileSizeBytes = 0;
  }

  return {
    dbFileSizeBytes,
    estimatedTotalBytes: estimatedTotal,
    packages,
  };
}

/** Format a byte count as a compact human string (e.g. "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const KB = 1024;
  const MB = KB * 1024;
  if (bytes < MB) {
    const kb = bytes / KB;
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  const mb = bytes / MB;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

// ── Journal export ────────────────────────────────────────────────────────

export interface JournalExport {
  /** Path to the written file, or null on failure. */
  path: string | null;
  segmentCount: number;
}

interface ExportSegRow {
  created_at: number;
  segment_type: string;
  text: string | null;
  parent_date: string | null;
}

/**
 * Export the journal as a plain-text document written to the app's document
 * directory. The file is timestamped and returned so the user can find it.
 */
export async function exportJournalToFile(): Promise<JournalExport> {
  const db = getDatabase();
  if (!db) return { path: null, segmentCount: 0 };

  try {
    const rows = await db.getAllAsync<ExportSegRow>(
      `SELECT created_at, segment_type, text, parent_date
       FROM journal_segments
       ORDER BY COALESCE(parent_date, ''), position_index;`
    );

    const lines: string[] = ['Resonance — Journal Export', ''];
    for (const r of rows) {
      if (r.segment_type === 'date_divider' && r.parent_date) {
        lines.push('', `── ${r.parent_date} ──`, '');
      } else if (r.segment_type === 'text' && r.text) {
        lines.push(r.text, '');
      }
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const path = `${FileSystem.documentDirectory}resonance-journal-${stamp}.txt`;
    await FileSystem.writeAsStringAsync(
      path,
      lines.join('\n'),
      { encoding: 'utf8' }
    );

    return { path, segmentCount: rows.length };
  } catch {
    return { path: null, segmentCount: 0 };
  }
}

// ── Destructive actions ───────────────────────────────────────────────────

/** Delete every journal segment (and, via CASCADE, its vectors). */
export async function clearAllJournalData(): Promise<number> {
  const db = getDatabase();
  if (!db) return 0;
  try {
    const result = await db.runAsync(
      `DELETE FROM journal_segments WHERE segment_type = 'text';`
    );
    return result.changes;
  } catch {
    return 0;
  }
}

/** Delete the user's resonance (embedding) vectors. Rebuild on next index. */
export async function clearResonanceVectors(): Promise<number> {
  const db = getDatabase();
  if (!db) return 0;
  try {
    const result = await db.runAsync(
      `DELETE FROM journal_segment_vectors;`
    );
    return result.changes;
  } catch {
    return 0;
  }
}
