import type { ResonanceResult } from '@resonance/core';
import { getDatabase } from '../db/database';
import type { DatabaseConnection } from '../db/database';
import { searchPassages } from '../db/queries/bibleQueries';

export type OfflineNodeType = 'journal_entry' | 'highlight' | 'note' | 'reading_event' | 'corpus_passage' | 'theme_snapshot';

function now(): number { return Date.now(); }
function id(prefix = 'local'): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function json(value: unknown): string { return JSON.stringify(value ?? {}); }
function parse<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
export function offlineContentHash(text: string): string {
  let h = 2166136261;
  const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function db(): Promise<DatabaseConnection | null> { return getDatabase(); }

export async function upsertOfflineSourceNode(input: {
  nodeType: OfflineNodeType;
  sourceTable: string;
  sourceId: string;
  bodyText: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const conn = await db();
  if (!conn) return null;
  const ts = now();
  const existing = await conn.getFirstAsync<{ id: string; created_at: number }>(
    `SELECT id, created_at FROM resonance_nodes WHERE node_type = ? AND source_id = ?;`,
    [input.nodeType, input.sourceId],
  );
  const nodeId = existing?.id ?? id('node');
  await conn.runAsync(
    `INSERT OR REPLACE INTO resonance_nodes
      (id, node_type, source_table, source_id, title, body_text, content_hash, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?);`,
    [nodeId, input.nodeType, input.sourceTable, input.sourceId, input.title ?? null, input.bodyText, offlineContentHash(input.bodyText), json(input.metadata ?? {}), existing?.created_at ?? ts, ts],
  );
  return { id: nodeId, source_id: input.sourceId, node_type: input.nodeType, content_hash: offlineContentHash(input.bodyText), body_text: input.bodyText };
}

export async function markOfflineNodeDeleted(nodeType: OfflineNodeType, sourceId: string) {
  const conn = await db();
  if (!conn) return null;
  await conn.runAsync(`UPDATE resonance_nodes SET status = 'deleted', updated_at = ? WHERE node_type = ? AND source_id = ?;`, [now(), nodeType, sourceId]);
  return conn.getFirstAsync<{ id: string }>(`SELECT id FROM resonance_nodes WHERE node_type = ? AND source_id = ?;`, [nodeType, sourceId]);
}

export async function appendOfflineEvent(input: { eventType: string; sourceNodeId?: string | null; sourceType?: string | null; sourceId?: string | null; payload?: Record<string, unknown> }) {
  const conn = await db();
  if (!conn) return null;
  const eventId = id('evt');
  const ts = now();
  await conn.runAsync(
    `INSERT INTO resonance_events (id, event_type, source_node_id, source_type, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [eventId, input.eventType, input.sourceNodeId ?? null, input.sourceType ?? null, input.sourceId ?? null, json(input.payload ?? {}), ts],
  );
  await conn.runAsync(`INSERT INTO sync_outbox (id, event_id, status, attempts, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?);`, [id('outbox'), eventId, ts, ts]);
  return { id: eventId };
}

export async function enqueueOfflineJob(input: { jobType: string; sourceNodeId: string; sourceTable: string; sourceId: string; priority?: number; payload?: Record<string, unknown> }) {
  const conn = await db();
  if (!conn) return null;
  const existing = await conn.getFirstAsync<{ id: string }>(`SELECT id FROM resonance_jobs WHERE source_node_id = ? AND status IN ('pending','running') LIMIT 1;`, [input.sourceNodeId]);
  if (existing) return existing;
  const jobId = id('job');
  const ts = now();
  await conn.runAsync(
    `INSERT INTO resonance_jobs (id, job_type, source_node_id, source_table, source_id, status, priority, attempts, max_attempts, run_after, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, 3, ?, ?, ?, ?);`,
    [jobId, input.jobType, input.sourceNodeId, input.sourceTable, input.sourceId, input.priority ?? 100, ts, json(input.payload ?? {}), ts, ts],
  );
  return { id: jobId };
}

function scoreText(query: string, text: string): number {
  const q = new Set(query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
  if (q.size === 0 || words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (q.has(w)) hits++;
  return Math.min(1, hits / Math.max(4, q.size));
}

async function localResonance(bodyText: string): Promise<ResonanceResult> {
  const hits = await searchPassages(bodyText, { translation: 'WEB', limit: 24 } as any).catch(() => [] as any[]);
  const scored = hits.map((hit: any) => ({ hit, sim: Math.max(scoreText(bodyText, hit.text ?? ''), hit.score ?? 0.15) })).sort((a, b) => b.sim - a.sim);
  const scripture = scored.slice(0, 3).map(({ hit, sim }: any) => ({ passageId: Number(hit.id ?? 0), bookId: String(hit.bookId ?? hit.book_id ?? hit.ref ?? 'offline-scripture'), text: hit.text ?? '', source: hit.ref ?? hit.source ?? 'Downloaded Scripture', translation: hit.translation ?? 'WEB', similarity: sim, kind: 'scripture' as const }));
  const voices = scored.slice(3, 6).map(({ hit, sim }: any) => ({ passageId: Number(hit.id ?? 0), bookId: String(hit.bookId ?? hit.book_id ?? hit.source ?? 'offline-library'), text: hit.text ?? '', source: hit.source ?? hit.bookTitle ?? 'Downloaded Library', translation: null, similarity: sim, kind: 'voice' as const }));
  return { scripture, voices, pastEntries: [] };
}

export async function getOfflineCache(sourceId: string, sourceType?: OfflineNodeType): Promise<ResonanceResult | null> {
  const conn = await db();
  if (!conn) return null;
  const node = await conn.getFirstAsync<{ id: string; content_hash: string }>(
    `SELECT id, content_hash FROM resonance_nodes WHERE source_id = ? AND status = 'active' ${sourceType ? 'AND node_type = ?' : ''} ORDER BY updated_at DESC LIMIT 1;`,
    sourceType ? [sourceId, sourceType] : [sourceId],
  );
  if (!node) return null;
  const cache = await conn.getFirstAsync<{ result_json: string }>(
    `SELECT result_json FROM resonance_result_cache WHERE source_node_id = ? AND content_hash = ? AND status = 'fresh' AND expires_at > ? ORDER BY computed_at DESC LIMIT 1;`,
    [node.id, node.content_hash, now()],
  );
  return cache ? parse<ResonanceResult>(cache.result_json, { scripture: [], voices: [], pastEntries: [] }) : null;
}

export async function processOfflineJobs(limit = 5) {
  const conn = await db();
  if (!conn) return { processed: 0 };
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await conn.getFirstAsync<any>(`SELECT * FROM resonance_jobs WHERE status = 'pending' AND run_after <= ? ORDER BY priority ASC, created_at ASC LIMIT 1;`, [now()]);
    if (!job) break;
    const node = await conn.getFirstAsync<any>(`SELECT * FROM resonance_nodes WHERE id = ? AND status = 'active';`, [job.source_node_id]);
    if (!node) {
      await conn.runAsync(`UPDATE resonance_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?;`, ['source node missing', now(), job.id]);
      continue;
    }
    const result = await localResonance(node.body_text ?? '');
    const ts = now();
    const cacheKey = `${node.id}:${node.content_hash}:offline-local`;
    await conn.runAsync(
      `INSERT OR REPLACE INTO resonance_result_cache (id, source_node_id, source_type, source_id, cache_key, content_hash, model_id, result_json, status, computed_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'offline-local', ?, 'fresh', ?, ?, ?);`,
      [id('cache'), node.id, node.node_type, node.source_id, cacheKey, node.content_hash, json(result), ts, ts + 7 * 86400000, json({ offline: true })],
    );
    const cards = [...result.scripture.map(c => ({ kind: 'scripture', c })), ...result.voices.map(c => ({ kind: 'voice', c }))];
    for (const item of cards) {
      await conn.runAsync(
        `INSERT OR REPLACE INTO resonance_edges (id, source_node_id, target_kind, target_source, target_id, target_ref, score, confidence, state, evidence, first_seen_at, last_seen_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?);`,
        [id('edge'), node.id, item.kind, item.c.source ?? null, String(item.c.passageId ?? item.c.source), item.c.source ?? null, item.c.similarity ?? 0, Math.max(0, Math.min(1, item.c.similarity ?? 0)), json([{ reason: 'offline_local_resonance', excerpt: item.c.text?.slice(0, 180) ?? null, seen_at: ts }]), ts, ts, ts + 30 * 86400000, json(item.c)],
      );
    }
    await conn.runAsync(`UPDATE resonance_jobs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?;`, [ts, ts, job.id]);
    processed++;
  }
  return { processed };
}

export async function generateOfflineThemeSnapshot() {
  const conn = await db();
  if (!conn) return null;
  const since = now() - 30 * 86400000;
  const nodes = await conn.getAllAsync<any>(`SELECT id, node_type, source_id, body_text, updated_at FROM resonance_nodes WHERE status = 'active' AND node_type IN ('journal_entry','highlight','note') AND updated_at >= ? ORDER BY updated_at DESC LIMIT 60;`, [since]);
  const texts = nodes.map((n: any) => String(n.body_text ?? '')).filter((t: string) => t.length > 12);
  if (texts.length < 2) return null;
  const terms = Array.from(new Set(texts.join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 4))).slice(0, 4);
  if (!terms.length) return null;
  const ts = now();
  const snapshot = { id: id('theme'), label: terms.slice(0, 3).join(' · '), summary: `Recently echoed around ${terms.slice(0, 3).join(' · ')}`, confidence: Math.min(0.9, 0.2 + texts.length / 20), evidence: nodes.slice(0, 8).map((n: any) => ({ source_node_id: n.id, source_type: n.node_type, source_id: n.source_id, excerpt: String(n.body_text ?? '').slice(0, 160) })) };
  await conn.runAsync(`INSERT INTO theme_snapshots (id, label, summary, confidence, evidence, status, valid_from, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?);`, [snapshot.id, snapshot.label, snapshot.summary, snapshot.confidence, json(snapshot.evidence), since, ts + 15 * 86400000, ts, ts]);
  return snapshot;
}

export async function offlineAdaptiveSummary() {
  const conn = await db();
  if (!conn) return null;
  const tables = ['resonance_nodes','resonance_events','resonance_jobs','resonance_result_cache','resonance_edges','theme_snapshots','sync_outbox'];
  const out: Record<string, number> = {};
  for (const table of tables) {
    const row = await conn.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM ${table};`);
    out[table] = row?.c ?? 0;
  }
  return out;
}
