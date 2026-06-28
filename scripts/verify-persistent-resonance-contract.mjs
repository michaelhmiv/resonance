#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const failures = [];
function read(path) { return readFileSync(path, 'utf8'); }
function fail(path, message) { failures.push(`${path}: ${message}`); }

const dbPath = 'apps/web/lib/db.ts';
const entriesRoutePath = 'apps/web/app/api/journal/entries/route.ts';
const entryRoutePath = 'apps/web/app/api/journal/entries/[id]/route.ts';
const prewarmRoutePath = 'apps/web/app/api/resonance/prewarm/route.ts';
const prewarmScriptPath = 'scripts/prewarm-journal-resonance.mjs';
const packagePath = 'package.json';

const db = read(dbPath);
const entriesRoute = read(entriesRoutePath);
const entryRoute = read(entryRoutePath);
let prewarmRoute = '';
let prewarmScript = '';
try { prewarmRoute = read(prewarmRoutePath); } catch { fail(prewarmRoutePath, 'must exist.'); }
try { prewarmScript = read(prewarmScriptPath); } catch { fail(prewarmScriptPath, 'must exist.'); }
const pkg = read(packagePath);

// Contract 1: stored resonance is durable derived data, not a 7-day short-lived cache.
if (/\.gt\('expires_at',/.test(db)) {
  fail(dbPath, 'must not check expires_at on stored resonance lookups — status + content_hash + model_id is sufficient.');
}
if (!/getStoredResonanceForNode\b/.test(db)) {
  fail(dbPath, 'must expose getStoredResonanceForNode for deterministic source-node/content-hash verification.');
}

// Contract 2: journal create/update must compute/store resonance immediately, not only enqueue a someday job.
for (const [path, source, name] of [
  [entriesRoutePath, entriesRoute, 'create'],
  [entryRoutePath, entryRoute, 'update'],
]) {
  if (!/precomputeJournalEntryResonance\b/.test(source)) {
    fail(path, `journal ${name} route must call precomputeJournalEntryResonance so new/edited entries are warm on save.`);
  }
}

// Contract 3: there must be an explicit authenticated backfill/prewarm path for old entries after deploy.
if (prewarmRoute) {
  if (!/RESonANCE_JOB_SECRET|RESONANCE_JOB_SECRET/.test(prewarmRoute)) {
    fail(prewarmRoutePath, 'must require RESONANCE_JOB_SECRET authentication.');
  }
  if (!/getJournalEntries\b/.test(prewarmRoute) || !/precomputeJournalEntryResonance\b/.test(prewarmRoute)) {
    fail(prewarmRoutePath, 'must iterate journal entries and precompute missing stored resonance.');
  }
  if (!/force/.test(prewarmRoute) || !/limit/.test(prewarmRoute)) {
    fail(prewarmRoutePath, 'must support bounded force/limit controls for safe deploy verification.');
  }
}
if (prewarmScript) {
  if (!/api\/resonance\/prewarm/.test(prewarmScript)) {
    fail(prewarmScriptPath, 'must call /api/resonance/prewarm.');
  }
  if (!/RESONANCE_JOB_SECRET/.test(prewarmScript)) {
    fail(prewarmScriptPath, 'must authenticate with RESONANCE_JOB_SECRET.');
  }
}
if (!/"prewarm:journal-resonance"/.test(pkg) || !/"verify:persistent-resonance"/.test(pkg)) {
  fail(packagePath, 'must expose prewarm:journal-resonance and verify:persistent-resonance scripts.');
}

if (failures.length) {
  console.error('Persistent resonance contract verification failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('Persistent resonance contract verification passed.');
