/**
 * Offline SQLite concordance adapter for mobile Patterns.
 *
 * Queries local SQLite tables (Migration v1 + v2 + v3 Personal Library & 512d
 * int8 passage_vectors) and delegates all concordance calculations to the pure
 * shared engine in `@resonance/core`. Zero network calls — 100% private and
 * instant on-device.
 */

import {
  blobToVector,
  buildBookBridgesFromData,
  buildConcordanceDayDetail,
  buildConcordanceSummary,
  classifyLiteratureGroup,
  dotProductFloat32Int8,
  LITERATURE_SHELF_GROUPS,
  normalizePatternDate,
  parseBibleBookName,
  resolveTimeframeWindow,
  shiftDateDays,
  type BookBridgeResult,
  type CandidateBookPassage,
  type ConcordanceRawInput,
  type CrossRefBridgePair,
  type InstalledVoiceBookInfo,
  type PatternDayDetail,
  type PatternFeedbackInput,
  type PatternTimeframe,
  type PatternsSummary,
  type VectorBridgeHit,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import { getCrossReferences } from '../db/queries/readingQueries';

function inWindow(date: string | null, start: string, end: string): boolean {
  return Boolean(date && date >= start && date <= end);
}

async function safeAll<T>(sql: string, params: Array<string | number | null> = []): Promise<T[]> {
  const db = getDatabase();
  if (!db) return [];
  try {
    return await db.getAllAsync<T>(sql, params);
  } catch {
    return [];
  }
}

async function loadInstalledVoices(): Promise<InstalledVoiceBookInfo[]> {
  // Migration v3 adds personal_books(include_in_resonance); fall back cleanly on older DBs.
  let rows = await safeAll<{
    id: string;
    title: string | null;
    author: string | null;
    era: string | null;
    package_id: string | null;
    source: string | null;
    include_in_resonance: number | null;
  }>(
    `SELECT b.id, b.title, b.author, b.era, b.package_id, b.source, pb.include_in_resonance
     FROM books b
     LEFT JOIN personal_books pb ON pb.book_id = b.id
     WHERE b.type = 'voice'
     ORDER BY COALESCE(b.author, b.title, b.id);`,
  );

  if (rows.length === 0) {
    const legacyRows = await safeAll<{
      id: string;
      title: string | null;
      author: string | null;
      era: string | null;
      package_id: string | null;
      source: string | null;
    }>(
      `SELECT id, title, author, era, package_id, source
       FROM books
       WHERE type = 'voice'
       ORDER BY COALESCE(author, title, id);`,
    );
    rows = legacyRows.map((r) => ({ ...r, include_in_resonance: null }));
  }

  return rows
    .filter((r) => r.include_in_resonance !== 0)
    .map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      era: r.era,
      packageId: r.package_id,
      source: r.source,
    }));
}

async function loadLocalRaw(
  start: string,
  end: string,
  installedVoices: InstalledVoiceBookInfo[],
): Promise<ConcordanceRawInput> {
  const [journalRows, readingRows, highlightRows, bookmarkRows, eventRows, nodeRows, edgeRows, snapshotRows] =
    await Promise.all([
      safeAll<{ id: string; text: string | null; created_at: number; updated_at: number }>(
        `SELECT id, text, created_at, updated_at
         FROM journal_segments
         WHERE segment_type = 'text' AND text IS NOT NULL AND length(trim(text)) > 0
         ORDER BY created_at DESC
         LIMIT 500;`,
      ),
      safeAll<{ id: string; book_id: string; chapter: number; verse_ref: string; created_at: number }>(
        `SELECT id, book_id, chapter, verse_ref, created_at
         FROM reading_events
         ORDER BY created_at DESC
         LIMIT 1000;`,
      ),
      safeAll<{
        id: string;
        verse_ref: string;
        color: string | null;
        selected_text?: string | null;
        note_text?: string | null;
        note_updated_at?: number | null;
        created_at: number;
        updated_at?: number | null;
      }>(
        `SELECT * FROM highlights ORDER BY created_at DESC LIMIT 1000;`,
      ),
      safeAll<{ id: string; verse_ref: string; label: string | null; created_at: number }>(
        `SELECT id, verse_ref, label, created_at
         FROM bookmarks
         ORDER BY created_at DESC
         LIMIT 500;`,
      ),
      safeAll<{ id: string; event_type: string; created_at: number }>(
        `SELECT id, event_type, created_at
         FROM resonance_events
         ORDER BY created_at DESC
         LIMIT 400;`,
      ),
      safeAll<{
        id: string;
        node_type: string;
        source_table: string;
        source_id: string;
        title: string | null;
        body_text: string | null;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT id, node_type, source_table, source_id, title, body_text, created_at, updated_at
         FROM resonance_nodes
         WHERE status = 'active'
         ORDER BY updated_at DESC
         LIMIT 600;`,
      ),
      safeAll<{
        id: string;
        source_node_id: string;
        target_kind: string;
        target_source: string | null;
        target_id: string;
        target_ref: string | null;
        score: number;
        confidence: number;
        state: string;
        evidence: string;
        first_seen_at: number;
        last_seen_at: number;
        metadata: string;
      }>(
        `SELECT * FROM resonance_edges
         WHERE state IN ('candidate', 'active', 'reinforced')
         ORDER BY last_seen_at DESC
         LIMIT 400;`,
      ),
      safeAll<{
        id: string;
        label: string;
        summary: string | null;
        confidence: number;
        evidence: string;
        valid_from: number;
        expires_at: number | null;
      }>(
        `SELECT id, label, summary, confidence, evidence, valid_from, expires_at
         FROM theme_snapshots
         WHERE status = 'active'
         ORDER BY created_at DESC
         LIMIT 20;`,
      ),
    ]);

  return {
    journal: journalRows
      .filter((r) => inWindow(normalizePatternDate(r.created_at), start, end))
      .map((r) => ({
        id: r.id,
        text: r.text ?? '',
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    reading: readingRows.filter((r) => inWindow(normalizePatternDate(r.created_at), start, end)),
    highlights: highlightRows.filter(
      (h) =>
        inWindow(normalizePatternDate(h.created_at), start, end) ||
        inWindow(normalizePatternDate(h.note_updated_at ?? h.updated_at), start, end),
    ),
    bookmarks: bookmarkRows.filter((b) => inWindow(normalizePatternDate(b.created_at), start, end)),
    events: eventRows.filter((e) => inWindow(normalizePatternDate(e.created_at), start, end)),
    nodes: nodeRows,
    edges: edgeRows.filter(
      (e) => inWindow(normalizePatternDate(e.last_seen_at), start, end) || !e.last_seen_at,
    ),
    snapshots: snapshotRows,
    installedVoices,
  };
}

/**
 * Score a single book's Migration-v3 int8 `passage_vectors` against recent
 * `journal_segment_vectors` for true on-device semantic bridges (512d Voyage-4-Nano).
 * Returns [] cleanly when vectors haven't been embedded yet so lexical/cross-ref
 * bridges take over seamlessly.
 */
async function computeBookVectorBridges(
  bookIds: string[],
  bookPassages: CandidateBookPassage[],
  start: string,
  end: string,
): Promise<VectorBridgeHit[]> {
  if (bookIds.length === 0 || bookPassages.length === 0) return [];

  const journalVecRows = await safeAll<{
    segment_id: string;
    vector_blob: Uint8Array;
    text: string | null;
    created_at: number;
  }>(
    `SELECT jsv.segment_id, jsv.vector_blob, js.text, js.created_at
     FROM journal_segment_vectors jsv
     JOIN journal_segments js ON js.id = jsv.segment_id
     WHERE js.segment_type = 'text' AND js.text IS NOT NULL AND jsv.vector_blob IS NOT NULL
     ORDER BY js.created_at DESC
     LIMIT 20;`,
  );

  const queries = journalVecRows
    .filter((r) => inWindow(normalizePatternDate(r.created_at), start, end))
    .map((r) => ({
      vec: blobToVector(r.vector_blob),
      date: normalizePatternDate(r.created_at),
      text: r.text ?? '',
    }))
    .filter((q) => q.vec.length > 0 && q.text.trim().length >= 12);

  if (queries.length === 0) return [];

  const placeholders = bookIds.map(() => '?').join(', ');
  const pvRows = await safeAll<{
    passage_id: number;
    dim: number;
    scale: number;
    vector_int8: Uint8Array;
  }>(
    `SELECT passage_id, dim, scale, vector_int8
     FROM passage_vectors
     WHERE book_id IN (${placeholders})
     LIMIT 600;`,
    bookIds,
  );
  if (pvRows.length === 0) return [];

  const passageById = new Map<number, CandidateBookPassage>();
  for (const p of bookPassages) passageById.set(p.id, p);

  const hits: VectorBridgeHit[] = [];
  for (const pv of pvRows) {
    const passage = passageById.get(pv.passage_id);
    if (!passage || !pv.vector_int8 || pv.dim <= 0) continue;
    const rawBytes =
      pv.vector_int8 instanceof Uint8Array
        ? pv.vector_int8
        : new Uint8Array(pv.vector_int8 as unknown as ArrayBuffer);
    const int8 = new Int8Array(
      rawBytes.buffer,
      rawBytes.byteOffset,
      rawBytes.byteLength,
    );
    if (int8.length < pv.dim) continue;

    let bestScore = -1;
    let bestQuery = queries[0];
    for (const q of queries) {
      if (q.vec.length !== pv.dim) continue;
      const sim = dotProductFloat32Int8(q.vec, int8, 0, pv.scale, pv.dim);
      if (sim > bestScore) {
        bestScore = sim;
        bestQuery = q;
      }
    }

    if (bestScore >= 0.28) {
      hits.push({
        passage,
        score: bestScore,
        journalDate: bestQuery.date,
        journalExcerpt: bestQuery.text,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}

export async function getOfflinePatternsSummary(
  start: string,
  end: string,
  timeframe: PatternTimeframe = '30d',
): Promise<PatternsSummary> {
  const installedVoices = await loadInstalledVoices();
  const tfWindow = resolveTimeframeWindow(timeframe);
  const [calendarRaw, timeframeRaw] = await Promise.all([
    loadLocalRaw(start, end, installedVoices),
    loadLocalRaw(tfWindow.start, tfWindow.end, installedVoices),
  ]);

  return buildConcordanceSummary({
    calendarRaw,
    timeframeRaw,
    calendarWindow: { start, end },
    timeframe,
  });
}

export async function getOfflinePatternDayDetail(date: string): Promise<PatternDayDetail> {
  const installedVoices = await loadInstalledVoices();
  const contextStart = shiftDateDays(date, -30);
  const todayStr = new Date().toISOString().slice(0, 10);
  const forward = shiftDateDays(date, 7);
  const contextEnd = forward > todayStr ? todayStr : forward;
  const contextRaw = await loadLocalRaw(contextStart, contextEnd, installedVoices);

  return buildConcordanceDayDetail({
    date,
    contextRaw,
    contextStart,
    contextEnd,
  });
}

export async function getOfflineBookBridges(
  kind: 'bible' | 'voice',
  id: string,
  timeframe: PatternTimeframe,
  bookId?: string,
): Promise<BookBridgeResult> {
  const installedVoices = await loadInstalledVoices();
  const tfWindow = resolveTimeframeWindow(timeframe);
  const raw = await loadLocalRaw(tfWindow.start, tfWindow.end, installedVoices);

  if (kind === 'bible') {
    const bookName = parseBibleBookName(id) ?? id;
    const slug = bookName.replace(/\s+/g, '_');
    const resolvedBookId = bookId || `WEB_${slug}`;
    const candidateBookIds = Array.from(
      new Set([resolvedBookId, `WEB_${slug}`, `web_${slug}`]),
    );
    const passageRows = await safeAll<{
      id: number;
      book_id: string;
      chapter: number | null;
      verse_start: number | null;
      text: string | null;
    }>(
      `SELECT id, book_id, chapter, verse_start, text
       FROM passages
       WHERE (book_id = ? OR book_id = ? OR lower(book_id) = ?)
         AND text IS NOT NULL
       ORDER BY chapter, verse_start
       LIMIT 600;`,
      [resolvedBookId, `WEB_${slug}`, `web_${slug.toLowerCase()}`],
    );

    const bookPassages: CandidateBookPassage[] = passageRows.map((p) => ({
      id: p.id,
      ref:
        p.verse_start != null
          ? `${bookName} ${p.chapter ?? ''}:${p.verse_start}`.trim()
          : `${bookName} ${p.chapter ?? ''}`.trim(),
      bookId: p.book_id,
      chapter: p.chapter,
      verse: p.verse_start,
      text: p.text ?? '',
    }));

    const passageByRef = new Map<string, CandidateBookPassage>();
    for (const p of bookPassages) {
      passageByRef.set(p.ref.toLowerCase().replace(/[^a-z0-9]/g, ''), p);
    }

    const crossRefPairs: CrossRefBridgePair[] = [];
    const seen = new Set<string>();
    for (const hl of raw.highlights.slice(0, 30)) {
      if (!hl.verse_ref || parseBibleBookName(hl.verse_ref) === bookName) continue;
      const targets = await getCrossReferences(hl.verse_ref);
      for (const target of targets) {
        if (parseBibleBookName(target) !== bookName) continue;
        const normTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(normTarget)) continue;
        seen.add(normTarget);
        const match = passageByRef.get(normTarget);
        crossRefPairs.push({
          fromHighlightRef: hl.verse_ref,
          fromExcerpt: hl.note_text ?? hl.selected_text ?? null,
          targetRef: match?.ref ?? target,
          targetText: match?.text ?? null,
        });
        if (crossRefPairs.length >= 3) break;
      }
      if (crossRefPairs.length >= 3) break;
    }

    const vectorBridgeHits = await computeBookVectorBridges(
      candidateBookIds,
      bookPassages,
      tfWindow.start,
      tfWindow.end,
    );

    return buildBookBridgesFromData({
      kind: 'bible',
      id: bookName,
      bookId: resolvedBookId,
      title: bookName,
      subtitle: 'Scripture · Living Concordance',
      timeframe,
      raw,
      bookPassages,
      crossRefPairs,
      vectorBridgeHits,
    });
  }

  const voice = installedVoices.find((v) => v.id === id || v.id === bookId) ?? null;
  const resolvedBookId = voice?.id ?? bookId ?? id;
  const title = voice?.author ?? voice?.title ?? id;
  const eraGroupId = classifyLiteratureGroup(voice?.packageId, voice?.era, voice?.source);
  const eraMeta = LITERATURE_SHELF_GROUPS.find((g) => g.id === eraGroupId);
  const subtitle = [voice?.title, eraMeta?.fullLabel].filter(Boolean).join(' · ') || 'Installed Literature';

  const passageRows = await safeAll<{ id: number; book_id: string; text: string | null }>(
    `SELECT id, book_id, text
     FROM passages
     WHERE book_id = ? AND text IS NOT NULL
     ORDER BY id
     LIMIT 400;`,
    [resolvedBookId],
  );
  const bookPassages: CandidateBookPassage[] = passageRows.map((p) => ({
    id: p.id,
    ref: [voice?.author, voice?.title].filter(Boolean).join(' · ') || title,
    bookId: p.book_id,
    text: p.text ?? '',
  }));

  const vectorBridgeHits = await computeBookVectorBridges(
    [resolvedBookId],
    bookPassages,
    tfWindow.start,
    tfWindow.end,
  );

  return buildBookBridgesFromData({
    kind: 'voice',
    id: resolvedBookId,
    bookId: resolvedBookId,
    title,
    subtitle,
    timeframe,
    raw,
    bookPassages,
    vectorBridgeHits,
  });
}

export async function recordOfflinePatternFeedback(
  input: PatternFeedbackInput,
): Promise<{ ok: boolean }> {
  const db = getDatabase();
  if (!db) return { ok: false };
  const ts = Date.now();
  const evtId = `evt-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.runAsync(
      `INSERT INTO resonance_events (id, event_type, source_node_id, source_type, source_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        evtId,
        `patterns.${input.surface}.${input.action}`,
        input.sourceNodeId ?? null,
        input.surface,
        input.itemId,
        JSON.stringify(input.metadata ?? {}),
        ts,
      ],
    );
    const nextState =
      input.action === 'saved'
        ? 'reinforced'
        : input.action === 'opened'
          ? 'active'
          : 'dismissed';
    if (input.edgeId) {
      await db.runAsync(
        `UPDATE resonance_edges SET state = ?, last_seen_at = ? WHERE id = ?;`,
        [nextState, ts, input.edgeId],
      );
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
