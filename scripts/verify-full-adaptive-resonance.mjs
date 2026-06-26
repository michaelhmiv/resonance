#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const failures = [];
function read(path) { if (!existsSync(path)) { failures.push(`${path}: missing`); return ''; } return readFileSync(path, 'utf8'); }
function requireMatch(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

// ─── 1. Schema ───
const migration = read('supabase/migrations/20260626090000_adaptive_resonance_memory.sql');
for (const table of ['resonance_nodes','resonance_embeddings','resonance_events','resonance_edges','resonance_result_cache','theme_snapshots','resonance_jobs']) {
  requireMatch(migration, migration, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table.replace('_','\\\\_')}`,'i'), `migration creates ${table}`);
}
requireMatch(migration, migration, /vector\(2560\)/i, 'migration stores pplx 2560-d embeddings');

// ─── 2. Core DB functions ───
const db = read('apps/web/lib/db.ts');
for (const fn of ['upsertJournalResonanceNode','appendResonanceEvent','enqueueResonanceJob','getFreshResonanceCacheForSource','storeResonanceEmbedding','storeResonanceCache','replaceResonanceEdges','processNextResonanceJob','runResonanceMaintenance','generateThemeSnapshot','upsertHighlightResonanceNodes','markHighlightResonanceNodesDeleted']) {
  requireMatch(db, db, new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`), `db.ts exports ${fn}`);
}

// ─── 3. Job processor security ───
const jobsRoute = read('apps/web/app/api/resonance/jobs/route.ts');
requireMatch(jobsRoute, jobsRoute, /RESONANCE_JOB_SECRET/, 'jobs route checks RESONANCE_JOB_SECRET');
requireMatch(jobsRoute, jobsRoute, /runResonanceMaintenance/, 'jobs route supports maintenance');

// ─── 4. Cache route ───
const cacheRoute = read('apps/web/app/api/resonance/cache/route.ts');
requireMatch(cacheRoute, cacheRoute, /sourceType/, 'cache route supports sourceType');

// ─── 5. Highlights wiring ───
const hlPost = read('apps/web/app/api/reading/highlights/route.ts');
requireMatch(hlPost, hlPost, /upsertHighlightResonanceNodes/, 'highlights POST upserts resonance nodes');
requireMatch(hlPost, hlPost, /appendResonanceEvent/, 'highlights POST logs event');
requireMatch(hlPost, hlPost, /enqueueResonanceJob\b/, 'highlights POST enqueues job');

const hlPatch = read('apps/web/app/api/reading/highlights/[id]/route.ts');
requireMatch(hlPatch, hlPatch, /enqueueResonanceJob\b/, 'highlights PATCH enqueues job');

// ─── 6. Themes ───
const themesRoute = read('apps/web/app/api/patterns/themes/route.ts');
requireMatch(themesRoute, themesRoute, /generateThemeSnapshot/, 'themes route generates snapshots');
requireMatch(themesRoute, themesRoute, /RESONANCE_JOB_SECRET/, 'themes route secures maintenance');

// ─── 7. Resonance route ───
const resRoute = read('apps/web/app/api/resonance/route.ts');
requireMatch(resRoute, resRoute, /sourceType/, 'resonance route handles sourceType');

// ─── 8. Mobile offline store ───
const offStore = read('apps/mobile/src/embedding/offlineAdaptiveStore.ts');
for (const sym of ['upsertOfflineSourceNode','processOfflineJobs','getOfflineCache','generateOfflineThemeSnapshot']) {
  requireMatch(offStore, offStore, new RegExp(sym.replace(/[\[\]]/g, '\\\\$&')), `offline store exports ${sym}`);
}
for (const tbl of ['resonance_nodes','resonance_jobs','resonance_result_cache','resonance_edges','theme_snapshots']) {
  requireMatch(offStore, offStore, new RegExp(tbl.replace(/_/g, '[_]')), `offline store references ${tbl}`);
}

// ─── Report ───
if (failures.length) { console.error('Full adaptive resonance verification FAILED:'); failures.forEach(f => console.error(`  - ${f}`)); process.exit(1); }
console.log('Full adaptive resonance verification PASSED');
