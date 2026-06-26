#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const failures = [];
function read(path) {
  if (!existsSync(path)) {
    failures.push(`${path}: missing`);
    return '';
  }
  return readFileSync(path, 'utf8');
}
function requireMatch(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${path}: ${message}`);
}

const migrationPath = 'supabase/migrations/20260626090000_adaptive_resonance_memory.sql';
const dbPath = 'apps/web/lib/db.ts';
const journalCreatePath = 'apps/web/app/api/journal/entries/route.ts';
const journalItemPath = 'apps/web/app/api/journal/entries/[id]/route.ts';
const resonancePath = 'apps/web/app/api/resonance/route.ts';
const jobsPath = 'apps/web/app/api/resonance/jobs/route.ts';
const cachePath = 'apps/web/app/api/resonance/cache/route.ts';
const clientPath = 'apps/web/lib/client-data-layer.ts';

const migration = read(migrationPath);
for (const table of [
  'resonance_nodes',
  'resonance_embeddings',
  'resonance_events',
  'resonance_edges',
  'resonance_result_cache',
  'theme_snapshots',
  'corpus_versions',
  'book_ingestion_jobs',
  'resonance_jobs',
]) {
  requireMatch(migrationPath, migration, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i'), `migration must create ${table}`);
}
requireMatch(migrationPath, migration, /vector\(2560\)/i, 'migration must store pplx 2560-d embeddings');
requireMatch(migrationPath, migration, /content_hash/i, 'migration must include content_hash for embedding/cache invalidation');
requireMatch(migrationPath, migration, /service_role_full_access_resonance_jobs/i, 'migration must add service-role policies for new tables');

const db = read(dbPath);
for (const fn of [
  'upsertJournalResonanceNode',
  'appendResonanceEvent',
  'enqueueResonanceJob',
  'getFreshResonanceCacheForSource',
  'storeResonanceEmbedding',
  'storeResonanceCache',
  'replaceResonanceEdges',
  'processNextResonanceJob',
]) {
  requireMatch(dbPath, db, new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`), `must export ${fn}`);
}
requireMatch(dbPath, db, /createHash\('sha256'\)/, 'must hash journal content with sha256');
requireMatch(dbPath, db, /resonance_jobs[\s\S]*pending/, 'must enqueue pending resonance jobs');

const journalCreate = read(journalCreatePath);
requireMatch(journalCreatePath, journalCreate, /upsertJournalResonanceNode/, 'journal POST must upsert resonance node');
requireMatch(journalCreatePath, journalCreate, /appendResonanceEvent[\s\S]*journal\.created/, 'journal POST must append journal.created event');
requireMatch(journalCreatePath, journalCreate, /enqueueResonanceJob/, 'journal POST must enqueue resonance job');

const journalItem = read(journalItemPath);
requireMatch(journalItemPath, journalItem, /journal\.updated/, 'journal PUT must append journal.updated event');
requireMatch(journalItemPath, journalItem, /journal\.deleted/, 'journal DELETE must append journal.deleted event');
requireMatch(journalItemPath, journalItem, /enqueueResonanceJob/, 'journal PUT must enqueue recompute job');

const jobs = read(jobsPath);
requireMatch(jobsPath, jobs, /processNextResonanceJob/, 'jobs route must call processNextResonanceJob');
requireMatch(jobsPath, jobs, /limit/i, 'jobs route must support bounded processing');

const cache = read(cachePath);
requireMatch(cachePath, cache, /getFreshResonanceCacheForSource/, 'cache route must read fresh cached resonance by source id');

const resonance = read(resonancePath);
requireMatch(resonancePath, resonance, /sourceId|entryId/, '/api/resonance must accept source id/entry id for cache lookup');
requireMatch(resonancePath, resonance, /storeResonanceCache/, '/api/resonance must store cache when source id is supplied');
requireMatch(resonancePath, resonance, /replaceResonanceEdges/, '/api/resonance must store candidate edges when source id is supplied');

const client = read(clientPath);
requireMatch(clientPath, client, /findResonance\(journalText:\s*string,\s*segmentId\?:\s*string\)/, 'web data layer findResonance must accept optional segment id');
requireMatch(clientPath, client, /\/api\/resonance\/cache/, 'web findResonance must check server cache before embedding');
requireMatch(clientPath, client, /sourceId/, 'web findResonance must pass source id to /api/resonance');

if (failures.length > 0) {
  console.error('Adaptive resonance contract verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Adaptive resonance contract verification passed.');
