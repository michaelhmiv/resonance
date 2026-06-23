/**
 * Patterns service — cluster journal entries, generate weekly roundups,
 * and prepare "what shifted" narratives.
 *
 * Uses the LLM enhancement layer (generateClusterLabel, generateShiftNarrative)
 * when available; falls back to TF-IDF keyword extraction for cluster labels
 * and side-by-side comparison for shifts.
 *
 * (design spec §7.3 — LLM enhancement as opt-in, separate from embeddings;
 *  §5.8 — Patterns tab: dual-path LLM and fallback)
 */

import { getDatabase } from '../db/database';
import { cosineSimilarity, blobToVector } from './embeddingService';
import {
  generateClusterLabel,
  generateShiftNarrative,
  isLlmReady,
} from './reflectionService';
import type { JournalSegment } from '@resonance/core';

// ── Types ───────────────────────────────────────────────────────────────────

export interface EntryCluster {
  id: string;
  label: string;
  entryCount: number;
  excerpts: string[];
  dateRange: { start: string; end: string };
}

export interface WeeklyRoundup {
  weekStart: string;
  entryCount: number;
  themes: string[];
  excerpt: string;
}

export interface ShiftReport {
  comparisonDate: string;
  period1Start: string;
  period2Start: string;
  narrative: string | null;
}

// ── Clustering ───────────────────────────────────────────────────────────────

/** Similarity threshold for grouping entries into the same cluster. */
const CLUSTER_THRESHOLD = 0.65;
/** Min entries to form a cluster. */
const MIN_CLUSTER_SIZE = 2;
/** Max clusters to surface. */
const MAX_CLUSTERS = 6;

interface EntryWithVector {
  segment: JournalSegment;
  vector: Float32Array | null;
}

/**
 * Group similar journal entries into clusters. Uses cosine similarity on
 * stored embedding vectors. Falls back to TF-IDF keyword matching when
 * vectors aren't available.
 *
 * Returns clusters sorted by size (largest first), each with a label.
 */
export async function clusterEntries(
  segments: JournalSegment[]
): Promise<EntryCluster[]> {
  const textSegments = segments.filter(
    (s) => s.segment_type === 'text' && s.text && s.text.trim().length > 12
  );
  if (textSegments.length < MIN_CLUSTER_SIZE) return [];

  // Try vector-based clustering first.
  const db = getDatabase();
  let vectorMap: Map<string, Float32Array> = new Map();

  if (db) {
    try {
      const rows = await db.getAllAsync<{
        segment_id: string;
        vector_blob: Uint8Array;
      }>(`SELECT segment_id, vector_blob FROM journal_segment_vectors;`);

      for (const row of rows) {
        if (row.vector_blob && row.vector_blob.byteLength > 0) {
          vectorMap.set(row.segment_id, blobToVector(row.vector_blob));
        }
      }
    } catch {
      // vectors not available — fall through to keyword clustering
    }
  }

  // If we have vectors, do vector-based clustering.
  if (vectorMap.size >= MIN_CLUSTER_SIZE) {
    return vectorCluster(textSegments, vectorMap);
  }

  // Fallback: TF-IDF keyword clustering.
  return keywordCluster(textSegments);
}

// ── Vector-based clustering ─────────────────────────────────────────────────

function vectorCluster(
  segments: JournalSegment[],
  vectorMap: Map<string, Float32Array>
): EntryCluster[] {
  const entries: EntryWithVector[] = segments.map((segment) => ({
    segment,
    vector: vectorMap.get(segment.id) ?? null,
  }));

  const clustered: EntryWithVector[][] = [];
  const assigned = new Set<string>();

  for (const entry of entries) {
    if (assigned.has(entry.segment.id)) continue;
    if (!entry.vector) continue;

    const cluster: EntryWithVector[] = [entry];
    assigned.add(entry.segment.id);

    for (const other of entries) {
      if (assigned.has(other.segment.id)) continue;
      if (!other.vector) continue;

      const sim = cosineSimilarity(entry.vector, other.vector);
      if (sim >= CLUSTER_THRESHOLD) {
        cluster.push(other);
        assigned.add(other.segment.id);
      }
    }

    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clustered.push(cluster);
    }
  }

  // Sort by size descending, take top N.
  clustered.sort((a, b) => b.length - a.length);
  const top = clustered.slice(0, MAX_CLUSTERS);

  // Build cluster objects. Labels are generated asynchronously by the
  // caller via generateClusterLabel; for now, use TF-IDF keywords as
  // immediate labels and let the LLM replace them when ready.
  return top.map((cluster, i) => {
    const excerpts = cluster
      .map((e) => e.segment.text ?? '')
      .filter((t) => t.length > 0)
      .slice(0, 3);

    const dates = cluster
      .map((e) => e.segment.parent_date)
      .filter((d): d is string => d != null)
      .sort();

    const label = extractTopKeywords(excerpts).slice(0, 3).join(' · ');

    return {
      id: `cluster-${i}`,
      label: label || 'Reflections',
      entryCount: cluster.length,
      excerpts,
      dateRange: {
        start: dates[0] ?? '',
        end: dates[dates.length - 1] ?? '',
      },
    };
  });
}

// ── TF-IDF keyword clustering (fallback) ────────────────────────────────────

function keywordCluster(segments: JournalSegment[]): EntryCluster[] {
  // Compute TF-IDF for each segment, then group by shared top keywords.
  const docs = segments.map((s) => ({
    segment: s,
    keywords: extractTopKeywords([s.text ?? '']),
  }));

  const clustered: typeof docs[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < docs.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [docs[i]];
    assigned.add(i);

    for (let j = i + 1; j < docs.length; j++) {
      if (assigned.has(j)) continue;
      const overlap = docs[i].keywords.filter((k) =>
        docs[j].keywords.includes(k)
      );
      if (overlap.length >= 2) {
        cluster.push(docs[j]);
        assigned.add(j);
      }
    }

    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clustered.push(cluster);
    }
  }

  clustered.sort((a, b) => b.length - a.length);

  return clustered.slice(0, MAX_CLUSTERS).map((cluster, i) => {
    const excerpts = cluster
      .map((c) => c.segment.text ?? '')
      .filter((t) => t.length > 0)
      .slice(0, 3);

    const dates = cluster
      .map((c) => c.segment.parent_date)
      .filter((d): d is string => d != null)
      .sort();

    const label = cluster[0].keywords.slice(0, 3).join(' · ');

    return {
      id: `cluster-${i}`,
      label: label || 'Reflections',
      entryCount: cluster.length,
      excerpts,
      dateRange: {
        start: dates[0] ?? '',
        end: dates[dates.length - 1] ?? '',
      },
    };
  });
}

// ── TF-IDF keyword extraction ───────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'am', 'if', 'because', 'while', 'any', 'now', 'one',
  'really', 'feel', 'feeling', 'felt', 'like', 'know', 'think', 'thought',
  'want', 'need', 'go', 'going', 'went', 'get', 'got', 'come', 'came',
  'good', 'bad', 'well', 'even', 'still', 'back', 'way', 'thing', 'things',
  'much', 'many', 'lot', 'kind', 'sort', 'ever', 'never', 'always',
]);

function extractTopKeywords(texts: string[], maxKeywords = 8): string[] {
  // Compute term frequency across all texts, then pick the most frequent
  // non-stopword terms.
  const termFreq = new Map<string, number>();

  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));

    for (const word of words) {
      termFreq.set(word, (termFreq.get(word) ?? 0) + 1);
    }
  }

  return Array.from(termFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

// ── Weekly roundup ───────────────────────────────────────────────────────────

/**
 * Build a weekly roundup from entries in a given week (ISO week starting Monday).
 * Returns a serene overview: entry count, top themes, and a representative excerpt.
 */
export async function generateWeeklyRoundup(
  segments: JournalSegment[],
  weekStart: string
): Promise<WeeklyRoundup> {
  const weekEnd = addDays(weekStart, 7);

  const weekEntries = segments.filter((s) => {
    if (!s.parent_date) return false;
    return s.parent_date >= weekStart && s.parent_date < weekEnd;
  });

  const textEntries = weekEntries.filter(
    (s) => s.segment_type === 'text' && s.text && s.text.trim().length > 0
  );

  if (textEntries.length === 0) {
    return {
      weekStart,
      entryCount: 0,
      themes: [],
      excerpt: '',
    };
  }

  // Extract themes via TF-IDF (LLM could enhance this, but themes are
  // a lightweight summary — keywords suffice).
  const themes = extractTopKeywords(
    textEntries.map((e) => e.text ?? ''),
    5
  );

  // Pick a representative excerpt — the longest entry (usually the most
  // substantial reflection).
  const longest = [...textEntries].sort(
    (a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0)
  )[0];

  const excerpt = (longest.text ?? '').slice(0, 200);

  return {
    weekStart,
    entryCount: textEntries.length,
    themes,
    excerpt,
  };
}

// ── "What shifted" report ───────────────────────────────────────────────────

/**
 * Compare two time periods and generate a shift narrative. Uses the LLM
 * when available; falls back to returning null (the UI shows side-by-side
 * excerpts instead).
 */
export async function generateShiftReport(
  segments: JournalSegment[],
  period1Start: string,
  period2Start: string
): Promise<ShiftReport> {
  const p1End = addDays(period1Start, 7);
  const p2End = addDays(period2Start, 7);

  const p1Entries = segments.filter((s) => {
    if (!s.parent_date || s.segment_type !== 'text') return false;
    return s.parent_date >= period1Start && s.parent_date < p1End;
  });

  const p2Entries = segments.filter((s) => {
    if (!s.parent_date || s.segment_type !== 'text') return false;
    return s.parent_date >= period2Start && s.parent_date < p2End;
  });

  let narrative: string | null = null;

  if (isLlmReady() && p1Entries.length > 0 && p2Entries.length > 0) {
    narrative = await generateShiftNarrative(
      p1Entries.map((e) => e.text ?? ''),
      p2Entries.map((e) => e.text ?? '')
    );
  }

  return {
    comparisonDate: new Date().toISOString().slice(0, 10),
    period1Start,
    period2Start,
    narrative,
  };
}

// ── Calendar data ───────────────────────────────────────────────────────────

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  hasEntries: boolean;
  entryCount: number;
}

/**
 * Build a calendar grid for a given month: which days have journal entries.
 */
export async function getCalendarDays(
  segments: JournalSegment[],
  year: number,
  month: number // 0-indexed
): Promise<CalendarDay[]> {
  const days: CalendarDay[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entries = segments.filter(
      (s) => s.parent_date === dateStr && s.segment_type === 'text' && s.text && s.text.trim().length > 0
    );
    days.push({
      date: dateStr,
      hasEntries: entries.length > 0,
      entryCount: entries.length,
    });
  }

  return days;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
